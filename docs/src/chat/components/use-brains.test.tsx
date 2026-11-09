import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, vi } from "vitest";
import { brainsInfo } from "./brains.fixture";
import { readBrainsInfo, useBrains } from "./use-brains";

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
