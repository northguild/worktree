import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as git from "./git.js";
import {
  loadProjectConfig,
  ProjectConfigError,
  projectConfigJsonSchema,
  readProjectConfig,
  resetProjectConfigCache,
} from "./project-config.js";

vi.mock("./git.js", () => ({
  gitResolveOriginHead: vi.fn(),
  gitGetConfigValue: vi.fn(),
  gitReadBlobAtRef: vi.fn(),
  gitHasOriginRemote: vi.fn(),
  gitGetTopLevelPath: vi.fn(),
}));

// The example file from plan §4, verbatim: the expected values below come from
// it and its comments, not from the schema under test.
const EXAMPLE = `# yaml-language-server: $schema=https://northguild.github.io/worktree/schema/v1.json
defaultSourceBranch: origin/main

branchPrefix:
  feature: feat/
  bugfix: fix/
  chore: chore/

jira:
  host: https://acme.atlassian.net
  # First matching rule wins. Ids, because people here use Jira in different languages.
  branchType:
    - when: { customfield_10359: { id: "10301" } }   # Work Category = Maintenance
      type: chore
    - when: { customfield_10359: { id: "10302" } }   # Work Category = Bug
      type: bugfix
    - when: { issuetype: { id: "10008" } }           # Issue Type = Bug
      type: bugfix
    - otherwise: feature

github:
  branchType:
    - when: { Type: Bug }
      type: bugfix
    - when: { Labels: [chore, maintenance] }
      type: chore

branchName: "{prefix}{id}-{slug}"

copy:
  - config/master.key

postCreate:
  - pnpm install
  - pnpm prisma generate
`;

const mocked = vi.mocked(git);
let scratch: string;

function blob(content: string) {
  mocked.gitReadBlobAtRef.mockResolvedValue({ status: "found", content });
}

// Most slices read a file from origin/main with no working copy on disk.
function fromOriginMain(content: string) {
  mocked.gitResolveOriginHead.mockResolvedValue("origin/main");
  blob(content);
}

async function failure(content: string) {
  fromOriginMain(content);
  const error = await readProjectConfig({}).then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ProjectConfigError);
  return error as ProjectConfigError;
}

beforeEach(() => {
  resetProjectConfigCache();
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "wt-project-config-"));
  mocked.gitResolveOriginHead.mockResolvedValue("");
  mocked.gitGetConfigValue.mockResolvedValue("");
  mocked.gitReadBlobAtRef.mockResolvedValue({ status: "absent-path" });
  mocked.gitHasOriginRemote.mockResolvedValue(true);
  mocked.gitGetTopLevelPath.mockResolvedValue(scratch);
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe("readProjectConfig: the example file", () => {
  it("loads every key of the plan's example, from origin/HEAD", async () => {
    fromOriginMain(EXAMPLE);

    const result = await readProjectConfig({});

    expect(mocked.gitReadBlobAtRef).toHaveBeenCalledWith(
      "origin/main",
      ".worktree.yml",
    );
    expect(result).toMatchObject({
      status: "loaded",
      source: { kind: "ref", ref: "origin/main" },
      warnings: [],
    });
    if (result.status !== "loaded") {
      throw new Error("expected a loaded config");
    }
    expect(result.config).toEqual({
      defaultSourceBranch: "origin/main",
      branchPrefix: { feature: "feat/", bugfix: "fix/", chore: "chore/" },
      jira: {
        host: "https://acme.atlassian.net",
        branchType: [
          { when: { customfield_10359: { id: "10301" } }, type: "chore" },
          { when: { customfield_10359: { id: "10302" } }, type: "bugfix" },
          { when: { issuetype: { id: "10008" } }, type: "bugfix" },
          { otherwise: "feature" },
        ],
      },
      github: {
        branchType: [
          { when: { Type: "Bug" }, type: "bugfix" },
          { when: { Labels: ["chore", "maintenance"] }, type: "chore" },
        ],
      },
      branchName: "{prefix}{id}-{slug}",
      copy: ["config/master.key"],
      postCreate: ["pnpm install", "pnpm prisma generate"],
    });
  });
});

describe("readProjectConfig: no project config (D1)", () => {
  it("has no ref when origin/HEAD and the personal key are both unset", async () => {
    const result = await readProjectConfig({});

    expect(result).toMatchObject({ status: "none", reason: "no-ref" });
    expect(mocked.gitReadBlobAtRef).not.toHaveBeenCalled();
  });

  it("names `git remote set-head origin --auto` once when an origin exists", async () => {
    const result = await readProjectConfig({});

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("git remote set-head origin --auto");
  });

  it("stays silent in a repository with no origin", async () => {
    mocked.gitHasOriginRemote.mockResolvedValue(false);

    const result = await readProjectConfig({});

    expect(result).toMatchObject({ status: "none", reason: "no-ref" });
    expect(result.warnings).toEqual([]);
  });

  it("treats a ref that does not resolve as no ref", async () => {
    mocked.gitResolveOriginHead.mockResolvedValue("origin/gone");
    mocked.gitReadBlobAtRef.mockResolvedValue({ status: "absent-ref" });

    const result = await readProjectConfig({});

    expect(result).toMatchObject({ status: "none", reason: "no-ref" });
    // D1: a ref that does not resolve is no ref, and says so like the unset case.
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("origin/gone");
    expect(result.warnings[0]).toContain("git remote set-head origin --auto");
  });

  it("has no file when the ref holds no .worktree.yml", async () => {
    mocked.gitResolveOriginHead.mockResolvedValue("origin/main");
    mocked.gitReadBlobAtRef.mockResolvedValue({ status: "absent-path" });

    expect(await readProjectConfig({})).toMatchObject({
      status: "none",
      reason: "no-file",
    });
  });

  it("calls an empty file empty", async () => {
    fromOriginMain("");

    expect(await readProjectConfig({})).toMatchObject({
      status: "none",
      reason: "empty-file",
    });
  });

  it("calls a file of only comments empty", async () => {
    fromOriginMain("# nothing here yet\n");

    expect(await readProjectConfig({})).toMatchObject({
      status: "none",
      reason: "empty-file",
    });
  });
});

describe("readProjectConfig: which ref (D1)", () => {
  it("falls back to the personal defaultSourceBranch when origin/HEAD is absent", async () => {
    mocked.gitGetConfigValue.mockResolvedValue("origin/develop");
    blob("branchPrefix: { feature: feat/ }\n");

    const result = await readProjectConfig({});

    expect(mocked.gitGetConfigValue).toHaveBeenCalledWith(
      "defaultSourceBranch",
    );
    expect(mocked.gitReadBlobAtRef).toHaveBeenCalledWith(
      "origin/develop",
      ".worktree.yml",
    );
    expect(result).toMatchObject({
      status: "loaded",
      source: { kind: "ref", ref: "origin/develop" },
    });
  });

  it("never uses the file's own defaultSourceBranch as the ref", async () => {
    // The fallback is personal: the file cannot choose which ref it is read from.
    blob("defaultSourceBranch: origin/elsewhere\n");

    const result = await readProjectConfig({});

    expect(result).toMatchObject({ status: "none", reason: "no-ref" });
    expect(mocked.gitReadBlobAtRef).not.toHaveBeenCalled();
  });

  it("prefers origin/HEAD over the personal key", async () => {
    mocked.gitResolveOriginHead.mockResolvedValue("origin/main");
    mocked.gitGetConfigValue.mockResolvedValue("origin/develop");
    blob("copy: [a]\n");

    await readProjectConfig({});

    expect(mocked.gitReadBlobAtRef).toHaveBeenCalledWith(
      "origin/main",
      ".worktree.yml",
    );
  });

  it("reads WORKTREE_PROJECT_CONFIG instead, and announces it", async () => {
    const override = path.join(scratch, "draft.yml");
    fs.writeFileSync(override, "branchPrefix: { chore: chore/ }\n");
    fromOriginMain("branchPrefix: { chore: wrong/ }\n");

    const result = await readProjectConfig({
      WORKTREE_PROJECT_CONFIG: override,
    });

    expect(mocked.gitReadBlobAtRef).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "loaded",
      source: { kind: "path", path: override },
      config: { branchPrefix: { chore: "chore/" } },
    });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("WORKTREE_PROJECT_CONFIG");
    expect(result.warnings[0]).toContain(override);
  });

  it("fails naming the path when the override cannot be read", async () => {
    const missing = path.join(scratch, "absent.yml");

    await expect(
      readProjectConfig({ WORKTREE_PROJECT_CONFIG: missing }),
    ).rejects.toThrow(missing);
  });
});

describe("readProjectConfig: a differing working copy (D1)", () => {
  it("warns once, naming both the working copy and the ref in use", async () => {
    fromOriginMain("copy: [a]\n");
    const working = path.join(scratch, ".worktree.yml");
    fs.writeFileSync(working, "copy: [b]\n");

    const result = await readProjectConfig({});

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(working);
    expect(result.warnings[0]).toContain("origin/main");
  });

  it("is quiet when the working copy matches", async () => {
    fromOriginMain("copy: [a]\n");
    fs.writeFileSync(path.join(scratch, ".worktree.yml"), "copy: [a]\n");

    expect((await readProjectConfig({})).warnings).toEqual([]);
  });

  it("is quiet when the worktree has no copy of its own", async () => {
    fromOriginMain("copy: [a]\n");

    expect((await readProjectConfig({})).warnings).toEqual([]);
  });
});

describe("readProjectConfig: secret keys are refused (D3, D4)", () => {
  it.each([
    ["jira.apiToken", "jira:\n  apiToken: abc123secret\n"],
    ["linear.apiKey", "linear:\n  apiKey: abc123secret\n"],
    ["clickup.apiToken", "clickup:\n  apiToken: abc123secret\n"],
    ["github.token", "github:\n  token: abc123secret\n"],
  ])("refuses %s, naming the key and the rotation", async (key, yaml) => {
    const error = await failure(`copy: [a]\n${yaml}`);

    expect(error.message).toContain(key);
    expect(error.message).toContain("rotate");
    expect(error.message).toContain("line 3");
    expect(error.message).toContain("origin/main");
    // The value is the secret: it must not be copied into the message.
    expect(error.message).not.toContain("abc123secret");
  });

  it("exits 2 as invalid_value", async () => {
    const error = await failure("github:\n  token: x\n");

    expect(error.oclif.exit).toBe(2);
    expect(error.code).toBe("invalid_value");
  });
});

describe("readProjectConfig: a bad file stops the run (D4)", () => {
  it("fails on invalid YAML, naming the file, the ref and the line", async () => {
    const error = await failure("copy: [a]\nbranchPrefix: {feature: x\n");

    expect(error.message).toContain(".worktree.yml");
    expect(error.message).toContain("origin/main");
    expect(error.message).toMatch(/line [23]\b/);
    expect(error.oclif.exit).toBe(2);
  });

  it("fails on a wrong type, naming the key path and the line", async () => {
    const error = await failure("copy: [a]\nbranchPrefix:\n  feature: 5\n");

    expect(error.message).toContain("branchPrefix.feature");
    expect(error.message).toContain("line 3");
    expect(error.message).toContain("origin/main");
  });

  it("names an array index in the key path of a malformed rule", async () => {
    const error = await failure(
      "jira:\n  branchType:\n    - when: { a: b }\n      type: chore\n    - when: { a: b }\n      type: epic\n",
    );

    expect(error.message).toContain("jira.branchType[1].type");
    expect(error.message).toContain("line 6");
  });

  it("counts lines from the file's first byte, blank lines included", async () => {
    const error = await failure("\n\n\nbranchPrefix:\n  feature: 5\n");

    expect(error.message).toContain("branchPrefix.feature (line 5)");
  });

  it("fails on a file that is not a mapping", async () => {
    const error = await failure("- a\n- b\n");

    expect(error.message).toContain(".worktree.yml");
    expect(error.message).toContain("mapping");
  });

  it("names the path, not a ref, when the override file is bad", async () => {
    const override = path.join(scratch, "bad.yml");
    fs.writeFileSync(override, "branchName: 5\n");

    await expect(
      readProjectConfig({ WORKTREE_PROJECT_CONFIG: override }),
    ).rejects.toThrow(override);
  });

  it("refuses a duplicate key rather than silently taking the last", async () => {
    const error = await failure("copy: [a]\ncopy: [b]\n");

    expect(error.message).toContain("line 2");
  });
});

describe("readProjectConfig: keys outside the file's classes (D3, D4)", () => {
  it("warns on an unknown top-level key and ignores it", async () => {
    fromOriginMain("copy: [a]\nfutureThing: 1\n");

    const result = await readProjectConfig({});

    expect(result.status).toBe("loaded");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("futureThing");
    if (result.status === "loaded") {
      expect(result.config).toEqual({ copy: ["a"] });
    }
  });

  it("warns on an unknown key inside a known section", async () => {
    fromOriginMain("jira:\n  host: https://a.example\n  mystery: 1\n");

    const result = await readProjectConfig({});

    expect(result.warnings.join("\n")).toContain("jira.mystery");
  });

  it.each([
    "constructor",
    "toString",
    "__proto__",
  ])("treats the prototype name %s as an unknown key", async (name) => {
    fromOriginMain(`copy: [a]\n${name}:\n  a: 1\n`);

    const result = await readProjectConfig({});

    expect(result.status).toBe("loaded");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(`unknown key \`${name}\``);
  });

  it("treats a prototype name inside a known section as unknown", async () => {
    fromOriginMain("jira:\n  constructor: 1\n  host: https://a.example\n");

    const result = await readProjectConfig({});

    expect(result.status).toBe("loaded");
    expect(result.warnings.join("\n")).toContain("jira.constructor");
  });

  it.each([
    ["opener", "opener: herdr\n"],
    ["codeEditor", "codeEditor: code\n"],
    ["herdr.focus", "herdr:\n  focus: true\n"],
    ["agent.command", "agent:\n  command: claude\n"],
    ["jira.email", "jira:\n  email: a@b.co\n"],
    ["github.autoAssign", "github:\n  autoAssign: true\n"],
    ["jira.autoAssign", "jira:\n  autoAssign: true\n"],
  ])("warns that %s is personal and ignores it", async (key, yaml) => {
    fromOriginMain(`copy: [a]\n${yaml}`);

    const result = await readProjectConfig({});

    expect(result.status).toBe("loaded");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(key);
    expect(result.warnings[0]).toContain(`worktree config ${key}`);
    if (result.status === "loaded") {
      expect(result.config).toEqual({ copy: ["a"] });
    }
  });
});

describe("readProjectConfig: shapes the schema refuses (D8, D12, D14, D15)", () => {
  it.each([
    ["a '..' segment", "copy:\n  - ../secrets\n"],
    ["a '..' segment inside", "copy:\n  - a/../b\n"],
    ["a leading '/'", "copy:\n  - /etc/passwd\n"],
    ["a leading ':'", "copy:\n  - ':(top)x'\n"],
  ])("refuses a copy pattern with %s", async (_label, yaml) => {
    const error = await failure(yaml);

    expect(error.message).toContain("copy[0]");
  });

  it("accepts a plain relative glob in copy", async () => {
    fromOriginMain("copy:\n  - config/*.key\n  - ..env\n");

    expect((await readProjectConfig({})).status).toBe("loaded");
  });

  it("refuses an unknown branchName placeholder", async () => {
    const error = await failure('branchName: "{prefix}{ticket}-{slug}"\n');

    expect(error.message).toContain("branchName");
    expect(error.message).toContain("{ticket}");
  });

  it.each([
    "{prefix}{id}-{slug}",
    "{id}",
    "fixed-{slug}",
  ])("accepts the branchName %s", async (template) => {
    fromOriginMain(`branchName: "${template}"\n`);

    expect((await readProjectConfig({})).status).toBe("loaded");
  });

  it("refuses an otherwise that is not last", async () => {
    const error = await failure(
      "github:\n  branchType:\n    - otherwise: feature\n    - when: { Type: Bug }\n      type: bugfix\n",
    );

    expect(error.message).toContain("github.branchType");
    expect(error.message).toContain("otherwise");
  });

  it("refuses two otherwise rules", async () => {
    const error = await failure(
      "linear:\n  branchType:\n    - otherwise: feature\n    - otherwise: chore\n",
    );

    expect(error.message).toContain("otherwise");
  });

  it("refuses a rule with an empty when", async () => {
    const error = await failure(
      "clickup:\n  branchType:\n    - when: {}\n      type: chore\n",
    );

    expect(error.message).toContain("clickup.branchType[0]");
  });

  it("refuses a rule key the schema does not know", async () => {
    const error = await failure(
      "github:\n  branchType:\n    - when: { Type: Bug }\n      type: bugfix\n      typo: 1\n",
    );

    expect(error.message).toContain("github.branchType[0]");
  });

  it("refuses an empty postCreate step", async () => {
    const error = await failure('postCreate:\n  - pnpm install\n  - "  "\n');

    expect(error.message).toContain("postCreate[1]");
  });

  it("accepts a value as a name, an id object, or a list of either", async () => {
    fromOriginMain(
      "jira:\n  branchType:\n    - when: { a: x, b: { id: 7 }, c: [x, { id: '9' }] }\n      type: chore\n",
    );

    expect((await readProjectConfig({})).status).toBe("loaded");
  });
});

describe("loadProjectConfig", () => {
  it("reads once per run", async () => {
    fromOriginMain("copy: [a]\n");

    const first = await loadProjectConfig();
    const second = await loadProjectConfig();

    expect(second).toBe(first);
    expect(mocked.gitReadBlobAtRef).toHaveBeenCalledTimes(1);
  });
});

describe("the published JSON Schema (D5, D6)", () => {
  it("is Draft 2020-12, the dialect zod emits by default", () => {
    expect(projectConfigJsonSchema().$schema).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
  });

  // Fails when docs/public/schema/v1.json differs from what the zod schema
  // generates. Compared as data, because `pnpm check` reformats the file and
  // byte equality would fight it. To regenerate after a schema change:
  //   UPDATE_PROJECT_SCHEMA=1 pnpm vitest run src/lib/project-config.test.ts
  //   pnpm check:fix
  it("matches the committed docs/public/schema/v1.json", () => {
    const file = fileURLToPath(
      new URL("../../docs/public/schema/v1.json", import.meta.url),
    );
    const generated = projectConfigJsonSchema();
    if (process.env.UPDATE_PROJECT_SCHEMA) {
      fs.writeFileSync(file, `${JSON.stringify(generated, null, 2)}\n`);
    }

    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual(generated);
  });
});
