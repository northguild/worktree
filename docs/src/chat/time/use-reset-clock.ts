/**
 * The reset clock's view of the date display settings (plan #309 D13; ported from gmt's `use-reset-clock.ts`): the format and
 * zone resets are shown in, plus the reader's locale and a "now" that keeps relative output from going stale.
 *
 * The format and zone live in `date-display-store.ts`, shared with the header clock. This hook adds what is local to one
 * clock: the zone list, the locale and the tick. "Now" is `getUtcNow()`, a UTC ISO string, the same value type as the resets
 * it is compared with, so every preset takes both directly.
 *
 * ## Resolved after mount, never during render
 *
 * `/dox` is rendered at build time, and the build's zone and locale are not the reader's. Resolving either during render
 * would make the server print one reset and the browser another (a hydration mismatch). Until the effect has run, `ready`
 * is false and every consumer renders no reset at all.
 */
import { getUtcNow } from "@northguild/gmt/utc/get";
import { getSystemTimeZone, getTimeZones } from "@northguild/gmt/zoned/get";
import { useEffect, useState } from "react";
import {
  hydrateDateDisplay,
  setDateFormat,
  setDateZone,
  useDateDisplay,
} from "./date-display-store";
import type { ResetFormatId } from "./reset-formats";

/** Relative and calendar output is minute-grained, so a minute is the longest the chip can sit without reading wrong. */
const TICK_MS = 60_000;

export interface ResetClockState {
  /** False until the reader's zone and locale are known. Render no reset before then. */
  ready: boolean;
  /** The IANA zone resets are rendered in. Defaults to the reader's own. */
  zone: string;
  formatId: ResetFormatId;
  /** BCP 47 locale for the localised presets: the browser's own. */
  locale: string;
  /** "Now" as a UTC ISO string, refreshed every tick. */
  now: string;
  /** Every zone the picker offers. */
  zones: readonly string[];
  setZone: (zone: string) => void;
  setFormatId: (id: ResetFormatId) => void;
}

/**
 * gmt's `getTimeZones()`, made safe to pick from. `Intl.supportedValuesOf("timeZone")` lists canonical ids only; some engines
 * leave `UTC` out, and a reader's system zone can be an alias that is not in the list (`Asia/Calcutta`). Both are added
 * rather than left unselectable.
 */
function zoneOptions(systemZone: string): string[] {
  const zones = getTimeZones();
  const extras = ["UTC", systemZone].filter(
    (zone) => zone !== "" && !zones.includes(zone),
  );
  return [...new Set([...extras, ...zones])];
}

export function useResetClock(): ResetClockState {
  const formatId = useDateDisplay((display) => display.formatId);
  const pickedZone = useDateDisplay((display) => display.zone);

  const [ready, setReady] = useState(false);
  const [zones, setZones] = useState<readonly string[]>([]);
  const [systemZone, setSystemZone] = useState("UTC");
  const [locale, setLocale] = useState("en-US");
  const [now, setNow] = useState("");

  useEffect(() => {
    hydrateDateDisplay();

    const system = getSystemTimeZone() || "UTC";
    setSystemZone(system);
    setZones(zoneOptions(system));
    setLocale(Intl.DateTimeFormat().resolvedOptions().locale);
    setNow(getUtcNow());
    setReady(true);

    const timer = window.setInterval(() => setNow(getUtcNow()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  // A stored zone this runtime does not offer (a typo, a zone from another engine's list) falls back to the reader's own
  // rather than rendering "".
  const zone =
    pickedZone && zones.includes(pickedZone) ? pickedZone : systemZone;

  return {
    ready,
    zone,
    formatId,
    locale,
    now,
    zones,
    setZone: setDateZone,
    setFormatId: setDateFormat,
  };
}
