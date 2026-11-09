// What the badge and the brain menu show, from one ledger snapshot (plan #309 D10; ported from gmt `worker/brains-payload.ts`).
//
// One builder for the two places that send it: `GET /api/brains`, and the `dox-usage` event once a question has been
// counted (`chat-handler.ts`). The ledger is advisory (`usage.ts`): nothing here refuses a request.

import { convertUnixToUtc } from "@northguild/gmt/unix/convert";
import { type Brain, VISITOR_DAILY_MAX } from "../src/chat/lib/chat-constants";
import type { BrainsInfo } from "../src/chat/lib/chat-types";
import { nextVisitorMidnightMs } from "../src/chat/lib/day-clock";
import { configuredBrains, type Env, stringVars } from "./brains";
import {
  chatRateLimiter,
  getClientId,
  nowMs,
  retryAfterSeconds,
} from "./rate-limit";
import {
  type BrainState,
  EMPTY_SNAPSHOT,
  hashVisitor,
  type LedgerBrain,
  providerResets,
  readUsage,
  type UsageSnapshot,
} from "./usage";

/** Whether the ledger has not marked `brain` out for today. */
export function isUsable(brain: LedgerBrain, snapshot: UsageSnapshot): boolean {
  return (snapshot.states[brain.id] ?? "ok") === "ok";
}

/** Requests left on a brain for the badge: its `dailyLimit` less the count, and 0 for a brain marked out. */
export function remainingFor(brain: Brain, snapshot: UsageSnapshot): number {
  if (!isUsable(brain, snapshot)) return 0;
  return Math.max(0, brain.dailyLimit - (snapshot.perBrain[brain.id] ?? 0));
}

export function brainsPayload({
  brains,
  snapshot,
  nowMs: now,
}: {
  brains: readonly Brain[];
  snapshot: UsageSnapshot;
  nowMs: number;
}): BrainsInfo {
  return {
    brains: brains.map((brain) => ({
      id: brain.id,
      label: brain.label,
      provider: brain.provider,
      remaining: remainingFor(brain, snapshot),
      limit: brain.dailyLimit,
      state: snapshot.states[brain.id] ?? "ok",
    })),
    providers: providerResets(brains, now),
    activeBrainId:
      brains.find((brain) => isUsable(brain, snapshot))?.id ?? null,
    visitor: {
      used: snapshot.visitor,
      limit: VISITOR_DAILY_MAX,
      remaining: Math.max(0, VISITOR_DAILY_MAX - snapshot.visitor),
      // The visitor cap is Dox's own and always on the UTC day.
      resetsAt: convertUnixToUtc(nextVisitorMidnightMs(now)),
    },
  };
}

/**
 * The snapshot as it stands after this request: one more question for the visitor and the brain that answered, and every
 * brain the walk marked out. The increments `recordRequest` and `markBrain` write to KV, applied in memory, so the reader
 * sees them without waiting on KV's lag.
 */
export function withRecordedRequest(
  snapshot: UsageSnapshot,
  answered: LedgerBrain,
  markedOut: Readonly<Record<string, Exclude<BrainState, "ok">>>,
): UsageSnapshot {
  return {
    perBrain: {
      ...snapshot.perBrain,
      [answered.id]: (snapshot.perBrain[answered.id] ?? 0) + 1,
    },
    states: { ...snapshot.states, ...markedOut },
    visitor: snapshot.visitor + 1,
  };
}

export interface BrainsHandlerDeps {
  /** Milliseconds: the instant the day keys and resets are worked from. */
  now: () => number;
}

/**
 * `GET /api/brains`: what the badge and the menu need before any chat.
 *
 * The body carries one visitor's own counts, keyed on a hash of their address, so it is `private`, never `public`: a
 * shared cache would hand one reader's counts to the next. `no-store` because the only thing left to cache is one
 * visitor's own browser, and a stale count is a wrong badge. It reads KV, so it has its own bucket in the limiter the
 * chat route uses, and a limited client is told when to come back.
 */
export function createBrainsHandler(deps: BrainsHandlerDeps) {
  return async function handleBrainsRequest(
    request: Request,
    env: Env,
    cors: Record<string, string>,
  ): Promise<Response> {
    const headers = { "Cache-Control": "private, no-store", ...cors };
    const clientId = getClientId(request);

    const verdict = chatRateLimiter.check(
      `brains:${clientId}`,
      stringVars(env),
      nowMs(),
    );
    if (verdict.limited) {
      return Response.json(
        {
          error: "Too many requests. Wait a moment and try again.",
          retryable: true,
        },
        {
          status: 429,
          headers: {
            ...headers,
            "Retry-After": retryAfterSeconds(verdict, nowMs()).toString(),
          },
        },
      );
    }

    const now = deps.now();
    const brains = configuredBrains(env);
    const snapshot = env.DOX_USAGE
      ? await readUsage(env.DOX_USAGE, brains, await hashVisitor(clientId), now)
      : EMPTY_SNAPSHOT;
    return Response.json(brainsPayload({ brains, snapshot, nowMs: now }), {
      headers,
    });
  };
}
