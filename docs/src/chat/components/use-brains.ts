/**
 * Reads `GET /api/brains`: what Dox has left today and which brains are usable (plan #309 D10; ported from gmt's
 * `use-brains.ts`).
 *
 * Fetched rather than built in, because the numbers change with every question anyone asks. Deliberately failure-tolerant:
 * if the endpoint is unreachable (the Worker restarting, an older deploy, offline) the hook reports `null` and the page
 * simply omits the badge. A broken counter must never stop someone asking a question.
 *
 * After a question the counts arrive on the chat stream instead (`apply`, fed by the `dox-usage` event): the Worker knows
 * them the moment it records the question, while a re-read of the KV ledger can lag that write.
 *
 * The first read happens in an effect, so the server's render, which has no reader, holds no badge.
 *
 * It reads again when the soonest reset passes. Nothing else would: a spent budget disables the composer, so no question
 * can be asked and no `dox-usage` event can arrive, and without the re-read the page would stay resting past the time its
 * own banner gives until the reader reloaded it. A tab that slept through the reset reads again when it is shown.
 */
import { getUnixNow } from "@northguild/gmt/unix/get";
import { useCallback, useEffect, useRef, useState } from "react";
import { brainsEndpoint } from "../lib/chat-endpoint";
import type { BrainsInfo } from "../lib/chat-types";
import { soonestResetMs } from "../time/quota-resets";

export type { BrainsInfo };

const STATES = new Set(["ok", "spent", "unavailable"]);
const PROVIDERS = new Set(["google", "workers-ai"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/**
 * A value from the wire, checked: `GET /api/brains` and the `dox-usage` event carry the Worker's `BrainsInfo`, but a stale
 * deploy or a foreign answer must not throw in render. `null` for anything else.
 */
export function readBrainsInfo(value: unknown): BrainsInfo | null {
  if (!isRecord(value)) return null;
  const { brains, providers, activeBrainId, visitor } = value;
  if (!Array.isArray(brains) || !Array.isArray(providers)) return null;
  if (activeBrainId !== null && typeof activeBrainId !== "string") return null;
  if (!isRecord(visitor)) return null;
  if (
    typeof visitor.used !== "number" ||
    typeof visitor.limit !== "number" ||
    typeof visitor.remaining !== "number" ||
    typeof visitor.resetsAt !== "string"
  ) {
    return null;
  }
  const brainsOk = brains.every(
    (brain) =>
      isRecord(brain) &&
      typeof brain.id === "string" &&
      typeof brain.label === "string" &&
      PROVIDERS.has(brain.provider as string) &&
      typeof brain.remaining === "number" &&
      typeof brain.limit === "number" &&
      STATES.has(brain.state as string),
  );
  const providersOk = providers.every(
    (provider) =>
      isRecord(provider) &&
      PROVIDERS.has(provider.id as string) &&
      typeof provider.label === "string" &&
      typeof provider.resetsAt === "string",
  );
  return brainsOk && providersOk ? (value as unknown as BrainsInfo) : null;
}

/** Past the reset before reading, so the Worker's day has turned even with its clock and the reader's a little apart. */
export const RESET_MARGIN_MS = 2_000;
/**
 * The first wait when the soonest reset the counts name has already passed, doubling with each read that still names it,
 * up to `RESET_RETRY_MAX_MS`. That happens when the reader's clock runs ahead of the Worker's, by as long as it is ahead,
 * or when the read fails; it stops once a read names a reset still to come. Each read costs the Worker about a dozen KV
 * reads from a free daily allowance, so a clock hours fast must not turn into a poll every 30 s.
 */
export const RESET_RETRY_MS = 30_000;
/** The longest wait between those reads: a reset is at most this late to lift the composer, whatever the clocks say. */
export const RESET_RETRY_MAX_MS = 5 * 60_000;
/** `setTimeout`'s ceiling, a signed 32-bit count of ms; a longer delay would fire at once. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/**
 * How long to wait before reading again, from `now`; `undefined` when `info` names no reset that can be read. `retries` is
 * how many reads since the counts last changed found that reset already passed.
 */
export function refreshDelay(
  info: BrainsInfo,
  now: number,
  retries = 0,
): number | undefined {
  const soonest = soonestResetMs(info);
  if (soonest === undefined) return undefined;
  if (soonest <= now)
    return Math.min(RESET_RETRY_MS * 2 ** retries, RESET_RETRY_MAX_MS);
  return Math.min(soonest - now + RESET_MARGIN_MS, MAX_TIMEOUT_MS);
}

export function useBrains() {
  const [info, setInfo] = useState<BrainsInfo | null>(null);
  // Which answer is newest. A read that was asked for before a newer one landed (the stream's counts, say) is dropped when
  // it arrives, so the badge never steps back to an older count.
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const response = await fetch(
        brainsEndpoint(import.meta.env.PUBLIC_GEMINI_WORKER_URL),
        { headers: { accept: "application/json" } },
      );
      if (!response.ok) return;
      const read = readBrainsInfo(await response.json());
      if (read !== null && ticket === latest.current) setInfo(read);
    } catch {
      // Left as it was: the badge stays hidden, or keeps its last counts, and the chat keeps working.
    }
  }, []);

  const apply = useCallback((next: BrainsInfo) => {
    latest.current += 1;
    setInfo(next);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The reads that have found the soonest reset already passed, and which reset that was. Kept across renders because
  // every successful read is a new object, which re-runs the effect below even when it says what the last one did: the
  // count must outlive that, and start over only when the counts name another reset.
  const pastReset = useRef<{ at: number; retries: number } | null>(null);

  useEffect(() => {
    if (!info) return;
    // The clock fails only if the platform's does; then no reset is ever due, which leaves the counts as they are.
    const now = () => getUnixNow() ?? 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    // A read that changes the counts re-runs this effect, which starts over from them. One that does not (it failed) sets
    // the timer again from the same counts. Either way a reset that has passed waits longer each time it is read again.
    const schedule = () => {
      const at = now();
      const soonest = soonestResetMs(info);
      let passed: { at: number; retries: number } | undefined;
      if (soonest !== undefined && soonest <= at) {
        passed =
          pastReset.current?.at === soonest
            ? pastReset.current
            : { at: soonest, retries: 0 };
        pastReset.current = passed;
      }
      const delay = refreshDelay(info, at, passed?.retries ?? 0);
      if (delay === undefined) return;
      timer = setTimeout(() => {
        // Counted as the read is made, not as it is scheduled: a read that lands new counts schedules twice, from here and
        // from the effect it re-runs, and only one of those timers survives.
        if (passed) passed.retries += 1;
        void refresh().finally(() => {
          if (!stopped) schedule();
        });
      }, delay);
    };
    schedule();
    // A timer can fire late after the machine has slept, so a tab shown again once a reset has passed reads at once.
    const onShown = () => {
      if (document.visibilityState !== "visible") return;
      const soonest = soonestResetMs(info);
      if (soonest !== undefined && soonest <= now()) void refresh();
    };
    document.addEventListener("visibilitychange", onShown);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShown);
    };
  }, [info, refresh]);

  return { info, refresh, apply };
}
