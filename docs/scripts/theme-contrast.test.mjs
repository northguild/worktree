// @vitest-environment node

import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  measure,
  NON_TEXT_MIN,
  PAIRS,
  resolveColor,
  TEXT_MIN,
  themeProperties,
} from "./theme-contrast.mjs";

// Oracles that do not come from this codebase: WCAG 2.2's definition of the ratio (black on white is 21:1, a colour on itself is
// 1:1) and the figures WebAIM publishes for the grey that is the lightest to pass on white: #767676 is 4.54:1, #777777 is 4.48:1.
// The colour-mix and color(from ...) expectations are worked from CSS Color 5: srgb mixes are per channel and premultiplied.
const rgb = (hex) => resolveColor(hex, new Map());

describe("contrastRatio", () => {
  it("is 21:1 for black on white and 1:1 for a colour on itself", () => {
    expect(contrastRatio(rgb("#000000"), rgb("#ffffff"))).toBeCloseTo(21, 5);
    expect(contrastRatio(rgb("#4ade80"), rgb("#4ade80"))).toBeCloseTo(1, 5);
  });

  it("matches WebAIM's figures for #767676 and #777777 on white, in either order", () => {
    expect(contrastRatio(rgb("#767676"), rgb("#ffffff"))).toBeCloseTo(4.54, 2);
    expect(contrastRatio(rgb("#ffffff"), rgb("#777777"))).toBeCloseTo(4.48, 2);
  });

  it("puts the line between passing and failing text where WCAG does (4.5)", () => {
    expect(
      contrastRatio(rgb("#767676"), rgb("#ffffff")),
    ).toBeGreaterThanOrEqual(TEXT_MIN);
    expect(contrastRatio(rgb("#777777"), rgb("#ffffff"))).toBeLessThan(
      TEXT_MIN,
    );
  });
});

describe("resolveColor", () => {
  const properties = new Map([
    ["--a", "#102030"],
    ["--b", "var(--a)"],
  ]);

  it("reads hex, with and without alpha, and rgb in both syntaxes", () => {
    expect(rgb("#0f0")).toEqual({ r: 0, g: 255, b: 0, a: 1 });
    expect(rgb("#ff000080").a).toBeCloseTo(128 / 255, 5);
    expect(rgb("rgba(34, 211, 238, 0.18)")).toEqual({
      r: 34,
      g: 211,
      b: 238,
      a: 0.18,
    });
    expect(resolveColor("rgb(8 145 178 / 50%)", new Map())).toEqual({
      r: 8,
      g: 145,
      b: 178,
      a: 0.5,
    });
  });

  it("follows var() chains and uses a fallback for an undefined property", () => {
    expect(resolveColor("var(--b)", properties)).toEqual({
      r: 16,
      g: 32,
      b: 48,
      a: 1,
    });
    expect(resolveColor("var(--missing, #ffffff)", properties)).toEqual({
      r: 255,
      g: 255,
      b: 255,
      a: 1,
    });
    expect(() => resolveColor("var(--missing)", properties)).toThrow(
      /not defined/,
    );
  });

  it("mixes in srgb: half black and half white is 127.5 per channel", () => {
    const mixed = resolveColor(
      "color-mix(in srgb, #000000 50%, #ffffff)",
      new Map(),
    );
    expect(mixed.r).toBeCloseTo(127.5, 5);
    expect(mixed.a).toBe(1);
  });

  it("defaults a missing percentage to the rest, and mixes with transparent into alpha", () => {
    const quarter = resolveColor(
      "color-mix(in srgb, #ffffff 25%, #000000)",
      new Map(),
    );
    expect(quarter.g).toBeCloseTo(63.75, 5);
    const wash = resolveColor(
      "color-mix(in srgb, #4ade80 18%, transparent)",
      new Map(),
    );
    expect(wash).toMatchObject({ r: 74, g: 222, b: 128 });
    expect(wash.a).toBeCloseTo(0.18, 5);
  });

  it("sets a new alpha with color(from ... srgb r g b / a)", () => {
    expect(
      resolveColor("color(from #ff0000 srgb r g b / 0.5)", new Map()),
    ).toEqual({ r: 255, g: 0, b: 0, a: 0.5 });
  });

  it("throws on a form it does not read rather than guessing", () => {
    expect(() => resolveColor("oklch(0.5 0.1 120)", new Map())).toThrow(
      /cannot read/,
    );
    expect(() =>
      resolveColor("color-mix(in oklch, #fff, #000)", new Map()),
    ).toThrow(/srgb/);
  });
});

// The accent is spring (D17): the vendored tokens define it as #4ade80 (dark) and #16a34a (light), with the ink tier for text on
// light surfaces #0a5626 (light; it is the same as spring in dark). Those are the values at the commit named in the vendored
// files' headers (ade22a5): tokens.css lines 41 and 420, tokens-light.css lines 20 and 97.
describe("the accent mapping", () => {
  const dark = themeProperties("dark");
  const light = themeProperties("light");
  const at = (properties, name) => {
    const { r, g, b } = resolveColor(`var(${name})`, properties);
    return [r, g, b]
      .map((v) => Math.round(v).toString(16).padStart(2, "0"))
      .join("");
  };

  it.each([
    ["--sl-color-accent", "4ade80", "16a34a"], // fill tier: --gmt-spring
    ["--sl-color-text-accent", "4ade80", "0a5626"], // ink tier: --gmt-spring-ink
    ["--sl-color-accent-high", "4ade80", "0a5626"],
    ["--color-chat-accent", "4ade80", "16a34a"],
    ["--color-chat-accent-ink", "4ade80", "0a5626"],
  ])("maps %s to spring (dark %s, light %s)", (name, expectedDark, expectedLight) => {
    expect(at(dark, name)).toBe(expectedDark);
    expect(at(light, name)).toBe(expectedLight);
  });
});

describe("every pair the theme puts on screen", () => {
  for (const theme of ["dark", "light"]) {
    it(`meets WCAG 2.2 in the ${theme} theme: 4.5:1 for text, 3:1 for controls and rings`, () => {
      const results = measure(theme);
      expect(results).toHaveLength(PAIRS.length);
      const failing = results
        .filter((m) => m.ratio < m.min)
        .map((m) => `${m.name}: ${m.ratio.toFixed(2)} < ${m.min}`);
      expect(failing).toEqual([]);
    });
  }

  it("uses the two WCAG thresholds and no other", () => {
    expect(new Set(PAIRS.map((p) => p.min))).toEqual(
      new Set([TEXT_MIN, NON_TEXT_MIN]),
    );
    expect([TEXT_MIN, NON_TEXT_MIN]).toEqual([4.5, 3]);
  });

  it("notices a pair that fails: light-theme spring (#16a34a) as text on white is 3.30:1", () => {
    // Worked by hand: L(#16a34a) = 0.2686, L(white) = 1, (1 + 0.05) / (0.2686 + 0.05) = 3.30.
    const weak = [
      {
        name: "x",
        fg: "#16a34a",
        bg: ["#ffffff"],
        min: TEXT_MIN,
        kind: "text",
      },
    ];
    const [result] = measure("light", weak, new Map());
    expect(result.ratio).toBeCloseTo(3.3, 2);
    expect(result.ratio).toBeLessThan(result.min);
  });
});

// Plan #309 Phase 4: the links to /dox are measured on the surfaces they sit on. The thresholds are WCAG 2.2's (an icon, a
// ring or a bar that marks the current page is a graphical object, 3:1; text, 4.5:1). The header's glass is what the theme
// toggle's icon is measured on, so the Dox crystal is measured on the same.
describe("the links to /dox (the header, the menu and the landing)", () => {
  const named = (name) => PAIRS.find((p) => p.name === name);

  it.each([
    ["header: Dox link icon", "non-text"],
    ["menu: Dox link icon", "non-text"],
    ["header: Dox link, current page bar", "non-text"],
    ["hero: Ask Dox text", "text"],
    ["hero: Ask Dox border", "non-text"],
  ])("measures %s", (name, kind) => {
    expect(named(name)?.kind).toBe(kind);
  });

  it("measures the icon in the colour the theme toggle's is, on the same header glass", () => {
    expect(named("header: Dox link icon")?.fg).toBe(
      named("header: theme toggle icon")?.fg,
    );
    expect(named("header: Dox link icon")?.bg).toEqual(
      named("header: theme toggle icon")?.bg,
    );
  });

  it("no longer measures the launcher's bubble, which is gone", () => {
    expect(PAIRS.filter((p) => /launcher/.test(p.name))).toEqual([]);
  });
});

// Plan #309 Phase 2: the hive's pairs are measured, not assumed. The expected thresholds are WCAG 2.2's (text 4.5:1, a
// control's boundary or glyph 3:1); the figure for the composer's edge is worked by hand below.
describe("the hive's pairs (the Dox page)", () => {
  const hive = PAIRS.filter((pair) => pair.name.startsWith("hive: "));

  it("covers the text the page puts on its three surfaces: the page, a turn's card and the composer", () => {
    const names = hive.filter((p) => p.kind === "text").map((p) => p.name);
    for (const covered of [
      "hive: text in a turn's card",
      "hive: the waiting line",
      "hive: a warning",
      "hive: typed text in the composer",
      "hive: the composer's placeholder",
      "hive: the accuracy note",
      "hive: a role label (Dox, You)",
    ])
      expect(names).toContain(covered);
    expect(hive.filter((p) => p.kind === "text").length).toBeGreaterThanOrEqual(
      15,
    );
  });

  for (const theme of ["dark", "light"]) {
    it(`measures every hive text pair at ${TEXT_MIN}:1 or more in the ${theme} theme`, () => {
      const properties = themeProperties(theme);
      const measured = measure(theme, hive, properties).filter(
        (m) => m.kind === "text",
      );
      expect(measured.length).toBeGreaterThan(0);
      expect(
        measured.filter((m) => m.ratio < TEXT_MIN).map((m) => m.name),
      ).toEqual([]);
    });
  }

  it("lays a card's tint over the page before measuring: ice on spring at 5% over the dark void, 15.1:1", () => {
    // Worked by hand, dark theme: void #03080c, spring #4ade80, ice #cfeaf2. The card is 5% spring over void:
    // r = 3 + 0.05 * (74 - 3) = 6.55, g = 8 + 0.05 * (222 - 8) = 18.7, b = 12 + 0.05 * (128 - 12) = 17.8.
    // L(card) = 0.2126 * lin(6.55) + 0.7152 * lin(18.7) + 0.0722 * lin(17.8) = 0.0004 + 0.0046 + 0.0004 = 0.0054 (lin per WCAG).
    // L(ice #cfeaf2) = 0.2126 * 0.6239 + 0.7152 * 0.8228 + 0.0722 * 0.8879 = 0.7852. (0.7852 + 0.05) / (0.0054 + 0.05) = 15.1.
    const [card] = measure(
      "dark",
      hive.filter((p) => p.name === "hive: text in a turn's card"),
    );
    expect(card.ratio).toBeCloseTo(15.1, 0);
  });

  it("keeps the composer's edge off gmt's spring hairline, which fails 3:1 in both themes", () => {
    for (const theme of ["dark", "light"]) {
      const [hairline] = measure(theme, [
        {
          name: "x",
          fg: "var(--gmt-border-strong)",
          bg: ["var(--gmt-glass-tint)", "var(--gmt-void)"],
          min: NON_TEXT_MIN,
          kind: "non-text",
        },
      ]);
      expect(hairline.ratio).toBeLessThan(NON_TEXT_MIN);
    }
    const edge = hive.find((p) => p.name === "hive: the composer's edge");
    for (const theme of ["dark", "light"])
      expect(measure(theme, [edge])[0].ratio).toBeGreaterThanOrEqual(
        NON_TEXT_MIN,
      );
  });
});
