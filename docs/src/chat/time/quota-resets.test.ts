import type { BrainsInfo } from "../lib/chat-types";
import { listResets, nextReset } from "./quota-resets";

// Expected values: the rules in plan #309 §4.1 row 21 and D10 (the visitor's day is the UTC day, a provider's is its own) as
// gmt's `quota-resets.ts` states them, worked by hand on two instants: Pacific midnight is 07:00Z in June (PDT, UTC-7), so
// Workers AI's 00:00 UTC reset comes seven hours before Gemini's.
const PACIFIC_MIDNIGHT = "2026-06-16T07:00:00Z";
const UTC_MIDNIGHT = "2026-06-16T00:00:00Z";

function info(overrides: {
  gemini?: number;
  workersAI?: number;
  visitorRemaining?: number;
  providers?: BrainsInfo["providers"];
}): BrainsInfo {
  const remaining = overrides.visitorRemaining ?? 5;
  return {
    brains: [
      {
        id: "gemini-a",
        label: "A",
        provider: "google",
        remaining: overrides.gemini ?? 20,
        limit: 20,
        state: "ok",
      },
      {
        id: "cf-a",
        label: "B",
        provider: "workers-ai",
        remaining: overrides.workersAI ?? 40,
        limit: 40,
        state: "ok",
      },
    ],
    providers: overrides.providers ?? [
      { id: "google", label: "Gemini", resetsAt: PACIFIC_MIDNIGHT },
      { id: "workers-ai", label: "Workers AI", resetsAt: UTC_MIDNIGHT },
    ],
    activeBrainId: "gemini-a",
    // The visitor's own day is the UTC one; this fixture gives it the later instant so the rules below can tell them apart.
    visitor: {
      used: 5 - remaining,
      limit: 5,
      remaining,
      resetsAt: PACIFIC_MIDNIGHT,
    },
  };
}

describe("nextReset", () => {
  it("shows the reader's own allowance when nothing is spent", () => {
    expect(nextReset(info({}))?.id).toBe("visitor");
  });

  it("shows the reader's own reset when only their questions are gone", () => {
    expect(nextReset(info({ visitorRemaining: 0 }))?.id).toBe("visitor");
  });

  it("shows the soonest provider refill when every brain is spent: Workers AI, seven hours before Gemini", () => {
    expect(nextReset(info({ gemini: 0, workersAI: 0 }))).toEqual({
      id: "workers-ai",
      label: "Workers AI",
      resetsAt: UTC_MIDNIGHT,
    });
  });

  it("orders by instant, not by the order the providers arrive in", () => {
    const reversed = info({
      gemini: 0,
      workersAI: 0,
      providers: [
        { id: "workers-ai", label: "Workers AI", resetsAt: PACIFIC_MIDNIGHT },
        { id: "google", label: "Gemini", resetsAt: UTC_MIDNIGHT },
      ],
    });
    expect(nextReset(reversed)?.id).toBe("google");
  });

  it("waits for the later of the two when the reader and the pool are both spent", () => {
    // A brain is back at UTC midnight, but this reader cannot ask until their own questions refill, later.
    expect(
      nextReset(info({ gemini: 0, workersAI: 0, visitorRemaining: 0 }))?.id,
    ).toBe("visitor");
  });

  it("waits for the pool when it comes back after the reader's own questions do", () => {
    const later = info({
      gemini: 0,
      workersAI: 0,
      visitorRemaining: 0,
      providers: [
        { id: "google", label: "Gemini", resetsAt: "2026-06-17T07:00:00Z" },
      ],
    });
    expect(nextReset(later)?.id).toBe("google");
  });

  it("treats a brain marked out as spent: its remaining is 0", () => {
    const out = info({});
    out.brains = out.brains.map((brain) => ({
      ...brain,
      remaining: 0,
      state: "spent",
    }));
    expect(nextReset(out)?.id).toBe("workers-ai");
  });

  it("is undefined when the pool is spent and the deployment reports no providers", () => {
    expect(
      nextReset(info({ gemini: 0, workersAI: 0, providers: [] })),
    ).toBeUndefined();
  });
});

describe("listResets", () => {
  it("lists the reader's own allowance first, then each provider in the order sent", () => {
    expect(listResets(info({})).map((reset) => reset.id)).toEqual([
      "visitor",
      "google",
      "workers-ai",
    ]);
  });

  it("labels the reader's own row 'Your questions'", () => {
    expect(listResets(info({}))[0]).toEqual({
      id: "visitor",
      label: "Your questions",
      resetsAt: PACIFIC_MIDNIGHT,
    });
  });
});
