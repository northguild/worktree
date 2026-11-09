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
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { brainsEndpoint } from "../lib/chat-endpoint";
import type { BrainsInfo } from "../lib/chat-types";

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

  return { info, refresh, apply };
}
