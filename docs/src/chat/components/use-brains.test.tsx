import { convertUtcToUnix } from "@northguild/gmt/utc/convert";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { brainsInfo, UTC_MIDNIGHT } from "./brains.fixture";
import {
  RESET_MARGIN_MS,
  RESET_RETRY_MAX_MS,
  RESET_RETRY_MS,
  readBrainsInfo,
  refreshDelay,
  useBrains,
} from "./use-brains";

// Expected values: plan #309 D10 (the badge reads `GET /api/brains`, then the `dox-usage` event's counts) and Phase 8's scope
// ("an unreachable /api/brains hides the badge and leaves the chat usable"). The route and its shape are
// docs/worker/README.md's route table and `BrainsInfo` in `lib/chat-types.ts`; the local Worker address is
// `chat-endpoint.ts`'s fallback, as `PUBLIC_GEMINI_WORKER_URL` is unset under test.

afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("useBrains", () => {
  it("reads /api/brains from the Worker after mount, asking for JSON", async () => {
    const info = brainsInfo();
    const fetchMock = vi.fn(async () => json(info));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useBrains());
    expect(result.current.info).toBeNull();
    await waitFor(() => expect(result.current.info).toEqual(info));
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:8787/api/brains", {
      headers: { accept: "application/json" },
    });
  });

  it("has nothing for the badge when the endpoint cannot be reached", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useBrains());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.info).toBeNull();
  });

  it.each([
    404, 429, 500,
  ])("has nothing for the badge on an HTTP %i", async (status) => {
    const fetchMock = vi.fn(async () => json({ error: "no" }, status));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useBrains());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.info).toBeNull();
  });

  it("has nothing for the badge when the answer is not a BrainsInfo", async () => {
    const fetchMock = vi.fn(async () => json({ hello: "world" }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useBrains());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(result.current.info).toBeNull();
  });

  it("takes the counts the stream carries, replacing what the read found", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(brainsInfo())),
    );
    const { result } = renderHook(() => useBrains());
    await waitFor(() => expect(result.current.info).not.toBeNull());
    const after = brainsInfo({ visitorRemaining: 4 });
    act(() => result.current.apply(after));
    expect(result.current.info?.visitor.remaining).toBe(4);
  });

  it("drops a read that was asked for before the stream's counts landed, so the badge never steps back", async () => {
    let release!: () => void;
    const slow = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchMock = vi.fn(async () => {
      await slow;
      return json(brainsInfo({ visitorRemaining: 5 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useBrains());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    act(() => result.current.apply(brainsInfo({ visitorRemaining: 4 })));
    await act(async () => {
      release();
      await slow;
    });
    expect(result.current.info?.visitor.remaining).toBe(4);
  });

  it("reads again on refresh, keeping the old counts if that read fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(brainsInfo({ visitorRemaining: 3 })))
      .mockRejectedValueOnce(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useBrains());
    await waitFor(() => expect(result.current.info?.visitor.remaining).toBe(3));
    await act(() => result.current.refresh());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.info?.visitor.remaining).toBe(3);
  });
});

function unix(iso: string): number {
  const ms = convertUtcToUnix(iso);
  if (ms === null) throw new Error(`bad fixture ${iso}`);
  return ms;
}

// The fixture's soonest reset is the UTC midnight (the visitor's and Workers AI's, 2026-06-16T00:00:00Z); Gemini's is seven
// hours later. A spent budget disables the composer, so these reads are the only way the page learns it may ask again.
describe("useBrains at a reset", () => {
  const MINUTE_BEFORE = unix(UTC_MIDNIGHT) - 60_000;
  // The read at mount, then however many after it, each answered by the next body.
  const reads = (...bodies: unknown[]) => {
    const fetchMock = vi.fn();
    for (const body of bodies) fetchMock.mockResolvedValueOnce(json(body));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  };
  const advance = (ms: number) =>
    act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(MINUTE_BEFORE);
  });
  afterEach(() => vi.useRealTimers());

  it("reads again just past the soonest reset, so a spent budget lifts without a reload", async () => {
    const fetchMock = reads(
      brainsInfo({ visitorRemaining: 0 }),
      brainsInfo({ visitorRemaining: 5 }),
    );
    const { result } = renderHook(() => useBrains());
    await advance(0);
    expect(result.current.info?.visitor.remaining).toBe(0);
    // A minute to the reset, and the margin past it.
    await advance(60_000 + RESET_MARGIN_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.info?.visitor.remaining).toBe(5);
  });

  it("asks again at 30 s, then twice as long each time, while the counts still name a reset that has passed, and stops once one is to come", async () => {
    // The reader's clock is ahead of the Worker's: for it the reset is past, for the Worker not yet.
    vi.setSystemTime(unix(UTC_MIDNIGHT) + 5_000);
    const later = brainsInfo();
    later.visitor.resetsAt = "2026-06-17T00:00:00Z";
    later.providers = later.providers.map((provider) => ({
      ...provider,
      resetsAt: "2026-06-17T00:00:00Z",
    }));
    // The Worker's day has not turned for the first three reads; the fourth names tomorrow.
    const fetchMock = reads(brainsInfo(), brainsInfo(), brainsInfo(), later);
    renderHook(() => useBrains());
    await advance(0);
    await advance(RESET_RETRY_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(2 * RESET_RETRY_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await advance(4 * RESET_RETRY_MS);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    await advance(10 * RESET_RETRY_MAX_MS);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("waits no longer than five minutes between those reads, however long they go on", async () => {
    vi.setSystemTime(unix(UTC_MIDNIGHT) + 5_000);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(brainsInfo()))
      .mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);
    renderHook(() => useBrains());
    await advance(0);
    // 30 s, 60 s, 120 s, 240 s, then 300 s from there on.
    await advance(30_000 + 60_000 + 120_000 + 240_000);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    await advance(RESET_RETRY_MAX_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    await advance(1);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    await advance(RESET_RETRY_MAX_MS);
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it("asks again after a read at the reset fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(brainsInfo({ visitorRemaining: 0 })))
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(json(brainsInfo({ visitorRemaining: 5 })));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => useBrains());
    await advance(0);
    await advance(60_000 + RESET_MARGIN_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.info?.visitor.remaining).toBe(0);
    await advance(RESET_RETRY_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.current.info?.visitor.remaining).toBe(5);
  });

  it("reads at once when the tab is shown again after a reset it slept through, and not before one", async () => {
    const fetchMock = reads(
      brainsInfo({ visitorRemaining: 0 }),
      brainsInfo({ visitorRemaining: 5 }),
    );
    const { result } = renderHook(() => useBrains());
    await advance(0);
    const shown = () =>
      act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
        await Promise.resolve();
      });
    await shown();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // The clock moves past the reset with no timer run, as it does across a sleep.
    vi.setSystemTime(unix(UTC_MIDNIGHT) + 5 * 60_000);
    await shown();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await advance(0);
    expect(result.current.info?.visitor.remaining).toBe(5);
  });
});

describe("refreshDelay", () => {
  const AT_RESET = unix(UTC_MIDNIGHT);

  it("waits until just past the soonest reset while it is to come", () => {
    expect(refreshDelay(brainsInfo(), AT_RESET - 60_000)).toBe(
      60_000 + RESET_MARGIN_MS,
    );
  });

  it("backs off from 30 s once that reset has passed, doubling to a 5 min ceiling", () => {
    const delays = [0, 1, 2, 3, 4, 5, 20].map((retries) =>
      refreshDelay(brainsInfo(), AT_RESET + 1, retries),
    );
    expect(delays).toEqual([
      30_000, 60_000, 120_000, 240_000, 300_000, 300_000, 300_000,
    ]);
  });

  it("has no delay when no reset can be read", () => {
    const unreadable = brainsInfo({ providers: [] });
    unreadable.visitor.resetsAt = "soon";
    expect(refreshDelay(unreadable, AT_RESET)).toBeUndefined();
  });
});

describe("readBrainsInfo", () => {
  it("accepts the Worker's own shape", () => {
    const info = brainsInfo({ activeBrainId: null });
    expect(readBrainsInfo(info)).toEqual(info);
  });

  it.each([
    ["null", null],
    ["a string", "x"],
    ["no visitor", { ...brainsInfo(), visitor: undefined }],
    [
      "a visitor without a reset",
      { ...brainsInfo(), visitor: { used: 0, limit: 5, remaining: 5 } },
    ],
    [
      "a brain in an unknown state",
      {
        ...brainsInfo(),
        brains: [{ ...brainsInfo().brains[0], state: "asleep" }],
      },
    ],
    [
      "a brain of an unknown provider",
      {
        ...brainsInfo(),
        brains: [{ ...brainsInfo().brains[0], provider: "openai" }],
      },
    ],
    [
      "a provider without a reset",
      { ...brainsInfo(), providers: [{ id: "google", label: "Gemini" }] },
    ],
    ["an active brain that is a number", { ...brainsInfo(), activeBrainId: 3 }],
  ])("refuses %s", (_name, value) => {
    expect(readBrainsInfo(value)).toBeNull();
  });
});
