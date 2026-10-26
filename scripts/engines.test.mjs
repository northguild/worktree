import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";
import { describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const rootPackage = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const rootRange = rootPackage.engines.node;

// Installed package.json of a dependency, resolved from the root node_modules.
// Not via require.resolve: some packages do not export "./package.json".
function installedManifest(name) {
  const path = join(root, "node_modules", name, "package.json");
  if (!existsSync(path)) throw new Error(`${name} is not installed; run pnpm install`);
  return JSON.parse(readFileSync(path, "utf8"));
}

// Every installer-visible Node range the root package promises must sit inside
// the range each dependency declares, or `npm install` warns/fails for users.
const violations = (rootNode, dependencies) =>
  dependencies.flatMap(({ name, node }) =>
    node && !semver.subset(rootNode, node)
      ? [
          `${name} requires node "${node}", which does not contain the root engines.node "${rootNode}". ` +
            `Widen or narrow engines.node in package.json and context/stack.md to match.`,
        ]
      : [],
  );

describe("engines.node", () => {
  const dependencies = Object.keys(rootPackage.dependencies).map((name) => ({
    name,
    node: installedManifest(name).engines?.node,
  }));

  it("sits inside the engines.node of every runtime dependency", () => {
    expect(violations(rootRange, dependencies)).toEqual([]);
  });

  it("checks at least one dependency", () => {
    expect(dependencies.filter(({ node }) => node).length).toBeGreaterThan(0);
  });

  it("fails when a dependency range does not contain the root range", () => {
    // A literal root range, not the live one: ">=24" excludes all of ^20.17.0.
    expect(semver.subset("^20.17.0", ">=24")).toBe(false);
    const [message] = violations("^20.17.0", [{ name: "dep-x", node: ">=24" }]);
    expect(message).toContain("dep-x");
    expect(message).toContain(">=24");
    expect(message).toContain("^20.17.0");
    expect(message).toContain("package.json and context/stack.md");
  });

  it("skips a dependency that declares no engines.node", () => {
    expect(violations(rootRange, [{ name: "dep-y", node: undefined }])).toEqual([]);
  });
});
