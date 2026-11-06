/**
 * audit-dist.mjs
 *
 * Reads the built docs site (`docs/dist/`) and asserts the SEO requirements of plan §4.8. Exits 1 and lists every
 * failure when any rule breaks; exits 0 and says so when none does.
 *
 * Per page: a unique `<meta name="description">` of at most 155 characters; one `<link rel="canonical">` in the D3
 * form; Open Graph and Twitter tags; JSON-LD of the right types (`BreadcrumbList` only on a nested page, D10); and
 * no script that loads the chat before it is activated. Per site: a sitemap listing exactly the 26 URLs, a
 * `404.html`, a landing at the root (a heading and a "Get started" link to /getting-started/), and no `shuding/nextra` string anywhere.
 *
 * Also per page (phase 8): the "Last updated" date equals `git log --follow -1` for the page's source file (D11). It
 * applies to the 26 pages only; `404.html` is not one of them and has none. Phase 15 turns it around on the landing,
 * which has no footer: the root must carry no date. No page carries an "Edit page" link to GitHub (the user,
 * 2026-11-04, replacing phase 8's edit links; gmt's docs have none either); no page carries the project line the
 * footer once had (licence, CLI version, maintainers); and no page shows the northguild organisation's GitHub avatar,
 * the second logo the footer once carried beside the header's mark; no id appears twice on a page; and the landing has one
 * action ("Get started") and no section below the hero. Per site: `llms.txt`
 * (D13) is a llmstxt.org file listing the same 26 URLs, each with a title and the page's own description.
 *
 * Also (phase 9, accessibility): every button has an accessible name (an icon-only one needs an `aria-label`, an
 * `aria-labelledby` or a `title`), and a name that stands beside visible text contains it (WCAG 2.5.3); every
 * `<select>` is labelled; every page has the search button; the chat launcher announces its shortcut with
 * `aria-keyshortcuts="Alt+Shift+C"` (WAI-ARIA 1.2 syntax); the built CSS gives the package-manager tabs a minimum
 * height of at least 44px; and `404.html` has the site's search, a link to Getting Started, and no canonical link or
 * JSON-LD (it is not a page of the site, so it must not point at one). The search *input* is made by Pagefind in the
 * browser and is not in the HTML: its label is a real-browser check.
 *
 * Also (phase 13, the product header and the spring theme): every page's header has the two NorthGuild links of D17 (the
 * mark and "NorthGuild" to https://northguild.dev/, "worktree" to /worktree/), each named by its own visible text, and the
 * GitHub and Discord icon links, each opening in a new tab and saying so in its name; every `<svg>` is either hidden from
 * assistive technology or named (a decorative graphic is never announced); `404.html` speaks git (`fatal: ...`); and no
 * cyan reaches a rule or file the site uses (see `cyanFindings`: the `--gmt-cyan*` variables and their literal colours
 * from the vendored tokens, in the built CSS, the HTML and the scripts).
 *
 * Also (phase 16, D18, the leaf-particle hero): the root alone loads the hero loader (the script of `HeroLeaves.astro`);
 * no page, the 404 included, loads the effect's chunks up front (a script, a modulepreload, or a static import: the
 * loader reaches them only through a dynamic `import()`); the loader is at most 2 KB gzipped and everything it imports,
 * together, at most 32 KB gzipped; and on the landing the still SVG and the canvas are `aria-hidden`, while no other page
 * carries the hero's markup.
 *
 * Also (plan §9 Q3, the share preview and the favicon): every page has an `og:image` that is an absolute URL under the
 * site and names a file in the build, a `twitter:image` that is the same URL, and alt text for both; and every page and
 * the 404 link an icon (`rel="icon"`), with every icon link (`icon`, `shortcut icon`, `apple-touch-icon`) naming a file
 * in the build, a regular file and not a directory. The favicon 404'd on every page until then, and nothing noticed. The
 * og:image is 1200×630 (plan §4.4), read from the file's own header, and `og:image:type`, `:width` and `:height` say what
 * the file is. Every page's and the 404's `<title>` is its `og:title` and `og:site_name` joined by GMT's ` · ` (the user,
 * 2026-11-04, replacing Starlight's default ` | `), or its `og:title` alone where that already names the site.
 *
 * Also (#266, the two-state theme toggle): every page and the 404 has `starlight-theme-select` (Header.astro renders it in the
 * header and Starlight in the mobile menu), each holding exactly one named `<button>` and no `<select>`, and the theme provider's script (the override, not Starlight's) is inline in `<head>`,
 * so the theme is set before first paint and the button's icon is kept current.
 *
 * Also (#266 phase 2, D5): in every page's and the 404's `<header>` the theme toggle (the header's own) comes before the
 * GitHub link, which comes before the Discord link.
 *
 * Also (#266 phase 3, D6-D9, the landing header's entrance): the entrance marker (`data-landing-entrance`) is on the
 * landing's header and no other page's, and that header holds the internal-arrival script inline (no `src`); in the built
 * CSS the `header-entrance-*` keyframes, and every rule that animates them, sit under
 * `@media (prefers-reduced-motion: no-preference)` alone; and no rule outside a keyframe, and no `style` in the header,
 * gives a header item `opacity: 0`, so nothing waits hidden on a script.
 *
 * Usage: node docs/scripts/audit-dist.mjs [distDir]   (default: docs/dist, after `pnpm docs:build`)
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { Temporal } from "@northguild/gmt";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIST = join(here, "../dist");
const ORIGIN = "https://northguild.dev/worktree/";
const MAX_DESCRIPTION = 155;
const CONTENT_DIR = join(here, "../src/content/docs");
const REPO_ROOT = join(here, "../..");
/** Starlight's "Edit page" link, or any link into GitHub's web editor: `https://github.com/<owner>/<repo>/edit/...`. */
const GITHUB_EDIT = /^https:\/\/github\.com\/[^/]+\/[^/]+\/edit\//;
const BASE_PATH = new URL(ORIGIN).pathname;

/**
 * The file in `dist` a site URL names: absolute under ORIGIN, or a path under the base (`/worktree/favicon.svg`).
 * Undefined for anything outside the site. The build is written without the base (stage:deploy adds it).
 */
function builtFileOf(href, dist) {
  const path = href.startsWith(ORIGIN)
    ? href.slice(ORIGIN.length)
    : href.startsWith(BASE_PATH)
      ? href.slice(BASE_PATH.length)
      : undefined;
  return path === undefined || path === "" ? undefined : join(dist, path);
}

/** Whether a site URL names a regular file in `dist`: a directory (`/worktree/faq/`) is not one. */
function isBuiltFile(href, dist) {
  const file = href ? builtFileOf(href, dist) : undefined;
  if (file === undefined) return false;
  try {
    return statSync(file).isFile();
  } catch {
    return false; // ENOENT, or ENOTDIR for a path that runs through a file (`favicon.ico/x`)
  }
}

/**
 * An image's type and size from its own header, or undefined when it is neither a PNG nor a JPEG. PNG: the IHDR chunk's
 * width and height follow the 8-byte signature and the chunk's length and type (PNG spec §11.2.2). JPEG: the first
 * start-of-frame marker (SOF0-SOF15 but DHT, JPG and DAC) carries the height, then the width (ITU T.81 §B.2.2).
 */
export function imageSize(bytes) {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (png.every((b, i) => bytes[i] === b) && bytes.length >= 24)
    return {
      type: "image/png",
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  for (let i = 2; i + 8 < bytes.length; ) {
    if (bytes[i] !== 0xff) return undefined;
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i += 1; // fill byte
      continue;
    }
    if (
      marker >= 0xc0 &&
      marker <= 0xcf &&
      ![0xc4, 0xc8, 0xcc].includes(marker)
    )
      return {
        type: "image/jpeg",
        width: bytes.readUInt16BE(i + 7),
        height: bytes.readUInt16BE(i + 5),
      };
    i += 2 + bytes.readUInt16BE(i + 2);
  }
  return undefined;
}

/** Plan §4.4: a 1200×630 preview image. */
const PREVIEW_SIZE = { width: 1200, height: 630 };

/**
 * The title is the page's own (its `og:title`) and the site's (`og:site_name`), joined by GMT's middle dot ` · ` (the user,
 * 2026-11-04, replacing D9's ` | `); a page whose own title already names the site carries it alone, never twice (D9).
 * Starlight's default delimiter is the pipe, so a title built anywhere but Head.astro would bring it back; GMT's own 404
 * shows the drift (`404 | @northguild/gmt`). On a page a missing `og:title` or `og:site_name` is its own rule's failure;
 * the 404 has no such rule, so `reportMissing` reports it here.
 */
function auditTitle(html, { reportMissing = false } = {}) {
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1];
  if (title === undefined) return ["no <title>"];
  const meta = (property) =>
    tagsOf(html, "meta").find((m) => m.property === property)?.content;
  const own = meta("og:title");
  const site = meta("og:site_name");
  if (!own || !site)
    return reportMissing
      ? ["the title cannot be checked: no og:title or og:site_name"]
      : [];
  const expected = own.includes(site) ? own : `${own} · ${site}`;
  return decode(title) === expected
    ? []
    : [`title is "${decode(title)}", expected "${expected}"`];
}

/** Every page and the 404 link an icon, and every icon link names a file in the build (plan §9 Q3). */
function auditIcons(html, dist) {
  const failures = [];
  const icons = tagsOf(html, "link").filter((l) =>
    (l.rel ?? "")
      .split(/\s+/)
      .some((t) => t === "icon" || t === "apple-touch-icon"),
  );
  if (!icons.some((l) => l.rel.split(/\s+/).includes("icon")))
    failures.push('no favicon (a <link rel="icon">)');
  for (const { rel, href } of icons) {
    if (!isBuiltFile(href, dist))
      failures.push(`${rel} ${href || "(no href)"} is not a file in the build`);
  }
  return failures;
}

/** The page's source file relative to the content directory, or undefined when none exists: `commands` is `commands/index.mdx`. */
export function sourcePathOf(path, contentDir = CONTENT_DIR) {
  const candidates =
    path === "" ? ["index.mdx"] : [`${path}.mdx`, `${path}/index.mdx`];
  return candidates.find((c) => existsSync(join(contentDir, c)));
}

/**
 * The date of the newest commit to `file` (relative to `repoRoot`) following renames, as a UTC calendar date. UTC
 * because Starlight renders its date in UTC (`timeZone: "UTC"` in its LastUpdated component); `%cs` would be the
 * committer's local date and can differ by a day. This is D11's oracle, independent of Starlight, which runs
 * `git log -1` without `--follow`.
 */
export function followDate(repoRoot, file) {
  const result = spawnSync(
    "git",
    ["log", "--follow", "-1", "--format=%ct", "--", file],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const seconds = result.stdout?.trim();
  if (result.error || !/^\d+$/.test(seconds ?? ""))
    throw new Error(`no git history for ${file}`);
  return Temporal.Instant.fromEpochMilliseconds(Number(seconds) * 1000)
    .toZonedDateTimeISO("UTC")
    .toPlainDate()
    .toString();
}

const defaultExpectedDate = (path) => {
  const source = sourcePathOf(path);
  if (source === undefined) return undefined;
  return followDate(REPO_ROOT, `docs/src/content/docs/${source}`);
};

// The site-wide default description (§4.3's index row). Starlight falls back to it when a page has no `description:`
// frontmatter, so a page carrying it has lost its own (D9). The landing (D17) is the one page it belongs to: the
// index row is its own description, written out in its frontmatter, so the root alone may carry it.
export const SITE_DEFAULT_DESCRIPTION =
  "Docs for worktree, an open-source CLI that manages git worktrees: one per branch or issue, with env files copied and your editor opened.";

// The 26 pages: the 24 old routes at 2633f3a and the two #238 added (5c741ee) under D17 (2026-11-04): /docs becomes the landing at the root,
// /docs/getting-started becomes /getting-started/, and every other /docs/<p> becomes /<p>/. Written out, not
// derived from the content collection, so a page added or lost by accident fails here.
export const PAGE_PATHS = Object.freeze([
  "",
  "changelog",
  "commands",
  "commands/branch",
  "commands/checkout",
  "commands/cleanup",
  "commands/config",
  "commands/linear-listen",
  "commands/list",
  "commands/open",
  "commands/remove",
  "configuration",
  "faq",
  "getting-started",
  "guides",
  "guides/clickup-integration",
  "guides/context-switching",
  "guides/editor-integration",
  "guides/env-files",
  "guides/github-issue-integration",
  "guides/herdr-spaces",
  "guides/jira-integration",
  "guides/linear-agent-delegation",
  "guides/linear-integration",
  "guides/team-conventions",
  "project-configuration",
]);

const pageUrl = (path) => (path === "" ? ORIGIN : `${ORIGIN}${path}/`);
const pageFile = (path) => (path === "" ? "index.html" : `${path}/index.html`);
const label = (path) => (path === "" ? "/ (root)" : `/${path}/`);

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };
const decode = (text) =>
  text.replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ENTITIES[name]);

function attributes(tag) {
  const found = {};
  for (const [, name, value] of tag.matchAll(/([\w:-]+)(?:="([^"]*)")?/g)) {
    found[name] = value === undefined ? "" : decode(value);
  }
  return found;
}

/** Every `<meta>` / `<link>` / `<script>` opening tag in the document, as an attribute map. */
function tagsOf(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\s[^>]*>`, "g"))].map((m) =>
    attributes(m[0].slice(name.length + 1)),
  );
}

function expectedJsonLdTypes(path) {
  return path === ""
    ? ["SoftwareApplication", "WebSite", "Organization"]
    : ["SoftwareApplication", "BreadcrumbList"];
}

function jsonLdTypes(html) {
  const blocks = [
    ...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs),
  ];
  if (blocks.length === 0) return { error: "no JSON-LD block" };
  const types = [];
  for (const [, body] of blocks) {
    try {
      const data = JSON.parse(body);
      for (const node of data["@graph"] ?? [data]) types.push(node["@type"]);
    } catch {
      return { error: "JSON-LD is not valid JSON" };
    }
  }
  return { types };
}

const CHAT_SHORTCUT_ARIA = "Alt+Shift+C";
const MIN_TAB_HEIGHT_PX = 44;
// A rem is the root font size, 16px unless the site changes it; the site does not.
const PX_PER_REM = 16;

// ---- Phase 13: the header's links, hidden decoration, and no cyan -----------------------------------------------------

// D17: the mark and "NorthGuild" are one link to the apex; "worktree" is a second link to this site's home.
const NORTHGUILD_HREF = "https://northguild.dev/";
const PRODUCT_HREF = "/worktree/";
// The community links of northguild.dev's Header.astro at ade22a5, and the wording the header must use for a link
// that opens a new tab ("(opens in a new tab)", the same as northguild.dev).
const COMMUNITY_LINKS = Object.freeze([
  { href: "https://github.com/northguild", names: "GitHub" },
  { href: "https://discord.gg/TdvQdP3t5a", names: "Discord" },
]);
const NEW_TAB_WORDING = "(opens in a new tab)";
// The northguild organisation's GitHub avatar, at any size (phase 15: one logo, the header's).
const ORG_AVATAR = /^https:\/\/github\.com\/northguild\.png(\?|$)/;

/** The page's `<header>` element, from its opening tag to its closing tag; "" when it has none. */
function headerOf(html) {
  const open = html.indexOf("<header");
  const close = html.indexOf("</header>");
  return open === -1 || close === -1 ? "" : html.slice(open, close);
}

/** What the sighted see of a link: its text without icons or screen-reader-only text. */
const linkVisibleText = (inner) => visibleLabel(inner);

/**
 * The header's links (WCAG 4.1.2 name, 2.5.3 label in name): the two NorthGuild links exist, resolve where D17 says and
 * are named by their own text; the community icons open in a new tab, say so, and carry `rel=noopener`.
 */
function auditHeader(html, where) {
  const failures = [];
  const fail = (rule) => failures.push(`${where}: header: ${rule}`);
  const header = headerOf(html);
  if (header === "") {
    fail("no <header> element");
    return failures;
  }
  const links = [...header.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(
    ([whole, rawAttrs, inner]) => ({
      at: header.indexOf(whole),
      attrs: attributes(rawAttrs),
      visible: linkVisibleText(inner),
      inner,
    }),
  );
  const named = (link) =>
    (link.attrs["aria-label"] ?? "").trim() || linkVisibleText(link.inner);

  const apex = links.filter((l) => l.attrs.href === NORTHGUILD_HREF);
  if (apex.length !== 1)
    fail(`${apex.length} links to ${NORTHGUILD_HREF}, expected exactly 1`);
  else if (apex[0].visible !== "NorthGuild")
    fail(
      `the link to ${NORTHGUILD_HREF} reads "${apex[0].visible}", expected "NorthGuild"`,
    );
  const product = links.filter((l) => l.attrs.href === PRODUCT_HREF);
  if (product.length !== 1)
    fail(`${product.length} links to ${PRODUCT_HREF}, expected exactly 1`);
  else if (product[0].visible !== "worktree")
    fail(
      `the link to ${PRODUCT_HREF} reads "${product[0].visible}", expected "worktree"`,
    );
  for (const link of [...apex, ...product]) {
    const name = named(link);
    if (name === "") fail(`link to ${link.attrs.href} has no accessible name`);
    else if (!name.toLowerCase().includes(link.visible.toLowerCase()))
      fail(
        `link "${link.visible}": its name "${name}" does not contain its visible text (WCAG 2.5.3)`,
      );
  }

  for (const { href, names } of COMMUNITY_LINKS) {
    const found = links.filter((l) => l.attrs.href === href);
    if (found.length !== 1) {
      fail(`${found.length} links to ${href}, expected exactly 1`);
      continue;
    }
    const [link] = found;
    const name = named(link);
    if (!name.includes(names) || !name.includes(NEW_TAB_WORDING))
      fail(
        `the ${names} link is named "${name}", expected it to say "${names}" and "${NEW_TAB_WORDING}"`,
      );
    if (link.attrs.target !== "_blank")
      fail(`the ${names} link does not open in a new tab (target="_blank")`);
    if (!/\bnoopener\b/.test(link.attrs.rel ?? ""))
      fail(`the ${names} link has no rel="noopener"`);
  }

  // #266 phase 2, D5: the reading and keyboard order is the theme toggle, then GitHub, then Discord. The toggle must be
  // the header's own (the mobile menu's is outside `<header>`), which the page-wide theme rule does not require.
  const toggleAt = header.search(
    /<starlight-theme-select\b[^>]*>[\s\S]*?<button\b[^>]*\btheme-toggle\b/,
  );
  const githubAt = links.find(
    (l) => l.attrs.href === COMMUNITY_LINKS[0].href,
  )?.at;
  const discordAt = links.find(
    (l) => l.attrs.href === COMMUNITY_LINKS[1].href,
  )?.at;
  if (toggleAt === -1) fail("no theme toggle in the header");
  else if (githubAt !== undefined && toggleAt > githubAt)
    fail("the theme toggle comes after the GitHub link, expected it before");
  if (githubAt !== undefined && discordAt !== undefined && githubAt > discordAt)
    fail("the GitHub link comes after the Discord link, expected it before");
  return failures;
}

/** Every `<svg>` is hidden from assistive technology, or is an image with a name: decoration is never announced. */
function auditSvgs(page, where) {
  const failures = [];
  // A graphic inside an element that is itself aria-hidden (Starlight's heading anchor icons) is hidden with it.
  let html = page;
  for (const element of ["span", "div"])
    html = withoutElements(
      html,
      element,
      new RegExp(`<${element}\\b[^>]*aria-hidden="true"[^>]*>`),
    );
  for (const [open] of html.matchAll(/<svg\b[^>]*>/g)) {
    const attrs = attributes(open.slice(4, -1));
    const hidden = attrs["aria-hidden"] === "true";
    const named =
      attrs.role === "img" &&
      ((attrs["aria-label"] ?? "").trim() !== "" ||
        (attrs["aria-labelledby"] ?? "").trim() !== "");
    if (!hidden && !named)
      failures.push(
        `${where}: <svg> is neither aria-hidden="true" nor a named role="img" (${open.slice(0, 60)})`,
      );
  }
  return failures;
}

// ---- no cyan ------------------------------------------------------------------------------------------------------

const VENDORED_DIR = join(here, "../src/styles/northguild");

/** The literal colours of the vendored `--gmt-cyan*` definitions (`22d3ee`, `67e8f9`, ...), lowercase, no `#`. */
export function cyanLiterals(dir = VENDORED_DIR) {
  const literals = new Set();
  for (const file of ["tokens.css", "tokens-light.css"]) {
    const css = readFileSync(join(dir, file), "utf8");
    for (const [, hex] of css.matchAll(
      /--gmt-cyan[\w-]*\s*:\s*#([0-9a-fA-F]{6})\b/g,
    ))
      literals.add(hex.toLowerCase());
  }
  return literals;
}

/** Whether a declaration value names cyan: a `var(--gmt-cyan...)`, or one of `literals` as hex (with or without alpha) or as rgb(). */
export function namesCyan(value, literals) {
  if (/var\(\s*--gmt-cyan/.test(value)) return true;
  const lower = value.toLowerCase();
  for (const hex of literals) {
    if (new RegExp(`#${hex}(?![0-9a-f]{3})`).test(lower)) return true;
    const [r, g, b] = [0, 2, 4].map((k) =>
      Number.parseInt(hex.slice(k, k + 2), 16),
    );
    if (new RegExp(`rgba?\\(\\s*${r}[\\s,]+${g}[\\s,]+${b}\\b`).test(lower))
      return true;
  }
  return false;
}

/** The index of the `}` closing the block that opens at `open`, skipping strings. */
function closingBrace(css, open) {
  let depth = 0;
  let quote = "";
  for (let i = open; i < css.length; i++) {
    const ch = css[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = "";
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return css.length;
}

/** Splits at `separator` outside parentheses and quotes. */
function splitOutside(text, separator) {
  const parts = [];
  let depth = 0;
  let quote = "";
  let current = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === "\\") current += text[++i] ?? "";
      else if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
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

function declarationsOf(body) {
  return splitOutside(body, ";").flatMap((declaration) => {
    const colon = declaration.indexOf(":");
    if (colon === -1) return [];
    return [
      [
        declaration.slice(0, colon).trim().toLowerCase(),
        declaration.slice(colon + 1).trim(),
      ],
    ];
  });
}

/**
 * Style rules and keyframes of a stylesheet, flattened: `{ chain, selector, declarations }` where `chain` is the
 * enclosing at-rules (`@media ...`, `@layer ...`). The built CSS is minified and not nested.
 */
export function parseStylesheet(
  css,
  chain = [],
  out = { rules: [], keyframes: [] },
) {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let i = 0;
  while (i < source.length) {
    const open = source.indexOf("{", i);
    const semicolon = source.indexOf(";", i);
    if (semicolon !== -1 && (open === -1 || semicolon < open)) {
      i = semicolon + 1; // @import, @charset, @layer a, b;
      continue;
    }
    if (open === -1) break;
    const prelude = source.slice(i, open).trim();
    const close = closingBrace(source, open);
    const body = source.slice(open + 1, close);
    i = close + 1;
    if (prelude.startsWith("@keyframes") || /^@-\w+-keyframes/.test(prelude))
      out.keyframes.push({ name: prelude.split(/\s+/)[1], body, chain });
    else if (prelude.startsWith("@font-face")) continue;
    else if (prelude.startsWith("@"))
      parseStylesheet(body, [...chain, prelude], out);
    else
      out.rules.push({
        chain,
        selector: prelude,
        declarations: declarationsOf(body),
      });
  }
  return out;
}

/** `selector` without its `:not(...)`, `:where(...)` and `:is(...)` groups, which do not require a class to exist. */
function withoutGroups(selector) {
  let out = selector;
  for (let guard = 0; guard < 10; guard++) {
    const next = out.replace(/:(?:not|where|is)\([^()]*\)/g, "");
    if (next === out) break;
    out = next;
  }
  return out;
}

/**
 * Where cyan still reaches something the site uses, as one line each. The site's accent is spring (D17); gmt's cyan
 * survives only where nothing can show it. For the built `dist`:
 *
 *  - It reads every stylesheet and every `<style>` and `style=""` in the HTML, and looks at each declaration whose value
 *    names cyan: `var(--gmt-cyan...)`, or a literal colour that the vendored tokens give a `--gmt-cyan*` variable
 *    (`cyanLiterals`), as hex or `rgb()`.
 *  - The `--gmt-cyan*` definitions themselves are not findings (the vendored tokens define them).
 *  - Per selector and property the last declaration wins, so a vendored cyan value that theme.css re-declares is
 *    overridden, not a finding.
 *  - A declaration counts only if something uses it. A rule is used when every class or id in its selector appears
 *    in a page's HTML or in a script (the vendored widget rules, such as `.gmt-field`, are not). A custom property is
 *    used when a used declaration reads it with `var()`, directly or through other used custom properties.
 *    A keyframe is used when a used declaration names it.
 *  - Outside stylesheets: a cyan literal or `--gmt-cyan` in the HTML text or in a script is a finding.
 */
export async function cyanFindings(dist, literals = cyanLiterals()) {
  const files = await filesUnder(dist);
  const sheets = []; // { origin, css }
  const words = new Set();
  const findings = [];
  const wordsIn = (text) => {
    for (const [word] of text.matchAll(/[\w-]{2,}/g)) words.add(word);
  };
  for (const file of files) {
    const origin = file.slice(dist.length + 1);
    if (file.endsWith(".css")) {
      sheets.push({ origin, css: await readFile(file, "utf8") });
    } else if (file.endsWith(".html")) {
      const html = await readFile(file, "utf8");
      for (const [, css] of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g))
        sheets.push({ origin: `${origin} <style>`, css });
      for (const [, inline] of html.matchAll(/\sstyle="([^"]*)"/g))
        sheets.push({
          origin: `${origin} style=""`,
          css: `x{${decode(inline)}}`,
        });
      for (const [, names] of html.matchAll(/\sclass="([^"]*)"/g))
        wordsIn(names);
      const prose = html.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, "");
      if (namesCyan(prose.replace(/\sstyle="[^"]*"/g, ""), literals))
        findings.push(`${origin}: the HTML names cyan`);
    } else if (file.endsWith(".js") || file.endsWith(".mjs")) {
      const script = await readFile(file, "utf8");
      wordsIn(script);
      if (namesCyan(script, literals))
        findings.push(`${origin}: the script names cyan`);
    }
  }

  // The last declaration of each (chain, selector, property) wins; one entry per single selector of a list.
  const effective = new Map();
  for (const { origin, css } of sheets) {
    const { rules, keyframes } = parseStylesheet(css);
    for (const { chain, selector, declarations } of rules) {
      for (const single of splitOutside(selector, ",").map((s) => s.trim())) {
        const classes = [
          ...withoutGroups(single).matchAll(/[.#]([\w-]+)/g),
        ].map((m) => m[1]);
        const used = classes.every((c) => words.has(c));
        // `:root` and `[data-theme=light]` have equal specificity, so the later of the two wins in the light theme
        // and only `:root` counts in the dark one: two views of the same cascade, each with its own winner.
        const normal = single.replace(/["']/g, "").replace(/\s+/g, "");
        const views =
          normal === ":root"
            ? ["dark", "light"]
            : normal === "[data-theme=light]"
              ? ["light"]
              : [single];
        for (const [property, value] of declarations) {
          const entry = { origin, selector: single, property, value, used };
          for (const view of views)
            effective.set(`${chain.join("|")}|${view}|${property}`, entry);
        }
      }
    }
    for (const { name, body } of keyframes)
      effective.set(`@keyframes|${name}`, { keyframes: name, body, origin });
  }

  // What the used declarations read: custom properties through var(), keyframes by name.
  const declarations = [...new Set(effective.values())].filter(
    (d) => d.property !== undefined,
  );
  const readProperties = new Set();
  const usedKeyframes = new Set();
  const read = (value) => {
    for (const [, name] of value.matchAll(/var\(\s*(--[\w-]+)/g))
      readProperties.add(name);
    for (const { keyframes } of effective.values())
      if (
        keyframes &&
        new RegExp(`(^|[\\s,:])${keyframes}([\\s,;]|$)`).test(value)
      )
        usedKeyframes.add(keyframes);
  };
  for (const d of declarations)
    if (d.used && !d.property.startsWith("--")) read(d.value);
  for (let grew = true; grew; ) {
    grew = false;
    const before = readProperties.size;
    for (const d of declarations)
      if (d.used && readProperties.has(d.property)) read(d.value);
    grew = readProperties.size > before;
  }

  for (const d of declarations) {
    if (!d.used || !namesCyan(d.value, literals)) continue;
    if (/^--gmt-cyan/.test(d.property)) continue; // a definition
    if (d.property.startsWith("--") && !readProperties.has(d.property))
      continue; // nothing reads it
    findings.push(
      `${d.origin}: ${d.selector} { ${d.property}: ${d.value} } uses cyan`,
    );
  }
  for (const k of effective.values()) {
    if (
      k.keyframes &&
      usedKeyframes.has(k.keyframes) &&
      namesCyan(k.body, literals)
    )
      findings.push(`${k.origin}: @keyframes ${k.keyframes} uses cyan`);
  }
  return findings;
}

const textOf = (html) =>
  decode(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")).trim();

/** `html` without the elements `name` opens, repeated so nested ones go too. */
function withoutElements(
  html,
  name,
  openTag = new RegExp(`<${name}\\b[^>]*>`),
) {
  const closing = `</${name}>`;
  let out = html;
  for (let guard = 0; guard < 20; guard++) {
    const open = out.match(openTag);
    if (!open) break;
    const end = out.indexOf(closing, open.index);
    if (end === -1) break;
    out = out.slice(0, open.index) + out.slice(end + closing.length);
  }
  return out;
}

/** What the sighted see of a button: no icon, no keyboard-hint, no screen-reader-only text. */
function visibleLabel(inner) {
  const srOnly = /<span\b[^>]*class="[^"]*\bsr-only\b[^"]*"[^>]*>/;
  return textOf(
    withoutElements(
      withoutElements(withoutElements(inner, "svg"), "kbd"),
      "span",
      srOnly,
    ),
  );
}

/**
 * The theme control (#266, D1/D3): at least one `starlight-theme-select` (Header.astro renders it in the header and Starlight in the
 * mobile menu), each holding exactly one `<button>` and no `<select>`
 * (the button's name is checked with every other button by `auditControls`), and the theme provider's script inline in
 * `<head>`, so `data-theme` is set before first paint. The provider is recognised by the two things Starlight's own does
 * not have: it defines `StarlightThemeProvider`, draws into `button.theme-toggle` and reads the `'starlight-theme'` key (D2), so a build that lost the
 * override (and so has a button nothing updates) fails here.
 */
function auditThemeControl(html, where) {
  const failures = [];
  const fail = (rule) => failures.push(`${where}: ${rule}`);
  const selects = [
    ...html.matchAll(
      /<starlight-theme-select\b[^>]*>([\s\S]*?)<\/starlight-theme-select>/g,
    ),
  ];
  // Starlight renders the select twice, in the header and in the mobile menu, so "one" means one button per select.
  if (selects.length === 0)
    fail(
      "0 starlight-theme-select elements, expected the header's and the mobile menu's",
    );
  for (const [, inner] of selects) {
    const buttons = inner.match(/<button\b/g) ?? [];
    if (buttons.length !== 1)
      fail(
        `the theme select holds ${buttons.length} <button> elements, expected exactly 1`,
      );
    if (/<select\b/.test(inner))
      fail("the theme select holds a <select>, expected the two-state button");
  }
  const head = html.slice(0, Math.max(html.indexOf("</head>"), 0));
  const inlineProvider = [
    ...head.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g),
  ].some(
    ([, rawAttrs, source]) =>
      attributes(rawAttrs).src === undefined &&
      source.includes("StarlightThemeProvider") &&
      source.includes("button.theme-toggle") &&
      source.includes("'starlight-theme'"),
  );
  if (!inlineProvider)
    fail(
      "the theme provider script is not inline in <head> (expected the override, ThemeProvider.astro)",
    );
  return failures;
}

/** The attribute on the landing header's root that switches the entrance on (Header.astro). */
const ENTRANCE_MARKER = "data-landing-entrance";
const ENTRANCE_KEYFRAMES = /^header-entrance-/;
const NO_PREFERENCE = "@media(prefers-reduced-motion:no-preference)";
const underNoPreference = (chain) =>
  chain.length === 1 && chain[0].replace(/\s+/g, "") === NO_PREFERENCE;
/** A selector that names something in the header: its root, title, search, theme button, chips or right group. */
const HEADER_ITEM =
  /\.(?:header|title-wrapper|theme-toggle|social-icons|right-group)(?![\w-])|\.header-chip(?![\w-])|(?:^|[\s>+~,(])header(?![\w-])|\[data-landing-entrance/;

/**
 * The entrance's markup (#266 phase 3): the marker is on the landing's header and nowhere else, the landing's header
 * holds the internal-arrival script inline, and no header element is hidden by an inline style.
 */
function auditEntranceMarkup(html, where, landing) {
  const failures = [];
  const fail = (rule) => failures.push(`${where}: ${rule}`);
  const head = headerOf(html);
  const marked = new RegExp(`\\s${ENTRANCE_MARKER}(?=[\\s>=/])`).test(head);
  if (landing && !marked)
    fail(`the header has no entrance marker (${ENTRANCE_MARKER})`);
  if (!landing && marked)
    fail(
      `the header carries the entrance marker, which only the landing's may`,
    );
  if (landing) {
    const inline = [
      ...head.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g),
    ].some(
      ([, attrs, source]) =>
        attributes(attrs).src === undefined &&
        source.includes("document.referrer") &&
        source.includes("data-entrance-off"),
    );
    if (!inline)
      fail(
        "the header holds no inline internal-arrival script (one reading document.referrer and setting data-entrance-off)",
      );
  }
  for (const [, style] of head.matchAll(/\sstyle="([^"]*)"/g))
    if (/(^|;)\s*opacity\s*:\s*0(?:\.0*)?%?\s*(;|!|$)/i.test(decode(style)))
      fail(`a header element has style="${style}", hidden until a script runs`);
  return failures;
}

/**
 * The entrance's built CSS (#266 phase 3), over every stylesheet and `<style>`: the `header-entrance-*` keyframes exist,
 * each sits under the no-preference query alone, so does every rule that names one in an animation, and no rule gives a
 * header item `opacity: 0` (a keyframe may; it is not a rule).
 */
export async function entranceCssFindings(dist) {
  const findings = [];
  const sheets = [];
  for (const file of await filesUnder(dist)) {
    const origin = file.slice(dist.length + 1);
    if (file.endsWith(".css"))
      sheets.push({ origin, css: await readFile(file, "utf8") });
    else if (file.endsWith(".html"))
      for (const [, css] of (await readFile(file, "utf8")).matchAll(
        /<style\b[^>]*>([\s\S]*?)<\/style>/g,
      ))
        sheets.push({ origin: `${origin} <style>`, css });
  }
  let keyframes = 0;
  for (const { origin, css } of sheets) {
    const parsed = parseStylesheet(css);
    for (const k of parsed.keyframes) {
      if (!ENTRANCE_KEYFRAMES.test(k.name)) continue;
      keyframes++;
      if (!underNoPreference(k.chain))
        findings.push(
          `${origin}: @keyframes ${k.name} is not only under @media (prefers-reduced-motion: no-preference)`,
        );
      // Only opacity, transform and colour animate (D6, D8): nothing that repaints or relays out.
      for (const [, property] of k.body.matchAll(/(?:^|[{;\s])([a-z-]+)\s*:/g))
        if (!["opacity", "transform", "color"].includes(property))
          findings.push(
            `${origin}: @keyframes ${k.name} animates ${property}, expected only opacity, transform and color`,
          );
    }
    for (const { chain, selector, declarations } of parsed.rules) {
      for (const [property, value] of declarations) {
        if (
          /^animation(-name)?$/.test(property) &&
          /(^|[\s,])header-entrance-/.test(value)
        ) {
          const where = `${origin}: ${selector} { ${property}: ${value} }`;
          if (!selector.includes("[data-landing-entrance]"))
            findings.push(`${where} is not scoped to [data-landing-entrance]`);
          if (
            !selector.replace(/\s+/g, "").includes(":not([data-entrance-off])")
          )
            findings.push(`${where} is not gated by :not([data-entrance-off])`);
          if (/\b(forwards|both)\b/.test(value))
            findings.push(
              `${where} keeps an end state (forwards/both), expected backwards`,
            );
          if (value.includes("header-entrance-fade")) {
            // The shield and wordmark are static, GitHub and Discord do not fade, and the search fade is the open
            // button alone (the dialog inside <site-search> holds buttons that would replay each time it opens).
            if (/\.wordmark|\.title-wrapper|header-chip/.test(selector))
              findings.push(
                `${where} fades the wordmark, the title wrapper or a header chip`,
              );
            if (
              /site-search/.test(selector) &&
              !/>\s*button\[data-open-modal\]\s*$/.test(selector)
            )
              findings.push(
                `${where} fades more than the search open button (expected site-search > button[data-open-modal])`,
              );
          }
        }
        if (
          /^animation(-name)?$/.test(property) &&
          /(^|[\s,])header-entrance-/.test(value) &&
          !underNoPreference(chain)
        )
          findings.push(
            `${origin}: ${selector} { ${property}: ${value} } animates the entrance outside @media (prefers-reduced-motion: no-preference)`,
          );
        if (
          property === "opacity" &&
          /^0(\.0*)?%?(\s*!important)?$/.test(value.trim()) &&
          HEADER_ITEM.test(selector)
        )
          findings.push(
            `${origin}: ${selector} { opacity: 0 } hides a header item outside a keyframe`,
          );
      }
    }
  }
  if (keyframes === 0)
    findings.push("no header-entrance-* keyframes in the build's CSS");
  return findings;
}

/** Failures in how a page's controls are named (WCAG 4.1.2 and 2.5.3) and in the chat launcher's announced shortcut. */
function auditControls(html, where) {
  const failures = [];
  const fail = (rule) => failures.push(`${where}: ${rule}`);
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)];
  let hasSearch = false;
  let launcher;
  for (const [, rawAttrs, inner] of buttons) {
    const attrs = attributes(rawAttrs);
    if ("data-open-modal" in attrs) hasSearch = true;
    if ("data-chat-launcher" in attrs) launcher = attrs;
    const ariaLabel = (attrs["aria-label"] ?? "").trim();
    const hidden = (re) => withoutElements(inner, "span", re);
    const contentName = textOf(
      hidden(/<span\b[^>]*aria-hidden="true"[^>]*>/).replace(
        /<svg\b[\s\S]*?<\/svg>/g,
        "",
      ),
    );
    const named =
      ariaLabel !== "" ||
      (attrs["aria-labelledby"] ?? "").trim() !== "" ||
      contentName !== "" ||
      (attrs.title ?? "").trim() !== "";
    const describe = rawAttrs.trim().slice(0, 60);
    if (!named) fail(`button (${describe}) has no accessible name`);
    const visible = visibleLabel(inner);
    if (
      ariaLabel !== "" &&
      visible !== "" &&
      !ariaLabel.toLowerCase().includes(visible.toLowerCase())
    )
      fail(
        `button "${visible}": aria-label "${ariaLabel}" does not contain its visible text (WCAG 2.5.3)`,
      );
  }
  if (!hasSearch) fail("no search button (data-open-modal)");

  if (launcher === undefined)
    fail("no chat launcher button (data-chat-launcher)");
  else if (launcher["aria-keyshortcuts"] === undefined)
    fail(
      `chat launcher has no aria-keyshortcuts, expected ${CHAT_SHORTCUT_ARIA}`,
    );
  else if (launcher["aria-keyshortcuts"] !== CHAT_SHORTCUT_ARIA)
    fail(
      `chat launcher aria-keyshortcuts is ${launcher["aria-keyshortcuts"]}, expected ${CHAT_SHORTCUT_ARIA}`,
    );

  const labels = [
    ...html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g),
  ].filter(([, inner]) => textOf(withoutElements(inner, "select")) !== "");
  for (const select of html.matchAll(/<select\b([^>]*)>/g)) {
    const attrs = attributes(select[1]);
    const inLabel = labels.some(
      (label) =>
        select.index > label.index &&
        select.index < label.index + label[0].length,
    );
    if (!inLabel && (attrs["aria-label"] ?? "").trim() === "")
      fail("select has no label");
  }
  return failures;
}

/** The largest minimum height, in px, that a built stylesheet gives an element with `role=tab`; undefined when none does. */
function tabMinHeightPx(css) {
  let largest;
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/\[role=["']?tab["']?\]/.test(selector)) continue;
    for (const [, value, unit] of body.matchAll(
      /min-(?:block-size|height)\s*:\s*([\d.]+)(px|rem)/g,
    )) {
      const px = Number(value) * (unit === "rem" ? PX_PER_REM : 1);
      if (largest === undefined || px > largest) largest = px;
    }
  }
  return largest;
}

const isChatChunk = (reference) => /(^|\/)Chat\.[^/]*$/.test(reference);
// The hero's loader is the page script Astro builds from HeroLeaves.astro; the effect (OGL and the particles) is
// src/hero/particles.ts, a chunk of its own that only the loader's dynamic import reaches.
const isHeroLoader = (reference) => /(^|\/)HeroLeaves\.[^/]*$/.test(reference);
const isHeroChunk = (reference) => /(^|\/)particles\.[^/]*$/.test(reference);

/** The scripts and modulepreloads a page names, as the URLs the HTML gives. */
function scriptReferences(html) {
  return [
    ...tagsOf(html, "script").map((a) => a.src),
    ...tagsOf(html, "link")
      .filter((a) => a.rel === "modulepreload")
      .map((a) => a.href),
  ].filter(Boolean);
}

const fileOf = (dist, reference) =>
  join(dist, reference.replace(/^\/worktree\//, ""));

/** `from"./x.js"` and `import"./x.js"`, not `import("./x.js")`, which is a dynamic import. The bundler quotes with `"` or a backtick. */
const staticImportsOf = (source) => [
  ...[...source.matchAll(/\bfrom\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]),
  ...[...source.matchAll(/\bimport\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]),
];
/** Dynamic imports, also as the bundler wraps them: `import("./x.js")` inside a preload helper call. */
const dynamicImportsOf = (source) =>
  [...source.matchAll(/\bimport\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map(
    (m) => m[1],
  );

/** Code a page loads up front: a script or modulepreload for a chunk `isChunk` names, or a page script importing it statically. */
async function loadedUpFront(html, dist, isChunk) {
  const references = scriptReferences(html);
  if (references.some(isChunk)) return true;
  for (const reference of references) {
    let source;
    try {
      source = await readFile(fileOf(dist, reference), "utf8");
    } catch {
      continue;
    }
    if (staticImportsOf(source).some(isChunk)) return true;
  }
  return false;
}

const chatLoadedUpFront = (html, dist) =>
  loadedUpFront(html, dist, isChatChunk);

// D18's budget: the loader at most 2 KB gzipped, everything it imports, together, at most 32 KB gzipped.
export const HERO_LOADER_BUDGET = 2 * 1024;
export const HERO_EFFECT_BUDGET = 32 * 1024;
const gzipped = (buffer) => gzipSync(buffer, { level: 9 }).length;

/** `files` and everything they import statically, as paths (a file that cannot be read is skipped). */
async function staticClosure(files) {
  const seen = new Set();
  const queue = [...files];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    for (const specifier of staticImportsOf(text))
      if (specifier.startsWith(".")) queue.push(join(dirname(file), specifier));
  }
  return [...seen];
}

const totalGzipped = async (files) => {
  let total = 0;
  for (const file of files) total += gzipped(await readFile(file));
  return total;
};

/**
 * The hero (D18). `landing` is true for the root, the only page that loads the loader and carries the art box.
 * Returns failure rules, without the page's label.
 */
async function auditHero(html, dist, landing) {
  const failures = [];
  const loaders = scriptReferences(html).filter(isHeroLoader);
  if (await loadedUpFront(html, dist, isHeroChunk))
    failures.push("loads the hero effect up front");
  if (!landing) {
    if (loaders.length > 0)
      failures.push("loads the hero loader; only the landing may");
    if (/\bdata-hero-art\b/.test(html))
      failures.push("carries the hero's art box; only the landing may");
    return failures;
  }

  if (loaders.length !== 1) {
    failures.push(`loads ${loaders.length} hero loaders, expected 1`);
  } else {
    const loaderFile = fileOf(dist, loaders[0]);
    try {
      // What ships up front: the loader and whatever it imports statically (the bundler's preload helper).
      const size = await totalGzipped(await staticClosure([loaderFile]));
      if (size > HERO_LOADER_BUDGET)
        failures.push(
          `the hero loader is ${size} B gzipped, over the ${HERO_LOADER_BUDGET} B budget`,
        );
      // What the loader fetches later: the effect chunk, with everything that imports.
      const entries = dynamicImportsOf(await readFile(loaderFile, "utf8"))
        .filter(isHeroChunk)
        .map((entry) => join(dirname(loaderFile), entry));
      if (entries.length === 0)
        failures.push(
          "the hero loader has no dynamic import() of the effect chunk",
        );
      const total = await totalGzipped(await staticClosure(entries));
      if (total > HERO_EFFECT_BUDGET)
        failures.push(
          `the hero effect and what it imports are ${total} B gzipped, over the ${HERO_EFFECT_BUDGET} B budget`,
        );
    } catch (error) {
      failures.push(`the hero loader cannot be read (${error.message})`);
    }
  }

  // Decorative (D18): the still SVG and the canvas are hidden from assistive technology; the heading and the link carry
  // the meaning.
  const canvases = [...html.matchAll(/<canvas\b[^>]*>/g)].map((m) =>
    attributes(m[0].slice(7, -1)),
  );
  if (canvases.length !== 1)
    failures.push(
      `has ${canvases.length} <canvas> elements, expected the hero's 1`,
    );
  for (const canvas of canvases)
    if (canvas["aria-hidden"] !== "true")
      failures.push('the hero canvas is not aria-hidden="true"');
  const stills = [...html.matchAll(/<svg\b[^>]*>/g)]
    .map((m) => attributes(m[0].slice(4, -1)))
    .filter((a) => /(^|\s)hero-still(\s|$)/.test(a.class ?? ""));
  if (stills.length !== 1)
    failures.push(`has ${stills.length} hero still SVGs, expected 1`);
  for (const still of stills)
    if (still["aria-hidden"] !== "true")
      failures.push('the hero still SVG is not aria-hidden="true"');
  return failures;
}

async function auditPage(path, dist, descriptions, options) {
  const failures = [];
  const fail = (rule) => failures.push(`${label(path)}: ${rule}`);
  let html;
  try {
    html = await readFile(join(dist, pageFile(path)), "utf8");
  } catch {
    fail(`${pageFile(path)} is missing from the build`);
    return failures;
  }

  const metas = tagsOf(html, "meta");
  const metaContent = (key, value) =>
    metas.find((m) => m[key] === value)?.content;

  const description = metaContent("name", "description");
  if (description === undefined || description === "") {
    fail("no meta description");
  } else {
    if (path !== "" && description === SITE_DEFAULT_DESCRIPTION)
      fail(
        "meta description is the site default: the page has no description of its own",
      );
    if (description.length > MAX_DESCRIPTION)
      fail(
        `meta description is ${description.length} characters, over ${MAX_DESCRIPTION}`,
      );
    const seenAt = descriptions.get(description);
    if (seenAt === undefined) descriptions.set(description, path);
    else fail(`meta description is not unique: same as ${label(seenAt)}`);
  }

  const canonicals = tagsOf(html, "link").filter((l) => l.rel === "canonical");
  if (canonicals.length !== 1)
    fail(`${canonicals.length} canonical links, expected exactly 1`);
  else if (canonicals[0].href !== pageUrl(path))
    fail(`canonical is ${canonicals[0].href}, expected ${pageUrl(path)}`);

  for (const property of [
    "og:title",
    "og:description",
    "og:url",
    "og:site_name",
  ]) {
    if (!metaContent("property", property)) fail(`no ${property} tag`);
  }
  const card = metaContent("name", "twitter:card");
  if (card === undefined) fail("no twitter:card tag");
  else if (card !== "summary_large_image")
    fail(`twitter:card is ${card}, expected summary_large_image`);
  // The share preview (plan §9 Q3): crawlers need an absolute URL, and a URL that 404s shows no card at all.
  const image = metaContent("property", "og:image");
  if (!image) fail("no og:image tag");
  else if (!image.startsWith(ORIGIN))
    fail(`og:image is ${image}, expected an absolute URL under ${ORIGIN}`);
  else if (!isBuiltFile(image, dist))
    fail(`og:image ${image} is not a file in the build`);
  else {
    // What the tags declare must be what the file is, and the file what plan §4.4 asks for.
    const size = imageSize(readFileSync(builtFileOf(image, dist)));
    const declared = {
      type: metaContent("property", "og:image:type"),
      width: metaContent("property", "og:image:width"),
      height: metaContent("property", "og:image:height"),
    };
    if (!size) fail(`og:image ${image} is not a PNG or a JPEG`);
    else {
      if (
        size.width !== PREVIEW_SIZE.width ||
        size.height !== PREVIEW_SIZE.height
      )
        fail(
          `og:image is ${size.width}×${size.height}, expected ${PREVIEW_SIZE.width}×${PREVIEW_SIZE.height}`,
        );
      if (
        declared.width !== String(size.width) ||
        declared.height !== String(size.height)
      )
        fail(
          `og:image:width and og:image:height say ${declared.width}×${declared.height}, the file is ${size.width}×${size.height}`,
        );
      if (declared.type !== size.type)
        fail(`og:image:type is ${declared.type}, the file is ${size.type}`);
    }
  }
  const twitterImage = metaContent("name", "twitter:image");
  if (!twitterImage) fail("no twitter:image tag");
  else if (twitterImage !== image)
    fail(`twitter:image is ${twitterImage}, expected the og:image (${image})`);
  if (!metaContent("property", "og:image:alt")) fail("no og:image:alt tag");
  if (!metaContent("name", "twitter:image:alt"))
    fail("no twitter:image:alt tag");
  for (const rule of auditIcons(html, dist)) fail(rule);
  for (const rule of auditTitle(html)) fail(rule);

  const ld = jsonLdTypes(html);
  if (ld.error)
    fail(ld.error.startsWith("JSON-LD") ? ld.error : `JSON-LD: ${ld.error}`);
  else {
    const expected = expectedJsonLdTypes(path);
    if (ld.types.join(",") !== expected.join(","))
      fail(`JSON-LD types are [${ld.types}], expected [${expected}]`);
  }

  if (await chatLoadedUpFront(html, dist))
    fail("loads chat code before it is activated");
  for (const rule of await auditHero(html, dist, path === "")) fail(rule);

  failures.push(...auditControls(html, label(path)));
  failures.push(...auditThemeControl(html, label(path)));
  failures.push(...auditHeader(html, label(path)));
  failures.push(...auditEntranceMarkup(html, label(path), path === ""));
  failures.push(...auditSvgs(html, label(path)));

  // Ids are unique in a document (HTML Living Standard, "the id attribute"); the header's and the footer's marks each
  // find their gradients by id (phase 15).
  const ids = new Map();
  for (const [, id] of html.matchAll(/\sid="([^"]*)"/g))
    ids.set(id, (ids.get(id) ?? 0) + 1);
  for (const [id, count] of ids)
    if (count > 1) fail(`id "${id}" appears ${count} times`);

  // A second NorthGuild logo (phase 15): the organisation's GitHub avatar, which the footer once showed beside the
  // header's own mark.
  for (const img of tagsOf(html, "img"))
    if (ORG_AVATAR.test(img.src ?? ""))
      fail(`shows ${img.src}, a second logo beside the header's mark`);

  // No page carries the project footer, the licence, CLI version and maintainers block the footer once had (the user,
  // 2026-11-04: "lose this content that is on every damn page"). Found by what it said, not only by its class name.
  if (
    /class="[^"]*\bproject-footer\b/.test(html) ||
    /aria-label="Maintainers"/.test(html) ||
    /CLI Version:/.test(html)
  )
    fail(
      "carries the project footer (licence, version or maintainers); no page has one",
    );

  const times = tagsOf(html, "time");

  // No "Edit page" link on any page, the landing included.
  if (tagsOf(html, "a").some((a) => GITHUB_EDIT.test(a.href ?? "")))
    fail("carries an edit link to GitHub; no page has one");

  // The landing has no footer (phase 15): no date. The chat launcher is checked with the other controls above, so it is
  // still required there.
  if (path === "") {
    if (times.length > 0)
      fail("the landing carries a last updated date; it has no footer");
    return failures;
  }

  // Last updated (D11): the rendered <time> must be the independently computed date.
  const expectedDate = options.expectedDate(path);
  if (times.length === 0) fail("no last updated date (<time>) on the page");
  else if (expectedDate === undefined)
    fail("no source file to compute the expected last updated date from");
  else {
    const shown = times[0].datetime?.slice(0, 10);
    if (shown !== expectedDate)
      fail(
        `last updated is ${shown}, expected ${expectedDate} (git log --follow)`,
      );
  }
  return failures;
}

async function sitemapUrls(dist) {
  const index = await readFile(join(dist, "sitemap-index.xml"), "utf8");
  const urls = [];
  for (const [, loc] of index.matchAll(/<loc>([^<]*)<\/loc>/g)) {
    const file = loc.replace(/^https:\/\/northguild\.dev\/worktree\//, "");
    const sitemap = await readFile(join(dist, file), "utf8");
    urls.push(
      ...[...sitemap.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]),
    );
  }
  return urls;
}

async function filesUnder(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) =>
      e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)],
    ),
  );
  return nested.flat();
}

/** The item lines of a llmstxt.org file: `- [name](url): notes`. */
function llmsItems(text) {
  return text
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => {
      const m = line.match(/^- \[([^\]]*)\]\(([^)]*)\)(?:: (.*))?$/);
      return m
        ? { title: m[1], url: m[2], notes: m[3] ?? "" }
        : { malformed: line };
    });
}

async function auditLlms(dist, descriptions) {
  const failures = [];
  let text;
  try {
    text = await readFile(join(dist, "llms.txt"), "utf8");
  } catch {
    return ["llms.txt is missing from the build"];
  }
  const lines = text.replace(/^\uFEFF/, "").split("\n");
  if (!/^# \S/.test(lines[0] ?? ""))
    failures.push("llms.txt: does not open with an H1 naming the site");
  if (!lines.some((l) => /^> \S/.test(l)))
    failures.push("llms.txt: has no blockquote summary");
  const items = llmsItems(text);
  const seen = new Set();
  for (const item of items) {
    if (item.malformed) {
      failures.push(`llms.txt: not a link item: ${item.malformed}`);
      continue;
    }
    seen.add(item.url);
    const path = PAGE_PATHS.find((p) => pageUrl(p) === item.url);
    if (path === undefined) {
      failures.push(
        `llms.txt: ${item.url} is not one of the ${PAGE_PATHS.length} pages`,
      );
      continue;
    }
    if (item.title === "") failures.push(`llms.txt: ${item.url} has no title`);
    if (item.notes === "")
      failures.push(`llms.txt: ${item.url} has no description`);
    else if (descriptions.get(item.notes) !== path)
      failures.push(`llms.txt: ${item.url} description is not the page's own`);
  }
  for (const path of PAGE_PATHS)
    if (!seen.has(pageUrl(path)))
      failures.push(`llms.txt: ${pageUrl(path)} is missing`);
  if (items.length !== seen.size)
    failures.push("llms.txt: a URL is listed twice");
  return failures;
}

/** The 404: the site's search, a link to Getting Started (/getting-started/), and nothing that names a URL the site does not have. */
function auditNotFound(html) {
  const failures = [
    ...auditControls(html, "404.html"),
    ...auditThemeControl(html, "404.html"),
    ...auditHeader(html, "404.html"),
    ...auditSvgs(html, "404.html"),
  ];
  const fail = (rule) => failures.push(`404.html: ${rule}`);
  // The 404 speaks git (phase 13): the heading is a git error line, which begins "fatal: " in git's own output.
  const heading = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/);
  if (!heading || !/^fatal: \S/.test(textOf(heading[1])))
    fail(
      'the heading is not a git error line (expected it to begin "fatal: ")',
    );
  if (tagsOf(html, "link").some((l) => l.rel === "canonical"))
    fail("has a canonical link, but /404/ is not a page of the site");
  if (/<script type="application\/ld\+json">/.test(html))
    fail("has JSON-LD (a BreadcrumbList would name /404/ as a page)");
  const toGettingStarted = [
    ...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g),
  ].some(
    ([, attrs, inner]) =>
      attributes(attrs).href === "/worktree/getting-started/" &&
      /getting started/i.test(textOf(inner)),
  );
  if (!toGettingStarted)
    fail('no link to Getting Started (href="/worktree/getting-started/")');
  return failures;
}

async function auditSite(dist) {
  const failures = [];

  try {
    const urls = (await sitemapUrls(dist)).sort();
    const expected = PAGE_PATHS.map(pageUrl).sort();
    for (const url of expected)
      if (!urls.includes(url)) failures.push(`sitemap: ${url} is missing`);
    for (const url of urls)
      if (!expected.includes(url))
        failures.push(
          `sitemap: ${url} is not one of the ${expected.length} pages`,
        );
    if (urls.length !== new Set(urls).size)
      failures.push("sitemap: a URL is listed twice");
  } catch (error) {
    failures.push(`sitemap: cannot be read (${error.message})`);
  }

  try {
    const notFound = await readFile(join(dist, "404.html"), "utf8");
    failures.push(...auditNotFound(notFound));
    for (const rule of [
      ...auditIcons(notFound, dist),
      ...auditTitle(notFound, { reportMissing: true }),
    ])
      failures.push(`404.html: ${rule}`);
    for (const rule of await auditHero(notFound, dist, false))
      failures.push(`404.html: ${rule}`);
    for (const rule of auditEntranceMarkup(notFound, "404.html", false))
      failures.push(rule);
  } catch {
    failures.push("404.html is missing");
  }

  failures.push(...(await cyanFindings(dist)));
  failures.push(...(await entranceCssFindings(dist)));

  const heights = [];
  for (const file of await filesUnder(dist)) {
    if (!file.endsWith(".css")) continue;
    const height = tabMinHeightPx(await readFile(file, "utf8"));
    if (height !== undefined) heights.push(height);
  }
  if (heights.length === 0)
    failures.push(
      "tabs: no stylesheet sets a minimum height on [role=tab] (custom.css, plan #235 requirement 8)",
    );
  else if (Math.max(...heights) < MIN_TAB_HEIGHT_PX)
    failures.push(
      `tabs: minimum height is ${Math.max(...heights)}px, expected at least ${MIN_TAB_HEIGHT_PX}px`,
    );

  try {
    const root = await readFile(join(dist, "index.html"), "utf8");
    // D17: the root is a landing, a real page (finding 1: not a redirect) with a heading and the call to action.
    if (!/<h1\b[^>]*>[\s\S]*?\S[\s\S]*?<\/h1>/.test(root))
      failures.push("/ (root): the landing has no heading");
    const getStarted = [...root.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].some(
      ([, attrs, inner]) =>
        attributes(attrs).href === "/worktree/getting-started/" &&
        /^get started$/i.test(textOf(inner)),
    );
    if (!getStarted)
      failures.push(
        '/ (root): the landing has no "Get started" link to /worktree/getting-started/',
      );
    // Phase 15 (the user, 2026-11-04): the hero alone, with one action. The Install action and the Install and "Where
    // to next" sections are gone.
    const actions = [...root.matchAll(/<a\b([^>]*)>/g)].filter(([, attrs]) =>
      /(^|\s)sl-link-button(\s|$)/.test(attributes(attrs).class ?? ""),
    ).length;
    if (actions > 1)
      failures.push(
        `/ (root): the landing has ${actions} actions, expected only "Get started"`,
      );
    const sections = (root.match(/<h2\b/g) ?? []).length;
    if (sections > 0)
      failures.push(
        `/ (root): the landing has ${sections} section(s) below the hero, expected the hero alone`,
      );
  } catch {
    // auditPage already reports the missing root.
  }

  for (const file of await filesUnder(dist)) {
    if ((await readFile(file, "utf8")).includes("shuding/nextra")) {
      failures.push(`${file.slice(dist.length + 1)}: contains shuding/nextra`);
    }
  }
  return failures;
}

/** Every failed rule across the build in `dist`, one line each; an empty array is a pass. */
export async function auditDist(dist = DEFAULT_DIST, overrides = {}) {
  const options = {
    expectedDate: defaultExpectedDate,
    ...overrides,
  };
  const descriptions = new Map();
  const failures = [];
  for (const path of PAGE_PATHS)
    failures.push(...(await auditPage(path, dist, descriptions, options)));
  failures.push(...(await auditSite(dist)));
  failures.push(...(await auditLlms(dist, descriptions)));
  return failures;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const dist = resolve(process.argv[2] ?? DEFAULT_DIST);
  const failures = await auditDist(dist).catch((error) => [
    `cannot audit ${dist}: ${error.message}`,
  ]);
  if (failures.length > 0) {
    console.error(`audit-dist: ${failures.length} failure(s) in ${dist}`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(
    `audit-dist: ${PAGE_PATHS.length} pages and the site checks pass in ${dist}`,
  );
}
