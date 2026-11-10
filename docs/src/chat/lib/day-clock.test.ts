import { convertUtcToUnix } from "@northguild/gmt";
import { describe, expect, it } from "vitest";
import {
  dayKey,
  nextVisitorMidnightMs,
  secondsUntilMidnight,
  secondsUntilVisitorReset,
  visitorDayKey,
} from "./day-clock";

// Expected values are worked by hand from the zone rules (plan #309 §8): Pacific is UTC-8 in winter, and UTC-7 until
// 2026-11-01 09:00Z, when the clocks go back; UTC has no changes. A TTL is the seconds to the next midnight plus 300,
// and a key's day is the calendar date on the clock the provider's quota runs on.

function unix(iso: string): number {
  const ms = convertUtcToUnix(iso);
  if (ms === null) throw new Error(`bad fixture ${iso}`);
  return ms;
}

const LA = "America/Los_Angeles";

describe("dayKey", () => {
  it.each([
    // 03:00Z on the 10th is 19:00 on the 9th in Pacific (UTC-8).
    [
      "Pacific, evening: still the 9th",
      "2026-11-10T03:00:00Z",
      LA,
      "2026-11-09",
    ],
    [
      "UTC, same instant: the 10th",
      "2026-11-10T03:00:00Z",
      "UTC",
      "2026-11-10",
    ],
    // 07:59:59Z is 23:59:59 PST the day before; 08:00:00Z is Pacific midnight.
    [
      "Pacific, a second before midnight",
      "2026-11-10T07:59:59Z",
      LA,
      "2026-11-09",
    ],
    ["Pacific, at midnight", "2026-11-10T08:00:00Z", LA, "2026-11-10"],
  ])("%s", (_name, now, zone, expected) => {
    expect(dayKey(unix(now), zone)).toBe(expected);
  });

  it("falls back to a stable bucket on an unknown zone, not an empty key", () => {
    expect(dayKey(unix("2026-11-10T03:00:00Z"), "Not/AZone")).toBe("unknown");
  });
});

describe("secondsUntilMidnight (the TTL of a ledger key)", () => {
  it.each([
    // Pacific midnight is 08:00Z; from 03:00Z that is 5 h = 18,000 s, plus 300.
    ["Pacific, five hours to go", "2026-11-10T03:00:00Z", LA, 18_300],
    // UTC midnight is 2026-11-11T00:00Z; from 03:00Z that is 21 h = 75,600 s, plus 300.
    ["UTC, 21 hours to go", "2026-11-10T03:00:00Z", "UTC", 75_900],
    // 30 s to UTC midnight, plus 300.
    ["UTC, 30 s to go", "2026-11-10T23:59:30Z", "UTC", 330],
    // 07:00Z on 11-01 is 00:00 PDT; the clocks go back at 09:00Z, so the day is 25 h: midnight PST is 11-02T08:00Z,
    // 25 h = 90,000 s away, plus 300.
    ["Pacific, the 25-hour day", "2026-11-01T07:00:00Z", LA, 90_300],
  ])("%s", (_name, now, zone, expected) => {
    expect(secondsUntilMidnight(unix(now), zone)).toBe(expected);
  });

  it("falls back to the 300 s margin alone when the zone is unknown", () => {
    // An unknown zone makes the midnight `now`, so no time remains and only the margin is left. This does not exercise
    // the 60 s floor, which the margin keeps from ever binding.
    expect(
      secondsUntilMidnight(unix("2026-11-10T03:00:00Z"), "Not/AZone"),
    ).toBe(300);
  });
});

describe("the visitor's day is UTC", () => {
  const now = unix("2026-11-10T03:00:00Z");

  it("keys the day on UTC, not Pacific", () => {
    expect(visitorDayKey(now)).toBe("2026-11-10");
  });

  it("resets at the next UTC midnight", () => {
    expect(nextVisitorMidnightMs(now)).toBe(unix("2026-11-11T00:00:00Z"));
  });

  it("expires 21 hours and 300 s on", () => {
    expect(secondsUntilVisitorReset(now)).toBe(75_900);
  });
});
