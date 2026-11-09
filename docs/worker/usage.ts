// The usage ledger: what has been spent today, per brain and per visitor (plan #309 D10; ported from gmt `worker/usage.ts`).
//
// Advisory, never a gate. The only thing that refuses a request is the provider's own error; the ledger picks a brain that
// probably still has room, and tells the reader honestly what is left. That is why Workers KV, eventually consistent, is
// enough: a count that lags by one changes a digit in a badge and cannot let through what a provider would refuse.
//
// A brain's keys are bucketed by its provider's day (Pacific for Gemini, UTC for Workers AI), so a count refills and a
// spent mark expires when the provider's allowance does. The visitor cap is Dox's own and runs on the UTC day.
//
// Every mutation is best-effort: a write failure is logged and swallowed, because the right answer to "could not record
// that you asked" is to answer. Every read failure reads as "no record", which is optimism: try the brain, let the
// provider decide. Visitor keys hold a truncated SHA-256 of the client id, never the address.

import { convertUnixToUtc } from "@northguild/gmt/unix/convert";
import {
  BRAIN_PROVIDER_LABEL,
  BRAIN_RESET_TIME_ZONE,
  type Brain,
  type BrainProvider,
} from "../src/chat/lib/chat-constants";
import type { ProviderStatus } from "../src/chat/lib/chat-types";
import {
  dayKey,
  nextMidnightMs,
  secondsUntilMidnight,
  secondsUntilVisitorReset,
  visitorDayKey,
} from "../src/chat/lib/day-clock";
import { describeThrown } from "./error-mapping";

/** The request's ids, so a ledger line can be matched to the request that caused it (observability standard). */
export interface LedgerContext {
  threadId?: string;
  runId?: string;
}

/**
 * One structured warn line for a ledger failure: unexpected, but the request went on in degraded mode. Never the value,
 * never more of the error than its message.
 */
function logLedger(
  event: "usage.read_failed" | "usage.write_failed" | "usage.mark_failed",
  detail: Record<string, string>,
  error: unknown,
  context: LedgerContext,
): void {
  console.warn(
    JSON.stringify({
      event,
      level: "warn",
      ...detail,
      error: describeThrown(error).message,
      ...context,
    }),
  );
}

/** The part of a KV namespace this module uses, hand-declared like `AiBinding`: a `KVNamespace` satisfies it. */
export interface UsageStore {
  get(key: string): Promise<string | null>;
  put(
    key: string,
    value: string,
    options?: { expirationTtl?: number },
  ): Promise<void>;
}

/** Why a brain is not currently usable. */
export type BrainState = "ok" | "spent" | "unavailable";

/** What the ledger needs to know about a brain: which one, and whose clock. */
export type LedgerBrain = Pick<Brain, "id" | "provider">;

export interface UsageSnapshot {
  /** Requests recorded against each brain today. */
  perBrain: Record<string, number>;
  /** Whether each brain is out for today. */
  states: Record<string, BrainState>;
  /** Requests this visitor has spent today. */
  visitor: number;
}

/** What a reader sees when there is no ledger: nothing spent, nothing marked. */
export const EMPTY_SNAPSHOT: UsageSnapshot = {
  perBrain: {},
  states: {},
  visitor: 0,
};

function brainClock(
  brain: LedgerBrain,
  nowMs: number,
): { day: string; ttl: number } {
  const zone = BRAIN_RESET_TIME_ZONE[brain.provider];
  return { day: dayKey(nowMs, zone), ttl: secondsUntilMidnight(nowMs, zone) };
}

const countKey = (day: string, brainId: string) => `model:${day}:${brainId}`;
const stateKey = (day: string, brainId: string) => `state:${day}:${brainId}`;
const visitorKey = (day: string, hash: string) => `visitor:${day}:${hash}`;

/** Each provider behind `brains`, once, in the order its first brain appears, with the instant its allowance next refills. */
export function providerResets(
  brains: readonly LedgerBrain[],
  nowMs: number,
): ProviderStatus[] {
  const providers: BrainProvider[] = [
    ...new Set(brains.map((brain) => brain.provider)),
  ];
  return providers.map((id) => ({
    id,
    label: BRAIN_PROVIDER_LABEL[id],
    resetsAt: convertUnixToUtc(
      nextMidnightMs(nowMs, BRAIN_RESET_TIME_ZONE[id]),
    ),
  }));
}

/** A stable, non-reversible id for a visitor (D10): the first 16 hex characters of SHA-256 of `dox:<client id>`. */
export async function hashVisitor(clientId: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`dox:${clientId}`),
  );
  return [...new Uint8Array(digest)]
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function toCount(raw: string | null): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

/** Reads everything the brain choice and the badge need, in parallel. A rejected read is "no record". */
export async function readUsage(
  store: UsageStore,
  brains: readonly LedgerBrain[],
  visitorHash: string,
  nowMs: number,
  context: LedgerContext = {},
): Promise<UsageSnapshot> {
  const safeGet = async (key: string): Promise<string | null> => {
    try {
      return await store.get(key);
    } catch (error) {
      logLedger("usage.read_failed", { key }, error, context);
      return null;
    }
  };

  const days = brains.map((brain) => brainClock(brain, nowMs).day);
  const [counts, states, visitor] = await Promise.all([
    Promise.all(
      brains.map((brain, i) => safeGet(countKey(days[i] as string, brain.id))),
    ),
    Promise.all(
      brains.map((brain, i) => safeGet(stateKey(days[i] as string, brain.id))),
    ),
    safeGet(visitorKey(visitorDayKey(nowMs), visitorHash)),
  ]);

  const perBrain: Record<string, number> = {};
  const stateMap: Record<string, BrainState> = {};
  brains.forEach(({ id }, i) => {
    perBrain[id] = toCount(counts[i] ?? null);
    const raw = states[i];
    stateMap[id] = raw === "spent" || raw === "unavailable" ? raw : "ok";
  });
  return { perBrain, states: stateMap, visitor: toCount(visitor) };
}

/**
 * Records one request against a brain and a visitor. Read-then-write, so it can lose an increment under concurrency:
 * accepted, because the count is advisory.
 */
export async function recordRequest(
  store: UsageStore,
  brain: LedgerBrain,
  visitorHash: string,
  nowMs: number,
  context: LedgerContext = {},
): Promise<void> {
  const { day, ttl } = brainClock(brain, nowMs);
  const bump = async (key: string, expirationTtl: number): Promise<void> => {
    const next = toCount(await store.get(key)) + 1;
    await store.put(key, String(next), { expirationTtl });
  };
  const writes: [key: string, expirationTtl: number][] = [
    [countKey(day, brain.id), ttl],
    [
      visitorKey(visitorDayKey(nowMs), visitorHash),
      secondsUntilVisitorReset(nowMs),
    ],
  ];
  await Promise.all(
    writes.map(([key, expirationTtl]) =>
      bump(key, expirationTtl).catch((error) => {
        logLedger("usage.write_failed", { key }, error, context);
      }),
    ),
  );
}

/**
 * Marks a brain out for the rest of its provider's day: `spent` from an exhausted quota, `unavailable` from a model this
 * account cannot call. Both expire at the provider's midnight, so a withdrawn model is probed again tomorrow.
 */
export async function markBrain(
  store: UsageStore,
  brain: LedgerBrain,
  state: Exclude<BrainState, "ok">,
  nowMs: number,
  context: LedgerContext = {},
): Promise<void> {
  const { day, ttl } = brainClock(brain, nowMs);
  try {
    await store.put(stateKey(day, brain.id), state, { expirationTtl: ttl });
  } catch (error) {
    logLedger(
      "usage.mark_failed",
      { key: stateKey(day, brain.id), state },
      error,
      context,
    );
  }
}
