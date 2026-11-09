/**
 * The current time in the `/dox` strip, in the reader's own zone and the page's chosen date format (plan #309 Phase 8, §4.1
 * row 2; ported from gmt's `HeaderClock`).
 *
 * The format comes from the shared date display store, so picking one in the reset clock's panel changes this too. The zone
 * is deliberately not the store's: this is the reader's local time, whatever zone they chose to read resets in.
 *
 * "Now" is `getUtcNow()`, a UTC ISO string, the value type every preset takes, so the clock renders it with exactly the
 * call the panel shows. A relative preset cannot make a clock (the distance from now to now is always "now"), so those
 * fall back to the calendar preset here (`liveClockFormat`), while the reset chip keeps its "in 4 hours".
 *
 * Renders nothing until mount: the build's zone and locale are not the reader's, so a time rendered earlier would be
 * wrong in the server's HTML and mismatch on hydration.
 */
import { getUtcNow } from "@northguild/gmt/utc/get";
import { getSystemTimeZone } from "@northguild/gmt/zoned/get";
import { useEffect, useState } from "react";
import { hydrateDateDisplay, useDateDisplay } from "../time/date-display-store";
import { liveClockFormat } from "../time/reset-formats";

/** Seconds show in several presets (local date-time, UTC, HTTP, Unix). */
const TICK_MS = 1_000;

interface LocalClock {
  zone: string;
  locale: string;
  now: string;
}

export function HeaderClock() {
  const formatId = useDateDisplay((display) => display.formatId);
  const [clock, setClock] = useState<LocalClock | null>(null);

  useEffect(() => {
    hydrateDateDisplay();

    const zone = getSystemTimeZone() || "UTC";
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    const tick = () => setClock({ zone, locale, now: getUtcNow() });
    tick();

    const timer = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  if (!clock) return null;

  const preset = liveClockFormat(formatId);
  const text = preset.format(clock.now, {
    timeZone: clock.zone,
    locale: clock.locale,
    now: clock.now,
  });
  if (text === "") return null;

  return (
    <time
      className="gmt-hive-now"
      dateTime={clock.now}
      title={`${preset.fnName} · ${clock.zone}`}
    >
      {text}
    </time>
  );
}
