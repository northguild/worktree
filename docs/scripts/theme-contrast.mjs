/**
 * theme-contrast.mjs
 *
 * Measures the contrast of every foreground/background pair the site's theme puts on screen, in both themes, from the
 * CSS source: the vendored NorthGuild tokens, this site's own `theme.css` and the chat tokens in `globals.css`. A pair
 * names two CSS colour expressions (`var(--sl-color-text-accent)`, `color-mix(...)`); this file resolves them the way
 * a browser would for `:root` (dark) and for `[data-theme="light"]` (light), then applies the WCAG 2.2 relative-luminance
 * formula. Nothing is copied from the CSS by hand: change a mapping and the next run measures the new colour.
 *
 * Thresholds are WCAG 2.2's: 4.5:1 for text (SC 1.4.3) and 3:1 for controls, focus rings and the shapes that carry
 * meaning (SC 1.4.11). Decorative marks that carry no meaning (the sidebar's trunk and branch lines, hairlines) are
 * not measured: the meaning is in the markup, and the dots beside each entry, which are measured, mark the structure.
 *
 * Usage: node docs/scripts/theme-contrast.mjs   (prints the table; exits 1 when a pair is under its threshold)
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const STYLES = join(here, "../src/styles");
// Load order, as in astro.config.mjs `customCss`: later wins at equal specificity.
const SOURCE_FILES = [
  "northguild/tokens.css",
  "northguild/tokens-light.css",
  "theme.css",
  "globals.css",
];

export const TEXT_MIN = 4.5; // WCAG 2.2 SC 1.4.3
export const NON_TEXT_MIN = 3; // WCAG 2.2 SC 1.4.11

// ---- reading the CSS ---------------------------------------------------------------------------------------

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Splits at `separator` outside parentheses and quotes. */
function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === separator && depth === 0) {
      parts.push(current);
      current = "";
    } else current += ch;
  }
  parts.push(current);
  return parts;
}

/** The custom-property declarations of one rule body. Nested blocks are not expected in the files read here. */
function customProperties(body) {
  const found = [];
  for (const declaration of splitTopLevel(body, ";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    const name = declaration.slice(0, colon).trim();
    if (!name.startsWith("--")) continue;
    found.push([
      name,
      declaration
        .slice(colon + 1)
        .replace(/\s+/g, " ")
        .trim(),
    ]);
  }
  return found;
}

/** Top-level `selector { body }` pairs, with `@theme inline` read as `:root` (Tailwind's token block). Other at-rules are skipped. */
function topLevelRules(css) {
  const rules = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open === -1) break;
    const prelude = css.slice(i, open).trim().replace(/^.*;/s, "").trim();
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth++;
      if (css[j] === "}") depth--;
      j++;
    }
    const body = css.slice(open + 1, j - 1);
    if (prelude === "@theme inline") rules.push([":root", body]);
    else if (!prelude.startsWith("@")) rules.push([prelude, body]);
    i = j;
  }
  return rules;
}

/** Every custom property that applies to `theme`, in cascade order: later declarations replace earlier ones. */
export function themeProperties(theme, files = SOURCE_FILES, dir = STYLES) {
  const properties = new Map();
  for (const file of files) {
    const css = stripComments(readFileSync(join(dir, file), "utf8"));
    for (const [selectors, body] of topLevelRules(css)) {
      const applies = selectors
        .split(",")
        .map((s) => s.trim())
        .some(
          (s) =>
            s === ":root" ||
            (theme === "light" && s === '[data-theme="light"]'),
        );
      if (!applies) continue;
      for (const [name, value] of customProperties(body))
        properties.set(name, value);
    }
  }
  return properties;
}

// ---- colour values -----------------------------------------------------------------------------------------

/** A colour as sRGB channels 0-255 and alpha 0-1. */
const color = (r, g, b, a = 1) => ({ r, g, b, a });

function parseHex(hex) {
  const h = hex.slice(1);
  const full = h.length <= 4 ? [...h].map((c) => c + c).join("") : h;
  const n = (k) => Number.parseInt(full.slice(k, k + 2), 16);
  return color(n(0), n(2), n(4), full.length === 8 ? n(6) / 255 : 1);
}

const percentage = (text) => Number.parseFloat(text) / 100;

/** `rgb()`/`rgba()` with commas or spaces and an optional `/ alpha`. */
function parseRgb(args) {
  const [channels, slashAlpha] = args.split("/").map((s) => s.trim());
  const parts = channels.split(/[\s,]+/).filter(Boolean);
  const alphaText = slashAlpha ?? parts[3];
  const alpha =
    alphaText === undefined
      ? 1
      : alphaText.endsWith("%")
        ? percentage(alphaText)
        : Number(alphaText);
  return color(Number(parts[0]), Number(parts[1]), Number(parts[2]), alpha);
}

/**
 * `color-mix(in srgb, A p%, B q%)` per CSS Color 5: missing percentages default so the pair sums to 100%, a pair
 * that sums to less scales the alpha, and the mix is premultiplied.
 */
function mix(args, resolve) {
  const [space, ...operands] = splitTopLevel(args, ",").map((s) => s.trim());
  if (space !== "in srgb")
    throw new Error(`color-mix: only "in srgb" is read, got "${space}"`);
  const parsed = operands.map((operand) => {
    const m = operand.match(/^(.*?)(?:\s+([\d.]+)%)?$/s);
    return {
      color: resolve(m[1].trim()),
      p: m[2] === undefined ? undefined : Number(m[2]) / 100,
    };
  });
  const [first, second] = parsed;
  if (first.p === undefined && second.p === undefined) first.p = second.p = 0.5;
  else if (first.p === undefined) first.p = 1 - second.p;
  else if (second.p === undefined) second.p = 1 - first.p;
  const total = first.p + second.p;
  const weights = parsed.map((x) => x.p / total);
  const alpha = weights.reduce((sum, w, k) => sum + w * parsed[k].color.a, 0);
  const channel = (key) =>
    alpha === 0
      ? 0
      : weights.reduce(
          (sum, w, k) => sum + w * parsed[k].color[key] * parsed[k].color.a,
          0,
        ) / alpha;
  return color(
    channel("r"),
    channel("g"),
    channel("b"),
    alpha * Math.min(total, 1),
  );
}

/** Resolves a CSS colour expression against `properties`; throws on anything it does not read, so a new form is noticed. */
export function resolveColor(value, properties, seen = []) {
  const text = value.trim();
  const again = (v) => resolveColor(v, properties, seen);
  if (text.startsWith("#")) return parseHex(text);
  if (text === "transparent") return color(0, 0, 0, 0);
  const fn = text.match(/^([\w-]+)\((.*)\)$/s);
  if (!fn) throw new Error(`cannot read colour "${text}"`);
  const [, name, args] = fn;
  if (name === "var") {
    const [property, ...fallback] = splitTopLevel(args, ",");
    const target = property.trim();
    if (seen.includes(target)) throw new Error(`var cycle at ${target}`);
    const next = properties.get(target);
    if (next !== undefined)
      return resolveColor(next, properties, [...seen, target]);
    if (fallback.length > 0) return again(fallback.join(","));
    throw new Error(`${target} is not defined`);
  }
  if (name === "rgb" || name === "rgba") return parseRgb(args);
  if (name === "color-mix") return mix(args, again);
  if (name === "brightness") {
    // brightness(<colour>, <factor>): the CSS filter on the backdrop, a per-channel multiply (not CSS syntax; a modelling helper).
    const [base, factor] = splitTopLevel(args, ",");
    const f = Number(resolveFactor(factor, properties));
    const c = again(base);
    return { ...c, r: c.r * f, g: c.g * f, b: c.b * f };
  }
  if (name === "color") {
    // color(from <origin> srgb r g b / <alpha>): the origin's own channels with a new alpha.
    const m = args.match(/^from\s+(.*)\s+srgb\s+r\s+g\s+b\s*\/\s*([\d.]+)$/s);
    if (!m) throw new Error(`cannot read colour "${text}"`);
    return { ...again(m[1]), a: Number(m[2]) };
  }
  throw new Error(`cannot read colour "${text}"`);
}

function resolveFactor(text, properties) {
  const t = text.trim();
  const m = t.match(/^var\((--[\w-]+)\)$/);
  return m ? resolveFactor(properties.get(m[1]) ?? "", properties) : t;
}

/** `top` painted over `below`. */
function over(top, below) {
  const a = top.a + below.a * (1 - top.a);
  const ch = (k) =>
    a === 0 ? 0 : (top[k] * top.a + below[k] * below.a * (1 - top.a)) / a;
  return color(ch("r"), ch("g"), ch("b"), a);
}

// ---- WCAG ---------------------------------------------------------------------------------------------------

/** Relative luminance, WCAG 2.2 "relative luminance" definition. */
export function luminance({ r, g, b }) {
  const lin = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** The WCAG contrast ratio of two opaque colours. */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ---- the pairs ----------------------------------------------------------------------------------------------

// The header is northguild.dev's glass (the user's decision of 2026-11-04, "exact northguild.dev glass"): the glass tint over a
// backdrop that is blurred, saturated and darkened by `brightness()`. The user accepted that page text shows faintly, blurred,
// through the bar while scrolling, so the pairs are measured against the glass over the page background, not against
// full-strength text behind it.
const HEADER = [
  "var(--gmt-glass-tint)",
  "brightness(var(--sl-color-bg), var(--gmt-brightness))",
];
const PAGE = ["var(--sl-color-bg)"];
const SIDEBAR = ["var(--sl-color-bg-sidebar)"];
const RAISED = ["var(--gmt-surface-2)"];
const CHAT = ["var(--color-chat-bg)"];
const CHAT_RAISED = ["var(--color-chat-raised)"];
// The search dialog (search.css): the panel, the surface at 85%, over the page behind it, which the backdrop has washed
// with the scrim and darkened by `brightness()`, as the header's glass does. search.css declares the panel as
// `--search-panel` on <site-search>, which this script does not read, so it is spelled out here; change both together.
const SEARCH = [
  "color-mix(in srgb, var(--gmt-surface) 85%, transparent)",
  "var(--gmt-glass-scrim)",
  "brightness(var(--sl-color-bg), var(--gmt-brightness))",
];
const SEARCH_FIELD = ["var(--gmt-glass-tint-subtle)", ...SEARCH];
const SEARCH_HOVER = ["var(--gmt-accent-wash)", ...SEARCH];
const SEARCH_FOCUS = ["var(--sl-color-accent-low)"];

const text = (name, fg, bg) => ({ name, fg, bg, min: TEXT_MIN, kind: "text" });
const shape = (name, fg, bg) => ({
  name,
  fg,
  bg,
  min: NON_TEXT_MIN,
  kind: "non-text",
});

/** Each pair: `fg` (one expression, or {dark, light}) on `bg` (layers, top first, the last one opaque). */
export const PAIRS = [
  text("body text on the page", "var(--sl-color-text)", PAGE),
  text("muted text on the page", "var(--sl-color-gray-3)", PAGE),
  text("muted text on the sidebar", "var(--sl-color-gray-3)", SIDEBAR),
  text("link text on the page", "var(--sl-color-text-accent)", PAGE),
  text("link text on the sidebar", "var(--sl-color-text-accent)", SIDEBAR),
  text("link text on a raised surface", "var(--sl-color-text-accent)", RAISED),
  text("header: NorthGuild wordmark", "var(--gmt-ice)", HEADER),
  // The CLI version beside " / worktree" (the user, 2026-11-04: "smaller font ... and probably gray"): muted text.
  text("header: the CLI version", "var(--sl-color-gray-3)", HEADER),
  text(
    'header: " / worktree" in the accent',
    "var(--sl-color-text-accent)",
    HEADER,
  ),
  text(
    "current sidebar entry (text on its fill)",
    "var(--sl-color-text-invert)",
    ["var(--sl-color-text-accent)"],
  ),
  text(
    "accent-high on accent-low (search hit, badge)",
    "var(--sl-color-accent-high)",
    ["var(--sl-color-accent-low)"],
  ),
  text("default badge (white on its fill)", "#ffffff", [
    "var(--sl-badge-default-bg)",
  ]),
  text("chat: text", "var(--color-chat-fg)", CHAT),
  text("chat: muted text", "var(--color-chat-muted)", CHAT),
  text("chat: muted text, raised", "var(--color-chat-muted)", CHAT_RAISED),
  text("chat: accent text", "var(--color-chat-accent-ink)", CHAT),
  text(
    "chat: accent text, raised",
    "var(--color-chat-accent-ink)",
    CHAT_RAISED,
  ),
  text("chat: text on the accent fill", "var(--color-chat-on-accent)", [
    "var(--color-chat-accent)",
  ]),
  text("chat: error text", "var(--color-chat-danger)", CHAT),
  shape("focus ring on the page", "var(--gmt-spring-ink)", PAGE),
  shape("focus ring on the sidebar", "var(--gmt-spring-ink)", SIDEBAR),
  shape("focus ring on a raised surface", "var(--gmt-spring-ink)", RAISED),
  shape("focus ring on the header", "var(--gmt-spring-ink)", HEADER),
  shape("focus ring in the chat", "var(--gmt-spring-ink)", CHAT),
  shape(
    "header: GitHub and Discord icons",
    "var(--sl-color-text-accent)",
    HEADER,
  ),
  // The theme toggle's icon (#266) is the same chip as the two links above: `.header-chip` in custom.css.
  shape("header: theme toggle icon", "var(--sl-color-text-accent)", HEADER),
  shape("chat launcher fill on the page", "var(--gmt-spring)", PAGE),
  shape("chat launcher border on the page", "var(--gmt-spring-ink)", PAGE),
  shape("chat launcher glyph on its fill", "var(--gmt-ink-fixed)", [
    "var(--gmt-spring)",
  ]),
  shape("chat: accent fill on the panel", "var(--color-chat-accent)", CHAT),
  text("search: typed text in the field", "var(--gmt-ice)", SEARCH_FIELD),
  text("search: the field's placeholder", "var(--gmt-ice-dim)", SEARCH_FIELD),
  text("search: a result's title", "var(--gmt-ice)", SEARCH),
  text("search: a result's excerpt", "var(--gmt-ice-dim)", SEARCH),
  text("search: a hit", "var(--sl-color-text-accent)", SEARCH),
  text(
    "search: an excerpt under the pointer",
    "var(--gmt-ice-dim)",
    SEARCH_HOVER,
  ),
  text(
    "search: a hit under the pointer",
    "var(--sl-color-text-accent)",
    SEARCH_HOVER,
  ),
  text("search: a focused result's title", "var(--gmt-ice)", SEARCH_FOCUS),
  text(
    "search: a focused result's excerpt",
    "var(--gmt-ice-dim)",
    SEARCH_FOCUS,
  ),
  shape("search: the field's edge at rest", "var(--gmt-ice-dim)", SEARCH),
  shape("search: the focused field's ring", "var(--gmt-spring-ink)", SEARCH),
  shape(
    "search: a focused result's ring",
    "var(--gmt-spring-ink)",
    SEARCH_FOCUS,
  ),
  shape("search: a result's commit dot", "var(--gmt-spring-ink)", SEARCH),
  shape("scrollbar thumb on the page", "var(--site-scrollbar-thumb)", PAGE),
  shape(
    "scrollbar thumb on the sidebar",
    "var(--site-scrollbar-thumb)",
    SIDEBAR,
  ),
  shape(
    "scrollbar thumb on a raised surface",
    "var(--site-scrollbar-thumb)",
    RAISED,
  ),
  shape(
    "scrollbar thumb in the search dialog",
    "var(--site-scrollbar-thumb)",
    SEARCH,
  ),
  shape("scrollbar thumb in the chat", "var(--site-scrollbar-thumb)", CHAT),
  shape(
    "code block: active tab indicator on the frame",
    { dark: "var(--sl-color-accent-high)", light: "var(--sl-color-accent)" },
    ["var(--sl-color-gray-6)"],
  ),
  shape(
    "sidebar graph: commit dot and HEAD dot",
    "var(--gmt-spring-ink)",
    SIDEBAR,
  ),
  shape(
    "list leaf and branch tip, link underline",
    "var(--gmt-spring-ink)",
    PAGE,
  ),
  // custom.css, "Leaves": a nested item's leaf, the parent's tint made translucent.
  shape(
    "nested list leaf on the page",
    "color-mix(in srgb, var(--gmt-spring-ink) 65%, transparent)",
    PAGE,
  ),
];

function surface(layers, properties) {
  return layers
    .map((layer) => resolveColor(layer, properties))
    .reduceRight((below, top) => over(top, below));
}

/** The ratio of every pair in `theme`, as { name, ratio, min, kind }. */
export function measure(
  theme,
  pairs = PAIRS,
  properties = themeProperties(theme),
) {
  return pairs.map((pair) => {
    const expression = typeof pair.fg === "string" ? pair.fg : pair.fg[theme];
    const background = surface(pair.bg, properties);
    if (background.a !== 1)
      throw new Error(`${pair.name}: the background is not opaque`);
    const foreground = over(resolveColor(expression, properties), background);
    return {
      name: pair.name,
      ratio: contrastRatio(foreground, background),
      min: pair.min,
      kind: pair.kind,
    };
  });
}

function report() {
  const dark = measure("dark");
  const light = measure("light");
  const cell = (m) => `${m.ratio.toFixed(2)}${m.ratio >= m.min ? "" : " FAIL"}`;
  const width = Math.max(...PAIRS.map((p) => p.name.length));
  console.log(`${"pair".padEnd(width)}  need   dark         light`);
  for (const [k, d] of dark.entries())
    console.log(
      `${d.name.padEnd(width)}  ${String(d.min).padEnd(4)}   ${cell(d).padEnd(12)} ${cell(light[k])}`,
    );
  const failed = [...dark, ...light].filter((m) => m.ratio < m.min);
  if (failed.length > 0) {
    console.error(
      `theme-contrast: ${failed.length} pair(s) under their threshold`,
    );
    process.exit(1);
  }
  console.log(`theme-contrast: ${PAIRS.length} pairs pass in both themes`);
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  report();
