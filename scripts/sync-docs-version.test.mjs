import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const scriptSource = fileURLToPath(
  new URL("./sync-docs-version.mjs", import.meta.url),
);

// The script locates package.json and the generated file relative to itself,
// so each run gets a throwaway tree laid out the same way.
const runSync = (pkg) => {
  const root = mkdtempSync(join(tmpdir(), "sync-docs-version-"));
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "docs/src/lib"), { recursive: true });
  copyFileSync(scriptSource, join(root, "scripts/sync-docs-version.mjs"));
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg));
  execFileSync("node", [join(root, "scripts/sync-docs-version.mjs")], {
    stdio: "pipe",
  });
  return readFileSync(join(root, "docs/src/lib/site-meta.ts"), "utf8");
};

const base = { name: "@acme/tool", version: "1.2.3" };
const repository = {
  type: "git",
  url: "git+https://github.com/acme/tool.git",
};

describe("sync-docs-version projectLink", () => {
  // R7: the docs site's "GitHub" link must name the repository even when
  // `homepage` points at the docs site, which is not on github.com.
  it("names the repository when homepage is the docs site", () => {
    const meta = runSync({
      ...base,
      repository,
      homepage: "https://northguild.dev/worktree/",
    });

    expect(meta).toContain('export const projectLink = "https://github.com/acme/tool";');
    expect(meta).toContain('export const projectOwnerName = "acme";');
  });

  it("prefers repository over a homepage that is also on github.com", () => {
    const meta = runSync({
      ...base,
      repository,
      homepage: "https://github.com/other/place",
    });

    expect(meta).toContain('export const projectLink = "https://github.com/acme/tool";');
  });

  it("accepts repository given as a string", () => {
    const meta = runSync({
      ...base,
      repository: "https://github.com/acme/tool.git",
      homepage: "https://example.com/",
    });

    expect(meta).toContain('export const projectLink = "https://github.com/acme/tool";');
  });

  it("falls back to a github.com homepage when there is no repository", () => {
    const meta = runSync({ ...base, homepage: "https://github.com/acme/tool" });

    expect(meta).toContain('export const projectLink = "https://github.com/acme/tool";');
  });

  it("falls back to https://github.com when neither names GitHub", () => {
    const meta = runSync({ ...base, homepage: "https://example.com/" });

    expect(meta).toContain('export const projectLink = "https://github.com";');
  });
});
