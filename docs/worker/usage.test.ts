// @vitest-environment node
import { convertUtcToUnix } from "@northguild/gmt";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BRAINS, type Brain } from "../src/chat/lib/chat-constants";
import {
  hashVisitor,
  markBrain,
  providerResets,
  readUsage,
  recordRequest,
  type UsageStore,
} from "./usage";

// Expected values come from: plan #309 D10 (key scheme `model:<day>:<brain>`, `state:<day>:<brain>`,
// `visitor:<day>:<hash>`; a brain's day is its provider's, the visitor's is UTC) and §8 (TTL = seconds to the next
// midnight + 300, floor 60), worked by hand from the zone rules; and `shasum -a 256` for the hash. None comes from the
// ledger.

function unix(iso: string): number {
  const ms = convertUtcToUnix(iso);
  if (ms === null) throw new Error(`not an instant: ${iso}`);
  return ms;
}

const [GEMMA, , FLASH_LITE] = BRAINS as unknown as [Brain, Brain, Brain];

/**
 * 03:00Z on 2026-11-10 is 19:00 on 2026-11-09 in Pacific (UTC-8), so the two providers sit on different days:
 * Gemini on `2026-11-09`, Workers AI and the visitor on `2026-11-10`. Pacific midnight is 08:00Z (5 h = 18,000 s away);
 * UTC midnight is 2026-11-11T00:00Z (21 h = 75,600 s away). Each TTL adds 300.
 */
const NOW = unix("2026-11-10T03:00:00Z");
const GEMINI_DAY = "2026-11-09";
const UTC_DAY = "2026-11-10";
const GEMINI_TTL = 18_300;
const UTC_TTL = 75_900;

// `printf %s 'dox:203.0.113.9' | shasum -a 256 | cut -c1-16`
const HASH = "4352518c3a682ace";

interface Put {
  key: string;
  value: string;
  expirationTtl: number | undefined;
}

/** A `Map`-backed store that remembers every write. */
function mapStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const puts: Put[] = [];
  const store: UsageStore = {
    async get(key) {
      return data.get(key) ?? null;
    },
    async put(key, value, options) {
      data.set(key, value);
      puts.push({ key, value, expirationTtl: options?.expirationTtl });
    },
  };
  return { store, data, puts };
}

const throwingStore: UsageStore = {
  get: () => Promise.reject(new Error("KV is down")),
  put: () => Promise.reject(new Error("KV is down")),
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hashVisitor", () => {
  it("is the first 16 hex characters of SHA-256 of `dox:<client id>`", async () => {
    expect(await hashVisitor("203.0.113.9")).toBe(HASH);
    // `printf %s 'dox:unknown' | shasum -a 256 | cut -c1-16`
    expect(await hashVisitor("unknown")).toBe("1e32c7f863bba468");
  });

  it("never contains the address", async () => {
    expect(await hashVisitor("203.0.113.9")).not.toContain("203");
  });
});

describe("providerResets", () => {
  it("gives each configured provider its own next midnight, in registry order", () => {
    expect(providerResets(BRAINS as unknown as Brain[], NOW)).toEqual([
      {
        id: "workers-ai",
        label: "Workers AI",
        resetsAt: "2026-11-11T00:00:00Z",
      },
      { id: "google", label: "Gemini", resetsAt: "2026-11-10T08:00:00Z" },
    ]);
  });

  it("leaves out a provider with no brain", () => {
    expect(providerResets([FLASH_LITE], NOW).map((p) => p.id)).toEqual([
      "google",
    ]);
  });
});

describe("recordRequest", () => {
  it("counts a Workers AI answer on the UTC day and the visitor on the UTC day, each with its TTL", async () => {
    const { store, puts } = mapStore();

    await recordRequest(store, GEMMA, HASH, NOW);

    expect(puts).toHaveLength(2);
    expect(puts).toContainEqual({
      key: `model:${UTC_DAY}:cf-gemma-4-26b`,
      value: "1",
      expirationTtl: UTC_TTL,
    });
    expect(puts).toContainEqual({
      key: `visitor:${UTC_DAY}:${HASH}`,
      value: "1",
      expirationTtl: UTC_TTL,
    });
  });

  it("counts a Gemini answer on the Pacific day, but the visitor still on the UTC day", async () => {
    const { store, puts } = mapStore();

    await recordRequest(store, FLASH_LITE, HASH, NOW);

    expect(puts).toContainEqual({
      key: `model:${GEMINI_DAY}:gemini-3.5-flash-lite`,
      value: "1",
      expirationTtl: GEMINI_TTL,
    });
    expect(puts).toContainEqual({
      key: `visitor:${UTC_DAY}:${HASH}`,
      value: "1",
      expirationTtl: UTC_TTL,
    });
  });

  it("adds one to what is already there", async () => {
    const { store, data } = mapStore({
      [`model:${UTC_DAY}:cf-gemma-4-26b`]: "7",
      [`visitor:${UTC_DAY}:${HASH}`]: "2",
    });

    await recordRequest(store, GEMMA, HASH, NOW);

    expect(data.get(`model:${UTC_DAY}:cf-gemma-4-26b`)).toBe("8");
    expect(data.get(`visitor:${UTC_DAY}:${HASH}`)).toBe("3");
  });

  it("resolves when the store throws, and says so in one structured warn line with the request's ids", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      recordRequest(throwingStore, GEMMA, HASH, NOW, {
        threadId: "t-1",
        runId: "r-1",
      }),
    ).resolves.toBeUndefined();

    const lines = warn.mock.calls.map(
      ([line]) => JSON.parse(line as string) as Record<string, unknown>,
    );
    expect(lines).toContainEqual({
      event: "usage.write_failed",
      level: "warn",
      key: `model:${UTC_DAY}:cf-gemma-4-26b`,
      error: "KV is down",
      threadId: "t-1",
      runId: "r-1",
    });
  });
});

describe("markBrain", () => {
  it("writes the state on the brain's own provider day, expiring with it", async () => {
    const { store, puts } = mapStore();

    await markBrain(store, FLASH_LITE, "spent", NOW);
    await markBrain(store, GEMMA, "unavailable", NOW);

    expect(puts).toEqual([
      {
        key: `state:${GEMINI_DAY}:gemini-3.5-flash-lite`,
        value: "spent",
        expirationTtl: GEMINI_TTL,
      },
      {
        key: `state:${UTC_DAY}:cf-gemma-4-26b`,
        value: "unavailable",
        expirationTtl: UTC_TTL,
      },
    ]);
  });

  it("resolves when the store throws, logging a usage.mark_failed warn line", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(
      markBrain(throwingStore, GEMMA, "spent", NOW),
    ).resolves.toBeUndefined();
    expect(JSON.parse(warn.mock.calls[0]?.[0] as string)).toMatchObject({
      event: "usage.mark_failed",
      level: "warn",
      state: "spent",
    });
  });
});

describe("readUsage", () => {
  const brains = [GEMMA, FLASH_LITE];

  it("reads each brain on its own provider's day, and the visitor on the UTC day", async () => {
    const { store } = mapStore({
      [`model:${UTC_DAY}:cf-gemma-4-26b`]: "3",
      [`model:${GEMINI_DAY}:gemini-3.5-flash-lite`]: "11",
      [`state:${GEMINI_DAY}:gemini-3.5-flash-lite`]: "spent",
      [`visitor:${UTC_DAY}:${HASH}`]: "4",
      // Yesterday's keys on the wrong clock must not be read.
      [`model:${GEMINI_DAY}:cf-gemma-4-26b`]: "99",
      [`visitor:${GEMINI_DAY}:${HASH}`]: "99",
    });

    expect(await readUsage(store, brains, HASH, NOW)).toEqual({
      perBrain: { "cf-gemma-4-26b": 3, "gemini-3.5-flash-lite": 11 },
      states: { "cf-gemma-4-26b": "ok", "gemini-3.5-flash-lite": "spent" },
      visitor: 4,
    });
  });

  it("reads an empty ledger as nothing used and every brain ok", async () => {
    const { store } = mapStore();
    expect(await readUsage(store, brains, HASH, NOW)).toEqual({
      perBrain: { "cf-gemma-4-26b": 0, "gemini-3.5-flash-lite": 0 },
      states: { "cf-gemma-4-26b": "ok", "gemini-3.5-flash-lite": "ok" },
      visitor: 0,
    });
  });

  it("treats a value that is not a count, or a state it does not know, as no record", async () => {
    const { store } = mapStore({
      [`model:${UTC_DAY}:cf-gemma-4-26b`]: "lots",
      [`state:${UTC_DAY}:cf-gemma-4-26b`]: "tired",
      [`visitor:${UTC_DAY}:${HASH}`]: "-3",
    });
    expect(await readUsage(store, [GEMMA], HASH, NOW)).toEqual({
      perBrain: { "cf-gemma-4-26b": 0 },
      states: { "cf-gemma-4-26b": "ok" },
      visitor: 0,
    });
  });

  it("degrades to an empty ledger when every read throws, logging usage.read_failed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await readUsage(throwingStore, brains, HASH, NOW)).toEqual({
      perBrain: { "cf-gemma-4-26b": 0, "gemini-3.5-flash-lite": 0 },
      states: { "cf-gemma-4-26b": "ok", "gemini-3.5-flash-lite": "ok" },
      visitor: 0,
    });
    expect(warn).toHaveBeenCalled();
    expect(JSON.parse(warn.mock.calls[0]?.[0] as string)).toMatchObject({
      event: "usage.read_failed",
      level: "warn",
      error: "KV is down",
    });
  });

  it("reads back what recordRequest and markBrain wrote", async () => {
    const { store } = mapStore();
    await recordRequest(store, GEMMA, HASH, NOW);
    await recordRequest(store, GEMMA, HASH, NOW);
    await markBrain(store, FLASH_LITE, "spent", NOW);

    expect(await readUsage(store, brains, HASH, NOW)).toEqual({
      perBrain: { "cf-gemma-4-26b": 2, "gemini-3.5-flash-lite": 0 },
      states: { "cf-gemma-4-26b": "ok", "gemini-3.5-flash-lite": "spent" },
      visitor: 2,
    });
  });
});
