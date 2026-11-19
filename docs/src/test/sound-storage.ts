/**
 * Sound records for tests, saved the way `writeSound` saves them (ported from gmt apps/dox/src/test/sound-storage.ts
 * at d6031ecd). Sound is opt-in, so a test that needs to hear anything stands for a reader who has turned it on:
 * `saveSound()` is unmuted unless `fields` says otherwise.
 *
 * `stubStorage` is this site's addition: the jsdom environment's own `localStorage` is not reliably present, so a test
 * supplies an in-memory one. `blocked` makes every call throw, as a browser with storage disabled does; `writesBlocked`
 * makes only writes throw, as a full quota does. Both can be flipped on the returned object.
 */
import { vi } from "vitest";
import { SOUND_KEY, SOUND_VERSION } from "../lib/sound/settings";

export interface StubStorage {
  /** Every call throws, reads included. */
  blocked: boolean;
  /** Only writes throw. */
  writesBlocked: boolean;
}

/** Installs an in-memory `localStorage`; the returned flags can be flipped mid-test. */
export function stubStorage(flags: Partial<StubStorage> = {}): StubStorage {
  const state: StubStorage = { blocked: false, writesBlocked: false, ...flags };
  const data = new Map<string, string>();
  const guard = <T>(fn: () => T, write = false): T => {
    if (state.blocked || (write && state.writesBlocked))
      throw new Error("blocked");
    return fn();
  };
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => guard(() => data.get(key) ?? null),
    setItem: (key: string, value: string) =>
      guard(() => void data.set(key, value), true),
    removeItem: (key: string) => guard(() => void data.delete(key), true),
    clear: () => guard(() => data.clear(), true),
  });
  return state;
}

export function saveSound(fields: Record<string, unknown> = {}): void {
  localStorage.setItem(
    SOUND_KEY,
    JSON.stringify({ v: SOUND_VERSION, muted: false, ...fields }),
  );
}
