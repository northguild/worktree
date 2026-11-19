/**
 * @vitest-environment jsdom
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type StubStorage,
  saveSound,
  stubStorage,
} from "../../test/sound-storage";
import {
  AURA_KEY,
  onAuraChange,
  onSoundChange,
  readAura,
  readSound,
  SOUND_KEY,
  writeAura,
  writeSound,
} from "./settings";

// Expected values come from the plan (#352 D5, D6, Phase 3 "Done when") and GMT's semantics (gmt
// apps/dox/src/lib/sound/settings.ts at d6031ecd), never from this code: no record, corrupt JSON, `v: 2` and a
// `muted` that is not a boolean all read as muted at level 5; this site writes `level` and `muted` only and carries
// the stored `aura` and `track` through untouched; `worktree:aura` is off on Forest air unless a valid record says
// otherwise.

const MUTED = { level: 5, muted: true };
const AURA_OFF = { on: false, track: "forest" };

const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? "null");

let storage: StubStorage;

beforeEach(() => {
  storage = stubStorage();
});

afterEach(() => {
  // A write that lands clears any choice an earlier test's blocked storage left on the page.
  storage.writesBlocked = false;
  storage.blocked = false;
  writeSound({});
  writeAura({});
  vi.unstubAllGlobals();
});

/** Another tab's write: the browser fires `storage`; nothing here can press it. */
function storageChanged(key: string) {
  window.dispatchEvent(new StorageEvent("storage", { key }));
}

/** A return from the back/forward cache, or a plain load when `persisted` is false. */
function pageShown(persisted: boolean) {
  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted }));
}

describe("readSound", () => {
  it("is muted at level 5 with nothing saved", () => {
    expect(readSound()).toEqual(MUTED);
  });

  it.each([
    ["corrupt JSON", "{not json"],
    ["a number", "7"],
    ["null", "null"],
    ["an array", "[false]"],
    ["v: 2", JSON.stringify({ v: 2, level: 9, muted: false })],
    ["no version", JSON.stringify({ level: 9, muted: false })],
    ["a version of the wrong type", JSON.stringify({ v: "1", muted: false })],
  ])("reads %s as muted at level 5", (_name, raw) => {
    localStorage.setItem(SOUND_KEY, raw);
    expect(readSound()).toEqual(MUTED);
  });

  it("reads each field on its own: muted: 'no' stays muted, a level of the wrong type is 5", () => {
    saveSound({ muted: "no", level: "loud" });
    expect(readSound()).toEqual(MUTED);
    saveSound({ muted: false, level: "loud" });
    expect(readSound()).toEqual({ level: 5, muted: false });
    saveSound({ muted: "no", level: 8 });
    expect(readSound()).toEqual({ level: 8, muted: true });
  });

  it("reads a saved choice", () => {
    saveSound({ level: 8, muted: false });
    expect(readSound()).toEqual({ level: 8, muted: false });
  });

  it("clamps a level outside 1 to 11", () => {
    saveSound({ level: 99 });
    expect(readSound().level).toBe(11);
    saveSound({ level: -4 });
    expect(readSound().level).toBe(1);
    expect(writeSound({ level: 0 }).level).toBe(1);
  });

  it("reads the muted default when reading throws, and writes nothing", () => {
    storage.blocked = true;
    expect(readSound()).toEqual(MUTED);
    storage.blocked = false;
    expect(localStorage.getItem(SOUND_KEY)).toBeNull();
  });
});

describe("writeSound carries aura and track through", () => {
  it("keeps what GMT wrote (aura: false, track: 'deep') when level is written", () => {
    saveSound({ muted: true, aura: false, track: "deep" });
    writeSound({ level: 9 });
    expect(stored(SOUND_KEY)).toEqual({
      v: 1,
      level: 9,
      muted: true,
      aura: false,
      track: "deep",
    });
  });

  it("keeps a track GMT would reject ('forest') unchanged", () => {
    saveSound({ aura: true, track: "forest" });
    writeSound({ muted: true });
    expect(stored(SOUND_KEY)).toMatchObject({ aura: true, track: "forest" });
  });

  it("keeps values of any type unchanged", () => {
    saveSound({ aura: "maybe", track: 7 });
    writeSound({ level: 3 });
    expect(stored(SOUND_KEY)).toMatchObject({ aura: "maybe", track: 7 });
  });

  it("leaves an absent aura and track absent", () => {
    writeSound({ muted: false, level: 7 });
    expect(stored(SOUND_KEY)).toEqual({ v: 1, level: 7, muted: false });
  });

  it("carries them through a write made after storage could not keep an earlier one", () => {
    saveSound({ muted: true, aura: false, track: "deep" });
    storage.writesBlocked = true;
    writeSound({ muted: false });
    expect(readSound().muted).toBe(false);
    storage.writesBlocked = false;
    writeSound({ level: 9 });
    expect(stored(SOUND_KEY)).toEqual({
      v: 1,
      level: 9,
      muted: false,
      aura: false,
      track: "deep",
    });
  });
});

describe("storage that throws", () => {
  it("keeps an unmute it could not save for the rest of the page", () => {
    storage.writesBlocked = true;
    expect(() => writeSound({ muted: false, level: 7 })).not.toThrow();
    expect(readSound()).toEqual({ muted: false, level: 7 });
    storage.writesBlocked = false;
    expect(localStorage.getItem(SOUND_KEY)).toBeNull();
  });

  it("drops the unsaved choice for another tab's write, which is newer", () => {
    const stop = onSoundChange(() => {});
    storage.writesBlocked = true;
    writeSound({ muted: false });
    storage.writesBlocked = false;
    saveSound({ muted: true, level: 2 });
    storageChanged(SOUND_KEY);
    expect(readSound()).toEqual({ muted: true, level: 2 });
    stop();
  });
});

describe("onSoundChange", () => {
  it("tells listeners of this document's write, then stops when unsubscribed", () => {
    const fn = vi.fn();
    const stop = onSoundChange(fn);
    writeSound({ muted: false });
    expect(fn).toHaveBeenCalledWith({ level: 5, muted: false }, "local");
    stop();
    writeSound({ level: 6 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("follows another tab through the storage event, ignoring other keys", () => {
    const fn = vi.fn();
    const stop = onSoundChange(fn);
    saveSound({ level: 9 });
    storageChanged(SOUND_KEY);
    expect(fn).toHaveBeenCalledWith({ level: 9, muted: false }, "storage");
    storageChanged("other");
    expect(fn).toHaveBeenCalledTimes(1);
    stop();
  });

  it("reads again when another tab clears its storage (a storage event with no key)", () => {
    const fn = vi.fn();
    const stop = onSoundChange(fn);
    saveSound({ level: 7 });
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
    expect(fn).toHaveBeenCalledWith({ level: 7, muted: false }, "storage");
    stop();
  });

  it("reads again on a return from the back/forward cache, not on a plain load", () => {
    const fn = vi.fn();
    const stop = onSoundChange(fn);
    saveSound();
    pageShown(false);
    expect(fn).not.toHaveBeenCalled();
    pageShown(true);
    expect(fn).toHaveBeenCalledWith({ level: 5, muted: false }, "storage");
    stop();
    pageShown(true);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("readAura", () => {
  it("is off on Forest air with nothing saved", () => {
    expect(readAura()).toEqual(AURA_OFF);
  });

  it.each([
    ["corrupt JSON", "{oops"],
    ["null", "null"],
    ["v: 2", JSON.stringify({ v: 2, on: true, track: "overhead" })],
    ["no version", JSON.stringify({ on: true })],
    ["on of the wrong type", JSON.stringify({ v: 1, on: "yes" })],
    ["on: 1", JSON.stringify({ v: 1, on: 1 })],
  ])("never turns on from %s", (_name, raw) => {
    localStorage.setItem(AURA_KEY, raw);
    expect(readAura().on).toBe(false);
  });

  it("reads on: true only from a valid record", () => {
    localStorage.setItem(
      AURA_KEY,
      JSON.stringify({ v: 1, on: true, track: "overhead" }),
    );
    expect(readAura()).toEqual({ on: true, track: "overhead" });
  });

  it("reads each field on its own: an unknown track is Forest air, a bad on is off", () => {
    localStorage.setItem(
      AURA_KEY,
      JSON.stringify({ v: 1, on: true, track: "ice" }),
    );
    expect(readAura()).toEqual({ on: true, track: "forest" });
    localStorage.setItem(
      AURA_KEY,
      JSON.stringify({ v: 1, on: "x", track: "overhead" }),
    );
    expect(readAura()).toEqual({ on: false, track: "overhead" });
  });

  it("reads the default when reading throws, and writes nothing", () => {
    storage.blocked = true;
    expect(readAura()).toEqual(AURA_OFF);
    storage.blocked = false;
    expect(localStorage.getItem(AURA_KEY)).toBeNull();
  });
});

describe("writeAura", () => {
  it("saves the record with its version and leaves dox:sound alone", () => {
    writeAura({ on: true });
    expect(stored(AURA_KEY)).toEqual({ v: 1, on: true, track: "forest" });
    expect(localStorage.getItem(SOUND_KEY)).toBeNull();
    writeAura({ track: "overhead" });
    expect(stored(AURA_KEY)).toEqual({ v: 1, on: true, track: "overhead" });
  });

  it("keeps a choice storage could not save for the rest of the page", () => {
    storage.writesBlocked = true;
    expect(() => writeAura({ on: true })).not.toThrow();
    expect(readAura()).toEqual({ on: true, track: "forest" });
  });
});

describe("onAuraChange", () => {
  it("tells listeners of a local write, a storage event and a restored page, then stops", () => {
    const fn = vi.fn();
    const stop = onAuraChange(fn);
    writeAura({ on: true });
    expect(fn).toHaveBeenLastCalledWith({ on: true, track: "forest" }, "local");
    localStorage.setItem(
      AURA_KEY,
      JSON.stringify({ v: 1, on: false, track: "overhead" }),
    );
    storageChanged(AURA_KEY);
    expect(fn).toHaveBeenLastCalledWith(
      { on: false, track: "overhead" },
      "storage",
    );
    storageChanged(SOUND_KEY);
    expect(fn).toHaveBeenCalledTimes(2);
    pageShown(false);
    expect(fn).toHaveBeenCalledTimes(2);
    pageShown(true);
    expect(fn).toHaveBeenCalledTimes(3);
    stop();
    pageShown(true);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe("the pre-paint script", () => {
  const source = readFileSync(
    resolve(process.cwd(), "src/components/ThemeProvider.astro"),
    "utf8",
  );
  const script = source
    .replace(/^[\s\S]*?<script is:inline>/, "")
    .replace(/<\/script>[\s\S]*$/, "");

  function prepaint(): string | undefined {
    delete document.documentElement.dataset.sound;
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    new Function(script)();
    return document.documentElement.dataset.sound;
  }

  it.each([
    ["nothing saved", null],
    ["saved unmuted", { v: 1, muted: false }],
    ["saved muted", { v: 1, muted: true }],
    ["unmuted with no version", { muted: false }],
    ["unmuted with v: 2", { v: 2, muted: false }],
    ["a mute of the wrong type", { v: 1, muted: "no" }],
    [
      "unmuted with GMT's aura and track",
      { v: 1, muted: false, aura: false, track: "deep" },
    ],
    ["corrupt", "{oops"],
    ["null", "null"],
    ["an array", "[false]"],
  ])("holds the same rule as readSound: %s", (_name, saved) => {
    if (saved !== null) {
      localStorage.setItem(
        SOUND_KEY,
        typeof saved === "string" ? saved : JSON.stringify(saved),
      );
    }
    expect(prepaint()).toBe(readSound().muted ? "off" : "on");
  });

  it("is on only for a saved v: 1 record with muted: false (fixed by the plan, not read from readSound)", () => {
    expect(prepaint()).toBe("off");
    localStorage.setItem(SOUND_KEY, JSON.stringify({ v: 1, muted: false }));
    expect(prepaint()).toBe("on");
  });

  it("still sets the theme", () => {
    prepaint();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("is off when storage throws", () => {
    storage.blocked = true;
    // The theme read after it is unguarded, as Starlight's is, so the script itself may throw.
    try {
      prepaint();
    } catch {}
    expect(document.documentElement.dataset.sound).toBe("off");
  });
});
