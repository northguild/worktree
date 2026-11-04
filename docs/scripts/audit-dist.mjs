/**
 * audit-dist.mjs
 *
 * Reads the built docs site (`docs/dist/`) and asserts the SEO requirements of plan §4.8. Exits 1 and lists every
 * failure when any rule breaks; exits 0 and says so when none does.
 *
 * Per page: a unique `<meta name="description">` of at most 155 characters; one `<link rel="canonical">` in the D3
 * form; Open Graph and Twitter tags; JSON-LD of the right types (`BreadcrumbList` only on a nested page, D10); and
 * no script that loads the chat before it is activated. Per site: a sitemap listing exactly the 23 URLs, a
 * `404.html`, Getting Started text in the root page's HTML, and no `shuding/nextra` string anywhere.
 *
 * Also per page (phase 8): the "Last updated" date equals `git log --follow -1` for the page's source file (D11), and the
 * "Edit this page" link is the repository's `edit/main/docs/src/content/docs/<source>` URL for a source file that
 * exists. These apply to the 23 pages only; `404.html` is not one of them and has neither. Per site: `llms.txt`
 * (D13) is a llmstxt.org file listing the same 23 URLs, each with a title and the page's own description.
 *
 * Also (phase 9, accessibility): every button has an accessible name (an icon-only one needs an `aria-label`, an
 * `aria-labelledby` or a `title`), and a name that stands beside visible text contains it (WCAG 2.5.3); every
 * `<select>` is labelled; every page has the search button; the chat launcher announces its shortcut with
 * `aria-keyshortcuts="Alt+Shift+C"` (WAI-ARIA 1.2 syntax); the built CSS gives the package-manager tabs a minimum
 * height of at least 44px; and `404.html` has the site's search, a link to Getting Started, and no canonical link or
 * JSON-LD (it is not a page of the site, so it must not point at one). The search *input* is made by Pagefind in the
 * browser and is not in the HTML: its label is a real-browser check.
 *
 * Not asserted yet, because the thing it checks does not exist until a later phase:
 *   - `og:image` / `twitter:image` (plan §9 Q3: the preview image is undecided). Set PREVIEW_IMAGE_DECIDED to
 *     true when it is; the rule is then a one-line addition in `auditPage`.
 *
 * Usage: node docs/scripts/audit-dist.mjs [distDir]   (default: docs/dist, after `pnpm docs:build`)
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Temporal } from "@northguild/gmt";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIST = join(here, "../dist");
const ORIGIN = "https://northguild.dev/worktree/";
const MAX_DESCRIPTION = 155;
const CONTENT_DIR = join(here, "../src/content/docs");
const REPO_ROOT = join(here, "../..");
const EDIT_BRANCH = "main";
export const PREVIEW_IMAGE_DECIDED = false;

/** The repository URL from package.json `repository.url` (`git+https://github.com/o/r.git` -> `https://github.com/o/r`). */
function repositoryUrl() {
  const { repository } = JSON.parse(
    readFileSync(join(REPO_ROOT, "package.json"), "utf8"),
  );
  return repository.url.replace(/^git\+/, "").replace(/\.git$/, "");
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

// The site-wide default description (D3: the old Documentation index row of §4.3). Starlight falls back to it
// when a page has no `description:` frontmatter, so a page carrying it has lost its own (D9).
export const SITE_DEFAULT_DESCRIPTION =
  "Docs for worktree, an open-source CLI that manages git worktrees: one per branch or issue, with env files copied and your editor opened.";

// The 23 pages: the 24 old routes at 2633f3a with the Documentation index dropped and /docs/getting-started
// folded into the root (D3). Written out, not derived from the content collection, so a page added or lost by
// accident fails here.
export const PAGE_PATHS = Object.freeze([
  "",
  "changelog",
  "commands",
  "commands/branch",
  "commands/checkout",
  "commands/cleanup",
  "commands/config",
  "commands/list",
  "commands/open",
  "commands/remove",
  "configuration",
  "faq",
  "guides",
  "guides/clickup-integration",
  "guides/context-switching",
  "guides/editor-integration",
  "guides/env-files",
  "guides/github-issue-integration",
  "guides/herdr-spaces",
  "guides/jira-integration",
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

/** Chat code a page loads up front: a script or modulepreload for the chat chunk, or a page script importing it statically. */
async function chatLoadedUpFront(html, dist) {
  const references = [
    ...tagsOf(html, "script").map((a) => a.src),
    ...tagsOf(html, "link")
      .filter((a) => a.rel === "modulepreload")
      .map((a) => a.href),
  ].filter(Boolean);
  if (references.some(isChatChunk)) return true;
  for (const reference of references) {
    const file = join(dist, reference.replace(/^\/worktree\//, ""));
    let source;
    try {
      source = await readFile(file, "utf8");
    } catch {
      continue;
    }
    // `from"./x.js"` and `import"./x.js"`, not `import("./x.js")`, which is the dynamic import the launcher uses.
    const staticImports = [
      ...source.matchAll(/\bfrom\s*["']([^"']+)["']/g),
      ...source.matchAll(/\bimport\s*["']([^"']+)["']/g),
    ];
    if (staticImports.some((m) => isChatChunk(m[1]))) return true;
  }
  return false;
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
    if (description === SITE_DEFAULT_DESCRIPTION)
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
  if (PREVIEW_IMAGE_DECIDED) {
    if (!metaContent("property", "og:image")) fail("no og:image tag");
    if (!metaContent("name", "twitter:image")) fail("no twitter:image tag");
  }

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

  failures.push(...auditControls(html, label(path)));

  // Last updated (D11): the rendered <time> must be the independently computed date.
  const times = tagsOf(html, "time");
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

  // Edit link: starts with the repository URL and names the page's real source file.
  const source = options.sourcePath(path);
  const edits = tagsOf(html, "a").filter((a) => a.href?.includes("/edit/"));
  if (edits.length !== 1)
    fail(`${edits.length} edit links, expected exactly 1`);
  else if (source === undefined)
    fail("edit link: the page has no source file under src/content/docs");
  else {
    const expected = `${options.repoUrl}/edit/${EDIT_BRANCH}/docs/src/content/docs/${source}`;
    if (edits[0].href !== expected)
      fail(`edit link is ${edits[0].href}, expected ${expected}`);
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

/** The 404: the site's search, a link to Getting Started, and nothing that names a URL the site does not have. */
function auditNotFound(html) {
  const failures = auditControls(html, "404.html");
  const fail = (rule) => failures.push(`404.html: ${rule}`);
  if (tagsOf(html, "link").some((l) => l.rel === "canonical"))
    fail("has a canonical link, but /404/ is not a page of the site");
  if (/<script type="application\/ld\+json">/.test(html))
    fail("has JSON-LD (a BreadcrumbList would name /404/ as a page)");
  const toGettingStarted = [
    ...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g),
  ].some(
    ([, attrs, inner]) =>
      attributes(attrs).href === "/worktree/" &&
      /getting started/i.test(textOf(inner)),
  );
  if (!toGettingStarted) fail('no link to Getting Started (href="/worktree/")');
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
    failures.push(
      ...auditNotFound(await readFile(join(dist, "404.html"), "utf8")),
    );
  } catch {
    failures.push("404.html is missing");
  }

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
    if (!/<h1[^>]*>[^<]*Getting Started/.test(root))
      failures.push(
        "/ (root): the HTML does not contain Getting Started text in its heading",
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
    repoUrl: repositoryUrl(),
    sourcePath: sourcePathOf,
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
