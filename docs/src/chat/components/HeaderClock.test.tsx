import { act, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, vi } from "vitest";
import {
  resetDateDisplay,
  setDateFormat,
  setDateZone,
} from "../time/date-display-store";
import { HeaderClock } from "./HeaderClock";

// Expected values: plan #309 §4.1 row 2 (the strip shows the reader's local clock in the app's date format) and D13. The clock
// is pinned to 1781593200000 ms = 2026-06-16T07:00:00Z (see use-reset-clock.test.tsx for the arithmetic) and the reader's
// zone to Asia/Tokyo (UTC+9, no DST), so it is 4:00 PM there that day. The text is each preset's documented output
// (reference pages: `formatCalendarUtc` reads "today at <time>" for a value on the reference's own day; `formatHttpDate`
// "Tue, 16 Jun 2026 07:00:00 GMT" is the IMF-fixdate for that instant).
const PINNED_MS = 1_781_593_200_000;
const realZone = process.env.TZ;

beforeEach(() => {
  resetDateDisplay();
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
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

describe("HeaderClock", () => {
  it("renders nothing on the server's pass: no time of the build's own", () => {
    expect(renderToString(<HeaderClock />)).toBe("");
  });

  it("shows the current local time in the default calendar format, as a <time> with its instant", () => {
    render(<HeaderClock />);
    const clock = screen.getByText("today at 4:00 PM");
    expect(clock.tagName).toBe("TIME");
    expect(clock.getAttribute("datetime")).toMatch(/^2026-06-16T07:00:00\.000/);
  });

  it("names the function and the zone in its title", () => {
    render(<HeaderClock />);
    expect(screen.getByText("today at 4:00 PM")).toHaveAttribute(
      "title",
      "formatCalendarUtc · Asia/Tokyo",
    );
  });

  it("follows the format picked in the shared store", () => {
    render(<HeaderClock />);
    act(() => setDateFormat("http"));
    expect(
      screen.getByText("Tue, 16 Jun 2026 07:00:00 GMT"),
    ).toBeInTheDocument();
  });

  it("falls back to the calendar format for a relative pick, which would only ever say 'now'", () => {
    render(<HeaderClock />);
    act(() => setDateFormat("relative-long"));
    expect(screen.getByText("today at 4:00 PM")).toHaveAttribute(
      "title",
      "formatCalendarUtc · Asia/Tokyo",
    );
  });

  it("stays on the reader's own zone, whatever zone the store holds", () => {
    render(<HeaderClock />);
    act(() => setDateZone("America/New_York"));
    expect(screen.getByText("today at 4:00 PM")).toBeInTheDocument();
  });

  it("ticks every second", () => {
    render(<HeaderClock />);
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(
      screen.getByText("today at 4:00 PM").getAttribute("datetime"),
    ).toMatch(/^2026-06-16T07:00:01\.000/);
  });

  it("stops ticking when it unmounts", () => {
    const { unmount } = render(<HeaderClock />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
