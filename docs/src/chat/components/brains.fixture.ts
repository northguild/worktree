import type { BrainsInfo } from "../lib/chat-types";

// A `GET /api/brains` answer as the Worker builds it (`worker/brains-payload.ts`, `lib/chat-types.ts` `BrainsInfo`), for the
// tests of the control bar. Brains, labels, providers and limits are `BRAINS` in `lib/chat-constants.ts` (gmt's, plan §8);
// Workers AI refills at 00:00 UTC and Gemini at midnight Pacific, which in June (PDT, UTC-7) is 07:00Z; the visitor's own
// questions refill at the UTC midnight (D10).
export const UTC_MIDNIGHT = "2026-06-16T00:00:00Z";
export const PACIFIC_MIDNIGHT = "2026-06-16T07:00:00Z";

export function brainsInfo(
  overrides: {
    remaining?: Partial<Record<string, number>>;
    states?: Partial<Record<string, "ok" | "spent" | "unavailable">>;
    visitorRemaining?: number;
    providers?: BrainsInfo["providers"];
    activeBrainId?: string | null;
  } = {},
): BrainsInfo {
  const brain = (
    id: string,
    label: string,
    provider: "google" | "workers-ai",
    limit: number,
  ): BrainsInfo["brains"][number] => ({
    id,
    label,
    provider,
    remaining: overrides.remaining?.[id] ?? limit,
    limit,
    state: overrides.states?.[id] ?? "ok",
  });
  const visitorRemaining = overrides.visitorRemaining ?? 5;
  return {
    brains: [
      brain("cf-gemma-4-26b", "Gemma 4 26B", "workers-ai", 40),
      brain("cf-glm-4.7-flash", "GLM 4.7 Flash", "workers-ai", 40),
      brain("gemini-3.5-flash-lite", "3.5 Flash-Lite", "google", 20),
      brain("gemini-3.6-flash", "3.6 Flash", "google", 20),
      brain("gemini-3.5-flash", "3.5 Flash", "google", 20),
    ],
    providers: overrides.providers ?? [
      { id: "workers-ai", label: "Workers AI", resetsAt: UTC_MIDNIGHT },
      { id: "google", label: "Gemini", resetsAt: PACIFIC_MIDNIGHT },
    ],
    activeBrainId:
      overrides.activeBrainId === undefined
        ? "cf-gemma-4-26b"
        : overrides.activeBrainId,
    visitor: {
      used: 5 - visitorRemaining,
      limit: 5,
      remaining: visitorRemaining,
      resetsAt: UTC_MIDNIGHT,
    },
  };
}
