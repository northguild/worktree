import { act, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, vi } from "vitest";
import { resetDateDisplay, setDateFormat } from "./date-display-store";
import { useResetClock } from "./use-reset-clock";

// Expected values: plan #309 Phase 8 "Done when" and its scope ("zone and locale resolve after mount, never during
// render"; "nothing time-based rendered on the server"), and D13. The clock is pinned to 1781593200000 ms, which is
// 2026-06-16T07:00:00Z: 1781593200 s is 20620 days and 7 hours after the epoch (20454 days to 2026-01-01, plus the 166 days
// to June 16), the instant gmt's own examples use for Pacific midnight.
const PINNED_MS = 1_781_593_200_000;
// gmt's `getUtcNow()` reads the clock to the nanosecond, so a pinned millisecond comes back with a sub-millisecond tail.
const PINNED_ISO_PREFIX = "2026-06-16T07:00:00.000";

let storage: Map<string, string>;
const realZone = process.env.TZ;

beforeEach(() => {
  resetDateDisplay();
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  vi.useFakeTimers();
  vi.setSystemTime(PINNED_MS);
  process.env.TZ = "Asia/Tokyo";
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (realZone === undefined) delete process.env.TZ;
  else process.env.TZ = realZone;
});

describe("useResetClock", () => {
  it("is not ready on the server's pass, and holds no zone, locale or instant of the server's own", () => {
    let seen: ReturnType<typeof useResetClock> | undefined;
    function Probe() {
      seen = useResetClock();
      return null;
    }
    renderToString(<Probe />);
    expect(seen).toMatchObject({ ready: false, now: "", zones: [] });
  });

  it("becomes ready on the reader's own zone, the default format and the pinned instant", () => {
    const { result } = renderHook(() => useResetClock());
    expect(result.current.ready).toBe(true);
    expect(result.current.zone).toBe("Asia/Tokyo");
    expect(result.current.formatId).toBe("calendar");
    expect(result.current.now.startsWith(PINNED_ISO_PREFIX)).toBe(true);
    expect(result.current.locale).toMatch(/^[a-z]{2,3}(-|$)/i);
  });

  it("offers UTC and the reader's zone even when the engine's list leaves them out", () => {
    const { result } = renderHook(() => useResetClock());
    expect(result.current.zones).toContain("UTC");
    expect(result.current.zones).toContain("Asia/Tokyo");
    expect(result.current.zones).toContain("America/New_York");
  });

  it("moves 'now' on a minute's tick", () => {
    const { result } = renderHook(() => useResetClock());
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(result.current.now.startsWith("2026-06-16T07:01:00.000")).toBe(true);
  });

  it("stops ticking when the clock unmounts", () => {
    const { unmount } = renderHook(() => useResetClock());
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("writes the reader's picks to the store, which remembers them", () => {
    const { result } = renderHook(() => useResetClock());
    act(() => result.current.setFormatId("http"));
    act(() => result.current.setZone("Europe/London"));
    expect(result.current.formatId).toBe("http");
    expect(result.current.zone).toBe("Europe/London");
    expect(storage.get("dox:date-format")).toBe("http");
    expect(storage.get("dox:date-zone")).toBe("Europe/London");
  });

  it("applies a stored pick after mount", () => {
    storage.set("dox:date-format", "unix-s");
    storage.set("dox:date-zone", "Europe/London");
    const { result } = renderHook(() => useResetClock());
    expect(result.current.formatId).toBe("unix-s");
    expect(result.current.zone).toBe("Europe/London");
  });

  it("falls back to the reader's own zone for a stored zone this engine does not offer", () => {
    storage.set("dox:date-zone", "Mars/Olympus_Mons");
    const { result } = renderHook(() => useResetClock());
    expect(result.current.zone).toBe("Asia/Tokyo");
  });

  it("ignores a stored format it does not recognise", () => {
    storage.set("dox:date-format", "relative-medium");
    const { result } = renderHook(() => useResetClock());
    expect(result.current.formatId).toBe("calendar");
  });

  it("follows a format picked elsewhere in the store", () => {
    const { result } = renderHook(() => useResetClock());
    act(() => setDateFormat("unix-ms"));
    expect(result.current.formatId).toBe("unix-ms");
  });
});
