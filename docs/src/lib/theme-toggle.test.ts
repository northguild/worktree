// @vitest-environment node
import { describe, expect, it } from "vitest";
import { nextStored, resolve, STORAGE_KEY } from "./theme-toggle";

// Expected values are the "toggle" table of plan #266 §4 (D1), which restates the issue's acceptance criterion
// ("only have system and non-system"), checked against GMT's ThemeSelect.astro at b15b3899 (click: an explicit theme is
// removed; none stored -> the opposite of the system preference is stored). Storage is Starlight 0.42.8's (D2): key
// `starlight-theme`, only "light" or "dark" is a stored theme; anything else, "" (what Starlight writes for "auto")
// included, means "follow the system". "" below stands for "nothing stored".
describe("nextStored: what a click stores", () => {
  it("none stored, system light: stores dark", () => {
    expect(nextStored(null, "light")).toBe("dark");
  });

  it("none stored, system dark: stores light", () => {
    expect(nextStored(null, "dark")).toBe("light");
  });

  it("stored light: back to system (nothing stored), whichever the system prefers", () => {
    expect(nextStored("light", "light")).toBe("");
    expect(nextStored("light", "dark")).toBe("");
  });

  it("stored dark: back to system (nothing stored), whichever the system prefers", () => {
    expect(nextStored("dark", "light")).toBe("");
    expect(nextStored("dark", "dark")).toBe("");
  });

  it.each([
    "",
    "auto",
    "system",
    "Dark",
    "garbage",
  ])("treats the stored value %j as system, as Starlight does", (stored) => {
    expect(nextStored(stored, "light")).toBe("dark");
    expect(nextStored(stored, "dark")).toBe("light");
  });
});

describe("resolve: the theme to apply", () => {
  it("an explicit light or dark wins over the system", () => {
    expect(resolve("light", "dark")).toBe("light");
    expect(resolve("dark", "light")).toBe("dark");
  });

  it("nothing stored follows the system", () => {
    expect(resolve(null, "light")).toBe("light");
    expect(resolve(null, "dark")).toBe("dark");
  });

  it.each([
    "",
    "auto",
    "system",
    "Dark",
  ])("the stored value %j follows the system", (stored) => {
    expect(resolve(stored, "light")).toBe("light");
    expect(resolve(stored, "dark")).toBe("dark");
  });
});

// D2: a returning visitor's saved choice survives only while the key is the one Starlight 0.42.8 uses
// (ThemeSelect.astro:28, `const storageKey = 'starlight-theme'`). ThemeProvider.astro's inline copy is held to the
// same key by the audit (scripts/audit-dist.test.mjs).
describe("STORAGE_KEY", () => {
  it("is Starlight's key", () => {
    expect(STORAGE_KEY).toBe("starlight-theme");
  });
});
