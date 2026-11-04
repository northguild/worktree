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
