// @vitest-environment node

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditDist } from "./audit-dist.mjs";

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
  const description =
    overrides.description ?? `A description of ${path || "the root"}.`;
  const canonical = overrides.canonical ?? url(path);
  const heading =
    path === "" ? "Getting Started with @northguild/worktree" : path;
  return [
    "<!doctype html><html><head>",
    `<title>${path || "Home"} | @northguild/worktree</title>`,
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
    `</head><body><h1>${heading}</h1>${overrides.body ?? ""}</body></html>`,
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

describe("auditDist", () => {
  it("passes a site that meets every rule", async () => {
    expect(await auditDist(dist)).toEqual([]);
  });

  it("fails a page with no meta description, naming the page", async () => {
    await rewrite("faq", (html) =>
      html.replace(/<meta name="description"[^>]*>/, ""),
    );
    const failures = await auditDist(dist);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/faq/);
    expect(failures[0]).toMatch(/description/i);
  });

  it("accepts a description of exactly 155 characters and fails one of 156", async () => {
    const at = (n) => "a".repeat(n);
    await write(dist, htmlPath("faq"), page("faq", { description: at(155) }));
    expect(await auditDist(dist)).toEqual([]);
    await write(dist, htmlPath("faq"), page("faq", { description: at(156) }));
    const failures = await auditDist(dist);
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
    expect(await auditDist(dist)).toEqual([]);
  });

  it("fails a page whose description is the site default (its own description: is missing)", async () => {
    // Literal from plan §4.3's index row, which D3 makes the site default.
    const siteDefault =
      "Docs for worktree, an open-source CLI that manages git worktrees: one per branch or issue, with env files copied and your editor opened.";
    await write(
      dist,
      htmlPath("faq"),
      page("faq", { description: siteDefault }),
    );
    const failures = await auditDist(dist);
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
    const failures = await auditDist(dist);
    expect(failures.some((f) => /unique|duplicate/i.test(f))).toBe(true);
  });

  it("fails a page with no canonical link", async () => {
    await rewrite("faq", (html) =>
      html.replace(/<link rel="canonical"[^>]*>/, ""),
    );
    const failures = await auditDist(dist);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/canonical/);
  });

  it("fails a canonical that is not the D3 URL of the page", async () => {
    await write(
      dist,
      htmlPath("faq"),
      page("faq", { canonical: "https://northguild.dev/worktree/faq" }),
    );
    const failures = await auditDist(dist);
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
    const failures = await auditDist(dist);
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
    const failures = await auditDist(dist);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(tag);
  });

  it("fails a twitter:card that is not summary_large_image", async () => {
    await rewrite("faq", (html) =>
      html.replace("summary_large_image", "summary"),
    );
    expect((await auditDist(dist)).some((f) => /twitter:card/.test(f))).toBe(
      true,
    );
  });

  it("does not require og:image while the preview image is undecided (plan §9 Q3)", async () => {
    // The compliant site above has none, and passes.
    expect(await auditDist(dist)).toEqual([]);
  });

  it("fails a nested page that has no BreadcrumbList", async () => {
    await write(
      dist,
      htmlPath("faq"),
      page("faq", {
        jsonLd: jsonLd("").replace(/"WebSite"|"Organization"/g, '"Thing"'),
      }),
    );
    expect((await auditDist(dist)).length).toBeGreaterThan(0);
  });

  it("fails the root page when it carries a BreadcrumbList", async () => {
    await write(dist, htmlPath(""), page("", { jsonLd: jsonLd("faq") }));
    expect((await auditDist(dist)).some((f) => /JSON-LD/.test(f))).toBe(true);
  });

  it("fails a page with no JSON-LD", async () => {
    await rewrite("faq", (html) =>
      html.replace(/<script type="application\/ld\+json">.*?<\/script>/, ""),
    );
    expect((await auditDist(dist)).some((f) => /JSON-LD/.test(f))).toBe(true);
  });

  it("fails a page whose JSON-LD is not valid JSON", async () => {
    await write(dist, htmlPath("faq"), page("faq", { jsonLd: "{not json" }));
    expect((await auditDist(dist)).some((f) => /JSON-LD/.test(f))).toBe(true);
  });

  it("fails a page that loads the chat chunk with a script tag", async () => {
    await rewrite("faq", (html) =>
      html.replace(
        "</head>",
        '<script type="module" src="/worktree/_astro/Chat.xyz.js"></script></head>',
      ),
    );
    expect((await auditDist(dist)).some((f) => /chat/i.test(f))).toBe(true);
  });

  it("fails a page that preloads the chat chunk", async () => {
    await rewrite("faq", (html) =>
      html.replace(
        "</head>",
        '<link rel="modulepreload" href="/worktree/_astro/Chat.xyz.js"></head>',
      ),
    );
    expect((await auditDist(dist)).some((f) => /chat/i.test(f))).toBe(true);
  });

  it("fails a page script that statically imports the chat chunk", async () => {
    await write(dist, "_astro/page.abc.js", 'import"./Chat.xyz.js";');
    expect((await auditDist(dist)).some((f) => /chat/i.test(f))).toBe(true);
  });

  it("allows the launcher to import the chat dynamically", async () => {
    // beforeEach's ChatLauncher.def.js already does: import("./Chat.xyz.js").
    expect(await auditDist(dist)).toEqual([]);
  });

  it("fails a sitemap missing a page", async () => {
    await write(
      dist,
      "sitemap-0.xml",
      sitemap(PATHS.filter((p) => p !== "faq")),
    );
    const failures = await auditDist(dist);
    expect(
      failures.some((f) => /sitemap/i.test(f) && f.includes(url("faq"))),
    ).toBe(true);
  });

  it("fails a sitemap with an extra URL", async () => {
    await write(dist, "sitemap-0.xml", sitemap([...PATHS, "extra"]));
    expect(
      (await auditDist(dist)).some(
        (f) => /sitemap/i.test(f) && f.includes(url("extra")),
      ),
    ).toBe(true);
  });

  it("fails when 404.html is missing", async () => {
    await rm(join(dist, "404.html"));
    expect((await auditDist(dist)).some((f) => /404/.test(f))).toBe(true);
  });

  it("fails a root that does not carry Getting Started in its HTML", async () => {
    await rewrite("", (html) => html.replace("Getting Started", "Redirecting"));
    expect((await auditDist(dist)).some((f) => /Getting Started/.test(f))).toBe(
      true,
    );
  });

  it("fails when shuding/nextra appears in any file", async () => {
    await write(dist, "_astro/old.js", "// https://github.com/shuding/nextra");
    expect((await auditDist(dist)).some((f) => /shuding\/nextra/.test(f))).toBe(
      true,
    );
  });

  it("fails a missing expected page file", async () => {
    await rm(join(dist, "faq"), { recursive: true });
    expect((await auditDist(dist)).some((f) => /faq/.test(f))).toBe(true);
  });
});
