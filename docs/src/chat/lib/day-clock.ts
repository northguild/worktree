// Whose day it is, and when it ends (plan #309 D10; ported from gmt `src/lib/pt-day.ts`).
//
// A daily allowance refills at its own midnight, not at the reader's: Gemini's at midnight Pacific, Workers AI's at 00:00
// UTC, and Dox's own per-visitor cap on the UTC day. The ledger buckets its keys by the day on the clock that allowance
// runs on, and gives each key a TTL that ends with it. The arithmetic is `@northguild/gmt`'s, never `Date`: a day in a
// zone that observes DST can be 23 or 25 hours long. Nothing here imports React or the DOM: the Worker bundles it.

import { convertUnixToZoned } from "@northguild/gmt/unix/convert";
import { addZoned, startOfZoned } from "@northguild/gmt/zoned/calculate";
import { convertZonedToUnix } from "@northguild/gmt/zoned/convert";

/** The clock of Dox's own per-visitor daily cap (D10): UTC days. */
export const VISITOR_CAP_TIME_ZONE = "UTC";

/**
 * Cloudflare KV refuses an `expirationTtl` under 60 s ("The minimum value is 60", the KV `put()` reference; plan #309
 * §9 Q15). gmt floors at the same number. With the margin below it never binds today; it keeps a TTL one KV would
 * accept if the margin ever changes.
 */
const KV_MIN_TTL_SECONDS = 60;

/** Added to a TTL so a key never expires slightly before the boundary it stands for (D10). */
const TTL_MARGIN_SECONDS = 300;

/**
 * The calendar date for an instant in `timeZone`, as `YYYY-MM-DD`: the ledger's bucket key. gmt answers `""` for invalid
 * input, and a bad clock must not take the chat down, so that becomes one stable bucket, `"unknown"`.
 */
export function dayKey(nowMs: number, timeZone: string): string {
  const zoned = convertUnixToZoned(nowMs, timeZone);
  return zoned === "" ? "unknown" : zoned.slice(0, 10);
}

/**
 * The next midnight in a zone, as an instant: the start of tomorrow's date, not 24 hours on, because across a clock
 * change the two differ and only the first lands on midnight. An unknown zone or a bad clock returns `nowMs` rather
 * than throwing: gmt answers `""` for invalid input, never an exception.
 */
export function nextMidnightMs(nowMs: number, timeZone: string): number {
  const zoned = convertUnixToZoned(nowMs, timeZone);
  if (zoned === "") return nowMs;
  const unix = convertZonedToUnix(
    addZoned(startOfZoned(zoned, "day"), { days: 1 }),
  );
  return typeof unix === "number" ? unix : nowMs;
}

/** The TTL of a ledger key on `timeZone`'s clock: seconds to its next midnight, plus a margin, never below KV's minimum. */
export function secondsUntilMidnight(nowMs: number, timeZone: string): number {
  const remaining = Math.ceil((nextMidnightMs(nowMs, timeZone) - nowMs) / 1000);
  return Math.max(KV_MIN_TTL_SECONDS, remaining + TTL_MARGIN_SECONDS);
}

/** The UTC calendar date for an instant: the visitor cap's bucket key. */
export function visitorDayKey(nowMs: number): string {
  return dayKey(nowMs, VISITOR_CAP_TIME_ZONE);
}

/** The next UTC midnight: when a visitor's questions refill. */
export function nextVisitorMidnightMs(nowMs: number): number {
  return nextMidnightMs(nowMs, VISITOR_CAP_TIME_ZONE);
}

/** The TTL of a visitor key. */
export function secondsUntilVisitorReset(nowMs: number): number {
  return secondsUntilMidnight(nowMs, VISITOR_CAP_TIME_ZONE);
}
