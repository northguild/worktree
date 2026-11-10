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
 * How soon to read again when the soonest reset the counts name has already passed: the Worker's clock is behind the
 * reader's, or the read at the reset failed. It stops once a read names a reset still to come.
 */
export const RESET_RETRY_MS = 30_000;
/** `setTimeout`'s ceiling, a signed 32-bit count of ms; a longer delay would fire at once. */
const MAX_TIMEOUT_MS = 2 ** 31 - 1;

/** How long to wait before reading again, from `now`; `undefined` when `info` names no reset that can be read. */
export function refreshDelay(
  info: BrainsInfo,
  now: number,
): number | undefined {
  const soonest = soonestResetMs(info);
  if (soonest === undefined) return undefined;
  if (soonest <= now) return RESET_RETRY_MS;
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

  useEffect(() => {
    if (!info) return;
    // The clock fails only if the platform's does; then no reset is ever due, which leaves the counts as they are.
    const now = () => getUnixNow() ?? 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    // A read that changes the counts re-runs this effect, which starts over from them. One that changes nothing (it failed,
    // or the Worker's day has not turned yet) sets the timer again from the same counts, so it keeps asking.
    const schedule = () => {
      const delay = refreshDelay(info, now());
      if (delay === undefined) return;
      timer = setTimeout(() => {
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
