/**
 * How Dox displays dates: one store every surface reads (plan #309 D13; ported from gmt's `date-display-store.ts`).
 *
 * Its writer is the reset clock's popover (format and zone); its readers are that clock, the header clock in the strip and
 * the brain menu's headings. gmt keeps it in TanStack Store; this site has no such dependency (D4: none added), and a store
 * is a value, a set of listeners and `useSyncExternalStore`.
 *
 * ## Hydration
 *
 * The store starts on the defaults everywhere, the server included, and `useDateDisplay` reads the defaults while the page
 * hydrates. Stored picks are applied by `hydrateDateDisplay()`, which every consumer calls from an effect, so nothing that
 * depends on them can reach server-rendered markup and hydrate against a different value. Consumers already render no date
 * until mount, because the reader's zone is not the server's.
 */
import { useSyncExternalStore } from "react";
import {
  DEFAULT_RESET_FORMAT_ID,
  isResetFormatId,
  type ResetFormatId,
} from "./reset-formats";

export interface DateDisplayState {
  /** Which gmt-backed preset to render dates with. */
  formatId: ResetFormatId;
  /** IANA zone for the zoned presets, or `null` for the reader's own. */
  zone: string | null;
}

/** The storage surface this module touches: `localStorage` in the browser, an in-memory stand-in in tests. */
export type DateDisplayStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

// gmt's own keys: the two Dox pages share an origin, so a reader's pick carries from one to the other.
const FORMAT_KEY = "dox:date-format";
const ZONE_KEY = "dox:date-zone";

export const DEFAULT_DATE_DISPLAY: DateDisplayState = {
  formatId: DEFAULT_RESET_FORMAT_ID,
  zone: null,
};

let state: DateDisplayState = DEFAULT_DATE_DISPLAY;
const listeners = new Set<() => void>();

export function getDateDisplay(): DateDisplayState {
  return state;
}

function replace(next: DateDisplayState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** A component's view of the store, re-rendered when the part it selects changes. */
export function useDateDisplay<T>(select: (state: DateDisplayState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(state),
    // The server, and the client's hydrating pass, see the defaults: picks are applied after mount.
    () => select(DEFAULT_DATE_DISPLAY),
  );
}

export function setDateFormat(formatId: ResetFormatId): void {
  replace({ ...state, formatId });
}

export function setDateZone(zone: string | null): void {
  replace({ ...state, zone });
}

/** `localStorage`, or nothing: it throws in some private modes and when site data is blocked, and is absent on the server. */
function browserStorage(): DateDisplayStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function read(storage: DateDisplayStorage | undefined, key: string) {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(
  storage: DateDisplayStorage | undefined,
  key: string,
  value: string | null,
): void {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    // Not persisted; the pick still holds for this session.
  }
}

let unsubscribe: (() => void) | null = null;

/**
 * Applies the reader's stored picks and starts saving changes. Idempotent: every consumer calls it on mount and only the
 * first call does anything. A stored format this build does not know is ignored. A stored zone is kept as it is; checking
 * it against the zone list is the consumer's job, since only it holds that list.
 */
export function hydrateDateDisplay(
  storage: DateDisplayStorage | undefined = browserStorage(),
): void {
  if (unsubscribe) return;

  const storedFormat = read(storage, FORMAT_KEY);
  const storedZone = read(storage, ZONE_KEY);
  replace({
    formatId: isResetFormatId(storedFormat)
      ? storedFormat
      : DEFAULT_RESET_FORMAT_ID,
    zone: storedZone || null,
  });

  unsubscribe = subscribe(() => {
    write(storage, FORMAT_KEY, state.formatId);
    write(storage, ZONE_KEY, state.zone);
  });
}

/** Back to the defaults and not hydrated. For tests. */
export function resetDateDisplay(): void {
  unsubscribe?.();
  unsubscribe = null;
  replace(DEFAULT_DATE_DISPLAY);
}
