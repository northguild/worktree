// @vitest-environment node

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildLegacyBundle } from "./build-legacy-pages.mjs";

const NEW_ROOT = "https://northguild.dev/worktree/";
const SCHEMA_SOURCE = fileURLToPath(
  new URL("../public/schema/v1.json", import.meta.url),
);

// Expected values, written by hand. Old routes: the 24 in
// `git show 2633f3a:docs/src/chat/docs-routes.generated.ts`, plus the two `git show 5c741ee:docs/src/chat/docs-routes.generated.ts` added. Targets: plan D17 (revising D3's root) — `/docs`
// -> the landing at the root, `/docs/<p>` (Getting Started included) -> `/<p>/`, under https://northguild.dev/worktree.
const EXPECTED = {
  "/docs": NEW_ROOT,
  "/docs/changelog": `${NEW_ROOT}changelog/`,
  "/docs/commands": `${NEW_ROOT}commands/`,
  "/docs/commands/branch": `${NEW_ROOT}commands/branch/`,
  "/docs/commands/checkout": `${NEW_ROOT}commands/checkout/`,
  "/docs/commands/cleanup": `${NEW_ROOT}commands/cleanup/`,
  "/docs/commands/config": `${NEW_ROOT}commands/config/`,
  "/docs/commands/linear-listen": `${NEW_ROOT}commands/linear-listen/`,
  "/docs/commands/list": `${NEW_ROOT}commands/list/`,
  "/docs/commands/open": `${NEW_ROOT}commands/open/`,
  "/docs/commands/remove": `${NEW_ROOT}commands/remove/`,
  "/docs/configuration": `${NEW_ROOT}configuration/`,
  "/docs/faq": `${NEW_ROOT}faq/`,
  "/docs/getting-started": `${NEW_ROOT}getting-started/`,
  "/docs/guides": `${NEW_ROOT}guides/`,
  "/docs/guides/clickup-integration": `${NEW_ROOT}guides/clickup-integration/`,
  "/docs/guides/context-switching": `${NEW_ROOT}guides/context-switching/`,
  "/docs/guides/editor-integration": `${NEW_ROOT}guides/editor-integration/`,
  "/docs/guides/env-files": `${NEW_ROOT}guides/env-files/`,
  "/docs/guides/github-issue-integration": `${NEW_ROOT}guides/github-issue-integration/`,
  "/docs/guides/herdr-spaces": `${NEW_ROOT}guides/herdr-spaces/`,
  "/docs/guides/jira-integration": `${NEW_ROOT}guides/jira-integration/`,
  "/docs/guides/linear-agent-delegation": `${NEW_ROOT}guides/linear-agent-delegation/`,
  "/docs/guides/linear-integration": `${NEW_ROOT}guides/linear-integration/`,
  "/docs/guides/team-conventions": `${NEW_ROOT}guides/team-conventions/`,
  "/docs/project-configuration": `${NEW_ROOT}project-configuration/`,
};

let outDir;

beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), "legacy-"));
  await buildLegacyBundle({ outDir });
});

afterAll(async () => {
  await rm(outDir, { recursive: true, force: true });
});

const read = (path) => readFile(join(outDir, path), "utf8");

describe("legacy Pages bundle", () => {
  it("covers exactly the 26 routes at 5c741ee", () => {
    expect(Object.keys(EXPECTED)).toHaveLength(26);
  });

  for (const [route, target] of Object.entries(EXPECTED)) {
    it(`stubs ${route} -> ${target}`, async () => {
      const html = await read(`${route.slice(1)}/index.html`);
      expect(html).toContain(`<link rel="canonical" href="${target}">`);
      expect(html).toContain(
        `<meta http-equiv="refresh" content="0; url=${target}">`,
      );
      // The script keeps the old link's #fragment, and runs before the meta refresh can.
      const script = `<script>location.replace(${JSON.stringify(target)} + location.hash)</script>`;
      expect(html).toContain(script);
      expect(html.indexOf(script)).toBeLessThan(
        html.indexOf('<meta http-equiv="refresh"'),
      );
      expect(html).toContain(`<a href="${target}">`);
      // Nothing but the D3 target is a URL in the stub.
      expect(new Set(html.match(/https?:\/\/[^\s"'<>]+/g))).toEqual(
        new Set([target]),
      );
    });
  }

  it("serves a root stub to the new root", async () => {
    const html = await read("index.html");
    expect(html).toContain(`<link rel="canonical" href="${NEW_ROOT}">`);
    expect(html).toContain(
      `<meta http-equiv="refresh" content="0; url=${NEW_ROOT}">`,
    );
  });

  it("writes a 404.html pointing at the new root", async () => {
    const html = await read("404.html");
    expect(html).toContain(`<a href="${NEW_ROOT}">`);
  });

  it("copies the schema byte-for-byte", async () => {
    const [copied, source] = await Promise.all([
      readFile(join(outDir, "schema/v1.json")),
      readFile(SCHEMA_SOURCE),
    ]);
    expect(copied.equals(source)).toBe(true);
  });
});
