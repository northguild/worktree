/**
 * build-legacy-pages.mjs
 *
 * Writes `docs/legacy/` (gitignored): the bundle deployed to the old GitHub Pages site
 * (https://northguild.github.io/worktree/). It holds
 *   - schema/v1.json, byte-identical to docs/public/schema/v1.json, so every released CLI's `$schema`
 *     comment and every npm README link keeps resolving;
 *   - one stub per old route, each carrying a canonical link, a meta refresh and a visible link to the
 *     new URL (D3: https://northguild.dev/worktree/<path>/);
 *   - a root stub and a 404.html.
 *
 * The route list is the 24 routes committed at 2633f3a and the two #238 added (5c741ee), not derived from the new code (D4), and the
 * bundle does not read the CLI's schema-URL constant (D5).
 *
 * Usage: node docs/scripts/build-legacy-pages.mjs [outDir]
 */

import { copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA_SOURCE = join(here, "../public/schema/v1.json");
const DEFAULT_OUT_DIR = join(here, "../legacy");
const NEW_ORIGIN = "https://northguild.dev";
const NEW_BASE = "/worktree/";

// `docs/src/chat/docs-routes.generated.ts` at 2633f3a, plus the two routes 5c741ee added.
export const OLD_ROUTES = Object.freeze([
  "/docs",
  "/docs/changelog",
  "/docs/commands",
  "/docs/commands/branch",
  "/docs/commands/checkout",
  "/docs/commands/cleanup",
  "/docs/commands/config",
  "/docs/commands/linear-listen",
  "/docs/commands/list",
  "/docs/commands/open",
  "/docs/commands/remove",
  "/docs/configuration",
  "/docs/faq",
  "/docs/getting-started",
  "/docs/guides",
  "/docs/guides/clickup-integration",
  "/docs/guides/context-switching",
  "/docs/guides/editor-integration",
  "/docs/guides/env-files",
  "/docs/guides/github-issue-integration",
  "/docs/guides/herdr-spaces",
  "/docs/guides/jira-integration",
  "/docs/guides/linear-agent-delegation",
  "/docs/guides/linear-integration",
  "/docs/guides/team-conventions",
  "/docs/project-configuration",
]);

const ROOT_URL = new URL(NEW_BASE, NEW_ORIGIN).href;

/** D17 (revising D3's root): `/docs` -> the landing at the root; `/docs/<p>`, Getting Started included, -> `/<p>/`. */
export function targetFor(route) {
  if (route === "/docs") return ROOT_URL;
  const page = route.replace(/^\/docs\//, "");
  return new URL(`${page}/`, ROOT_URL).href;
}

const escapeAttr = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export function renderStub(target, heading = "This page has moved") {
  const href = escapeAttr(target);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${heading} | Worktree</title>
<link rel="canonical" href="${href}">
<meta http-equiv="refresh" content="0; url=${href}">
<meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
<p>${heading}: <a href="${href}">${href}</a></p>
</body>
</html>
`;
}

export async function buildLegacyBundle({ outDir = DEFAULT_OUT_DIR } = {}) {
  const out = resolve(outDir);
  await rm(out, { recursive: true, force: true });

  await mkdir(join(out, "schema"), { recursive: true });
  await copyFile(SCHEMA_SOURCE, join(out, "schema/v1.json"));

  // The old Next export was served at /worktree/<route>; a directory index answers it with or without
  // a trailing slash.
  for (const route of OLD_ROUTES) {
    const dir = join(out, route.slice(1));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.html"), renderStub(targetFor(route)));
  }

  await writeFile(join(out, "index.html"), renderStub(ROOT_URL));
  await writeFile(
    join(out, "404.html"),
    renderStub(ROOT_URL, "Page not found. The documentation has moved"),
  );
  return out;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const out = await buildLegacyBundle(
    process.argv[2] ? { outDir: process.argv[2] } : {},
  );
  console.log(`legacy bundle written to ${out}`);
}
