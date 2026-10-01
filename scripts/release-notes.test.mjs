import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractReleaseNotes } from "./release-notes.mjs";

// Shaped like the output of `changeset version` with @changesets/cli/changelog.
const changelog = `# @northguild/worktree

## 2.1.0

### Minor Changes

- abc1234: Add \`wt prune\` to remove merged worktrees.

  It asks before deleting anything.

### Patch Changes

- def5678: Fix the branch picker on Windows.

## 2.1.0-next.0

### Minor Changes

- 0a1b2c3: Preview of \`wt prune\`.

## 2.0.0

### Major Changes

- 38cffe1: Headless agent mode for branch, list, remove and config.
`;

describe("extractReleaseNotes", () => {
  it("returns the section for a version, including its sub-headings, trimmed", () => {
    expect(extractReleaseNotes(changelog, "2.1.0")).toBe(
      [
        "### Minor Changes",
        "",
        "- abc1234: Add `wt prune` to remove merged worktrees.",
        "",
        "  It asks before deleting anything.",
        "",
        "### Patch Changes",
        "",
        "- def5678: Fix the branch picker on Windows.",
      ].join("\n"),
    );
  });

  it("stops at the next version heading and does not match a prerelease by prefix", () => {
    expect(extractReleaseNotes(changelog, "2.1.0-next.0")).toBe(
      "### Minor Changes\n\n- 0a1b2c3: Preview of `wt prune`.",
    );
  });

  it("reads the last section to the end of the file", () => {
    expect(extractReleaseNotes(changelog, "2.0.0")).toBe(
      "### Major Changes\n\n- 38cffe1: Headless agent mode for branch, list, remove and config.",
    );
  });

  it("returns null for a version with no section", () => {
    expect(extractReleaseNotes(changelog, "9.9.9")).toBeNull();
    expect(extractReleaseNotes(changelog, "2.1")).toBeNull();
  });

  it("returns null for a heading with an empty body", () => {
    expect(extractReleaseNotes("## 1.0.0\n\n## 0.9.0\n\n- x\n", "1.0.0")).toBeNull();
  });

  it("handles CRLF line endings", () => {
    expect(extractReleaseNotes("# p\r\n\r\n## 1.0.0\r\n\r\n- a: b\r\n", "1.0.0")).toBe("- a: b");
  });
});

describe("release-notes CLI", () => {
  const script = fileURLToPath(new URL("./release-notes.mjs", import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), "release-notes-"));
  const file = join(dir, "CHANGELOG.md");
  writeFileSync(file, changelog);

  it("prints the section to stdout", () => {
    const out = execFileSync("node", [script, "2.0.0", file], { encoding: "utf8" });
    expect(out).toBe(
      "### Major Changes\n\n- 38cffe1: Headless agent mode for branch, list, remove and config.\n",
    );
  });

  it("exits non-zero with a clear message when the version is missing", () => {
    const result = spawnSync("node", [script, "9.9.9", file], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("No release notes for version 9.9.9");
  });

  it("exits non-zero when the changelog cannot be read", () => {
    const result = spawnSync("node", [script, "1.0.0", join(dir, "nope.md")], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Cannot read");
  });
});
