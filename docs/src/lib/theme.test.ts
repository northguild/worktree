import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readTheme, THEME_KEY, type Theme, writeTheme } from "./theme";

// Expected values come from the plan (#352, D4 and Phase 1 "Done when"), not from the implementation: a press shows
// the opposite of the theme on screen; the key `starlight-theme` holds a theme only while it differs from the
// system's and is absent when it matches; with nothing saved the page follows the system. The key is Starlight 0.42.8's.

function stubSystem(system: Theme): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-color-scheme: light)" && system === "light",
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

// An in-memory Storage: this jsdom environment's own `localStorage` is not reliably present, so the test supplies one.
// `blocked` makes every call throw, as a browser with storage disabled does.
function stubStorage(blocked = false): void {
  const data = new Map<string, string>();
  const guard = <T>(fn: () => T): T => {
    if (blocked) throw new Error("storage blocked");
    return fn();
  };
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => guard(() => data.get(key) ?? null),
    setItem: (key: string, value: string) =>
      guard(() => void data.set(key, value)),
    removeItem: (key: string) => guard(() => void data.delete(key)),
    clear: () => guard(() => data.clear()),
  });
}

// A press of the settings switch (mountThemeSwitch): show the opposite of the theme on the screen (not of what storage says).
function press(): void {
  const shown =
    document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  writeTheme(opposite(shown));
}

const opposite = (theme: Theme): Theme =>
  theme === "light" ? "dark" : "light";

beforeEach(() => {
  stubStorage();
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("THEME_KEY", () => {
  it("is Starlight's key", () => {
    expect(THEME_KEY).toBe("starlight-theme");
  });
});

describe.each(["light", "dark"] as const)("system %s", (system) => {
  const other = opposite(system);

  beforeEach(() => stubSystem(system));

  describe("nothing saved", () => {
    it("shows the system's theme", () => {
      expect(readTheme()).toBe(system);
    });

    it("writing the opposite changes data-theme and saves it", () => {
      document.documentElement.dataset.theme = system;
      writeTheme(other);
      expect(document.documentElement.dataset.theme).toBe(other);
      expect(localStorage.getItem(THEME_KEY)).toBe(other);
      expect(readTheme()).toBe(other);
    });
  });

  describe("the opposite saved", () => {
    beforeEach(() => {
      localStorage.setItem(THEME_KEY, other);
      document.documentElement.dataset.theme = other;
    });

    it("shows the saved theme over the system's", () => {
      expect(readTheme()).toBe(other);
    });

    it("writing the opposite of the one on screen changes data-theme and leaves the key absent", () => {
      writeTheme(system);
      expect(document.documentElement.dataset.theme).toBe(system);
      expect(localStorage.getItem(THEME_KEY)).toBeNull();
      expect(readTheme()).toBe(system);
    });
  });

  it.each([
    "",
    "auto",
    "system",
    "Dark",
    "garbage",
  ])("treats the saved value %j as nothing saved, as Starlight does", (saved) => {
    localStorage.setItem(THEME_KEY, saved);
    expect(readTheme()).toBe(system);
  });

  it("a press always shows the opposite of the screen, over two presses", () => {
    document.documentElement.dataset.theme = readTheme();
    press();
    expect(document.documentElement.dataset.theme).toBe(other);
    press();
    expect(document.documentElement.dataset.theme).toBe(system);
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });

  it("a press flips the screen even when another tab saved a theme meanwhile", () => {
    document.documentElement.dataset.theme = system;
    localStorage.setItem(THEME_KEY, other); // another tab's press; this tab's screen still shows `system`
    press();
    expect(document.documentElement.dataset.theme).toBe(other);
  });

  it("every press flips the screen when storage is blocked", () => {
    stubStorage(true);
    document.documentElement.dataset.theme = system;
    press();
    expect(document.documentElement.dataset.theme).toBe(other);
    press();
    expect(document.documentElement.dataset.theme).toBe(system);
    press();
    expect(document.documentElement.dataset.theme).toBe(other);
  });

  it("still changes data-theme when storage is blocked", () => {
    stubStorage(true);
    writeTheme(other);
    expect(document.documentElement.dataset.theme).toBe(other);
    expect(readTheme()).toBe(system);
  });
});
