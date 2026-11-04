// @vitest-environment node

import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditDist, followDate, sourcePathOf } from "./audit-dist.mjs";

// The audit is tested against a small compliant site built here, then broken one rule at a time. Expected
// values come from plan §4.8 (what the audit asserts), D3 (URL form: https://northguild.dev/worktree/<path>/)
// and D10 (which JSON-LD types go where) — never from the audit's own constants. The 23 paths are the 24 old
// routes at 2633f3a, with the Documentation index dropped and /docs/getting-started becoming the root.
const ORIGIN = "https://northguild.dev/worktree/";
const PATHS = [
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
];
const url = (path) => (path === "" ? ORIGIN : `${ORIGIN}${path}/`);

// Plan §3 D11 / the Phase 8 scope: edit links are the repository URL (package.json `repository`) + /edit/main/docs/
// + the page's real source path under src/content/docs/. The fixture's source files are fakes; sourcePathOf is
// tested against a real directory below.
const REPO = "https://github.com/northguild/worktree";
const EDIT_BASE = `${REPO}/edit/main/docs/src/content/docs/`;
const DATE = "2026-11-04";
const sourceOf = (path) => (path === "" ? "index.mdx" : `${path}.mdx`);
const FIXTURE = {
  repoUrl: REPO,
  sourcePath: sourceOf,
  expectedDate: () => DATE,
};
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

function page(path, overrides = {}) {
  const description = overrides.description ?? descriptionOf(path);
  const editHref = overrides.editHref ?? `${EDIT_BASE}${sourceOf(path)}`;
  const time = overrides.time ?? `${DATE}T10:00:00.000Z`;
  const canonical = overrides.canonical ?? url(path);
  const heading =
    path === "" ? "Getting Started with @northguild/worktree" : path;
  return [
    "<!doctype html><html><head>",
    `<title>${titleOf(path)} | @northguild/worktree</title>`,
    `<link rel="canonical" href="${canonical}"/>`,
    `<meta property="og:title" content="${path || "Home"}"/>`,
    `<meta property="og:description" content="${description}"/>`,
    `<meta property="og:url" content="${url(path)}"/>`,
    `<meta property="og:site_name" content="@northguild/worktree"/>`,
    `<meta name="twitter:card" content="summary_large_image"/>`,
    `<meta name="description" content="${description}"/>`,
    `<script type="application/ld+json">${overrides.jsonLd ?? jsonLd(path)}</script>`,
    '<script type="module" src="/worktree/_astro/page.abc.js"></script>',
    '<script type="module" src="/worktree/_astro/ChatLauncher.def.js"></script>',
    `</head><body><h1>${heading}</h1>${overrides.edit ?? `<a href="${editHref}" class="sl-flex">Edit page</a>`}${overrides.updated ?? `<p>Last updated: <time datetime="${time}">Nov 4, 2026</time></p>`}${overrides.body ?? ""}</body></html>`,
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
  await write(dist, "404.html", "<!doctype html><title>Not found</title>");
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
    "_astro/ChatLauncher.def.js",
    'button.onclick=()=>import("./Chat.xyz.js");',
  );
  await write(dist, "_astro/Chat.xyz.js", "export const chat = 1;");
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

  it("does not require og:image while the preview image is undecided (plan §9 Q3)", async () => {
    // The compliant site above has none, and passes.
    expect(await audit()).toEqual([]);
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

  it("fails a page that loads the chat chunk with a script tag", async () => {
    await rewrite("faq", (html) =>
      html.replace(
        "</head>",
        '<script type="module" src="/worktree/_astro/Chat.xyz.js"></script></head>',
      ),
    );
    expect((await audit()).some((f) => /chat/i.test(f))).toBe(true);
  });

  it("fails a page that preloads the chat chunk", async () => {
    await rewrite("faq", (html) =>
      html.replace(
        "</head>",
        '<link rel="modulepreload" href="/worktree/_astro/Chat.xyz.js"></head>',
      ),
    );
    expect((await audit()).some((f) => /chat/i.test(f))).toBe(true);
  });

  it("fails a page script that statically imports the chat chunk", async () => {
    await write(dist, "_astro/page.abc.js", 'import"./Chat.xyz.js";');
    expect((await audit()).some((f) => /chat/i.test(f))).toBe(true);
  });

  it("allows the launcher to import the chat dynamically", async () => {
    // beforeEach's ChatLauncher.def.js already does: import("./Chat.xyz.js").
    expect(await audit()).toEqual([]);
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

  it("fails a root that does not carry Getting Started in its HTML", async () => {
    await rewrite("", (html) => html.replace("Getting Started", "Redirecting"));
    expect((await audit()).some((f) => /Getting Started/.test(f))).toBe(true);
  });

  it("fails when shuding/nextra appears in any file", async () => {
    await write(dist, "_astro/old.js", "// https://github.com/shuding/nextra");
    expect((await audit()).some((f) => /shuding\/nextra/.test(f))).toBe(true);
  });

  it("fails a missing expected page file", async () => {
    await rm(join(dist, "faq"), { recursive: true });
    expect((await audit()).some((f) => /faq/.test(f))).toBe(true);
  });

  // llms.txt (D13, plan §4.8): the same 23 URLs as the sitemap, each with a title and the page's description.
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

  // Edit links: each begins with the repository URL and ends in the page's real source path.
  it("fails an edit link that does not begin with the repository URL", async () => {
    await write(
      dist,
      htmlPath("faq"),
      page("faq", { editHref: "https://example.com/edit/main/faq.mdx" }),
    );
    const failures = await audit();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/faq.*edit/i);
  });

  it("fails an edit link to a file that is not the page's source", async () => {
    await write(
      dist,
      htmlPath("faq"),
      page("faq", { editHref: `${EDIT_BASE}missing.mdx` }),
    );
    expect((await audit()).some((f) => /faq.*edit/i.test(f))).toBe(true);
  });

  it("fails a page with no edit link", async () => {
    await write(dist, htmlPath("faq"), page("faq", { edit: "" }));
    expect((await audit()).some((f) => /faq.*edit/i.test(f))).toBe(true);
  });

  it("does not require a date or an edit link on 404.html (it is not one of the 23 pages)", async () => {
    // beforeEach's 404.html has neither, and the compliant site passes.
    expect(await audit()).toEqual([]);
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
