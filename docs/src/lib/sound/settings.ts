/**
 * The reader's sound choice, shared with GMT and Dox (plan #352, D5), and this site's own aura choice (D6).
 *
 * Ported from gmt apps/dox/src/lib/sound/settings.ts at d6031ecd, changed in two ways: this site reads and writes
 * `level` and `muted` only, and a write carries the stored `aura` and `track` through untouched (they are GMT's
 * landing's, and GMT rejects values this site might otherwise reset); and the aura has its own key.
 *
 * Sound is opt-in. Every visitor starts muted, whatever the system's settings, and only a reader's own choice in the
 * settings panel turns it on. Nothing else reads or writes these keys.
 *
 * `dox:sound` is one versioned record (`SOUND_VERSION`). `ThemeProvider.astro` reads the same key inline, before
 * first paint, and sets `data-sound` on `<html>` by the same rule; `settings.test.ts` holds the two equal. Change
 * both together.
 *
 * What makes it hold up:
 * - Anything this build cannot read (no record, corrupt JSON, another version, a field of the wrong type) reads as
 *   the default. A bad record can never turn sound or the aura on.
 * - A key is written only on a reader's choice; nothing writes one at load.
 * - Storage can throw (private windows, blocked site data, a full quota). A choice it cannot keep still holds for
 *   the rest of the page, so an unmute is not undone by the next read.
 * - A change in another tab arrives through the `storage` event. A page restored from the back/forward cache missed
 *   those while frozen, so it reads the key again on `pageshow`.
 */

/** The `localStorage` key GMT, Dox and this site share. `ThemeProvider.astro` reads it inline too. */
export const SOUND_KEY = "dox:sound";

/** This site's aura record (D6). GMT never reads it. */
export const AURA_KEY = "worktree:aura";

/** Raise a version when a field changes meaning, so an old record cannot carry a new meaning in. */
export const SOUND_VERSION = 1;
export const AURA_VERSION = 1;

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 11;

export interface SoundSettings {
  /** The volume notch, 1 to 11. */
  level: number;
  muted: boolean;
}

/** This site's two aura tracks: "Forest air" and "Leaves overhead". */
export const AURA_TRACKS = ["forest", "overhead"] as const;
export type AuraTrack = (typeof AURA_TRACKS)[number];

export const isAuraTrack = (value: unknown): value is AuraTrack =>
  (AURA_TRACKS as readonly unknown[]).includes(value);

export interface AuraSettings {
  on: boolean;
  track: AuraTrack;
}

/**
 * Where a change came from: this document's own write (a reader's gesture), or storage (another tab's write, or the
 * key read again on a return from the back/forward cache).
 */
export type SettingsOrigin = "local" | "storage";

function clampLevel(value: number): number {
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(value)));
}

/** The stored record as an object of this key's version, or null. Never throws. */
function storedRecord(
  key: string,
  version: number,
): Record<string, unknown> | null {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (typeof saved !== "object" || saved === null || Array.isArray(saved))
      return null;
    const record = saved as Record<string, unknown>;
    return record.v === version ? record : null;
  } catch {
    return null;
  }
}

/**
 * A listener set with the `storage` and `pageshow` hooks `onSoundChange` and `onAuraChange` share. `read` is the
 * settings now in force; `forget` drops this page's unsaved choice when another tab's write arrives.
 */
function subscribe<T>(
  key: string,
  listeners: Set<(settings: T, origin: SettingsOrigin) => void>,
  fn: (settings: T, origin: SettingsOrigin) => void,
  read: () => T,
  forget: () => void,
): () => void {
  listeners.add(fn);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== key && event.key !== null) return;
    // Another tab's write landed, so it is newer than any choice this page could not save.
    forget();
    fn(read(), "storage");
  };
  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) fn(read(), "storage");
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener("pageshow", onPageShow);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("pageshow", onPageShow);
  };
}

// --- dox:sound ---

/** What a visitor gets before choosing anything: muted, level 5. */
function defaultSound(): SoundSettings {
  return { level: 5, muted: true };
}

/** The saved choice, field by field over the default; a bad record or field reads as the default. */
function storedSound(): SoundSettings {
  const settings = defaultSound();
  const o = storedRecord(SOUND_KEY, SOUND_VERSION);
  if (!o) return settings;
  if (typeof o.level === "number" && Number.isFinite(o.level))
    settings.level = clampLevel(o.level);
  if (typeof o.muted === "boolean") settings.muted = o.muted;
  return settings;
}

/** This page's last choice, while storage has not kept it. Cleared when a write lands. */
let unsavedSound: SoundSettings | null = null;

/** The choice in force: this page's unsaved one, or the saved one, or the default. */
export function readSound(): SoundSettings {
  return unsavedSound ? { ...unsavedSound } : storedSound();
}

type SoundListener = (settings: SoundSettings, origin: SettingsOrigin) => void;
const soundListeners = new Set<SoundListener>();

/**
 * Save a reader's choice and tell this document's listeners. Returns what is now in force. The record keeps whatever
 * `aura` and `track` it already holds, of any value, and none where it holds none: they are GMT's.
 */
export function writeSound(patch: Partial<SoundSettings>): SoundSettings {
  const next = { ...readSound(), ...patch };
  next.level = clampLevel(next.level);
  const kept = storedRecord(SOUND_KEY, SOUND_VERSION);
  try {
    // `undefined` fields are left out by JSON.stringify, so an absent `aura` or `track` stays absent.
    localStorage.setItem(
      SOUND_KEY,
      JSON.stringify({
        v: SOUND_VERSION,
        level: next.level,
        muted: next.muted,
        aura: kept?.aura,
        track: kept?.track,
      }),
    );
    unsavedSound = null;
  } catch {
    // Not remembered for the next page, but it holds for this one.
    unsavedSound = next;
  }
  for (const fn of soundListeners) fn({ ...next }, "local");
  return { ...next };
}

/** Call `fn` on a change here, in another tab, or on a return from the back/forward cache. Returns the way to stop. */
export function onSoundChange(fn: SoundListener): () => void {
  return subscribe(SOUND_KEY, soundListeners, fn, readSound, () => {
    unsavedSound = null;
  });
}

// --- worktree:aura ---

/** What a visitor gets before choosing anything: the aura off, Forest air. */
function defaultAura(): AuraSettings {
  return { on: false, track: "forest" };
}

function storedAura(): AuraSettings {
  const settings = defaultAura();
  const o = storedRecord(AURA_KEY, AURA_VERSION);
  if (!o) return settings;
  if (typeof o.on === "boolean") settings.on = o.on;
  if (isAuraTrack(o.track)) settings.track = o.track;
  return settings;
}

let unsavedAura: AuraSettings | null = null;

/** The aura choice in force: this page's unsaved one, or the saved one, or the default (off). */
export function readAura(): AuraSettings {
  return unsavedAura ? { ...unsavedAura } : storedAura();
}

type AuraListener = (settings: AuraSettings, origin: SettingsOrigin) => void;
const auraListeners = new Set<AuraListener>();

/** Save a reader's aura choice and tell this document's listeners. Returns what is now in force. */
export function writeAura(patch: Partial<AuraSettings>): AuraSettings {
  const next = { ...readAura(), ...patch };
  try {
    localStorage.setItem(
      AURA_KEY,
      JSON.stringify({ v: AURA_VERSION, on: next.on, track: next.track }),
    );
    unsavedAura = null;
  } catch {
    unsavedAura = next;
  }
  for (const fn of auraListeners) fn({ ...next }, "local");
  return { ...next };
}

/** Call `fn` on an aura change here, in another tab, or on a return from the back/forward cache. */
export function onAuraChange(fn: AuraListener): () => void {
  return subscribe(AURA_KEY, auraListeners, fn, readAura, () => {
    unsavedAura = null;
  });
}
