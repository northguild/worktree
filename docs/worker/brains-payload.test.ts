// @vitest-environment node
import { convertUtcToUnix } from "@northguild/gmt";
import { describe, expect, it, vi } from "vitest";
import { BRAINS, type Brain } from "../src/chat/lib/chat-constants";
import type { BrainsInfo } from "../src/chat/lib/chat-types";
import {
  brainsPayload,
  createBrainsHandler,
  withRecordedRequest,
} from "./brains-payload";
import { getCorsHeaders } from "./cors";
import { EMPTY_SNAPSHOT, type UsageSnapshot, type UsageStore } from "./usage";

// Expected values come from: plan #309 D9 (the order, so which brain is first) and D10 (key scheme, `private, no-store`,
// the visitor's day is UTC, no store means the first brain and empty counts); §8 (`dailyLimit` 40/40/20/20/20, the cap
// 5 a UTC day). None comes from the code.

function unix(iso: string): number {
  const ms = convertUtcToUnix(iso);
  if (ms === null) throw new Error(`not an instant: ${iso}`);
  return ms;
}

const ALL = BRAINS as unknown as Brain[];
/** 2026-11-10T03:00:00Z: 2026-11-09 19:00 Pacific, so Pacific midnight is 08:00Z and UTC midnight 2026-11-11T00:00Z. */
const NOW = unix("2026-11-10T03:00:00Z");

const snapshot = (over: Partial<UsageSnapshot> = {}): UsageSnapshot => ({
  ...EMPTY_SNAPSHOT,
  ...over,
});

describe("brainsPayload", () => {
  it("with an empty ledger lists every brain with its limit left, the first one active", () => {
    const info = brainsPayload({
      brains: ALL,
      snapshot: EMPTY_SNAPSHOT,
      nowMs: NOW,
    });

    expect(
      info.brains.map(({ id, remaining, limit, state }) => [
        id,
        remaining,
        limit,
        state,
      ]),
    ).toEqual([
      ["cf-gemma-4-26b", 40, 40, "ok"],
      ["cf-glm-4.7-flash", 40, 40, "ok"],
      ["gemini-3.5-flash-lite", 20, 20, "ok"],
      ["gemini-3.6-flash", 20, 20, "ok"],
      ["gemini-3.5-flash", 20, 20, "ok"],
    ]);
    expect(info.activeBrainId).toBe("cf-gemma-4-26b");
  });

  it("subtracts what is used, and never goes below 0", () => {
    const info = brainsPayload({
      brains: ALL,
      snapshot: snapshot({
        perBrain: { "cf-gemma-4-26b": 15, "gemini-3.6-flash": 25 },
      }),
      nowMs: NOW,
    });
    const left = (id: string) =>
      info.brains.find((brain) => brain.id === id)?.remaining;
    expect(left("cf-gemma-4-26b")).toBe(25);
    expect(left("gemini-3.6-flash")).toBe(0);
  });

  it("shows a brain marked out as 0 left, and moves the active brain past it", () => {
    const info = brainsPayload({
      brains: ALL,
      snapshot: snapshot({
        perBrain: { "cf-gemma-4-26b": 3 },
        states: {
          "cf-gemma-4-26b": "spent",
          "cf-glm-4.7-flash": "unavailable",
        },
      }),
      nowMs: NOW,
    });
    expect(info.brains[0]).toMatchObject({ remaining: 0, state: "spent" });
    expect(info.brains[1]).toMatchObject({
      remaining: 0,
      state: "unavailable",
    });
    expect(info.activeBrainId).toBe("gemini-3.5-flash-lite");
  });

  it("has no active brain when every one is out", () => {
    const states = Object.fromEntries(
      ALL.map((brain) => [brain.id, "spent" as const]),
    );
    expect(
      brainsPayload({ brains: ALL, snapshot: snapshot({ states }), nowMs: NOW })
        .activeBrainId,
    ).toBeNull();
  });

  it("gives each configured provider its own reset, and no other", () => {
    const geminiOnly = ALL.filter((brain) => brain.provider === "google");
    expect(
      brainsPayload({
        brains: geminiOnly,
        snapshot: EMPTY_SNAPSHOT,
        nowMs: NOW,
      }).providers,
    ).toEqual([
      { id: "google", label: "Gemini", resetsAt: "2026-11-10T08:00:00Z" },
    ]);
  });

  it("counts the visitor against 5 a UTC day and names UTC midnight as the reset", () => {
    const info = brainsPayload({
      brains: ALL,
      snapshot: snapshot({ visitor: 3 }),
      nowMs: NOW,
    });
    expect(info.visitor).toEqual({
      used: 3,
      limit: 5,
      remaining: 2,
      resetsAt: "2026-11-11T00:00:00Z",
    });
  });

  it("leaves a visitor over the cap at 0 left", () => {
    expect(
      brainsPayload({
        brains: ALL,
        snapshot: snapshot({ visitor: 7 }),
        nowMs: NOW,
      }).visitor.remaining,
    ).toBe(0);
  });
});

describe("withRecordedRequest", () => {
  it("adds one question for the visitor and the answering brain, and applies the marks", () => {
    const after = withRecordedRequest(
      snapshot({ perBrain: { "cf-gemma-4-26b": 4 }, visitor: 1 }),
      { id: "cf-glm-4.7-flash", provider: "workers-ai" },
      { "cf-gemma-4-26b": "spent" },
    );
    expect(after).toEqual({
      perBrain: { "cf-gemma-4-26b": 4, "cf-glm-4.7-flash": 1 },
      states: { "cf-gemma-4-26b": "spent" },
      visitor: 2,
    });
  });

  it("does not change the snapshot it was given", () => {
    const before = snapshot({ perBrain: { "cf-gemma-4-26b": 4 } });
    withRecordedRequest(
      before,
      { id: "cf-gemma-4-26b", provider: "workers-ai" },
      {},
    );
    expect(before.perBrain["cf-gemma-4-26b"]).toBe(4);
  });
});

describe("GET /api/brains handler", () => {
  const AI = { run: vi.fn() };
  const CORS = getCorsHeaders("https://northguild.dev");
  const handler = createBrainsHandler({ now: () => NOW });
  let ip = 0;
  const get = (clientIp = `198.51.100.${++ip}`) =>
    new Request("https://worker.example.com/api/brains", {
      headers: { "CF-Connecting-IP": clientIp },
    });

  function mapStore(initial: Record<string, string> = {}): UsageStore {
    const data = new Map(Object.entries(initial));
    return {
      get: async (key) => data.get(key) ?? null,
      put: async (key, value) => void data.set(key, value),
    };
  }

  it("answers cache-control private, no-store, with the CORS headers", async () => {
    const res = await handler(get(), { AI }, CORS);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://northguild.dev",
    );
    expect(res.headers.get("Content-Type")).toContain("application/json");
  });

  it("without DOX_USAGE answers with the first brain and empty counts", async () => {
    const info = (await (
      await handler(get(), { AI, GEMINI_API_KEY: "k" }, CORS)
    ).json()) as BrainsInfo;

    expect(info.activeBrainId).toBe("cf-gemma-4-26b");
    expect(info.brains).toHaveLength(5);
    expect(info.brains.every((brain) => brain.remaining === brain.limit)).toBe(
      true,
    );
    expect(info.visitor.used).toBe(0);
    expect(info.visitor.remaining).toBe(5);
  });

  it("offers only the brains this deployment can reach", async () => {
    const info = (await (
      await handler(get(), { GEMINI_API_KEY: "k" }, CORS)
    ).json()) as BrainsInfo;
    expect(info.brains.map((brain) => brain.id)).toEqual([
      "gemini-3.5-flash-lite",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
    ]);
    expect(info.providers.map((p) => p.id)).toEqual(["google"]);
  });

  it("reads the counts for the asking visitor from the store", async () => {
    // `printf %s 'dox:203.0.113.9' | shasum -a 256 | cut -c1-16`
    const store = mapStore({
      "model:2026-11-10:cf-gemma-4-26b": "6",
      "state:2026-11-10:cf-glm-4.7-flash": "spent",
      "visitor:2026-11-10:4352518c3a682ace": "2",
      // another visitor's count is not this one's
      "visitor:2026-11-10:1e32c7f863bba468": "5",
    });

    const info = (await (
      await handler(get("203.0.113.9"), { AI, DOX_USAGE: store }, CORS)
    ).json()) as BrainsInfo;

    expect(info.brains[0]).toMatchObject({ remaining: 34, state: "ok" });
    expect(info.brains[1]).toMatchObject({ remaining: 0, state: "spent" });
    expect(info.visitor).toMatchObject({ used: 2, remaining: 3 });
  });

  it("still answers when the store throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const store: UsageStore = {
      get: () => Promise.reject(new Error("KV is down")),
      put: () => Promise.reject(new Error("KV is down")),
    };

    const res = await handler(get(), { AI, DOX_USAGE: store }, CORS);

    expect(res.status).toBe(200);
    expect(((await res.json()) as BrainsInfo).activeBrainId).toBe(
      "cf-gemma-4-26b",
    );
  });

  it("answers an empty list, and no active brain, when nothing is configured", async () => {
    const info = (await (await handler(get(), {}, CORS)).json()) as BrainsInfo;
    expect(info.brains).toEqual([]);
    expect(info.activeBrainId).toBeNull();
  });

  it("limits a client that asks too often, with Retry-After and no-store", async () => {
    const env = {
      AI,
      WORKER_RATE_LIMIT_MAX: "2",
      WORKER_RATE_LIMIT_WINDOW_SECONDS: "60",
    };
    const ip = "198.51.100.200";
    await handler(get(ip), env, CORS);
    await handler(get(ip), env, CORS);
    const third = await handler(get(ip), env, CORS);

    expect(third.status).toBe(429);
    expect(Number(third.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(third.headers.get("Cache-Control")).toBe("private, no-store");
    // A different client is not limited.
    expect((await handler(get("198.51.100.201"), env, CORS)).status).toBe(200);
  });
});
