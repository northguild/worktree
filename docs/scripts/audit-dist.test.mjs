// @vitest-environment node

import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  auditDist,
  cyanFindings,
  cyanLiterals,
  followDate,
  imageSize,
  namesCyan,
  sourcePathOf,
} from "./audit-dist.mjs";

// The audit is tested against a small compliant site built here, then broken one rule at a time. Expected
// values come from plan §4.8 (what the audit asserts), D3 (URL form: https://northguild.dev/worktree/<path>/)
// and D10 (which JSON-LD types go where) — never from the audit's own constants. The 28 paths are the 24 old
// routes at 2633f3a, the two #238 added (5c741ee), the Rex Sessions guide (#270) and the `rename` command page (#272) under D17 (2026-11-04): /docs becomes the landing at the root, /docs/getting-started becomes
// /getting-started/, every other /docs/<p> becomes /<p>/.
const ORIGIN = "https://northguild.dev/worktree/";
const PATHS = [
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
  "commands/rename",
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
  "guides/rex-sessions",
  "guides/jira-integration",
  "guides/linear-agent-delegation",
  "guides/linear-integration",
  "guides/team-conventions",
  "project-configuration",
];
const url = (path) => (path === "" ? ORIGIN : `${ORIGIN}${path}/`);

// The fixture's dates are fixed; sourcePathOf, which the real date oracle reads, is tested against a real directory below.
// No page carries an "Edit page" link (the user, 2026-11-04, replacing phase 8's edit links), so the fixture draws none;
// EDIT_LINK is Starlight's, for the tests that put one back.
const DATE = "2026-11-04";
const FIXTURE = { expectedDate: () => DATE };
const EDIT_LINK =
  '<a href="https://github.com/northguild/worktree/edit/main/docs/src/content/docs/faq.mdx" class="sl-flex">Edit page</a>';
const descriptionOf = (path) => `A description of ${path || "the root"}.`;
const titleOf = (path) => path || "Home";
const llmsTxt = (paths, described = {}) =>
  [
    "# @northguild/worktree",
    "",
    "> Docs.",
    "",
    "## Documentation",
    "",
    ...paths.map(
      (p) =>
        `- [${titleOf(p)}](${url(p)}): ${described[p] ?? descriptionOf(p)}`,
    ),
    "",
  ].join("\n");

function jsonLd(path) {
  const types =
    path === ""
      ? ["SoftwareApplication", "WebSite", "Organization"]
      : ["SoftwareApplication", "BreadcrumbList"];
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": types.map((type) => ({ "@type": type })),
  });
}

// Phase 9 (accessibility, plan #235 Scope): every icon-only button has an accessible name; a name that stands beside
// visible text contains it (WCAG 2.5.3 Label in Name); the
// package-manager tabs are at least 44px tall (the issue, requirement 8). The markup below is what the built
// pages carry for those controls, read off the build.
const SEARCH_BUTTON =
  '<button data-open-modal aria-label="Search"><svg aria-hidden="true"></svg><span aria-hidden="true">Search</span><kbd><kbd>Ctrl</kbd><kbd>K</kbd></kbd></button>';
const MENU_BUTTON =
  '<button popovertarget="starlight__sidebar"><svg aria-hidden="true"></svg><span class="sr-only">Menu</span></button>';
const COPY_BUTTON =
  '<button title="Copy to clipboard" data-code="x"><div></div></button>';
// #266: the theme control is a two-state toggle, one named button in one `starlight-theme-select`, and its provider's
// script is inline in the head (no flash of the wrong theme). Both are what the build renders.
const THEME_SELECT =
  '<starlight-theme-select><button type="button" class="theme-toggle header-chip" aria-label="Toggle color theme"><svg class="theme-icon" aria-hidden="true"></svg></button></starlight-theme-select>';
const THEME_PROVIDER =
  "<script>window.StarlightThemeProvider = (() => { localStorage.getItem('starlight-theme'); document.documentElement.dataset.theme = 'dark'; return { updatePickers() { document.querySelectorAll('starlight-theme-select button.theme-toggle'); } }; })();</script>";
const CONTROLS = `${SEARCH_BUTTON}${MENU_BUTTON}${COPY_BUTTON}${THEME_SELECT}`;

// Phase 13 (D17, northguild.dev's Header.astro at ade22a5): the header's two NorthGuild links and its two community
// links, as the build renders them. The wording "(opens in a new tab)" is northguild.dev's own.
const NORTHGUILD_LINK =
  '<a href="https://northguild.dev/" class="wordmark"><svg aria-hidden="true"></svg><span>NorthGuild</span></a>';
const PRODUCT_LINK = '<a href="/worktree/" class="product">worktree</a>';
const community = (href, name, extra = "") =>
  `<a ${extra || 'target="_blank" rel="noopener noreferrer"'} href="${href}" aria-label="NorthGuild on ${name} (opens in a new tab)"><svg aria-hidden="true"></svg></a>`;
const GITHUB_LINK = community("https://github.com/northguild", "GitHub");
const DISCORD_LINK = community("https://discord.gg/TdvQdP3t5a", "Discord");
// #309 phase 4 (D2): the header's "Chat with Dox" crystal link (gmt's Header.astro) is first in the right group, ahead of the
// theme toggle; on /dox it is the current page. The mobile menu carries a copy before the social icons (gmt's
// MobileMenuFooter.astro), on the pages that have a sidebar.
const DOX_HREF = "/worktree/dox/";
const doxLink = (current = false) =>
  `<a href="${DOX_HREF}" class="header-chip dox-link" aria-label="Chat with Dox" title="Chat with Dox"${current ? ' aria-current="page"' : ""}><svg aria-hidden="true" focusable="false"></svg></a>`;
const header = (parts = {}) =>
  `<header class="header"><div class="brand">${parts.northguild ?? NORTHGUILD_LINK}<span aria-hidden="true">/</span>${parts.product ?? PRODUCT_LINK}</div>${parts.dox ?? doxLink()}${parts.theme ?? THEME_SELECT}${parts.github ?? GITHUB_LINK}${parts.discord ?? DISCORD_LINK}</header>`;
const HEADER = header();
const MOBILE_MENU = `<div class="mobile-preferences sl-flex"><div class="social-icons">${doxLink()}${GITHUB_LINK}${DISCORD_LINK}</div></div>`;

// #266 phase 3 (D6-D9): the landing's header carries the entrance marker and, inline before the header paints, the
// script that turns the entrance off for an arrival from another page of the site. Header.astro renders both inside
// the <header>, the script first; no other page's header has either. The entrance keyframes (custom.css) are named
// `header-entrance-*` and live under the no-preference query alone.
const ENTRANCE_SCRIPT =
  '<script>try{var f=new URL(document.referrer);if(f.origin===location.origin&&(f.pathname+"/").indexOf("/worktree/")===0)document.documentElement.setAttribute("data-entrance-off","")}catch(e){}</script>';
const LANDING_HEADER = HEADER.replace(
  '<header class="header">',
  `<header class="header" data-landing-entrance>${ENTRANCE_SCRIPT}`,
);
const GATE = ":root:not([data-entrance-off]) .header[data-landing-entrance]";
const ENTRANCE_CSS = `@media (prefers-reduced-motion:no-preference){@keyframes header-entrance-fade{from{opacity:0;transform:translateY(.75rem)}}@keyframes header-entrance-ink{from{color:#888}}${GATE} .brand>:is(.slash,.product-line){animation:header-entrance-fade .6s backwards}${GATE} site-search>button[data-open-modal]{animation:header-entrance-fade .6s backwards}${GATE} a.header-chip{animation:header-entrance-ink .5s backwards}}`;

// Phase 15 (the user, 2026-11-04): the landing is the hero alone, with no footer, so it carries no date; every other
// page keeps one. And no page carries the project line, the footer's licence, version and
// maintainers block (the user, 2026-11-04: "lose this content that is on every damn page ... is there any need for an
// MIT license there? No need for namecalling on every page either").
const PROJECT_FOOTER =
  '<div class="project-footer"><span>MIT 2026 © northguild</span></div>';
const MAINTAINERS =
  '<div><div>Maintainers:</div><ul aria-label="Maintainers"><li><a href="https://github.com/baldurpan">Baldur</a></li></ul></div>';

// Phase 16 (D18, the leaf-particle hero): the landing alone loads the hero loader and carries the art box, whose still
// SVG and canvas are aria-hidden. The loader reaches the effect only through a dynamic import().
const HERO_SCRIPT =
  '<script type="module" src="/worktree/_astro/HeroLeaves.ghi.js"></script>';
const HERO_ART =
  '<div class="art" data-hero-art><svg class="hero-still" aria-hidden="true" focusable="false"></svg><canvas class="hero-canvas" data-hero-canvas aria-hidden="true"></canvas></div>';

// Plan §9 Q3: the favicon (Starlight's own link, the ICO fallback and the touch icon) and the share preview, as the build
// renders them on every page; the 404 carries the icons too.
const ICONS = [
  '<link rel="shortcut icon" href="/worktree/favicon.svg" type="image/svg+xml"/>',
  '<link rel="icon" href="/worktree/favicon.ico" sizes="32x32"/>',
  '<link rel="apple-touch-icon" href="/worktree/apple-touch-icon.png"/>',
].join("\n");
const PREVIEW = "https://northguild.dev/worktree/og-image.jpg";
const PREVIEW_TAGS = [
  `<meta property="og:image" content="${PREVIEW}"/>`,
  '<meta property="og:image:type" content="image/jpeg"/>',
  '<meta property="og:image:width" content="1200"/>',
  '<meta property="og:image:height" content="630"/>',
  '<meta property="og:image:alt" content="The landing."/>',
  `<meta name="twitter:image" content="${PREVIEW}"/>`,
  '<meta name="twitter:image:alt" content="The landing."/>',
].join("\n");

function jpeg(width, height) {
  const app0 = [0xff, 0xe0, 0x00, 0x04, 0x00, 0x00];
  const sof0 = [
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
  ];
  return Buffer.from([
    0xff,
    0xd8,
    ...app0,
    0xff,
    ...sof0,
    ...new Array(9).fill(0),
    0xff,
    0xd9,
  ]);
}

// A PNG's signature and IHDR chunk (PNG spec §11.2.2): length 13, "IHDR", then width and height as 32-bit integers.
function png(width, height) {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "latin1");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

/** The landing's "Ask Dox" as Hero.astro renders it: a link to /dox/ carrying the crystal after its label (gmt's `.gmt-dox-cta`). */
const ASK_DOX =
  '<a href="/worktree/dox/" class="ask-dox gmt-dox-cta">Ask Dox' +
  '<svg aria-hidden="true" focusable="false"></svg></a>';

function page(path, overrides = {}) {
  const description = overrides.description ?? descriptionOf(path);
  const time = overrides.time ?? `${DATE}T10:00:00.000Z`;
  const canonical = overrides.canonical ?? url(path);
  const heading =
    path === ""
      ? "A git worktree for every branch"
      : path === "getting-started"
        ? "Getting Started with @northguild/worktree"
        : path;
  // D17: the root is a landing whose call to action is "Get started", linking to Getting Started; beside it, the
  // "Ask Dox" link to /dox/ (the user, 2026-11-08; a link since #309 D2).
  const landing =
    path === ""
      ? (overrides.landing ??
        '<a href="/worktree/getting-started/" class="sl-link-button primary">Get started</a>' +
          ASK_DOX)
      : "";
  return [
    "<!doctype html><html><head>",
    overrides.provider ?? THEME_PROVIDER,
    `<title>${titleOf(path)} · @northguild/worktree</title>`,
    `<link rel="canonical" href="${canonical}"/>`,
    `<meta property="og:title" content="${path || "Home"}"/>`,
    `<meta property="og:description" content="${description}"/>`,
    `<meta property="og:url" content="${url(path)}"/>`,
    `<meta property="og:site_name" content="@northguild/worktree"/>`,
    `<meta name="twitter:card" content="summary_large_image"/>`,
    overrides.preview ?? PREVIEW_TAGS,
    overrides.icons ?? ICONS,
    `<meta name="description" content="${description}"/>`,
    `<script type="application/ld+json">${overrides.jsonLd ?? jsonLd(path)}</script>`,
    '<script type="module" src="/worktree/_astro/page.abc.js"></script>',
    path === "" ? (overrides.heroScript ?? HERO_SCRIPT) : "",
    `</head><body>${overrides.header ?? (path === "" ? LANDING_HEADER : HEADER)}<h1>${heading}</h1>${overrides.edit ?? ""}${overrides.updated ?? (path === "" ? "" : `<p>Last updated: <time datetime="${time}">Nov 4, 2026</time></p>`)}${overrides.footer ?? ""}${overrides.controls ?? CONTROLS}${path === "" ? "" : (overrides.menu ?? MOBILE_MENU)}${landing}${path === "" ? (overrides.heroArt ?? HERO_ART) : ""}${overrides.body ?? ""}</body></html>`,
  ].join("\n");
}

// The 404 (plan #235 Scope): the site's search, a link to Getting Started, and none of what ties a page to a URL
// it does not have: no canonical, no JSON-LD (so no BreadcrumbList to /worktree/404/).
function notFoundPage(overrides = {}) {
  return [
    "<!doctype html><html><head>",
    overrides.provider ?? THEME_PROVIDER,
    "<title>Page not found · @northguild/worktree</title>",
    overrides.og ??
      '<meta property="og:title" content="Page not found"/><meta property="og:site_name" content="@northguild/worktree"/>',
    overrides.icons ?? ICONS,
    overrides.head ?? "",
    "</head><body>",
    overrides.header ?? HEADER,
    overrides.controls ?? CONTROLS,
    overrides.heading ?? "<h1>fatal: no such branch</h1>",
    overrides.link ??
      '<a href="/worktree/getting-started/">Getting Started</a>',
    "</body></html>",
  ].join("\n");
}

// #309 phase 1 (D6): `/dox/` is built by Astro as a StarlightPage that is not one of the 28 pages. What it carries is what
// the build renders (read off dist/dox/index.html): `noindex`, the inline script that marks the document, the site header,
// the search and menu buttons and the theme toggle, no footer, and one `astro-island` holding the
// island's chunk (`DoxPage.<hash>.js`), whose stylesheet is linked from this page alone.
const DOX_TITLE = "Dox · @northguild/worktree";
const DOX_SHELL_SCRIPT =
  "<script>document.documentElement.setAttribute('data-dox-shell','')</script>";
const DOX_ISLAND =
  '<astro-island component-url="/worktree/_astro/DoxPage.mno.js" client="load"><svg aria-hidden="true" focusable="false"></svg></astro-island>';
const DOX_CONTROLS = `${SEARCH_BUTTON}${MENU_BUTTON}${THEME_SELECT}`;
const DOX_STYLESHEET =
  '<link rel="stylesheet" href="/worktree/_astro/dox.pqr.css"/>';

function doxPage(overrides = {}) {
  return [
    "<!doctype html><html><head>",
    THEME_PROVIDER,
    `<title>${overrides.title ?? DOX_TITLE}</title>`,
    overrides.robots ?? '<meta name="robots" content="noindex"/>',
    overrides.shell ?? DOX_SHELL_SCRIPT,
    DOX_STYLESHEET,
    "</head><body>",
    overrides.header ?? header({ dox: doxLink(true) }),
    overrides.controls ?? DOX_CONTROLS,
    overrides.island ?? DOX_ISLAND,
    overrides.extra ?? "",
    "</body></html>",
  ].join("\n");
}

function sitemap(paths) {
  return `<?xml version="1.0"?><urlset>${paths.map((p) => `<url><loc>${url(p)}</loc></url>`).join("")}</urlset>`;
}

async function write(dir, relative, content) {
  const target = join(dir, relative);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}

const htmlPath = (path) => (path === "" ? "index.html" : `${path}/index.html`);

let dist;

beforeEach(async () => {
  dist = await mkdtemp(join(tmpdir(), "audit-dist-"));
  for (const path of PATHS) await write(dist, htmlPath(path), page(path));
  await write(dist, "404.html", notFoundPage());
  await write(dist, "dox/index.html", doxPage());
  await write(dist, "_astro/DoxPage.mno.js", "export const dox = 1;");
  await write(dist, "_astro/dox.pqr.css", ".gmt-hive-shell{position:fixed}");
  await write(
    dist,
    "_astro/common.abc.css",
    `.tab>[role=tab]{display:flex;min-block-size:44px}${ENTRANCE_CSS}`,
  );
  await write(
    dist,
    "sitemap-index.xml",
    "<sitemapindex><sitemap><loc>https://northguild.dev/worktree/sitemap-0.xml</loc></sitemap></sitemapindex>",
  );
  await write(dist, "sitemap-0.xml", sitemap(PATHS));
  await write(dist, "llms.txt", llmsTxt(PATHS));
  await write(dist, "_astro/page.abc.js", "console.log('page');");
  await write(
    dist,
    "_astro/HeroLeaves.ghi.js",
    'document.addEventListener("x",()=>import("./particles.jkl.js"));',
  );
  await write(dist, "_astro/particles.jkl.js", "export const effect = 1;");
  for (const file of ["favicon.svg", "favicon.ico", "apple-touch-icon.png"])
    await write(dist, file, "x");
  await write(dist, "og-image.jpg", jpeg(1200, 630));
});

afterEach(async () => {
  await rm(dist, { recursive: true, force: true });
});

const rewrite = async (path, change) => {
  const file = join(dist, htmlPath(path));
  await writeFile(file, change(await readFile(file, "utf8")));
};

const audit = () => auditDist(dist, FIXTURE);

// A page whose description changes, with llms.txt kept consistent so only the rule under test can fail.
const describe_ = async (path, description) => {
  await write(dist, htmlPath(path), page(path, { description }));
  await write(dist, "llms.txt", llmsTxt(PATHS, { [path]: description }));
};

describe("auditDist", () => {
  it("passes a site that meets every rule", async () => {
    expect(await audit()).toEqual([]);
  });

  it("fails a page with no meta description, naming the page", async () => {
    await rewrite("faq", (html) =>
      html.replace(/<meta name="description"[^>]*>/, ""),
    );
    const failures = await audit();
    // The page has no description for llms.txt to be compared with, so llms.txt reports it too.
    expect(failures).toContain("/faq/: no meta description");
    expect(failures.every((f) => /faq/.test(f))).toBe(true);
  });

  it("accepts a description of exactly 155 characters and fails one of 156", async () => {
    const at = (n) => "a".repeat(n);
    await describe_("faq", at(155));
    expect(await audit()).toEqual([]);
    await describe_("faq", at(156));
    const failures = await audit();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/156/);
  });

  it("counts a description's characters after entities are decoded", async () => {
    // 150 characters plus "&amp;" (one character once decoded) is 151, under the limit.
    await write(
      dist,
      htmlPath("faq"),
      page("faq", { description: `${"a".repeat(150)}&amp;` }),
    );
    await write(
      dist,
      "llms.txt",
      llmsTxt(PATHS, { faq: `${"a".repeat(150)}&` }),
    );
    expect(await audit()).toEqual([]);
  });

  // D17: the landing's description is the §4.3 index row, which is also the site default; the landing carries it
  // on purpose, so the root alone may. Everything else still fails (the test above and below).
  it("accepts the site default as the landing's own description", async () => {
    const siteDefault =
      "Docs for worktree, an open-source CLI that manages git worktrees: one per branch or issue, with env files copied and your editor opened.";
    await describe_("", siteDefault);
    expect(await audit()).toEqual([]);
  });

  it("fails a second page that repeats the landing's description", async () => {
    const siteDefault =
      "Docs for worktree, an open-source CLI that manages git worktrees: one per branch or issue, with env files copied and your editor opened.";
    await describe_("", siteDefault);
    await describe_("faq", siteDefault);
    expect(
      (await audit()).some((f) => /faq.*(site default|unique)/.test(f)),
    ).toBe(true);
  });

  it("fails a page whose description is the site default (its own description: is missing)", async () => {
    // Literal from plan §4.3's index row, which D3 makes the site default.
    const siteDefault =
      "Docs for worktree, an open-source CLI that manages git worktrees: one per branch or issue, with env files copied and your editor opened.";
    await describe_("faq", siteDefault);
    const failures = await audit();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/faq.*site default/);
  });

  it("fails two pages sharing a description", async () => {
    await write(dist, htmlPath("faq"), page("faq", { description: "Same." }));
    await write(
      dist,
      htmlPath("changelog"),
      page("changelog", { description: "Same." }),
    );
    const failures = await audit();
    expect(failures.some((f) => /unique|duplicate/i.test(f))).toBe(true);
  });

  it("fails a page with no canonical link", async () => {
    await rewrite("faq", (html) =>
      html.replace(/<link rel="canonical"[^>]*>/, ""),
    );
    const failures = await audit();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/canonical/);
  });

  it("fails a canonical that is not the D3 URL of the page", async () => {
    await write(
      dist,
      htmlPath("faq"),
      page("faq", { canonical: "https://northguild.dev/worktree/faq" }),
    );
    const failures = await audit();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/canonical/);
  });

  it("fails a page with two canonical links", async () => {
    await rewrite("faq", (html) =>
      html.replace(
        "<meta property",
        `<link rel="canonical" href="${url("faq")}"/><meta property`,
      ),
    );
    const failures = await audit();
    expect(failures.some((f) => /canonical/.test(f))).toBe(true);
  });

  it.each([
    ["og:title", /<meta property="og:title"[^>]*>/],
    ["og:description", /<meta property="og:description"[^>]*>/],
    ["og:url", /<meta property="og:url"[^>]*>/],
    ["og:site_name", /<meta property="og:site_name"[^>]*>/],
    ["twitter:card", /<meta name="twitter:card"[^>]*>/],
  ])("fails a page missing %s", async (tag, pattern) => {
    await rewrite("faq", (html) => html.replace(pattern, ""));
    const failures = await audit();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(tag);
  });

  it("fails a twitter:card that is not summary_large_image", async () => {
    await rewrite("faq", (html) =>
      html.replace("summary_large_image", "summary"),
    );
    expect((await audit()).some((f) => /twitter:card/.test(f))).toBe(true);
  });

  describe("the share preview (plan §9 Q3)", () => {
    it.each([
      ["og:image", /<meta property="og:image" [^>]*>/],
      ["twitter:image", /<meta name="twitter:image" [^>]*>/],
      ["og:image:alt", /<meta property="og:image:alt"[^>]*>/],
      ["twitter:image:alt", /<meta name="twitter:image:alt"[^>]*>/],
    ])("fails a page missing %s", async (tag, pattern) => {
      await rewrite("faq", (html) => html.replace(pattern, ""));
      const failures = await audit();
      // A missing og:image also leaves twitter:image naming something else; either way, only faq fails.
      expect(failures.length).toBeGreaterThan(0);
      expect(failures.every((f) => f.startsWith("/faq/:"))).toBe(true);
      expect(failures.some((f) => f.includes(`no ${tag} tag`))).toBe(true);
    });

    it("fails an og:image that is not an absolute URL under the site", async () => {
      await rewrite("faq", (html) =>
        html.replaceAll(PREVIEW, "/worktree/og-image.jpg"),
      );
      expect(await audit()).toEqual([
        "/faq/: og:image is /worktree/og-image.jpg, expected an absolute URL under https://northguild.dev/worktree/",
      ]);
    });

    it("fails an og:image whose file is not in the build", async () => {
      await rm(join(dist, "og-image.jpg"));
      const failures = await audit();
      expect(failures).toContain(
        `/faq/: og:image ${PREVIEW} is not a file in the build`,
      );
      expect(failures).toHaveLength(PATHS.length);
    });

    it("fails a preview that is not 1200×630, saying what the file is", async () => {
      await write(dist, "og-image.jpg", jpeg(1440, 756));
      const failures = await audit();
      expect(failures).toContain(
        "/faq/: og:image is 1440×756, expected 1200×630",
      );
      expect(failures).toContain(
        "/faq/: og:image:width and og:image:height say 1200×630, the file is 1440×756",
      );
      expect(failures).toHaveLength(PATHS.length * 2);
    });

    it("fails declared tags that disagree with the file", async () => {
      await rewrite("faq", (html) =>
        html
          .replace('content="1200"/>', 'content="1201"/>')
          .replace('content="image/jpeg"/>', 'content="image/png"/>'),
      );
      expect(await audit()).toEqual([
        "/faq/: og:image:width and og:image:height say 1201×630, the file is 1200×630",
        "/faq/: og:image:type is image/png, the file is image/jpeg",
      ]);
    });

    it("fails a preview that is not an image", async () => {
      await write(dist, "og-image.jpg", "x");
      expect((await audit()).filter((f) => f.startsWith("/faq/:"))).toEqual([
        `/faq/: og:image ${PREVIEW} is not a PNG or a JPEG`,
      ]);
    });

    it("fails a twitter:image that is not the og:image", async () => {
      const other = "https://northguild.dev/worktree/favicon.ico";
      await rewrite("faq", (html) =>
        html.replace(
          `<meta name="twitter:image" content="${PREVIEW}"/>`,
          `<meta name="twitter:image" content="${other}"/>`,
        ),
      );
      expect(await audit()).toEqual([
        `/faq/: twitter:image is ${other}, expected the og:image (${PREVIEW})`,
      ]);
    });
  });

  describe("the favicon (plan §9 Q3)", () => {
    it("fails a page that links no icon", async () => {
      await write(dist, htmlPath("faq"), page("faq", { icons: "" }));
      expect(await audit()).toEqual([
        '/faq/: no favicon (a <link rel="icon">)',
      ]);
    });

    it("fails a touch icon alone: it is not a favicon", async () => {
      await write(
        dist,
        htmlPath("faq"),
        page("faq", {
          icons:
            '<link rel="apple-touch-icon" href="/worktree/apple-touch-icon.png"/>',
        }),
      );
      expect(await audit()).toEqual([
        '/faq/: no favicon (a <link rel="icon">)',
      ]);
    });

    // The defect this rule was written for: Starlight links /worktree/favicon.svg by default, and nothing supplied it.
    it("fails an icon link whose file is not in the build, on every page and the 404", async () => {
      await rm(join(dist, "favicon.svg"));
      const failures = await audit();
      expect(failures).toHaveLength(PATHS.length + 1);
      expect(failures).toContain(
        "/faq/: shortcut icon /worktree/favicon.svg is not a file in the build",
      );
      expect(failures).toContain(
        "404.html: shortcut icon /worktree/favicon.svg is not a file in the build",
      );
    });

    it("fails an icon link outside the site", async () => {
      await write(
        dist,
        htmlPath("faq"),
        page("faq", {
          icons: '<link rel="icon" href="/favicon.ico"/>',
        }),
      );
      expect(await audit()).toEqual([
        "/faq/: icon /favicon.ico is not a file in the build",
      ]);
    });

    it("fails an icon link that names a directory, a path through a file, or nothing", async () => {
      await write(
        dist,
        htmlPath("faq"),
        page("faq", {
          icons:
            '<link rel="icon" href="/worktree/faq/"/><link rel="icon" href="/worktree/favicon.ico/x"/><link rel="icon" href=""/><link rel="icon" href="/worktree/"/>',
        }),
      );
      expect(await audit()).toEqual([
        "/faq/: icon /worktree/faq/ is not a file in the build",
        "/faq/: icon /worktree/favicon.ico/x is not a file in the build",
        "/faq/: icon (no href) is not a file in the build",
        "/faq/: icon /worktree/ is not a file in the build",
      ]);
    });

    it("fails a 404 that links no icon", async () => {
      await write(dist, "404.html", notFoundPage({ icons: "" }));
      expect(await audit()).toEqual([
        '404.html: no favicon (a <link rel="icon">)',
      ]);
    });
  });

  // D9 with GMT's middle dot (the user, 2026-11-04): a title is its og:title and the site's name joined by " · ", or its
  // og:title alone where that already names the site. Starlight's default pipe, or any other delimiter, fails.
  describe("the title", () => {
    it.each([
      ["the pipe", " | "],
      ["a dash", " - "],
    ])("fails a page title joined with %s", async (_label, delimiter) => {
      await rewrite("faq", (html) =>
        html.replace(
          " · @northguild/worktree</title>",
          `${delimiter}@northguild/worktree</title>`,
        ),
      );
      expect(await audit()).toEqual([
        `/faq/: title is "faq${delimiter}@northguild/worktree", expected "faq · @northguild/worktree"`,
      ]);
    });

    it("fails a title that repeats a site name its page title already carries", async () => {
      await rewrite("faq", (html) =>
        html
          .replace(
            '<meta property="og:title" content="faq"/>',
            '<meta property="og:title" content="faq for @northguild/worktree"/>',
          )
          .replace(
            "<title>faq · @northguild/worktree</title>",
            "<title>faq for @northguild/worktree · @northguild/worktree</title>",
          ),
      );
      expect(await audit()).toEqual([
        '/faq/: title is "faq for @northguild/worktree · @northguild/worktree", expected "faq for @northguild/worktree"',
      ]);
    });

    it("fails a page with no <title>", async () => {
      await rewrite("faq", (html) => html.replace(/<title>[^<]*<\/title>/, ""));
      expect(await audit()).toEqual(["/faq/: no <title>"]);
    });

    it("fails a 404 title that uses the pipe", async () => {
      await write(
        dist,
        "404.html",
        notFoundPage().replace(
          "Page not found · @northguild/worktree",
          "Page not found | @northguild/worktree",
        ),
      );
      expect(await audit()).toEqual([
        '404.html: title is "Page not found | @northguild/worktree", expected "Page not found · @northguild/worktree"',
      ]);
    });

    it("fails a 404 whose title cannot be checked (no og:title)", async () => {
      await write(dist, "404.html", notFoundPage({ og: "" }));
      expect(await audit()).toEqual([
        "404.html: the title cannot be checked: no og:title or og:site_name",
      ]);
    });
  });

  it("fails a nested page that has no BreadcrumbList", async () => {
    await write(
      dist,
      htmlPath("faq"),
      page("faq", {
        jsonLd: jsonLd("").replace(/"WebSite"|"Organization"/g, '"Thing"'),
      }),
    );
    expect((await audit()).length).toBeGreaterThan(0);
  });

  it("fails the root page when it carries a BreadcrumbList", async () => {
    await write(dist, htmlPath(""), page("", { jsonLd: jsonLd("faq") }));
    expect((await audit()).some((f) => /JSON-LD/.test(f))).toBe(true);
  });

  it("fails a page with no JSON-LD", async () => {
    await rewrite("faq", (html) =>
      html.replace(/<script type="application\/ld\+json">.*?<\/script>/, ""),
    );
    expect((await audit()).some((f) => /JSON-LD/.test(f))).toBe(true);
  });

  it("fails a page whose JSON-LD is not valid JSON", async () => {
    await write(dist, htmlPath("faq"), page("faq", { jsonLd: "{not json" }));
    expect((await audit()).some((f) => /JSON-LD/.test(f))).toBe(true);
  });

  it("fails a sitemap missing a page", async () => {
    await write(
      dist,
      "sitemap-0.xml",
      sitemap(PATHS.filter((p) => p !== "faq")),
    );
    const failures = await audit();
    expect(
      failures.some((f) => /sitemap/i.test(f) && f.includes(url("faq"))),
    ).toBe(true);
  });

  it("fails a sitemap that lacks /getting-started/ (28 URLs are expected, not 27)", async () => {
    await write(
      dist,
      "sitemap-0.xml",
      sitemap(PATHS.filter((p) => p !== "getting-started")),
    );
    expect(
      (await audit()).some(
        (f) => /sitemap/i.test(f) && f.includes(url("getting-started")),
      ),
    ).toBe(true);
  });

  it("fails a sitemap with an extra URL", async () => {
    await write(dist, "sitemap-0.xml", sitemap([...PATHS, "extra"]));
    expect(
      (await audit()).some(
        (f) => /sitemap/i.test(f) && f.includes(url("extra")),
      ),
    ).toBe(true);
  });

  it("fails when 404.html is missing", async () => {
    await rm(join(dist, "404.html"));
    expect((await audit()).some((f) => /404/.test(f))).toBe(true);
  });

  // D17 replaces the old "root carries Getting Started text" rule (finding 1: the root must be a real page, not a
  // redirect): the landing must be a real page with a heading and a "Get started" link to /getting-started/.
  it("fails a landing with no Get started link", async () => {
    await rewrite("", (html) =>
      html.replace(
        /<a [^>]*class="sl-link-button primary">Get started<\/a>/,
        "",
      ),
    );
    expect((await audit()).some((f) => /landing.*Get started/.test(f))).toBe(
      true,
    );
  });

  it("fails a landing whose Get started link goes elsewhere", async () => {
    await rewrite("", (html) =>
      html.replace("/worktree/getting-started/", "/worktree/faq/"),
    );
    expect((await audit()).some((f) => /landing.*Get started/.test(f))).toBe(
      true,
    );
  });

  it("fails a landing with no heading", async () => {
    await rewrite("", (html) => html.replace(/<h1>[^<]*<\/h1>/, ""));
    expect((await audit()).some((f) => /landing.*heading/.test(f))).toBe(true);
  });

  it("fails a Getting Started page with no BreadcrumbList (it is nested now)", async () => {
    await write(
      dist,
      htmlPath("getting-started"),
      page("getting-started", {
        jsonLd: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": ["SoftwareApplication", "WebSite", "Organization"].map(
            (type) => ({ "@type": type }),
          ),
        }),
      }),
    );
    expect(
      (await audit()).some((f) => /getting-started.*JSON-LD/.test(f)),
    ).toBe(true);
  });

  it("fails a build whose old root no longer answers at /getting-started/", async () => {
    await rm(join(dist, "getting-started"), { recursive: true });
    expect((await audit()).some((f) => /getting-started/.test(f))).toBe(true);
  });

  it("fails when shuding/nextra appears in any file", async () => {
    await write(dist, "_astro/old.js", "// https://github.com/shuding/nextra");
    expect((await audit()).some((f) => /shuding\/nextra/.test(f))).toBe(true);
  });

  it("fails a missing expected page file", async () => {
    await rm(join(dist, "faq"), { recursive: true });
    expect((await audit()).some((f) => /faq/.test(f))).toBe(true);
  });

  // llms.txt (D13, plan §4.8): the same 28 URLs as the sitemap, each with a title and the page's description.
  it("fails when llms.txt is missing", async () => {
    await rm(join(dist, "llms.txt"));
    expect((await audit()).some((f) => /llms\.txt/.test(f))).toBe(true);
  });

  it("fails an llms.txt that omits a page", async () => {
    await write(dist, "llms.txt", llmsTxt(PATHS.filter((p) => p !== "faq")));
    const failures = await audit();
    expect(
      failures.some((f) => /llms\.txt/.test(f) && f.includes(url("faq"))),
    ).toBe(true);
  });

  it("fails an llms.txt with a URL that is not one of the pages", async () => {
    await write(dist, "llms.txt", llmsTxt([...PATHS, "extra"]));
    expect(
      (await audit()).some(
        (f) => /llms\.txt/.test(f) && f.includes(url("extra")),
      ),
    ).toBe(true);
  });

  it("fails an llms.txt item with no description", async () => {
    const text = (await readFile(join(dist, "llms.txt"), "utf8")).replace(
      `: ${descriptionOf("faq")}`,
      "",
    );
    await write(dist, "llms.txt", text);
    expect((await audit()).some((f) => /llms\.txt.*faq/.test(f))).toBe(true);
  });

  it("fails an llms.txt item whose description is not the page's own", async () => {
    const text = (await readFile(join(dist, "llms.txt"), "utf8")).replace(
      descriptionOf("faq"),
      "Something else.",
    );
    await write(dist, "llms.txt", text);
    expect((await audit()).some((f) => /llms\.txt.*faq/.test(f))).toBe(true);
  });

  it("fails an llms.txt without the H1 the format requires", async () => {
    const text = (await readFile(join(dist, "llms.txt"), "utf8")).replace(
      /^# .*\n/,
      "",
    );
    await write(dist, "llms.txt", text);
    expect((await audit()).some((f) => /llms\.txt.*H1/.test(f))).toBe(true);
  });

  // Last updated (D11): the page's <time> equals the independently computed date.
  it("fails a page whose last-updated date differs from the expected date", async () => {
    await write(
      dist,
      htmlPath("faq"),
      page("faq", { time: "2026-11-03T22:00:00.000Z" }),
    );
    const failures = await audit();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/faq.*2026-11-03.*2026-11-04/);
  });

  it("fails a page with no last-updated date", async () => {
    await write(dist, htmlPath("faq"), page("faq", { updated: "" }));
    const failures = await audit();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/faq.*last updated/i);
  });

  // No "Edit page" link anywhere (the user, 2026-11-04: "What do we need a useless edit link for?").
  it("fails a page that carries an edit link to GitHub", async () => {
    await write(dist, htmlPath("faq"), page("faq", { edit: EDIT_LINK }));
    const failures = await audit();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/faq.*edit link/i);
  });

  it("fails a landing that carries an edit link to GitHub", async () => {
    await write(dist, htmlPath(""), page("", { edit: EDIT_LINK }));
    const failures = await audit();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^\/ \(root\).*edit link/i);
  });

  it("does not take a link to a GitHub file for an edit link", async () => {
    await write(
      dist,
      htmlPath("faq"),
      page("faq", {
        body: '<a href="https://github.com/northguild/worktree/blob/main/README.md">README</a>',
      }),
    );
    expect(await audit()).toEqual([]);
  });

  // Phase 15 (the user, 2026-11-04): "ditch the footer" on the landing. The root is still one of the 28 pages, so
  // the date rule turns around there: the footer that carried it is gone.

  it("fails a landing that carries a last-updated date", async () => {
    await write(
      dist,
      htmlPath(""),
      page("", {
        updated: `<p>Last updated: <time datetime="${DATE}T10:00:00.000Z">Nov 4, 2026</time></p>`,
      }),
    );
    const failures = await audit();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^\/ \(root\).*last updated/i);
  });

  it("fails a landing that carries the project footer", async () => {
    await write(dist, htmlPath(""), page("", { footer: PROJECT_FOOTER }));
    const failures = await audit();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^\/ \(root\).*footer/i);
  });

  it("fails a page that carries the project footer", async () => {
    await write(dist, htmlPath("faq"), page("faq", { footer: PROJECT_FOOTER }));
    const failures = await audit();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/faq.*project footer/i);
  });

  it("fails a page that lists the maintainers, whatever the block is called", async () => {
    await write(dist, htmlPath("faq"), page("faq", { footer: MAINTAINERS }));
    const failures = await audit();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/faq.*project footer/i);
  });

  it("fails a page with the footer's CLI version line", async () => {
    await write(
      dist,
      htmlPath("faq"),
      page("faq", { footer: "<div>CLI Version: v2.1.2</div>" }),
    );
    const failures = await audit();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/faq.*project footer/i);
  });

  // Phase 15 (the user, 2026-11-04): "skip the install button, install and where to next parts in the front page. Just
  // keep the hero with one getting started button". The removed parts were a second hero action and two `##` sections.
  it("fails a landing with a second action beside Get started", async () => {
    await write(
      dist,
      htmlPath(""),
      page("", {
        body: '<a href="#install" class="sl-link-button secondary">Install</a>',
      }),
    );
    const failures = await audit();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^\/ \(root\).*2 actions/);
  });

  // The user, 2026-11-08: "we are missing an 'Ask Dox' button in the landing page"; #309 D2 makes it a link to /dox/.
  it("fails a landing with no Ask Dox link", async () => {
    await rewrite("", (html) => html.replace(ASK_DOX, ""));
    expect(await audit()).toEqual([
      '/ (root): the landing has 0 "Ask Dox" links to /worktree/dox/, expected 1',
    ]);
  });

  it("fails an Ask Dox link that goes elsewhere", async () => {
    await rewrite("", (html) =>
      html.replace(
        ASK_DOX,
        ASK_DOX.replace("/worktree/dox/", "/worktree/faq/"),
      ),
    );
    expect(await audit()).toEqual([
      '/ (root): the landing has 0 "Ask Dox" links to /worktree/dox/, expected 1',
    ]);
  });

  it("fails two Ask Dox links", async () => {
    await rewrite("", (html) => html.replace(ASK_DOX, ASK_DOX + ASK_DOX));
    expect(await audit()).toEqual([
      '/ (root): the landing has 2 "Ask Dox" links to /worktree/dox/, expected 1',
    ]);
  });

  it("fails an Ask Dox that is a button, whose drawer is gone", async () => {
    await rewrite("", (html) =>
      html.replace(
        ASK_DOX,
        ASK_DOX + '<button type="button" class="ask-dox">Ask Dox</button>',
      ),
    );
    expect(await audit()).toEqual([
      '/ (root): "Ask Dox" is a button; it must be a link to /worktree/dox/',
    ]);
  });

  it("fails a landing that has sections below the hero again", async () => {
    await write(
      dist,
      htmlPath(""),
      page("", { body: '<h2 id="install">Install</h2>' }),
    );
    const failures = await audit();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/^\/ \(root\).*section/);
  });

  // Phase 15: the header and the footer each draw the NorthGuild mark, whose gradients are found by id; HTML requires
  // an id to be unique in its document (HTML Living Standard, "the id attribute").
  it("fails a page with the same id twice", async () => {
    await write(
      dist,
      htmlPath("faq"),
      page("faq", {
        body: '<svg aria-hidden="true"><linearGradient id="ng-mark-pane"></linearGradient></svg><svg aria-hidden="true"><linearGradient id="ng-mark-pane"></linearGradient></svg>',
      }),
    );
    const failures = await audit();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/faq.*id "ng-mark-pane".*2 times/);
  });

  // Phase 15 (the user, 2026-11-04): "let's stick to the version [of the logo] in the header". The second version
  // was the GitHub avatar of the northguild organisation, github.com/northguild.png, in the footer.
  it("fails a page that shows the organisation's GitHub avatar as a second logo", async () => {
    await write(
      dist,
      htmlPath("faq"),
      page("faq", {
        footer: `<div><img src="https://github.com/northguild.png?size=64" alt="northguild"></div>`,
      }),
    );
    const failures = await audit();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/faq.*github\.com\/northguild\.png/);
  });

  it("does not take a maintainer's avatar for the organisation's", async () => {
    await write(
      dist,
      htmlPath("faq"),
      page("faq", {
        body: `<p><img src="https://github.com/baldurpan.png?size=64" alt="Baldur"></p>`,
      }),
    );
    expect(await audit()).toEqual([]);
  });

  it("does not require a date on 404.html (it is not one of the 28 pages)", async () => {
    // beforeEach's 404.html has none, and the compliant site passes.
    expect(await audit()).toEqual([]);
  });

  describe("accessible names", () => {
    // The control under test beside a search button, which a page always has.
    const withControls = (path, controls) =>
      write(
        dist,
        htmlPath(path),
        page(path, {
          controls: `${SEARCH_BUTTON}${THEME_SELECT}${controls}`,
        }),
      );

    it("fails an icon-only button with no accessible name, naming the page", async () => {
      await withControls(
        "faq",
        '<button class="x"><svg aria-hidden="true"></svg></button>',
      );
      const failures = await audit();
      expect(failures).toHaveLength(1);
      expect(failures[0]).toMatch(/faq.*button.*accessible name/);
    });

    it("fails an empty aria-label, which names nothing", async () => {
      await withControls(
        "faq",
        '<button aria-label=""><svg aria-hidden="true"></svg></button>',
      );
      expect((await audit()).some((f) => /faq.*accessible name/.test(f))).toBe(
        true,
      );
    });

    it("accepts a name from visible text, aria-labelledby, aria-label or title", async () => {
      await withControls(
        "faq",
        '<button>Cancel</button><button aria-labelledby="a"><svg aria-hidden="true"></svg></button><button aria-label="Close"><svg aria-hidden="true"></svg></button><button title="Copy"><div></div></button>',
      );
      expect(await audit()).toEqual([]);
    });

    it("fails an icon-only button on 404.html too", async () => {
      await write(
        dist,
        "404.html",
        notFoundPage({ controls: "<button><svg></svg></button>" }),
      );
      expect((await audit()).some((f) => /404.*accessible name/.test(f))).toBe(
        true,
      );
    });

    // WCAG 2.5.3 Label in Name: the accessible name contains the visible label text.
    it("fails a button whose aria-label leaves out its visible text", async () => {
      await withControls("faq", '<button aria-label="Go">Search docs</button>');
      expect((await audit()).some((f) => /faq.*Search docs/.test(f))).toBe(
        true,
      );
    });

    it("accepts an aria-label that contains its visible text, in any case", async () => {
      await withControls(
        "faq",
        '<button aria-label="Open the Search dialog">search</button>',
      );
      expect(await audit()).toEqual([]);
    });

    it("does not count screen-reader-only or shortcut-hint text as the visible label", async () => {
      await withControls(
        "faq",
        '<button aria-label="Search"><span class="sr-only">Find</span><kbd>Ctrl</kbd></button>',
      );
      expect(await audit()).toEqual([]);
    });

    it("fails a select with no label", async () => {
      await withControls("faq", "<select><option>a</option></select>");
      expect((await audit()).some((f) => /faq.*select/.test(f))).toBe(true);
    });

    it("fails a page with no search button", async () => {
      await write(
        dist,
        htmlPath("faq"),
        page("faq", { controls: MENU_BUTTON }),
      );
      expect((await audit()).some((f) => /faq.*search/i.test(f))).toBe(true);
    });
  });

  describe("package-manager tabs", () => {
    // The entrance's keyframes stay, so only the tab rule is under test.
    const css = (rule) =>
      write(dist, "_astro/common.abc.css", `${rule}${ENTRANCE_CSS}`);

    it("fails a build with no tab rule", async () => {
      await css(".other{min-block-size:44px}");
      expect((await audit()).some((f) => /tab/i.test(f))).toBe(true);
    });

    it("fails a tab rule shorter than 44px, and passes 44px, 2.75rem and a longer one", async () => {
      await css(".tab>[role=tab]{min-block-size:43px}");
      expect((await audit()).some((f) => /tab.*43/i.test(f))).toBe(true);
      await css('.tab>[role="tab"]{min-height:44px}');
      expect(await audit()).toEqual([]);
      await css(".tab>[role=tab]{min-block-size:2.75rem}");
      expect(await audit()).toEqual([]);
      await css(".tab>[role=tab]{min-block-size:3rem}");
      expect(await audit()).toEqual([]);
    });

    it("fails a tab rule that sets no minimum height", async () => {
      await css(".tab>[role=tab]{padding:.275rem 1.25rem}");
      expect((await audit()).some((f) => /tab/i.test(f))).toBe(true);
    });
  });

  describe("404.html", () => {
    const notFound = (overrides) =>
      write(dist, "404.html", notFoundPage(overrides));

    it("fails a 404 with a canonical link to a page that does not exist", async () => {
      await notFound({
        head: '<link rel="canonical" href="https://northguild.dev/worktree/404/"/>',
      });
      expect((await audit()).some((f) => /404.*canonical/.test(f))).toBe(true);
    });

    it("fails a 404 carrying JSON-LD, a BreadcrumbList above all", async () => {
      await notFound({
        head: '<script type="application/ld+json">{"@type":"BreadcrumbList"}</script>',
      });
      expect((await audit()).some((f) => /404.*JSON-LD/.test(f))).toBe(true);
    });

    it("fails a 404 with no link to Getting Started", async () => {
      await notFound({ link: '<a href="/worktree/faq/">FAQ</a>' });
      expect((await audit()).some((f) => /404.*Getting Started/.test(f))).toBe(
        true,
      );
    });

    it("fails a 404 whose Getting Started link goes elsewhere", async () => {
      await notFound({ link: '<a href="/worktree/faq/">Getting Started</a>' });
      expect((await audit()).some((f) => /404.*Getting Started/.test(f))).toBe(
        true,
      );
    });

    it("fails a 404 with no search", async () => {
      await notFound({ controls: MENU_BUTTON });
      expect((await audit()).some((f) => /404.*search/i.test(f))).toBe(true);
    });
  });
});

// The preview's size comes from the file's own header: PNG spec §11.2.2 (IHDR) and ITU T.81 §B.2.2 (SOF), built above.
describe("imageSize", () => {
  it("reads a PNG's IHDR", () => {
    expect(imageSize(png(1200, 630))).toEqual({
      type: "image/png",
      width: 1200,
      height: 630,
    });
  });

  it("reads a JPEG's frame header after the segments and fill bytes before it", () => {
    expect(imageSize(jpeg(1200, 630))).toEqual({
      type: "image/jpeg",
      width: 1200,
      height: 630,
    });
  });

  it("does not take a JPEG's Huffman table (DHT, FFC4) for its frame", () => {
    const dht = [0xff, 0xc4, 0x00, 0x05, 0x00, 0x00, 0x00];
    const bytes = jpeg(1200, 630);
    const withTable = Buffer.concat([
      bytes.subarray(0, 2),
      Buffer.from(dht),
      bytes.subarray(2),
    ]);
    expect(imageSize(withTable)).toEqual({
      type: "image/jpeg",
      width: 1200,
      height: 630,
    });
  });

  it("is undefined for a PNG cut short before its size", () => {
    expect(imageSize(png(1200, 630).subarray(0, 20))).toBeUndefined();
  });

  it("is undefined for anything else", () => {
    expect(imageSize(Buffer.from("GIF89a and more bytes"))).toBeUndefined();
  });
});

// The oracle for a page's date (D11): `git log --follow -1`, as a UTC calendar date because Starlight renders
// the date in UTC. Each expected value is worked out by hand from the commit dates set here.
describe("followDate", () => {
  let repo;
  const git = (args, date) =>
    execFileSync(
      "git",
      ["-c", "user.name=t", "-c", "user.email=t@t", ...args],
      {
        cwd: repo,
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: date,
          GIT_COMMITTER_DATE: date,
        },
        encoding: "utf8",
      },
    );
  const commit = (message, date) => git(["commit", "-qm", message], date);

  beforeEach(async () => {
    repo = await mkdtemp(join(tmpdir(), "follow-date-"));
    git(["init", "-q"], "2026-01-05T10:00:00Z");
    await mkdir(join(repo, "old"));
    await writeFile(join(repo, "old/p.md"), "one\ntwo\nthree\nfour\n");
    git(["add", "."], "2026-01-05T10:00:00Z");
    commit("add", "2026-01-05T10:00:00Z");
  });

  afterEach(async () => {
    await rm(repo, { recursive: true, force: true });
  });

  it("is the commit date of an untouched file", () => {
    expect(followDate(repo, "old/p.md")).toBe("2026-01-05");
  });

  it("follows a rename: a later edit at the new path is the latest change", async () => {
    await mkdir(join(repo, "new"));
    git(["mv", "old/p.md", "new/p.md"], "2026-02-01T10:00:00Z");
    commit("move", "2026-02-01T10:00:00Z");
    await writeFile(join(repo, "new/p.md"), "one\ntwo\nthree\nfour\nfive\n");
    git(["add", "."], "2026-03-09T10:00:00Z");
    commit("edit", "2026-03-09T10:00:00Z");
    expect(followDate(repo, "new/p.md")).toBe("2026-03-09");
  });

  it("is the rename commit's date when nothing changed after a pure rename", async () => {
    // Q9: git itself lists a pure rename as the newest change to the new path, with or without --follow.
    await mkdir(join(repo, "new"));
    git(["mv", "old/p.md", "new/p.md"], "2026-02-01T10:00:00Z");
    commit("move", "2026-02-01T10:00:00Z");
    expect(followDate(repo, "new/p.md")).toBe("2026-02-01");
  });

  it("reports the UTC date, not the committer's local one", async () => {
    // 23:30 at UTC-05:00 on 5 March is 04:30 UTC on 6 March; %cs would say 03-05.
    await writeFile(join(repo, "old/p.md"), "one\nTWO\nthree\nfour\n");
    git(["add", "."], "2026-03-05T23:30:00-05:00");
    commit("late edit", "2026-03-05T23:30:00-05:00");
    expect(followDate(repo, "old/p.md")).toBe("2026-03-06");
  });
});

describe("sourcePathOf", () => {
  let content;
  beforeEach(async () => {
    content = await mkdtemp(join(tmpdir(), "content-"));
    await write(content, "index.mdx", "");
    await write(content, "faq.mdx", "");
    await write(content, "commands/index.mdx", "");
    await write(content, "commands/branch.mdx", "");
  });
  afterEach(async () => {
    await rm(content, { recursive: true, force: true });
  });

  it.each([
    ["", "index.mdx"],
    ["faq", "faq.mdx"],
    ["commands", "commands/index.mdx"],
    ["commands/branch", "commands/branch.mdx"],
  ])("maps the page %j to %s", (path, expected) => {
    expect(sourcePathOf(path, content)).toBe(expected);
  });

  it("returns undefined for a page with no source file", () => {
    expect(sourcePathOf("nowhere", content)).toBeUndefined();
  });
});

// Phase 13. The header's expected links come from D17 (the mark and "NorthGuild" to https://northguild.dev/, "worktree" to
// /worktree/) and from northguild.dev's Header.astro at ade22a5 (the GitHub and Discord hrefs, the new-tab wording). That a
// name contains the visible text is WCAG 2.2 SC 2.5.3; that a control has a name at all is SC 4.1.2.
describe("the theme toggle (#266)", () => {
  // The header carries a toggle of its own, so a page "with no theme select" has neither it nor the menu's.
  const withControls = async (path, controls) => {
    await write(
      dist,
      htmlPath(path),
      page(path, {
        controls,
        header: controls.includes("starlight-theme-select")
          ? HEADER
          : header({ theme: "" }),
      }),
    );
    return audit();
  };
  const withProvider = async (provider) => {
    await write(dist, htmlPath("faq"), page("faq", { provider }));
    return audit();
  };
  const without = (html) => CONTROLS.replace(THEME_SELECT, html);

  it("passes a named button in the starlight-theme-select and an inline provider", async () => {
    expect(await audit()).toEqual([]);
  });

  it("fails a page with no starlight-theme-select", async () => {
    const failures = await withControls("faq", without(""));
    expect(failures.some((f) => /faq.*0 starlight-theme-select/.test(f))).toBe(
      true,
    );
  });

  // Starlight renders ThemeSelect in the header and again in the mobile menu, so two on a page is what the build has.
  it("passes the header's and the mobile menu's theme select together", async () => {
    expect(
      await withControls("faq", without(THEME_SELECT + THEME_SELECT)),
    ).toEqual([]);
  });

  it("fails the second theme select when it is the one without a button", async () => {
    const failures = await withControls(
      "faq",
      without(
        `${THEME_SELECT}<starlight-theme-select></starlight-theme-select>`,
      ),
    );
    expect(failures.some((f) => /faq.*0 <button>/.test(f))).toBe(true);
  });

  it("fails a theme select that holds a <select>, as Starlight's own does", async () => {
    const failures = await withControls(
      "faq",
      without(
        '<starlight-theme-select><label><span class="sr-only">Select theme</span><select><option>Dark</option></select></label></starlight-theme-select>',
      ),
    );
    expect(failures.some((f) => /faq.*<select>/.test(f))).toBe(true);
  });

  it("fails a theme select with no button", async () => {
    const failures = await withControls(
      "faq",
      without("<starlight-theme-select></starlight-theme-select>"),
    );
    expect(failures.some((f) => /faq.*0 <button>/.test(f))).toBe(true);
  });

  it("fails a theme select with two buttons", async () => {
    const button = THEME_SELECT.replace(/<\/?starlight-theme-select>/g, "");
    const failures = await withControls(
      "faq",
      without(
        `<starlight-theme-select>${button}${button}</starlight-theme-select>`,
      ),
    );
    expect(failures.some((f) => /faq.*2 <button>/.test(f))).toBe(true);
  });

  it("fails a theme button with no accessible name", async () => {
    const failures = await withControls(
      "faq",
      without(
        '<starlight-theme-select><button type="button"><svg aria-hidden="true"></svg></button></starlight-theme-select>',
      ),
    );
    expect(failures.some((f) => /faq.*no accessible name/.test(f))).toBe(true);
  });

  it("fails the 404 on the same rules", async () => {
    await write(
      dist,
      "404.html",
      notFoundPage({ controls: without(""), header: header({ theme: "" }) }),
    );
    expect(
      (await audit()).some((f) =>
        /404\.html.*0 starlight-theme-select/.test(f),
      ),
    ).toBe(true);
  });

  it("fails a page whose provider script is missing from the head", async () => {
    const failures = await withProvider("");
    expect(failures.some((f) => /faq.*theme provider/.test(f))).toBe(true);
  });

  it("fails a provider loaded as an external script rather than inline", async () => {
    const failures = await withProvider(
      '<script src="/worktree/_astro/provider.abc.js"></script>',
    );
    expect(failures.some((f) => /faq.*theme provider/.test(f))).toBe(true);
  });

  it("fails a provider that only appears in the body, after first paint", async () => {
    await write(
      dist,
      htmlPath("faq"),
      page("faq", { provider: "", body: THEME_PROVIDER }),
    );
    expect((await audit()).some((f) => /faq.*theme provider/.test(f))).toBe(
      true,
    );
  });

  // Shaped like Starlight 0.42.8's own ThemeProvider.astro:7-31: defines window.StarlightThemeProvider and updates a
  // <select> through picker.querySelector('select'), not a button. A build that lost the override has this.
  it("fails Starlight's own provider, which updates a select and not the toggle", async () => {
    const failures = await withProvider(
      "<script>window.StarlightThemeProvider = (() => { const storedTheme = localStorage.getItem('starlight-theme'); return { updatePickers(theme) { document.querySelectorAll('starlight-theme-select').forEach((picker) => { const select = picker.querySelector('select'); if (select) select.value = theme; }); } }; })();</script>",
    );
    expect(failures.some((f) => /faq.*theme provider/.test(f))).toBe(true);
  });

  // D2: the key is Starlight's `starlight-theme`; another key would reset every returning visitor's choice.
  it("fails a provider that reads another storage key", async () => {
    const failures = await withProvider(
      THEME_PROVIDER.replace("'starlight-theme'", "'theme'"),
    );
    expect(failures.some((f) => /faq.*theme provider/.test(f))).toBe(true);
  });

  it("fails the 404 when its provider is not inline in the head", async () => {
    await write(dist, "404.html", notFoundPage({ provider: "" }));
    expect(
      (await audit()).some((f) => /404\.html.*theme provider/.test(f)),
    ).toBe(true);
  });
});

describe("the product header", () => {
  const withHeader = async (html) => {
    await write(dist, htmlPath("faq"), page("faq", { header: html }));
    return audit();
  };

  it("passes the header northguild.dev's design asks for", async () => {
    expect(await withHeader(HEADER)).toEqual([]);
  });

  it("fails a page with no header", async () => {
    const failures = await withHeader("");
    expect(failures.some((f) => /faq.*no <header>/.test(f))).toBe(true);
  });

  it("fails when the NorthGuild link is missing or goes anywhere but the apex", async () => {
    let failures = await withHeader(header({ northguild: "" }));
    expect(
      failures.some((f) => /0 links to https:\/\/northguild\.dev\//.test(f)),
    ).toBe(true);
    failures = await withHeader(
      header({
        northguild: NORTHGUILD_LINK.replace(
          'href="https://northguild.dev/"',
          'href="https://northguild.dev/gmt/"',
        ),
      }),
    );
    expect(
      failures.some((f) => /0 links to https:\/\/northguild\.dev\//.test(f)),
    ).toBe(true);
  });

  it('fails a NorthGuild link whose text is not "NorthGuild"', async () => {
    const failures = await withHeader(
      header({
        northguild: NORTHGUILD_LINK.replace("NorthGuild</span>", "Home</span>"),
      }),
    );
    expect(
      failures.some((f) => /reads "Home", expected "NorthGuild"/.test(f)),
    ).toBe(true);
  });

  it("fails when worktree does not link to the site's home, or its text differs", async () => {
    let failures = await withHeader(
      header({ product: '<a href="/worktree/faq/">worktree</a>' }),
    );
    expect(failures.some((f) => /0 links to \/worktree\//.test(f))).toBe(true);
    failures = await withHeader(
      header({ product: '<a href="/worktree/">docs</a>' }),
    );
    expect(
      failures.some((f) => /reads "docs", expected "worktree"/.test(f)),
    ).toBe(true);
  });

  it("fails a second link to the same place (two names for one target)", async () => {
    const failures = await withHeader(
      header({ product: `${PRODUCT_LINK}${PRODUCT_LINK}` }),
    );
    expect(failures.some((f) => /2 links to \/worktree\//.test(f))).toBe(true);
  });

  it("fails a link whose aria-label leaves out its visible text (WCAG 2.5.3)", async () => {
    const failures = await withHeader(
      header({
        product: '<a href="/worktree/" aria-label="Home page">worktree</a>',
      }),
    );
    expect(
      failures.some((f) =>
        /"worktree".*does not contain its visible text/.test(f),
      ),
    ).toBe(true);
  });

  it("accepts an aria-label that contains the visible text", async () => {
    expect(
      await withHeader(
        header({
          product:
            '<a href="/worktree/" aria-label="worktree docs home">worktree</a>',
        }),
      ),
    ).toEqual([]);
  });

  it("fails a community link missing, unnamed or without the new-tab wording", async () => {
    let failures = await withHeader(header({ github: "" }));
    expect(
      failures.some((f) =>
        /0 links to https:\/\/github\.com\/northguild/.test(f),
      ),
    ).toBe(true);
    failures = await withHeader(
      header({
        discord:
          '<a target="_blank" rel="noopener" href="https://discord.gg/TdvQdP3t5a"><svg aria-hidden="true"></svg></a>',
      }),
    );
    expect(failures.some((f) => /Discord link is named ""/.test(f))).toBe(true);
    failures = await withHeader(
      header({ github: GITHUB_LINK.replace(" (opens in a new tab)", "") }),
    );
    expect(
      failures.some((f) =>
        /GitHub link is named "NorthGuild on GitHub"/.test(f),
      ),
    ).toBe(true);
  });

  it("fails a community link that does not open in a new tab, or has no rel=noopener", async () => {
    let failures = await withHeader(
      header({
        github: community(
          "https://github.com/northguild",
          "GitHub",
          'rel="noopener"',
        ),
      }),
    );
    expect(
      failures.some((f) => /GitHub link does not open in a new tab/.test(f)),
    ).toBe(true);
    failures = await withHeader(
      header({
        github: community(
          "https://github.com/northguild",
          "GitHub",
          'target="_blank"',
        ),
      }),
    );
    expect(
      failures.some((f) => /GitHub link has no rel="noopener"/.test(f)),
    ).toBe(true);
  });

  // #266 phase 2, D5: the order theme, GitHub, Discord is the reading and keyboard order. The expected order is the
  // issue's acceptance criterion (the user: "theme, GitHub, Discord"), not anything the build was observed to emit.
  it("fails a header whose GitHub link comes before the theme toggle", async () => {
    const failures = await withHeader(
      `<header class="header"><div class="brand">${NORTHGUILD_LINK}${PRODUCT_LINK}</div>${GITHUB_LINK}${THEME_SELECT}${DISCORD_LINK}</header>`,
    );
    expect(
      failures.some((f) => /faq.*header:.*theme toggle.*GitHub/.test(f)),
    ).toBe(true);
  });

  it("fails a header whose Discord link comes before the GitHub link", async () => {
    const failures = await withHeader(
      `<header class="header"><div class="brand">${NORTHGUILD_LINK}${PRODUCT_LINK}</div>${THEME_SELECT}${DISCORD_LINK}${GITHUB_LINK}</header>`,
    );
    expect(failures.some((f) => /faq.*header:.*GitHub.*Discord/.test(f))).toBe(
      true,
    );
  });

  // The page-wide rule needs only one toggle (the mobile menu's counts); this one needs the header's own.
  it("fails a header with no theme toggle even when the page has one elsewhere", async () => {
    const failures = await withHeader(header({ theme: "" }));
    expect(failures.some((f) => /faq.*header:.*no theme toggle/.test(f))).toBe(
      true,
    );
  });

  it("checks the order on 404.html too", async () => {
    await write(
      dist,
      "404.html",
      notFoundPage({
        header: `<header class="header"><div class="brand">${NORTHGUILD_LINK}${PRODUCT_LINK}</div>${GITHUB_LINK}${THEME_SELECT}${DISCORD_LINK}</header>`,
      }),
    );
    expect(
      (await audit()).some((f) => /404\.html: header:.*theme toggle/.test(f)),
    ).toBe(true);
  });

  it("checks 404.html's header too", async () => {
    await write(
      dist,
      "404.html",
      notFoundPage({ header: header({ northguild: "" }) }),
    );
    expect((await audit()).some((f) => /404\.html: header:/.test(f))).toBe(
      true,
    );
  });
});

// #309 phase 4. Expected values: the phase's Done-when. On every built page and the 404 the header has one link to
// /worktree/dox/ named "Chat with Dox", ahead of the theme toggle (gmt's Header.astro lists Dox, theme, then GitHub and
// Discord); on /dox that link carries aria-current="page" and on no other page; where the page has a mobile menu, the
// menu has the same link before the social icons (gmt's MobileMenuFooter.astro). WCAG 2.2 SC 2.5.3 holds the name to
// the visible text (an icon has none, so the name is free), SC 1.4.1 is why the current page is told by an attribute.
describe("the Dox link (#309 phase 4)", () => {
  const withHeader = async (html, path = "faq") => {
    await write(dist, htmlPath(path), page(path, { header: html }));
    return audit();
  };

  it("passes the header and menu this phase builds, on every page, the 404 and /dox/", async () => {
    expect(await audit()).toEqual([]);
  });

  it("fails a header with no Dox link", async () => {
    const failures = await withHeader(header({ dox: "" }));
    expect(failures).toContain(
      "/faq/: header: 0 links to /worktree/dox/, expected exactly 1",
    );
  });

  it("fails a header with two Dox links", async () => {
    const failures = await withHeader(header({ dox: doxLink() + doxLink() }));
    expect(failures).toContain(
      "/faq/: header: 2 links to /worktree/dox/, expected exactly 1",
    );
  });

  it("fails a Dox link not named Chat with Dox", async () => {
    const failures = await withHeader(
      header({ dox: doxLink().replace("Chat with Dox", "Open chat") }),
    );
    expect(failures.some((f) => /faq.*header:.*Chat with Dox/.test(f))).toBe(
      true,
    );
  });

  it("fails a Dox link with no name at all", async () => {
    const failures = await withHeader(
      header({ dox: doxLink().replace(' aria-label="Chat with Dox"', "") }),
    );
    expect(failures.some((f) => /faq.*header:.*Chat with Dox/.test(f))).toBe(
      true,
    );
  });

  it("fails a Dox link that comes after the theme toggle", async () => {
    const failures = await withHeader(
      header({ dox: "" }).replace("</header>", `${doxLink()}</header>`),
    );
    expect(
      failures.some((f) => /faq.*header:.*Dox link.*theme toggle/.test(f)),
    ).toBe(true);
  });

  it("fails a Dox link that comes after GitHub, as the right group reads Dox first", async () => {
    const failures = await withHeader(
      `<header class="header"><div class="brand">${NORTHGUILD_LINK}${PRODUCT_LINK}</div>${GITHUB_LINK}${doxLink()}${THEME_SELECT}${DISCORD_LINK}</header>`,
    );
    expect(failures.some((f) => /faq.*header:.*Dox link/.test(f))).toBe(true);
  });

  it("fails a Dox link marked current off /dox/", async () => {
    const failures = await withHeader(header({ dox: doxLink(true) }));
    expect(
      failures.some((f) => /faq.*header:.*aria-current.*off \/dox\//.test(f)),
    ).toBe(true);
  });

  it("fails /dox/ when its Dox link is not marked current", async () => {
    await write(dist, "dox/index.html", doxPage({ header: header() }));
    expect(
      (await audit()).some((f) =>
        /^\/dox\/: header:.*aria-current="page"/.test(f),
      ),
    ).toBe(true);
  });

  it("fails the 404 with no Dox link", async () => {
    await write(
      dist,
      "404.html",
      notFoundPage({ header: header({ dox: "" }) }),
    );
    expect(
      (await audit()).some((f) => /404\.html: header:.*0 links/.test(f)),
    ).toBe(true);
  });

  it("fails the landing with no Dox link in its header", async () => {
    await write(
      dist,
      htmlPath(""),
      page("", { header: LANDING_HEADER.replace(doxLink(), "") }),
    );
    expect((await audit()).some((f) => /root.*header:.*0 links/.test(f))).toBe(
      true,
    );
  });

  describe("the mobile menu", () => {
    const withMenu = async (menu) => {
      await write(dist, htmlPath("faq"), page("faq", { menu }));
      return audit();
    };

    it("fails a menu with no Dox link", async () => {
      const failures = await withMenu(MOBILE_MENU.replace(doxLink(), ""));
      expect(failures).toContain(
        "/faq/: mobile menu: no link to /worktree/dox/",
      );
    });

    it("fails a menu whose Dox link is not named Chat with Dox", async () => {
      const failures = await withMenu(
        MOBILE_MENU.replace("Chat with Dox", "Dox"),
      );
      expect(
        failures.some((f) => /faq.*mobile menu:.*Chat with Dox/.test(f)),
      ).toBe(true);
    });

    it("fails a menu whose Dox link comes after the social icons", async () => {
      const failures = await withMenu(
        MOBILE_MENU.replace(doxLink(), "").replace(
          "</div></div>",
          `${doxLink()}</div></div>`,
        ),
      );
      expect(
        failures.some((f) =>
          /faq.*mobile menu:.*before the social icons/.test(f),
        ),
      ).toBe(true);
    });

    it("does not ask for a menu on a page that has none (the landing, the 404, /dox/)", async () => {
      expect(await audit()).toEqual([]);
    });
  });
});

describe("decorative graphics", () => {
  const withBody = async (body) => {
    await write(dist, htmlPath("faq"), page("faq", { body }));
    return audit();
  };

  it("fails an svg that is neither hidden nor a named image", async () => {
    const failures = await withBody("<svg viewBox='0 0 1 1'></svg>");
    expect(
      failures.some((f) => /faq.*<svg> is neither aria-hidden/.test(f)),
    ).toBe(true);
  });

  it("accepts a hidden svg, a named image, and one inside a hidden span", async () => {
    expect(
      await withBody(
        '<svg aria-hidden="true"></svg><svg role="img" aria-label="Twig"></svg><span aria-hidden="true"><svg></svg></span>',
      ),
    ).toEqual([]);
  });

  it("fails an image with role=img but no name", async () => {
    expect((await withBody('<svg role="img"></svg>')).length).toBeGreaterThan(
      0,
    );
  });

  it("checks the 404's graphic too", async () => {
    await write(
      dist,
      "404.html",
      notFoundPage({ heading: "<h1>fatal: no such branch</h1><svg></svg>" }),
    );
    expect((await audit()).some((f) => /404\.html.*<svg>/.test(f))).toBe(true);
  });
});

describe("the 404 speaks git", () => {
  it('fails a heading that is not a git error line ("fatal: ...")', async () => {
    await write(
      dist,
      "404.html",
      notFoundPage({ heading: "<h1>Page not found</h1>" }),
    );
    expect(
      (await audit()).some((f) => /404\.html.*git error line/.test(f)),
    ).toBe(true);
  });

  it("accepts a heading with markup inside it", async () => {
    await write(
      dist,
      "404.html",
      notFoundPage({
        heading: '<h1 id="_top">fatal: <span>no such branch</span></h1>',
      }),
    );
    expect(await audit()).toEqual([]);
  });
});

// "No cyan accent left" (D17). The five literals are those the vendored tokens give a --gmt-cyan* variable at ade22a5:
// tokens.css (dark) --gmt-cyan #22d3ee and --gmt-cyan-bright #67e8f9; tokens-light.css --gmt-cyan #0891b2,
// --gmt-cyan-bright #0e7490 and --gmt-cyan-ink #045268. The rest of each case is the rule written in the audit's header: a
// declaration naming cyan is a finding only when it is the cascade winner and something uses it.
describe("no cyan accent left", () => {
  const sheet = (css) => write(dist, "_astro/theme.abc.css", css);
  const used = (selector = "a") =>
    write(
      dist,
      "index.html",
      page("", { body: `<div class="${selector.replace(/^\./, "")}"></div>` }),
    );
  const findings = () => cyanFindings(dist);

  it("takes its literals from the vendored tokens", () => {
    expect([...cyanLiterals()].sort()).toEqual([
      "045268",
      "0891b2",
      "0e7490",
      "22d3ee",
      "67e8f9",
    ]);
  });

  it.each([
    ["var(--gmt-cyan)", true],
    ["var( --gmt-cyan-ink )", true],
    ["#22d3ee", true],
    ["#22D3EE", true],
    ["#22d3ee2e", true], // the same colour with an alpha byte, as a minifier writes rgba(34,211,238,.18)
    ["rgb(34 211 238 / 8%)", true],
    ["rgba(34, 211, 238, .18)", true],
    ["rgb(8,145,178)", true], // 0891b2
    ["color(from var(--gmt-cyan) srgb r g b / .2)", true],
    ["var(--gmt-spring)", false],
    ["#4ade80", false],
    ["#22d3e0", false],
    ["rgb(74 222 128)", false],
  ])("reads %s as cyan: %s", (value, expected) => {
    expect(namesCyan(value, cyanLiterals())).toBe(expected);
  });

  it("passes a build with no cyan", async () => {
    await sheet(
      "a{color:var(--gmt-spring-ink)}:root{--gmt-border:color(from var(--gmt-spring) srgb r g b/.18)}",
    );
    expect(await findings()).toEqual([]);
  });

  it("fails a rule the pages use that reads a cyan variable or a cyan literal", async () => {
    await sheet("a{color:var(--gmt-cyan)}");
    expect(await findings()).toHaveLength(1);
    await sheet("a{border-color:#22d3ee}");
    expect(await findings()).toHaveLength(1);
  });

  it("does not count the --gmt-cyan* definitions", async () => {
    await sheet(
      ":root{--gmt-cyan:#22d3ee;--gmt-cyan-bright:#67e8f9;--gmt-cyan-ink:var(--gmt-cyan)}[data-theme=light]{--gmt-cyan:#0891b2}",
    );
    expect(await findings()).toEqual([]);
  });

  it("does not count a vendored cyan value that a later declaration overrides", async () => {
    await sheet(
      "a{color:var(--gmt-hairline)}:root{--gmt-hairline:rgba(34,211,238,.18)}:root{--gmt-hairline:color-mix(in srgb,var(--gmt-spring) 18%,transparent)}",
    );
    expect(await findings()).toEqual([]);
  });

  it("counts a custom property a used rule reads, directly or through another", async () => {
    await sheet(
      "a{color:var(--b)}:root{--b:var(--a)}:root{--a:rgba(34,211,238,.18)}",
    );
    expect(await findings()).toHaveLength(1);
  });

  it("does not count a custom property nothing reads", async () => {
    await sheet(":root{--gmt-series-1-wash:rgba(34,211,238,.18)}");
    expect(await findings()).toEqual([]);
  });

  it("counts a light-theme cyan value when it comes after the :root override, not before it", async () => {
    // :root and [data-theme=light] have equal specificity, so the later one wins in the light theme.
    await sheet(
      "a{color:var(--x)}[data-theme=light]{--x:#0891b2}:root{--x:var(--gmt-spring)}",
    );
    expect(await findings()).toEqual([]);
    await sheet(
      "a{color:var(--x)}:root{--x:var(--gmt-spring)}[data-theme=light]{--x:#0891b2}",
    );
    expect(await findings()).toHaveLength(1);
  });

  it("ignores a rule for a class no page or script uses (the vendored widgets)", async () => {
    await sheet(".gmt-field{border-color:var(--gmt-cyan)}");
    expect(await findings()).toEqual([]);
    await used(".gmt-field");
    expect(await findings()).toHaveLength(1);
  });

  it("reads a class used only by a script as used", async () => {
    await sheet(".widget-xyz{color:#67e8f9}");
    expect(await findings()).toEqual([]);
    await write(dist, "_astro/page.abc.js", "el.className='widget-xyz';");
    expect(await findings()).toHaveLength(1);
  });

  it("counts a keyframe only when a used rule names it", async () => {
    await sheet("@keyframes ping{from{box-shadow:0 0 0 2px var(--gmt-cyan)}}");
    expect(await findings()).toEqual([]);
    await sheet(
      "@keyframes ping{from{box-shadow:0 0 0 2px var(--gmt-cyan)}}a{animation:ping 1s}",
    );
    expect(await findings()).toHaveLength(1);
  });

  it("looks inside at-rules and inline styles", async () => {
    await sheet("@media (min-width:50rem){a{color:var(--gmt-cyan)}}");
    expect(await findings()).toHaveLength(1);
    await sheet("");
    await write(
      dist,
      "index.html",
      page("", { body: '<p style="color:#22d3ee">x</p>' }),
    );
    expect(await findings()).toHaveLength(1);
  });

  it("fails cyan in the HTML text or in a script", async () => {
    await write(
      dist,
      "index.html",
      page("", {
        body: '<svg aria-hidden="true"><path stroke="#67e8f9"/></svg>',
      }),
    );
    expect((await findings()).some((f) => /HTML names cyan/.test(f))).toBe(
      true,
    );
    await write(dist, "index.html", page(""));
    await write(dist, "_astro/page.abc.js", "const c='var(--gmt-cyan)';");
    expect((await findings()).some((f) => /script names cyan/.test(f))).toBe(
      true,
    );
  });

  it("is part of the audit", async () => {
    await sheet("a{color:var(--gmt-cyan)}");
    expect((await audit()).some((f) => /uses cyan/.test(f))).toBe(true);
  });
});

// Phase 16 (D18). Expected values: the root alone loads the hero loader, no page (the 404 included) loads the effect up
// front, the loader is at most 2 KB gzipped and the loader's whole import tree at most 32 KB gzipped, and on the landing
// the still SVG and the canvas are hidden from assistive technology.
describe("the leaf-particle hero", () => {
  const LOADER_BUDGET = 2 * 1024;
  const EFFECT_BUDGET = 32 * 1024;
  const gzipBytes = (buffer) => gzipSync(buffer, { level: 9 }).length;
  // Random bytes do not compress, so a file of n of them is about n gzipped.
  const incompressible = (n) => randomBytes(n);
  const heroFailures = async () =>
    (await audit()).filter((f) => /hero|canvas/i.test(f));

  it("passes the fixture, whose loader is tiny and imports the effect dynamically", async () => {
    expect(await heroFailures()).toEqual([]);
  });

  it("fails a landing that does not load the hero loader", async () => {
    await write(dist, htmlPath(""), page("", { heroScript: "" }));
    expect((await heroFailures()).some((f) => /loader/.test(f))).toBe(true);
  });

  it.each([
    "faq",
    "commands/branch",
  ])("fails %s loading the hero loader", async (path) => {
    await rewrite(path, (html) =>
      html.replace("</head>", `${HERO_SCRIPT}</head>`),
    );
    const failures = await heroFailures();
    expect(
      failures.some(
        (f) => f.includes(`/${path}/`) && /only the landing/.test(f),
      ),
    ).toBe(true);
  });

  it("fails the 404 loading the hero loader", async () => {
    await write(dist, "404.html", notFoundPage({ head: HERO_SCRIPT }));
    expect(
      (await heroFailures()).some(
        (f) => f.startsWith("404.html") && /only the landing/.test(f),
      ),
    ).toBe(true);
  });

  it("fails a page that loads the effect chunk with a script tag", async () => {
    await rewrite("faq", (html) =>
      html.replace(
        "</head>",
        '<script type="module" src="/worktree/_astro/particles.jkl.js"></script></head>',
      ),
    );
    expect((await heroFailures()).some((f) => /effect up front/.test(f))).toBe(
      true,
    );
  });

  it("fails the 404 preloading the effect chunk", async () => {
    await write(
      dist,
      "404.html",
      notFoundPage({
        head: '<link rel="modulepreload" href="/worktree/_astro/particles.jkl.js">',
      }),
    );
    expect(
      (await heroFailures()).some(
        (f) => f.startsWith("404.html") && /effect up front/.test(f),
      ),
    ).toBe(true);
  });

  it("fails a loader that imports the effect statically", async () => {
    await write(
      dist,
      "_astro/HeroLeaves.ghi.js",
      'import"./particles.jkl.js";',
    );
    expect((await heroFailures()).some((f) => /effect up front/.test(f))).toBe(
      true,
    );
  });

  it("fails a loader with no dynamic import of the effect", async () => {
    await write(dist, "_astro/HeroLeaves.ghi.js", "console.log(1);");
    expect(
      (await heroFailures()).some((f) => /no dynamic import/.test(f)),
    ).toBe(true);
  });

  it("fails a loader over 2 KB gzipped", async () => {
    await write(
      dist,
      "_astro/HeroLeaves.ghi.js",
      Buffer.concat([
        Buffer.from('import("./particles.jkl.js");//'),
        incompressible(LOADER_BUDGET + 500),
      ]),
    );
    expect(
      (await heroFailures()).some((f) => /loader is \d+ B gzipped/.test(f)),
    ).toBe(true);
  });

  it("counts the loader's own static imports against its 2 KB", async () => {
    await write(
      dist,
      "_astro/HeroLeaves.ghi.js",
      'import{t as e}from"./preload-helper.pqr.js";e(()=>import(`./particles.jkl.js`),[]);',
    );
    await write(
      dist,
      "_astro/preload-helper.pqr.js",
      incompressible(LOADER_BUDGET + 500),
    );
    expect(
      (await heroFailures()).some((f) => /loader is \d+ B gzipped/.test(f)),
    ).toBe(true);
  });

  it("reads the bundler's wrapped dynamic import, quoted with backticks, as the loader's import of the effect", async () => {
    await write(
      dist,
      "_astro/HeroLeaves.ghi.js",
      'import{t as e}from"./preload-helper.pqr.js";e(()=>import(`./particles.jkl.js`),[]);',
    );
    await write(dist, "_astro/preload-helper.pqr.js", "export const t = 1;");
    expect(await heroFailures()).toEqual([]);
  });

  it("fails an effect over 32 KB gzipped", async () => {
    await write(
      dist,
      "_astro/particles.jkl.js",
      incompressible(EFFECT_BUDGET + 2000),
    );
    expect(
      (await heroFailures()).some((f) => /effect and what it imports/.test(f)),
    ).toBe(true);
  });

  it("accepts an effect under 32 KB gzipped", async () => {
    const body = incompressible(20 * 1024);
    expect(gzipBytes(body)).toBeLessThan(EFFECT_BUDGET);
    await write(dist, "_astro/particles.jkl.js", body);
    expect(await heroFailures()).toEqual([]);
  });

  it("counts what the effect imports against the same 32 KB", async () => {
    // Each file is well under the budget; together they are over it: the budget is for "everything it imports, together".
    await write(
      dist,
      "_astro/particles.jkl.js",
      Buffer.concat([
        Buffer.from('import"./ogl.mno.js";//'),
        incompressible(20 * 1024),
      ]),
    );
    await write(dist, "_astro/ogl.mno.js", incompressible(20 * 1024));
    expect(
      (await heroFailures()).some((f) => /effect and what it imports/.test(f)),
    ).toBe(true);
  });

  it("fails a landing whose canvas is not hidden from assistive technology", async () => {
    await write(
      dist,
      htmlPath(""),
      page("", {
        heroArt: HERO_ART.replace(
          'data-hero-canvas aria-hidden="true"',
          "data-hero-canvas",
        ),
      }),
    );
    expect(
      (await heroFailures()).some((f) => /canvas is not aria-hidden/.test(f)),
    ).toBe(true);
  });

  it("fails a landing whose still SVG is not hidden from assistive technology", async () => {
    await write(
      dist,
      htmlPath(""),
      page("", {
        heroArt: HERO_ART.replace(
          'class="hero-still" aria-hidden="true"',
          'class="hero-still"',
        ),
      }),
    );
    expect(
      (await heroFailures()).some((f) =>
        /still SVG is not aria-hidden/.test(f),
      ),
    ).toBe(true);
  });

  it("fails a landing with no still SVG, and one with no canvas", async () => {
    await write(
      dist,
      htmlPath(""),
      page("", { heroArt: HERO_ART.replace(/<svg.*?<\/svg>/, "") }),
    );
    expect(
      (await heroFailures()).some((f) => /0 hero still SVGs/.test(f)),
    ).toBe(true);
    await write(
      dist,
      htmlPath(""),
      page("", { heroArt: HERO_ART.replace(/<canvas.*?<\/canvas>/, "") }),
    );
    expect((await heroFailures()).some((f) => /0 <canvas>/.test(f))).toBe(true);
  });

  it("fails another page that carries the hero's art box", async () => {
    await rewrite("faq", (html) =>
      html.replace("</body>", `${HERO_ART}</body>`),
    );
    expect((await heroFailures()).some((f) => /only the landing/.test(f))).toBe(
      true,
    );
  });
});

// #266 phase 3, D6-D9. The expected rules are the user's of 2026-11-06 (plan §3 D6-D9 and §8 items 5-8): the entrance is
// on the landing's header only, the internal-arrival check is an inline script in that header, the motion is inside
// the reduced-motion no-preference query, and nothing is ever held at opacity 0 outside a keyframe.
describe("the landing header's entrance (#266)", () => {
  const css = (rules) =>
    write(
      dist,
      "_astro/common.abc.css",
      `.tab>[role=tab]{display:flex;min-block-size:44px}${rules}`,
    );
  const withLandingHeader = async (landingHeader) => {
    await write(dist, "index.html", page("", { header: landingHeader }));
    return audit();
  };

  it("passes the landing's marker and inline script, and the keyframes under the query", async () => {
    expect(await audit()).toEqual([]);
  });

  it("fails a landing whose header has no entrance marker", async () => {
    const failures = await withLandingHeader(
      LANDING_HEADER.replace(" data-landing-entrance", ""),
    );
    expect(failures.some((f) => /\(root\).*entrance marker/.test(f))).toBe(
      true,
    );
  });

  it("fails an inner page whose header carries the entrance marker", async () => {
    await write(dist, htmlPath("faq"), page("faq", { header: LANDING_HEADER }));
    expect(
      (await audit()).some((f) => /faq.*entrance marker.*landing/.test(f)),
    ).toBe(true);
  });

  it("fails the 404 when its header carries the entrance marker", async () => {
    await write(dist, "404.html", notFoundPage({ header: LANDING_HEADER }));
    expect(
      (await audit()).some((f) => /404\.html.*entrance marker/.test(f)),
    ).toBe(true);
  });

  it("fails a landing whose header has no internal-arrival script", async () => {
    const failures = await withLandingHeader(
      LANDING_HEADER.replace(ENTRANCE_SCRIPT, ""),
    );
    expect(
      failures.some((f) => /\(root\).*internal-arrival script/.test(f)),
    ).toBe(true);
  });

  it("fails a landing whose internal-arrival script is not inline", async () => {
    const failures = await withLandingHeader(
      LANDING_HEADER.replace(
        ENTRANCE_SCRIPT,
        '<script type="module" src="/worktree/_astro/entrance.js"></script>',
      ),
    );
    expect(
      failures.some((f) => /\(root\).*internal-arrival script/.test(f)),
    ).toBe(true);
  });

  it("fails a landing whose inline script is outside the header", async () => {
    await withLandingHeader(LANDING_HEADER.replace(ENTRANCE_SCRIPT, ""));
    await rewrite("", (html) => html.replace("<h1>", `${ENTRANCE_SCRIPT}<h1>`));
    expect(
      (await audit()).some((f) => /\(root\).*internal-arrival script/.test(f)),
    ).toBe(true);
  });

  it("fails entrance keyframes outside the no-preference query", async () => {
    await css(
      "@keyframes header-entrance-fade{from{opacity:0}}@keyframes header-entrance-ink{from{color:#888}}",
    );
    const failures = await audit();
    expect(
      failures.some((f) =>
        /header-entrance-fade.*prefers-reduced-motion/.test(f),
      ),
    ).toBe(true);
  });

  it("fails entrance keyframes under the reduce query", async () => {
    await css(
      "@media (prefers-reduced-motion:reduce){@keyframes header-entrance-fade{from{opacity:0}}@keyframes header-entrance-ink{from{color:#888}}}",
    );
    expect(
      (await audit()).some((f) =>
        /header-entrance-fade.*prefers-reduced-motion/.test(f),
      ),
    ).toBe(true);
  });

  it("fails an animation of the entrance applied outside the query", async () => {
    await css(
      `${ENTRANCE_CSS}.header .theme-toggle{animation:header-entrance-ink .5s backwards}`,
    );
    expect(
      (await audit()).some((f) =>
        /\.theme-toggle.*header-entrance-ink.*prefers-reduced-motion/.test(f),
      ),
    ).toBe(true);
  });

  it("fails a build with no entrance keyframes at all", async () => {
    await css("");
    expect(
      (await audit()).some((f) => /no header-entrance-\* keyframes/.test(f)),
    ).toBe(true);
  });

  it.each([
    [".header .title-wrapper{opacity:0}"],
    ["header .theme-toggle{opacity:0%}"],
    ["@media (min-width:50rem){.header-chip{opacity:0!important}}"],
    [
      "@media (prefers-reduced-motion:no-preference){.header[data-landing-entrance] site-search button{opacity:0}}",
    ],
  ])("fails a rule that gives a header item opacity 0: %s", async (rule) => {
    await css(`${ENTRANCE_CSS}${rule}`);
    expect((await audit()).some((f) => /opacity: 0/.test(f))).toBe(true);
  });

  // The user, 2026-11-06: the shield and the "NorthGuild" wordmark stay static; only "/ worktree vX.Y.Z" fades.
  // The reviewer's finding: `site-search button` would also fade the dialog's buttons each time it opens.
  it.each([
    ["the wordmark", ".brand>.wordmark"],
    ["the title wrapper", ".title-wrapper"],
    ["GitHub and Discord", "a.header-chip"],
    ["every button in the search component", "site-search button"],
    ["the search dialog's buttons", "site-search>dialog button"],
  ])("fails an entrance fade on %s", async (_name, target) => {
    await css(
      `${ENTRANCE_CSS}@media (prefers-reduced-motion:no-preference){${GATE} ${target}{animation:header-entrance-fade .6s backwards}}`,
    );
    expect(
      (await audit()).some((f) => /fades (the wordmark|more than)/.test(f)),
    ).toBe(true);
  });

  it("fails an entrance rule not scoped to the landing marker or not gated by data-entrance-off", async () => {
    await css(
      `${ENTRANCE_CSS}@media (prefers-reduced-motion:no-preference){.brand>.slash{animation:header-entrance-fade .6s backwards}}`,
    );
    const failures = await audit();
    expect(
      failures.some((f) => /not scoped to \[data-landing-entrance\]/.test(f)),
    ).toBe(true);
    expect(
      failures.some((f) =>
        /not gated by :not\(\[data-entrance-off\]\)/.test(f),
      ),
    ).toBe(true);
  });

  it.each([
    "forwards",
    "both",
  ])("fails an entrance animation with the %s fill", async (fill) => {
    await css(
      `${ENTRANCE_CSS}@media (prefers-reduced-motion:no-preference){${GATE} a.header-chip{animation:header-entrance-ink .5s ${fill}}}`,
    );
    expect((await audit()).some((f) => /keeps an end state/.test(f))).toBe(
      true,
    );
  });

  it("fails an entrance keyframe that animates anything but opacity, transform and color", async () => {
    await css(
      ENTRANCE_CSS.replace(
        "translateY(.75rem)}",
        "translateY(.75rem);filter:blur(2px)}",
      ),
    );
    expect((await audit()).some((f) => /animates filter/.test(f))).toBe(true);
  });

  it("allows opacity 0 on something that is not a header item, and in a keyframe", async () => {
    await css(`${ENTRANCE_CSS}.chat-hint{opacity:0}.header a{opacity:1}`);
    expect(await audit()).toEqual([]);
  });

  it("fails a header item holding opacity 0 in its style attribute", async () => {
    const failures = await withLandingHeader(
      LANDING_HEADER.replace(
        '<div class="brand">',
        '<div class="brand" style="opacity: 0">',
      ),
    );
    expect(failures.some((f) => /style.*opacity/.test(f))).toBe(true);
  });
});

// Expected values: plan #309 Phase 1, scope item 6 and "Done when": `/dox/` is `noindex`, in neither the sitemap nor
// `llms.txt`, has the `data-dox-shell` script and exactly one `astro-island`, the title `Dox · @northguild/worktree`, the
// header and named controls, no footer (scope item 4), and no other page loads Dox code. Each rule has a
// fixture that breaks it alone.
describe("the Dox page (#309)", () => {
  const doxFailures = async () =>
    (await audit()).filter((f) => f.startsWith("/dox/"));
  const withDox = async (overrides) => {
    await write(dist, "dox/index.html", doxPage(overrides));
    return doxFailures();
  };

  it("passes a /dox/ that meets every rule, and the 28 pages do not list it", async () => {
    expect(await audit()).toEqual([]);
  });

  it("fails a build with no /dox/", async () => {
    await rm(join(dist, "dox"), { recursive: true });
    expect(await doxFailures()).toEqual([
      "/dox/: dox/index.html is missing from the build",
    ]);
  });

  it.each([
    ["no robots meta", { robots: "" }],
    [
      "a robots meta that allows indexing",
      { robots: '<meta name="robots" content="index,follow"/>' },
    ],
  ])("fails %s", async (_name, overrides) => {
    expect((await withDox(overrides)).some((f) => /noindex/.test(f))).toBe(
      true,
    );
  });

  it("accepts noindex among other robots directives", async () => {
    expect(
      await withDox({
        robots: '<meta name="robots" content="noindex, nofollow"/>',
      }),
    ).toEqual([]);
  });

  it("fails a page without the script that sets data-dox-shell", async () => {
    expect(
      (await withDox({ shell: "" })).some((f) => /data-dox-shell/.test(f)),
    ).toBe(true);
  });

  it.each([
    ["none", "", 0],
    ["two", DOX_ISLAND + DOX_ISLAND, 2],
  ])("fails %s astro-island elements", async (_name, island, count) => {
    expect(await withDox({ island })).toContain(
      `/dox/: ${count} astro-island elements, expected exactly 1`,
    );
  });

  it.each([
    ["Dox"],
    ["Dox | @northguild/worktree"],
    ["Dox · @northguild/worktree · @northguild/worktree"],
  ])("fails the title %j", async (title) => {
    expect((await withDox({ title })).some((f) => /title is/.test(f))).toBe(
      true,
    );
  });

  it("fails a footer", async () => {
    expect(
      (await withDox({ extra: "<footer>Last updated</footer>" })).some((f) =>
        /footer/.test(f),
      ),
    ).toBe(true);
  });

  it("fails a page without the site header", async () => {
    expect(
      (await withDox({ header: "" })).some((f) => /no <header>/.test(f)),
    ).toBe(true);
  });

  it("fails a header that lost a link", async () => {
    const failures = await withDox({ header: header({ github: "" }) });
    expect(failures.some((f) => /header: .*github\.com/.test(f))).toBe(true);
  });

  it("fails a control with no accessible name", async () => {
    const failures = await withDox({
      controls: `${DOX_CONTROLS}<button type="button"><svg aria-hidden="true"></svg></button>`,
    });
    expect(failures.some((f) => /has no accessible name/.test(f))).toBe(true);
  });

  it("fails a page with no search button", async () => {
    const failures = await withDox({
      controls: `${MENU_BUTTON}${THEME_SELECT}`,
    });
    expect(failures.some((f) => /no search button/.test(f))).toBe(true);
  });

  it("fails a graphic that is neither hidden nor named", async () => {
    const failures = await withDox({ extra: '<svg viewBox="0 0 1 1"></svg>' });
    expect(failures.some((f) => /svg/i.test(f))).toBe(true);
  });

  it("fails an id that appears twice (the crystal's gradients are found by id)", async () => {
    const failures = await withDox({ extra: '<i id="a"></i><i id="a"></i>' });
    expect(failures.some((f) => /id "a" appears 2 times/.test(f))).toBe(true);
  });

  it("fails a sitemap that lists /dox/", async () => {
    await write(dist, "sitemap-0.xml", sitemap([...PATHS, "dox"]));
    expect(await doxFailures()).toContain(
      "/dox/: is listed in the sitemap; it is kept out",
    );
  });

  it("fails an llms.txt that lists /dox/", async () => {
    await write(
      dist,
      "llms.txt",
      `${llmsTxt(PATHS)}- [Dox](${url("dox")}): Chat.\n`,
    );
    expect(await doxFailures()).toContain(
      "/dox/: is listed in llms.txt; it is kept out",
    );
  });

  it.each([
    [
      "a script for the island's chunk",
      (html) =>
        html.replace(
          "</body>",
          '<script type="module" src="/worktree/_astro/DoxPage.mno.js"></script></body>',
        ),
    ],
    [
      "a modulepreload of the island's chunk",
      (html) =>
        html.replace(
          "</head>",
          '<link rel="modulepreload" href="/worktree/_astro/DoxPage.mno.js"/></head>',
        ),
    ],
    [
      "an island for the island's chunk",
      (html) => html.replace("</body>", `${DOX_ISLAND}</body>`),
    ],
    [
      "the stylesheet that carries the hive",
      (html) => html.replace("</head>", `${DOX_STYLESHEET}</head>`),
    ],
  ])("fails another page that loads Dox code through %s", async (_name, change) => {
    await rewrite("commands/branch", change);
    expect(await audit()).toContain(
      "/commands/branch/: loads Dox code; only /dox/ may",
    );
  });

  it("fails a page whose script imports the island's chunk statically", async () => {
    await write(dist, "_astro/page.abc.js", 'import"./DoxPage.mno.js";');
    expect(
      (await audit()).some((f) => /loads Dox code; only \/dox\/ may/.test(f)),
    ).toBe(true);
  });

  it("fails the 404 when it loads Dox code", async () => {
    const file = join(dist, "404.html");
    await writeFile(
      file,
      (await readFile(file, "utf8")).replace(
        "</head>",
        `${DOX_STYLESHEET}</head>`,
      ),
    );
    expect(await audit()).toContain("404.html: loads Dox code; only /dox/ may");
  });
});
