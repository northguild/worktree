import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { confirm } from "@inquirer/prompts";
import { expectCommands, mockRun } from "../test-setup.js";
import type { ConfigValueSource } from "./config.js";
import * as config from "./config.js";
import { CONFIG_NAMES, SECRET_CONFIG_NAMES } from "./constants.js";
import * as git from "./git.js";
import { setNonInteractive } from "./interaction.js";
import {
  approvePostCreate,
  ensurePostCreateApproved,
  getBranchPrefix,
  getBranchTypeRules,
  getProjectPostCreateSteps,
  getUserPostCreateSteps,
  isProjectFileKey,
  isTeamConfigKey,
  loadProjectConfig,
  markProjectConfigUnusable,
  offerProjectConfig,
  POST_CREATE_APPROVAL_KEY,
  PROJECT_CONFIG_SCHEMA_URL,
  PROJECT_FILE_OFFER_KEY,
  ProjectConfigError,
  postCreateApprovalHash,
  projectConfigJsonSchema,
  projectFileKeys,
  projectFileValue,
  readProjectConfig,
  renderBranchName,
  renderProjectFile,
  resetProjectConfigCache,
  resolveTeamConfig,
  showLinesVisibly,
  summariseProjectFile,
  writeProjectFile,
} from "./project-config.js";
import { MissingValueError } from "./prompt.js";
import {
  resetUserConfigCache,
  USER_CONFIG_OVERRIDE_ENV,
  UserConfigError,
} from "./user-config.js";

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  input: vi.fn(),
  select: vi.fn(),
  checkbox: vi.fn(),
  Separator: class {},
}));

vi.mock("./git.js", () => ({
  gitResolveOriginHead: vi.fn(),
  gitReadBlobAtRef: vi.fn(),
  gitHasOriginRemote: vi.fn(),
  gitGetTopLevelPath: vi.fn(),
}));

vi.mock("./config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./config.js")>()),
  gitGetConfigValue: vi.fn(),
}));

// The example file from plan §4, verbatim: the expected values below come from
// it and its comments, not from the schema under test.
const EXAMPLE = `# yaml-language-server: $schema=https://northguild.dev/worktree/schema/v1.json
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
const mockedConfig = vi.mocked(config);
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

// The user file is read from here and never from the real $HOME: the default
// location points into the scratch directory, which holds no file unless a
// slice writes one (#281).
function userFile(content: string) {
  const file = path.join(scratch, "user-config.yml");
  fs.writeFileSync(file, content);
  vi.stubEnv(USER_CONFIG_OVERRIDE_ENV, file);
}

beforeEach(() => {
  resetProjectConfigCache();
  resetUserConfigCache();
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "wt-project-config-"));
  vi.stubEnv(USER_CONFIG_OVERRIDE_ENV, "");
  vi.stubEnv("XDG_CONFIG_HOME", path.join(scratch, "xdg"));
  mocked.gitResolveOriginHead.mockResolvedValue("");
  mockedConfig.gitGetConfigValue.mockResolvedValue("");
  mocked.gitReadBlobAtRef.mockResolvedValue({ status: "absent-path" });
  mocked.gitHasOriginRemote.mockResolvedValue(true);
  mocked.gitGetTopLevelPath.mockResolvedValue(scratch);
});

afterEach(() => {
  vi.unstubAllEnvs();
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
    mockedConfig.gitGetConfigValue.mockResolvedValue("origin/develop");
    blob("branchPrefix: { feature: feat/ }\n");

    const result = await readProjectConfig({});

    expect(mockedConfig.gitGetConfigValue).toHaveBeenCalledWith(
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
    mockedConfig.gitGetConfigValue.mockResolvedValue("origin/develop");
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

  it("warns that an uncommitted copy is ignored when the ref holds no file", async () => {
    mocked.gitResolveOriginHead.mockResolvedValue("origin/main");
    mocked.gitReadBlobAtRef.mockResolvedValue({ status: "absent-path" });
    const working = path.join(scratch, ".worktree.yml");
    fs.writeFileSync(working, "copy: [b]\n");

    const result = await readProjectConfig({});

    expect(result).toMatchObject({ status: "none", reason: "no-file" });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(working);
    expect(result.warnings[0]).toContain("origin/main");
    expect(result.warnings[0]).toContain("WORKTREE_PROJECT_CONFIG");
  });

  it.each([
    ["the ref holds no file", undefined],
    ["the ref holds a file", "copy: [a]\n"],
  ])("is quiet with no work tree when %s", async (_, content) => {
    if (content === undefined) {
      mocked.gitResolveOriginHead.mockResolvedValue("origin/main");
      mocked.gitReadBlobAtRef.mockResolvedValue({ status: "absent-path" });
    } else {
      fromOriginMain(content);
    }
    mocked.gitGetTopLevelPath.mockRejectedValue(
      new Error("fatal: this operation must be run in a work tree"),
    );

    const result = await readProjectConfig({});

    expect(result.status).toBe(content === undefined ? "none" : "loaded");
    expect(result.warnings).toEqual([]);
  });

  it("is quiet when neither the ref nor the worktree holds a file", async () => {
    mocked.gitResolveOriginHead.mockResolvedValue("origin/main");
    mocked.gitReadBlobAtRef.mockResolvedValue({ status: "absent-path" });

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
    ["linear.agentToken", "linear:\n  agentToken: abc123secret\n"],
    ["linear.webhookSecret", "linear:\n  webhookSecret: abc123secret\n"],
  ])("refuses %s, naming the key and the rotation", async (key, yaml) => {
    const error = await failure(`copy: [a]\n${yaml}`);

    expect(error.message).toContain(key);
    expect(error.message).toContain("rotate");
    expect(error.message).toContain("line 3");
    expect(error.message).toContain("origin/main");
    // The value is the secret: it must not be copied into the message.
    expect(error.message).not.toContain("abc123secret");
  });

  // #115 D8/D9: whether issue text reaches an agent is a decision for one
  // machine, never a committed team value.
  it("drops linear.agentContext from the file with a warning naming it", async () => {
    fromOriginMain("copy: [a]\nlinear:\n  agentContext: true\n");

    const result = await readProjectConfig({});

    expect(result.status).toBe("loaded");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("linear.agentContext");
    expect(result.warnings[0]).toContain("is a personal setting");
    expect(result.warnings[0]).toContain("worktree config linear.agentContext");
    if (result.status === "loaded") {
      expect(result.config).toEqual({ copy: ["a"] });
    }
  });

  // #115 D9: an allowlist of who may delegate is a decision for one machine,
  // never a committed team value; the file drops it and says which key.
  it("drops linear.agentAllow from the file with a warning naming it", async () => {
    fromOriginMain("copy: [a]\nlinear:\n  agentAllow: u1\n");

    const result = await readProjectConfig({});

    expect(result.status).toBe("loaded");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("linear.agentAllow");
    expect(result.warnings[0]).toContain("is a personal setting");
    expect(result.warnings[0]).toContain("worktree config linear.agentAllow");
    expect(result.warnings[0]).not.toContain("unknown key");
    if (result.status === "loaded") {
      expect(result.config).toEqual({ copy: ["a"] });
    }
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
    ["rex.focus", "rex:\n  focus: true\n"],
    ["agent.command", "agent:\n  command: claude\n"],
    ["jira.email", "jira:\n  email: a@b.co\n"],
    ["github.autoAssign", "github:\n  autoAssign: true\n"],
    ["jira.autoAssign", "jira:\n  autoAssign: true\n"],
    ["jira.autoStart", "jira:\n  autoStart: true\n"],
    ["linear.autoStart", "linear:\n  autoStart: true\n"],
    ["clickup.autoAssign", "clickup:\n  autoAssign: true\n"],
    ["clickup.autoStart", "clickup:\n  autoStart: true\n"],
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

// D2: flag -> git config -> project file -> built-in default. The flag and the
// built-in default belong to each caller; the resolver covers the middle two.
// Expected values come from the plan's example file (EXAMPLE) and from D2/D3.
describe("resolveTeamConfig (D2, D3)", () => {
  const fromFile = [
    ["defaultSourceBranch", "origin/main"],
    ["branchPrefix.feature", "feat/"],
    ["branchPrefix.bugfix", "fix/"],
    ["branchPrefix.chore", "chore/"],
    ["jira.host", "https://acme.atlassian.net"],
  ] as const;

  function personal(values: Record<string, string>) {
    mockedConfig.gitGetConfigValue.mockImplementation((name: string) =>
      Promise.resolve(values[name] ?? ""),
    );
  }

  it.each(
    fromFile,
  )("%s comes from the project file when git config has none", async (key, expected) => {
    fromOriginMain(EXAMPLE);

    expect(await resolveTeamConfig(key)).toEqual({
      value: expected,
      source: "project",
    });
  });

  it.each(
    fromFile,
  )("%s in git config wins over the project file", async (key) => {
    fromOriginMain(EXAMPLE);
    personal({ [key]: "mine" });

    expect(await resolveTeamConfig(key)).toEqual({
      value: "mine",
      source: "git-config",
    });
  });

  it("does not read the project file when git config answers", async () => {
    fromOriginMain(EXAMPLE);
    personal({ "jira.host": "mine" });

    await resolveTeamConfig("jira.host");

    expect(mocked.gitReadBlobAtRef).not.toHaveBeenCalled();
  });

  it("reads clickup.workspaceId as text, though YAML parses 9001234 as a number", async () => {
    fromOriginMain("clickup:\n  workspaceId: 9001234\n");

    expect(await resolveTeamConfig("clickup.workspaceId")).toEqual({
      value: "9001234",
      source: "project",
    });
  });

  it("falls through to the built-in default: empty, source default", async () => {
    fromOriginMain("copy: [a]\n");

    expect(await resolveTeamConfig("branchPrefix.feature")).toEqual({
      value: "",
      source: "default",
    });
  });

  it("is empty with no project file at all", async () => {
    expect(await resolveTeamConfig("defaultSourceBranch")).toEqual({
      value: "",
      source: "default",
    });
  });

  it("never reads a file's defaultSourceBranch to find the file (D1)", async () => {
    fromOriginMain(EXAMPLE);

    await resolveTeamConfig("defaultSourceBranch");

    expect(mocked.gitReadBlobAtRef).toHaveBeenCalledWith(
      "origin/main",
      ".worktree.yml",
    );
    expect(mockedConfig.gitGetConfigValue).toHaveBeenCalledTimes(1);
  });

  it("throws the file's error rather than answering with the default", async () => {
    fromOriginMain("defaultSourceBranch: [not, text]\n");

    await expect(resolveTeamConfig("jira.host")).rejects.toBeInstanceOf(
      ProjectConfigError,
    );
  });

  it("reads github.repository from the file, git config first", async () => {
    fromOriginMain("github:\n  repository: acme/widgets\n");

    expect(await resolveTeamConfig("github.repository")).toEqual({
      value: "acme/widgets",
      source: "project",
    });

    personal({ "github.repository": "me/fork" });
    expect(await resolveTeamConfig("github.repository")).toEqual({
      value: "me/fork",
      source: "git-config",
    });
  });

  it("reads github.host from the file, git config first (#120 D7)", async () => {
    fromOriginMain("github:\n  host: ghe.example.com\n");

    expect(await resolveTeamConfig("github.host")).toEqual({
      value: "ghe.example.com",
      source: "project",
    });

    personal({ "github.host": "github.com" });
    expect(await resolveTeamConfig("github.host")).toEqual({
      value: "github.com",
      source: "git-config",
    });
  });

  it("knows exactly the team keys the resolver covers", () => {
    expect(isTeamConfigKey("github.host")).toBe(true);
    expect(isTeamConfigKey("github.repository")).toBe(true);
    expect(isTeamConfigKey("jira.host")).toBe(true);
    expect(isTeamConfigKey("clickup.workspaceId")).toBe(true);
    // Personal and secret keys never come from the file (D3).
    expect(isTeamConfigKey("opener")).toBe(false);
    expect(isTeamConfigKey("jira.email")).toBe(false);
    expect(isTeamConfigKey("jira.apiToken")).toBe(false);
    expect(isTeamConfigKey("postCreate")).toBe(false);
  });
});

// #281 D2/D9: flag -> git config -> project file -> user file -> default. Each
// expected source below is read off that order and the Precedence table in
// docs/src/content/docs/project-configuration.mdx (flag, git, file, default),
// with the user file ranking below the team file; none comes from running the
// resolver. The values differ per layer so a wrong winner shows as a wrong value.
describe("resolveTeamConfig with the user file (#281 D2, D9)", () => {
  // key: [git, project, user], and the nested shape the YAML needs.
  const layers: Record<string, [string, string, string]> = {
    defaultSourceBranch: ["origin/git", "origin/project", "origin/user"],
    "branchPrefix.feature": ["g/", "p/", "u/"],
    "branchPrefix.bugfix": ["gb/", "pb/", "ub/"],
    "branchPrefix.chore": ["gc/", "pc/", "uc/"],
    "jira.host": ["git.example.com", "project.example.com", "user.example.com"],
    "jira.deployment": ["git-value", "datacenter", "cloud"],
    "clickup.workspaceId": ["111", "222", "333"],
    "github.repository": ["git/repo", "project/repo", "user/repo"],
    "github.host": [
      "git.example.com",
      "project.example.com",
      "user.example.com",
    ],
  };

  function yamlFor(key: string, value: string) {
    const [head, child] = key.split(".");
    return child === undefined
      ? `${head}: "${value}"\n`
      : `${head}:\n  ${child}: "${value}"\n`;
  }

  // Which layers hold a value -> the layer that must win.
  const subsets: ReadonlyArray<
    [string, readonly ("git" | "project" | "user")[], ConfigValueSource]
  > = [
    ["git, project and user", ["git", "project", "user"], "git-config"],
    ["git and project", ["git", "project"], "git-config"],
    ["git and user", ["git", "user"], "git-config"],
    ["project and user", ["project", "user"], "project"],
    ["git alone", ["git"], "git-config"],
    ["project alone", ["project"], "project"],
    ["user alone", ["user"], "user"],
  ];
  const winner = { "git-config": 0, project: 1, user: 2 } as const;

  describe.each(Object.keys(layers))("%s", (key) => {
    const values = layers[key] as [string, string, string];

    it.each(subsets)("set in %s", async (_label, present, expectedSource) => {
      if (present.includes("git")) {
        mockedConfig.gitGetConfigValue.mockImplementation((name: string) =>
          Promise.resolve(name === key ? values[0] : ""),
        );
      }
      if (present.includes("project")) {
        fromOriginMain(yamlFor(key, values[1]));
      }
      if (present.includes("user")) {
        userFile(yamlFor(key, values[2]));
      }

      expect(await resolveTeamConfig(key as never)).toEqual({
        value: values[winner[expectedSource as keyof typeof winner]],
        source: expectedSource,
      });
    });

    it("set nowhere is empty with source default", async () => {
      expect(await resolveTeamConfig(key as never)).toEqual({
        value: "",
        source: "default",
      });
    });
  });

  it("reads clickup.workspaceId from the user file as text, though YAML parses 9001234 as a number", async () => {
    userFile("clickup:\n  workspaceId: 9001234\n");

    expect(await resolveTeamConfig("clickup.workspaceId")).toEqual({
      value: "9001234",
      source: "user",
    });
  });

  it("reads the user file only when git config and the project file say nothing", async () => {
    fromOriginMain("defaultSourceBranch: origin/project\n");
    userFile("this: is: not valid yaml: [\n");

    expect(await resolveTeamConfig("defaultSourceBranch")).toEqual({
      value: "origin/project",
      source: "project",
    });
  });

  it("throws the user file's error rather than answering with the default", async () => {
    userFile("jira:\n  host: [not, text]\n");

    await expect(resolveTeamConfig("jira.host")).rejects.toBeInstanceOf(
      UserConfigError,
    );
  });

  it("is unchanged with no user file: no warning, no output", async () => {
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    fromOriginMain("defaultSourceBranch: origin/project\n");

    expect(await resolveTeamConfig("defaultSourceBranch")).toEqual({
      value: "origin/project",
      source: "project",
    });
    expect(stderr).not.toHaveBeenCalled();
    expect(stdout).not.toHaveBeenCalled();
  });
});

describe("getUserPostCreateSteps (#281 D10)", () => {
  it("is the user file's steps, trimmed", async () => {
    userFile("postCreate:\n  - ' pnpm install '\n  - pnpm build\n");

    expect(await getUserPostCreateSteps()).toEqual([
      "pnpm install",
      "pnpm build",
    ]);
  });

  it("is empty with no user file", async () => {
    expect(await getUserPostCreateSteps()).toEqual([]);
  });

  it("is empty when the file sets no steps", async () => {
    userFile("opener: none\n");

    expect(await getUserPostCreateSteps()).toEqual([]);
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

  // The editor flags what the pattern refuses; lengths and the ., .. and .git
  // names are left to the load.
  it("gives github.repository a pattern an editor can check", () => {
    const { github } = projectConfigJsonSchema().properties as Record<
      string,
      { properties: Record<string, { pattern: string }> }
    >;
    const pattern = new RegExp(github.properties.repository.pattern);

    expect(pattern.test("acme/widgets")).toBe(true);
    expect(pattern.test("mona-cat_octo/widgets")).toBe(true);
    expect(pattern.test("acme")).toBe(false);
    expect(pattern.test("acme/widgets/extra")).toBe(false);
    expect(pattern.test("https://github.com/acme/widgets")).toBe(false);
    expect(pattern.test("acme/wid gets")).toBe(false);
  });
});

// D12: placeholders {prefix}, {id}, {slug}; the default is today's name. The
// expected names come from D12 and from the example file's "{prefix}{id}-{slug}".
describe("renderBranchName (D12)", () => {
  const parts = { prefix: "fix/", id: "ENG-7", slug: "fix-login" };

  it("gives today's name when the file has no branchName", async () => {
    fromOriginMain("copy: [a]\n");

    expect(await renderBranchName(parts)).toBe("fix/ENG-7-fix-login");
  });

  it("gives today's name when there is no project file", async () => {
    expect(await renderBranchName(parts)).toBe("fix/ENG-7-fix-login");
  });

  it("gives today's name for the example file's own template", async () => {
    fromOriginMain(EXAMPLE);

    expect(await renderBranchName(parts)).toBe("fix/ENG-7-fix-login");
  });

  it("fills a different template with each placeholder", async () => {
    fromOriginMain('branchName: "{id}/{prefix}{slug}"\n');

    expect(await renderBranchName(parts)).toBe("ENG-7/fix/fix-login");
  });

  it("does not expand a placeholder that appears inside a value", async () => {
    fromOriginMain('branchName: "{prefix}{id}-{slug}"\n');

    expect(await renderBranchName({ prefix: "", id: "7", slug: "{id}" })).toBe(
      "7-{id}",
    );
  });
});

describe("getBranchTypeRules and getBranchPrefix", () => {
  it("reads one provider's rules from the example file", async () => {
    fromOriginMain(EXAMPLE);

    expect((await getBranchTypeRules("github"))?.rules).toEqual([
      { when: { Type: "Bug" }, type: "bugfix" },
      { when: { Labels: ["chore", "maintenance"] }, type: "chore" },
    ]);
    expect(await getBranchTypeRules("linear")).toBeUndefined();
  });

  it("has no rules without a project file", async () => {
    expect(await getBranchTypeRules("clickup")).toBeUndefined();
  });

  // D1 (provider list, then shared list), D7 (listName words the dry run).
  it("names the provider's own list when it sets one", async () => {
    fromOriginMain(EXAMPLE);

    expect(await getBranchTypeRules("github")).toMatchObject({
      listName: "github.branchType",
    });
  });

  it("falls back to the shared list, named branchType", async () => {
    fromOriginMain("branchType:\n  - otherwise: feature\n");

    for (const provider of ["jira", "github", "linear", "clickup"] as const) {
      expect(await getBranchTypeRules(provider)).toEqual({
        rules: [{ otherwise: "feature" }],
        listName: "branchType",
        shared: true,
      });
    }
  });

  it("prefers the provider's list over the shared one, for that provider only", async () => {
    fromOriginMain(
      "branchType:\n  - otherwise: chore\ngithub:\n  branchType:\n    - otherwise: bugfix\n",
    );

    expect(await getBranchTypeRules("github")).toEqual({
      rules: [{ otherwise: "bugfix" }],
      listName: "github.branchType",
      shared: false,
    });
    expect(await getBranchTypeRules("linear")).toEqual({
      rules: [{ otherwise: "chore" }],
      listName: "branchType",
      shared: true,
    });
  });

  it("rejects a bad rule in the shared list like any other", async () => {
    const error = await failure("branchType:\n  - otherwise: epic\n");

    expect(error.message).toContain("branchType[0]");
  });

  it("lists the shared list in --list", async () => {
    fromOriginMain("branchType:\n  - otherwise: feature\n");
    const loaded = await loadProjectConfig();
    if (loaded.status !== "loaded") {
      throw new Error("expected a loaded file");
    }

    expect(summariseProjectFile(loaded.config)).toContain(
      "branchType: 1 rule (.worktree.yml)",
    );
  });

  it.each([
    ["feature", "feat/"],
    ["bugfix", "fix/"],
    ["chore", "chore/"],
  ] as const)("the %s prefix is %s in the example file", async (kind, expected) => {
    fromOriginMain(EXAMPLE);

    expect(await getBranchPrefix(kind)).toBe(expected);
  });

  it("is empty for no kind, whatever the file says", async () => {
    fromOriginMain(EXAMPLE);

    expect(await getBranchPrefix(undefined)).toBe("");
  });
});

// Phase 7 (#181), D15/D16/D22. Expected values come from the plan: the hash of
// the §4 example's steps was computed outside this code, with
// `printf '%s' '["pnpm install","pnpm prisma generate"]' | shasum -a 256`
// (an independent SHA-256 over the bytes D16 defines), and the messages from D16.
describe("post-create approval", () => {
  const STEPS = ["pnpm install", "pnpm prisma generate"];
  const STEPS_HASH =
    "085b75c700b8be5a24f7d7c0fe76efa00d5cad067c3895aed7dddf53a79f56de";
  const REORDERED_HASH =
    "2d41837c4a077d267bfbb058703e515e342e5e5f6a95aab3c67d53ff730ea7c9";
  const CHANGED_HASH =
    "5154217f8a8823c092af6dc51f380ab1aa11dd9f4bd50794618cee083c054194";
  let stored: string;
  let personal: string;
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stored = "";
    personal = "";
    expectCommands(
      `git config --local ${POST_CREATE_APPROVAL_KEY}`,
      ...[STEPS_HASH, REORDERED_HASH, CHANGED_HASH].map(
        (hash) => `git config --local ${POST_CREATE_APPROVAL_KEY} ${hash}`,
      ),
    );
    mockRun.mockImplementation(async (_file: string, args: string[]) => {
      if (args.length === 3) {
        if (stored) return stored;
        throw new Error("exit 1");
      }
      stored = args[args.length - 1] ?? "";
      return "";
    });
    mockedConfig.gitGetConfigValue.mockImplementation(async (name: string) =>
      name === "postCreate" ? personal : "",
    );
    fromOriginMain(
      "postCreate:\n  - pnpm install\n  -   pnpm prisma generate  \n",
    );
    vi.mocked(confirm).mockReset();
    log = vi.spyOn(console, "error").mockImplementation(() => {});
    setNonInteractive(false);
  });

  afterEach(() => {
    log.mockRestore();
    setNonInteractive(false);
  });

  it("hashes the JSON array of the trimmed steps (value from shasum)", () => {
    expect(postCreateApprovalHash(STEPS)).toBe(STEPS_HASH);
    expect(
      postCreateApprovalHash([" pnpm install ", "pnpm prisma generate\n"]),
    ).toBe(STEPS_HASH);
  });

  it("hashes a different order differently (value from shasum)", () => {
    expect(postCreateApprovalHash([...STEPS].reverse())).toBe(REORDERED_HASH);
  });

  it("keeps the approval key out of CONFIG_NAMES", () => {
    expect(POST_CREATE_APPROVAL_KEY.startsWith("northguild.worktree.")).toBe(
      true,
    );
    const bare = POST_CREATE_APPROVAL_KEY.replace("northguild.worktree.", "");
    expect(CONFIG_NAMES as readonly string[]).not.toContain(bare);
    expect(CONFIG_NAMES as readonly string[]).not.toContain(
      POST_CREATE_APPROVAL_KEY,
    );
  });

  it("reads the file's steps trimmed", async () => {
    expect(await getProjectPostCreateSteps()).toEqual(STEPS);
  });

  it("needs nothing when the file has no steps", async () => {
    fromOriginMain("postCreate: []\n");
    setNonInteractive(true);

    await expect(ensurePostCreateApproved({})).resolves.toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("needs no approval for the user file's own steps (#281 D10)", async () => {
    fromOriginMain("postCreate: []\n");
    userFile("postCreate:\n  - pnpm install\n");
    setNonInteractive(true);

    await expect(ensurePostCreateApproved({})).resolves.toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("stops before anything is created when the user file cannot be used (#281)", async () => {
    fromOriginMain("postCreate: []\n");
    userFile("postCreate: [not valid\n");
    setNonInteractive(true);

    await expect(ensurePostCreateApproved({})).rejects.toBeInstanceOf(
      UserConfigError,
    );
  });

  it("fails closed non-interactively: exit 2, naming both ways out, never the hash", async () => {
    setNonInteractive(true);

    const error = await ensurePostCreateApproved({}).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(MissingValueError);
    const { message, value, flag, oclif } = error as MissingValueError & {
      oclif: { exit: number };
    };
    expect(oclif.exit).toBe(2);
    expect(message).toContain("worktree config --approve");
    expect(message).toContain("--no-install");
    for (const text of [message, value, flag]) {
      expect(text).not.toContain(STEPS_HASH);
      expect(text).not.toMatch(/[0-9a-f]{64}/);
    }
    expect(stored).toBe("");
  });

  it("asks interactively with every step listed, and yes stores the hash", async () => {
    vi.mocked(confirm).mockResolvedValue(true);

    await ensurePostCreateApproved({});

    const shown = log.mock.calls.flat().join("\n");
    expect(shown).toContain("pnpm install");
    expect(shown).toContain("pnpm prisma generate");
    expect(stored).toBe(STEPS_HASH);
    expect(mockRun).toHaveBeenCalledWith("git", [
      "config",
      "--local",
      POST_CREATE_APPROVAL_KEY,
      STEPS_HASH,
    ]);
  });

  it("does not ask again once approved", async () => {
    stored = STEPS_HASH;
    setNonInteractive(true);

    await expect(ensurePostCreateApproved({})).resolves.toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks again when one step changed", async () => {
    stored = STEPS_HASH;
    fromOriginMain("postCreate:\n  - pnpm install\n  - pnpm prisma migrate\n");
    vi.mocked(confirm).mockResolvedValue(true);

    await ensurePostCreateApproved({});

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(stored).toBe(CHANGED_HASH);
  });

  it("asks again when the order changed", async () => {
    stored = STEPS_HASH;
    fromOriginMain("postCreate:\n  - pnpm prisma generate\n  - pnpm install\n");
    vi.mocked(confirm).mockResolvedValue(true);

    await ensurePostCreateApproved({});

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(stored).toBe(REORDERED_HASH);
  });

  it("exits 1 and stores nothing when the answer is no", async () => {
    vi.mocked(confirm).mockResolvedValue(false);

    const error = await ensurePostCreateApproved({}).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect((error as { oclif?: { exit: number } }).oclif?.exit).toBe(1);
    expect(stored).toBe("");
  });

  it("needs no approval with --no-install", async () => {
    setNonInteractive(true);

    await expect(
      ensurePostCreateApproved({ install: false }),
    ).resolves.toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("needs no approval when a personal postCreate wins (D2)", async () => {
    personal = "make setup";
    setNonInteractive(true);

    await expect(ensurePostCreateApproved({})).resolves.toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("approvePostCreate refuses non-interactively and stores nothing", async () => {
    setNonInteractive(true);

    await expect(approvePostCreate()).rejects.toThrow(MissingValueError);
    expect(stored).toBe("");
  });

  it("approvePostCreate shows the steps, asks, and stores on yes", async () => {
    vi.mocked(confirm).mockResolvedValue(true);

    await approvePostCreate();

    expect(log.mock.calls.flat().join("\n")).toContain("pnpm prisma generate");
    expect(stored).toBe(STEPS_HASH);
  });

  it("approvePostCreate says so when the file has no steps", async () => {
    fromOriginMain("copy: []\n");

    await approvePostCreate();

    expect(confirm).not.toHaveBeenCalled();
    expect(stored).toBe("");
  });
});

// Phase 7 gate 2, B1: the approval prompt shows the step as text, so a step
// that can redraw the terminal or reorder what is shown (carriage return,
// escape, newline, tab, bidi override) would run something the person never
// saw. Such a file is refused at load, before any prompt (D4, D16).
describe("postCreate steps: control and formatting characters", () => {
  it.each([
    ["a carriage return", "touch pwned\\r  2. pnpm install"],
    ["an escape", "touch pwned\\e[2K"],
    ["a newline", "touch pwned\\n  2. pnpm install"],
    ["a tab", "touch\\tpwned"],
    ["a bidi override (U+202E)", "touch \\u202Epwned"],
  ])("refuses a step holding %s, naming the key path", async (_name, yaml) => {
    const error = await failure(
      `postCreate:\n  - pnpm install\n  - "${yaml}"\n`,
    );

    expect(error.message).toContain("postCreate[1] (line 3)");
    expect(error.message).toContain("control or formatting characters");
  });

  it("still accepts an ordinary step with spaces and quotes", async () => {
    fromOriginMain(`postCreate:\n  - make "setup all" --flag='x y'\n`);

    const result = await readProjectConfig({});

    expect(result).toMatchObject({
      status: "loaded",
      config: { postCreate: [`make "setup all" --flag='x y'`] },
    });
  });
});

// Phase 7 gate 2, B3: a key from the file reaches warnings printed before the
// approval prompt. Raw ESC or CR in one could redraw the terminal and hide the
// steps, so every control or formatting character is shown as an escape.
describe("file-derived text in warnings is shown, not interpreted", () => {
  it("escapes ESC and CR in an unknown key's warning", async () => {
    fromOriginMain('"x\\r\\e[8mhidden": 1\npostCreate:\n  - pnpm install\n');

    const result = await readProjectConfig({});

    const text = result.warnings.join(" ");
    expect(text).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    expect(text).toContain("x\\x0d\\x1b[8mhidden");
    expect(text).toContain("unknown key");
  });

  it("escapes a nested unknown key and a personal key the same way", async () => {
    fromOriginMain('jira:\n  "a\\e[2K": 1\n"opener\\r": x\n');

    const result = await readProjectConfig({});

    expect(result.warnings).toHaveLength(2);
    for (const warning of result.warnings) {
      expect(warning).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    }
  });

  it("leaves a plain unknown key's warning unchanged", async () => {
    fromOriginMain("surprise: 1\n");

    const result = await readProjectConfig({});

    expect(result.warnings).toEqual([
      "surprise (line 1): unknown key `surprise` is ignored. A newer version of worktree may know it.".replace(
        /^/,
        ".worktree.yml at origin/main: ",
      ),
    ]);
  });
});

// ---------------------------------------------------------------------------
// Phase 8 (#181): D19-D22. Expected values come from the plan's §4 example
// file and from D20's wording, never from the writer under test.
// ---------------------------------------------------------------------------

describe("github.repository in the file (#119)", () => {
  async function loads(content: string) {
    fromOriginMain(content);
    const result = await readProjectConfig({});
    if (result.status !== "loaded") throw new Error("did not load");
    return result.config;
  }

  it("loads, and is a project-file key", async () => {
    const config = await loads("github:\n  repository: acme/widgets\n");

    expect(config.github?.repository).toBe("acme/widgets");
    expect(isProjectFileKey("github.repository")).toBe(true);
    expect(projectFileValue(config, "github.repository")).toBe("acme/widgets");
    expect(projectFileKeys(config)).toEqual(["github.repository"]);
  });

  it("loads beside the github branchType rules", async () => {
    const config = await loads(
      "github:\n  repository: acme/widgets\n  branchType:\n    - otherwise: feature\n",
    );

    expect(config.github?.repository).toBe("acme/widgets");
    expect(config.github?.branchType).toHaveLength(1);
  });

  it.each([
    "acme/widgets/extra",
    "https://github.com/acme/widgets",
    "acme/..",
    "acme/widgets.git",
    "acme",
    '""',
    "[acme/widgets]",
  ])("fails to load with repository %s, as ProjectConfigError", async (value) => {
    const error = await failure(`github:\n  repository: ${value}\n`);

    expect(error.message).toContain("github.repository");
  });

  // The pattern and the refine both refuse a bad shape; the file says so once.
  it("names a value the pattern refuses once, not twice", async () => {
    const error = await failure("github:\n  repository: acme\n");

    expect(error.message.match(/must be owner\/repo/g)).toHaveLength(1);
  });

  it("loads a managed user's fork, whose owner ends in _ and a shortcode", async () => {
    const config = await loads(
      "github:\n  repository: mona-cat_octo/widgets\n",
    );

    expect(config.github?.repository).toBe("mona-cat_octo/widgets");
  });

  it("is written by renderProjectFile and loads as written", async () => {
    const text = renderProjectFile({ "github.repository": "acme/widgets" });

    expect(text).toContain("github:\n  repository: acme/widgets");
    expect((await loads(text)).github?.repository).toBe("acme/widgets");
  });
});

describe("github.host in the file (#120 D7)", () => {
  async function loads(content: string) {
    fromOriginMain(content);
    const result = await readProjectConfig({});
    if (result.status !== "loaded") throw new Error("did not load");
    return result.config;
  }

  it("loads, and is a project-file key", async () => {
    const config = await loads("github:\n  host: ghe.example.com\n");

    expect(config.github?.host).toBe("ghe.example.com");
    expect(isProjectFileKey("github.host")).toBe(true);
    expect(projectFileValue(config, "github.host")).toBe("ghe.example.com");
    expect(projectFileKeys(config)).toEqual(["github.host"]);
  });

  it("loads beside github.repository", async () => {
    const config = await loads(
      "github:\n  host: ghe.example.com\n  repository: acme/widgets\n",
    );

    expect(config.github?.host).toBe("ghe.example.com");
    expect(config.github?.repository).toBe("acme/widgets");
  });

  it.each([
    "https://ghe.example.com",
    "ghe.example.com:8443",
    "ghe.example.com/",
    "api.github.com",
    "ghe.example.com.",
    '""',
    "[ghe.example.com]",
  ])("fails to load with host %s, as ProjectConfigError", async (value) => {
    const error = await failure(`github:\n  host: ${value}\n`);

    expect(error.message).toContain("github.host");
  });

  it("is written by renderProjectFile and loads as written", async () => {
    const text = renderProjectFile({ "github.host": "ghe.example.com" });

    expect(text).toContain("github:\n  host: ghe.example.com");
    expect((await loads(text)).github?.host).toBe("ghe.example.com");
  });

  // The editor flags what the pattern refuses; the load adds github.com's own
  // subdomains and the 255-character total.
  it("gives github.host a pattern an editor can check in the published schema", () => {
    const { github } = projectConfigJsonSchema().properties as Record<
      string,
      { properties: { host: { pattern?: string; description?: string } } }
    >;
    const { pattern, description } = github.properties.host;

    expect(description).toContain("GitHub Enterprise");
    expect(new RegExp(pattern ?? "").test("ghe.example.com")).toBe(true);
    expect(new RegExp(pattern ?? "").test("https://ghe.example.com")).toBe(
      false,
    );
    expect(new RegExp(pattern ?? "").test("ghe.example.com:8443")).toBe(false);
  });
});

// #126 D2: jira.deployment is a team key, exactly `cloud` or `datacenter`.
describe("jira.deployment in the file (#126 D2)", () => {
  async function loads(content: string) {
    fromOriginMain(content);
    const result = await readProjectConfig({});
    if (result.status !== "loaded") throw new Error("did not load");
    return result.config;
  }

  it("loads as a team key, and is a project-file key", async () => {
    const config = await loads("jira:\n  deployment: datacenter\n");

    expect(config.jira?.deployment).toBe("datacenter");
    expect(isTeamConfigKey("jira.deployment")).toBe(true);
    expect(isProjectFileKey("jira.deployment")).toBe(true);
    expect(projectFileValue(config, "jira.deployment")).toBe("datacenter");
    expect(projectFileKeys(config)).toEqual(["jira.deployment"]);
  });

  it("loads beside jira.host", async () => {
    const config = await loads(
      "jira:\n  host: https://jira.example.com\n  deployment: datacenter\n",
    );

    expect(config.jira?.deployment).toBe("datacenter");
    expect(config.jira?.host).toBe("https://jira.example.com");
  });

  it("reads it from the file, git config first", async () => {
    fromOriginMain("jira:\n  deployment: datacenter\n");

    expect(await resolveTeamConfig("jira.deployment")).toEqual({
      value: "datacenter",
      source: "project",
    });

    mockedConfig.gitGetConfigValue.mockImplementation((name: string) =>
      Promise.resolve(name === "jira.deployment" ? "cloud" : ""),
    );
    expect(await resolveTeamConfig("jira.deployment")).toEqual({
      value: "cloud",
      source: "git-config",
    });
  });

  it.each([
    "server",
    "Cloud",
    "data-center",
    '""',
  ])("fails to load with deployment %s, naming the key", async (value) => {
    const error = await failure(`jira:\n  deployment: ${value}\n`);

    expect(error.message).toContain("jira.deployment");
  });

  it("is written by renderProjectFile and loads as written", async () => {
    const text = renderProjectFile({ "jira.deployment": "datacenter" });

    expect(text).toContain("jira:\n  deployment: datacenter");
    expect((await loads(text)).jira?.deployment).toBe("datacenter");
  });

  it("is an enum of exactly cloud and datacenter in the published schema", () => {
    const { jira } = projectConfigJsonSchema().properties as Record<
      string,
      { properties: { deployment: { enum?: string[] } } }
    >;

    expect(jira.properties.deployment.enum).toEqual(["cloud", "datacenter"]);
  });
});

describe("projectFileKeys and projectFileValue (D19)", () => {
  it("lists the keys the example file sets, in the order the wizard knows them", async () => {
    fromOriginMain(EXAMPLE);
    const result = await readProjectConfig({});
    if (result.status !== "loaded") throw new Error("example did not load");

    expect(projectFileKeys(result.config)).toEqual([
      "defaultSourceBranch",
      "branchPrefix.feature",
      "branchPrefix.bugfix",
      "branchPrefix.chore",
      "jira.host",
      "postCreate",
    ]);
    expect(projectFileValue(result.config, "jira.host")).toBe(
      "https://acme.atlassian.net",
    );
    expect(projectFileValue(result.config, "postCreate")).toBe(
      "pnpm install; pnpm prisma generate",
    );
  });

  it("counts a postCreate with no steps as not set", async () => {
    fromOriginMain("postCreate: []\n");
    const result = await readProjectConfig({});
    if (result.status !== "loaded") throw new Error("did not load");

    expect(projectFileKeys(result.config)).toEqual([]);
  });
});

describe("summariseProjectFile (D19)", () => {
  it("gives one line per file-only key, with counts, for the example file", async () => {
    fromOriginMain(EXAMPLE);
    const result = await readProjectConfig({});
    if (result.status !== "loaded") throw new Error("example did not load");

    // Counts read off the example in plan §4: jira has 4 rules, github 2,
    // copy 1 pattern, postCreate 2 steps.
    expect(summariseProjectFile(result.config)).toEqual([
      "jira.branchType: 4 rules (.worktree.yml)",
      "github.branchType: 2 rules (.worktree.yml)",
      "branchName={prefix}{id}-{slug} (.worktree.yml)",
      "copy: 1 pattern (.worktree.yml)",
      "postCreate: 2 steps (.worktree.yml)",
    ]);
  });

  it("uses the singular for one rule or step and shows a template visibly", async () => {
    fromOriginMain(
      'github:\n  branchType:\n    - otherwise: chore\nbranchName: "{id}\\e[2K"\npostCreate:\n  - pnpm install\n',
    );
    const result = await readProjectConfig({});
    if (result.status !== "loaded") throw new Error("did not load");

    expect(summariseProjectFile(result.config)).toEqual([
      "github.branchType: 1 rule (.worktree.yml)",
      "branchName={id}\\x1b[2K (.worktree.yml)",
      "postCreate: 1 step (.worktree.yml)",
    ]);
  });

  it("is empty for a file with no file-only keys", async () => {
    fromOriginMain("defaultSourceBranch: origin/main\n");
    const result = await readProjectConfig({});
    if (result.status !== "loaded") throw new Error("did not load");

    expect(summariseProjectFile(result.config)).toEqual([]);
  });
});

// A model of git config, so the writer and the offers run end to end against
// something that answers like git: `gitGetConfigValue` reads every scope, the
// `--local` calls read and write the local one.
function fakeGitConfig(initial: Record<string, string> = {}) {
  const local = new Map<string, string>(
    Object.entries(initial).map(([name, value]) => [
      `northguild.worktree.${name}`,
      value,
    ]),
  );
  const global = new Map<string, string>();
  mockedConfig.gitGetConfigValue.mockImplementation(async (name: string) => {
    const key = `northguild.worktree.${name}`;
    return local.get(key) ?? global.get(key) ?? "";
  });
  // git's exit codes, on the error as execFile puts them: 1 for a key that is
  // not set, 5 for an unset of a key that is not there.
  const exit = (code: number) =>
    Object.assign(new Error(`exit ${code}`), { code });
  mockRun.mockImplementation(async (_file: string, args: string[]) => {
    const [, scope, a, b] = args;
    if (scope === "--show-scope" && a === "--get-all" && b) {
      // In git's order: global before local.
      const entries = [
        ...(global.has(b) ? [`global\t${global.get(b)}`] : []),
        ...(local.has(b) ? [`local\t${local.get(b)}`] : []),
      ];
      if (entries.length === 0) throw exit(1);
      return entries.join("\n");
    }
    if (scope !== "--local")
      throw new Error(`unexpected git ${args.join(" ")}`);
    if (a === "--unset") {
      if (!b || !local.delete(b)) throw exit(5);
      return "";
    }
    if (b === undefined) {
      const value = a === undefined ? undefined : local.get(a);
      if (value === undefined) throw exit(1);
      return value;
    }
    local.set(a as string, b);
    return "";
  });
  return { local, global };
}

const SECRET_VALUES: Record<string, string> = {
  "jira.apiToken": "jira-secret-value-1",
  "linear.apiKey": "linear-secret-value-2",
  "clickup.apiToken": "clickup-secret-value-3",
  "github.token": "github-secret-value-4",
  "linear.agentToken": "linear-agent-secret-value-5",
  "linear.webhookSecret": "linear-webhook-secret-value-6",
};
// Personal keys per D3, each with a value no team key shares.
const PERSONAL_VALUES: Record<string, string> = {
  opener: "personal-opener-value",
  codeEditor: "personal-editor-value",
  "herdr.focus": "personal-focus-value",
  "herdr.agent": "personal-herdragent-value",
  "rex.focus": "personal-rexfocus-value",
  "agent.command": "personal-agentcmd-value",
  "jira.email": "personal-email-value",
  "jira.autoAssign": "personal-jira-assign-value",
  "jira.autoStart": "personal-jira-start-value",
  "github.autoAssign": "personal-github-assign-value",
  "linear.autoStart": "personal-linear-start-value",
  "clickup.autoAssign": "personal-clickup-assign-value",
  "clickup.autoStart": "personal-clickup-start-value",
};
const TEAM_VALUES: Record<string, string> = {
  defaultSourceBranch: "origin/main",
  "branchPrefix.feature": "feat/",
  "branchPrefix.bugfix": "fix/",
  "branchPrefix.chore": "chore/",
  "jira.host": "https://acme.atlassian.net",
  "clickup.workspaceId": "9001234",
  postCreate: "pnpm install",
};

describe("writeProjectFile (D20)", () => {
  const target = () => path.join(scratch, ".worktree.yml");

  it("writes the commented file, in the example's shape, from the team keys", async () => {
    fakeGitConfig({
      defaultSourceBranch: "origin/main",
      "branchPrefix.feature": "feat/",
      "branchPrefix.bugfix": "fix/",
      "jira.host": "https://acme.atlassian.net",
      postCreate: "pnpm install",
    });

    const written = await writeProjectFile();

    expect(written).toEqual({
      path: target(),
      keys: [
        "defaultSourceBranch",
        "branchPrefix.feature",
        "branchPrefix.bugfix",
        "jira.host",
        "postCreate",
      ],
    });
    // Built by hand from plan §4: the $schema line first, a blank line between
    // sections, and the personal postCreate string as a one-step list.
    expect(
      fs.readFileSync(target(), "utf8"),
    ).toBe(`# yaml-language-server: $schema=${PROJECT_CONFIG_SCHEMA_URL}
# Team settings for worktree, written by \`worktree config --project\` from your git config.
# Review it, commit it to the default branch, and everyone shares these settings.
# Settings that belong to one person never go in this file.

defaultSourceBranch: origin/main

branchPrefix:
  feature: feat/
  bugfix: fix/

jira:
  host: https://acme.atlassian.net

postCreate:
  - pnpm install
`);
  });

  it("holds the schema line from #181 verbatim", async () => {
    fakeGitConfig({ defaultSourceBranch: "origin/main" });
    await writeProjectFile();

    expect(fs.readFileSync(target(), "utf8").split("\n")[0]).toBe(
      "# yaml-language-server: $schema=https://northguild.dev/worktree/schema/v1.json",
    );
  });

  it("never writes a personal or secret key, by name or by value", async () => {
    fakeGitConfig({
      ...TEAM_VALUES,
      ...PERSONAL_VALUES,
      ...SECRET_VALUES,
    });

    await writeProjectFile();
    const text = fs.readFileSync(target(), "utf8");

    // Every personal key from D3 and every SECRET_CONFIG_NAMES key is set above.
    expect(Object.keys(SECRET_VALUES).sort()).toEqual(
      [...SECRET_CONFIG_NAMES].sort(),
    );
    for (const [name, value] of [
      ...Object.entries(PERSONAL_VALUES),
      ...Object.entries(SECRET_VALUES),
    ]) {
      expect(text).not.toContain(name);
      expect(text).not.toContain(value);
      // The last segment is what a nested YAML key would be spelled as.
      expect(text).not.toContain(name.split(".").pop() as string);
    }
    expect(text).not.toContain("has-called-config");
  });

  it("round-trips through the loader unchanged", async () => {
    fakeGitConfig(TEAM_VALUES);

    await writeProjectFile();
    const result = await readProjectConfig({
      WORKTREE_PROJECT_CONFIG: target(),
    });

    expect(result.status).toBe("loaded");
    if (result.status !== "loaded") return;
    expect(result.config).toEqual({
      defaultSourceBranch: "origin/main",
      branchPrefix: { feature: "feat/", bugfix: "fix/", chore: "chore/" },
      jira: { host: "https://acme.atlassian.net" },
      // A text value, so an id that looks like a number stays text.
      clickup: { workspaceId: "9001234" },
      postCreate: ["pnpm install"],
    });
    // Only the override notice: no personal-key or unknown-key warning.
    expect(result.warnings).toHaveLength(1);
  });

  it("refuses to overwrite an existing working copy", async () => {
    fakeGitConfig({ defaultSourceBranch: "origin/main" });
    fs.writeFileSync(target(), "# mine\n");

    await expect(writeProjectFile()).rejects.toThrow(/already exists/);
    expect(fs.readFileSync(target(), "utf8")).toBe("# mine\n");
  });

  it("says so, and writes nothing, when git config holds no team key", async () => {
    fakeGitConfig({ opener: "editor", "jira.apiToken": "x-secret" });

    await expect(writeProjectFile()).rejects.toThrow(/no team settings/i);
    expect(fs.existsSync(target())).toBe(false);
  });

  it("refuses a value the loader would reject, naming the key and not the file", async () => {
    fakeGitConfig({ "clickup.workspaceId": "not-digits" });

    await expect(writeProjectFile()).rejects.toThrow(/clickup\.workspaceId/);
    expect(fs.existsSync(target())).toBe(false);
  });

  it("leaves the file uncommitted: no git add, commit or push", async () => {
    fakeGitConfig({ defaultSourceBranch: "origin/main" });

    await writeProjectFile();

    const verbs = mockRun.mock.calls.map((call) => (call[1] as string[])[0]);
    expect(verbs.every((verb) => verb === "config")).toBe(true);
  });
});

describe("the internal offer keys (D22)", () => {
  it("live under northguild.worktree.* and are not in CONFIG_NAMES", () => {
    for (const key of [PROJECT_FILE_OFFER_KEY]) {
      expect(key.startsWith("northguild.worktree.")).toBe(true);
      const bare = key.replace("northguild.worktree.", "");
      expect(CONFIG_NAMES as readonly string[]).not.toContain(bare);
      expect(CONFIG_NAMES as readonly string[]).not.toContain(key);
    }
  });
});

describe("offerProjectConfig: the nudge (D21)", () => {
  let say: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(confirm).mockReset();
    say = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    setNonInteractive(false);
    // origin/HEAD resolves and holds no .worktree.yml: the repository the
    // nudge is for.
    mocked.gitResolveOriginHead.mockResolvedValue("origin/main");
  });

  afterEach(() => {
    say.mockRestore();
    setNonInteractive(false);
  });

  it("offers --project once when there is no file and a team key is set", async () => {
    const { local } = fakeGitConfig({ "branchPrefix.feature": "feat/" });
    vi.mocked(confirm).mockResolvedValue(false);

    await offerProjectConfig();
    await offerProjectConfig();

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(vi.mocked(confirm).mock.calls[0]?.[0].message).toContain(
      "worktree config --project",
    );
    // A "no" is recorded as well as a "yes".
    expect(local.get(PROJECT_FILE_OFFER_KEY)).toBe("declined");
    expect(fs.existsSync(path.join(scratch, ".worktree.yml"))).toBe(false);
  });

  // Review of #296: since #281, `worktree config` marks a file it cannot use
  // `{ status: "none", reason: "unusable" }` and carries on. That is not "no
  // file", so the offer stays silent and records no answer.
  it("offers nothing when the file was marked unusable", async () => {
    const { local } = fakeGitConfig({ "branchPrefix.feature": "feat/" });
    markProjectConfigUnusable();

    await offerProjectConfig();

    expect(confirm).not.toHaveBeenCalled();
    expect(local.has(PROJECT_FILE_OFFER_KEY)).toBe(false);
  });

  it("writes the file on yes and records the answer", async () => {
    const { local } = fakeGitConfig({ "branchPrefix.feature": "feat/" });
    vi.mocked(confirm).mockResolvedValue(true);

    await offerProjectConfig();

    expect(local.get(PROJECT_FILE_OFFER_KEY)).toBe("accepted");
    expect(
      fs.readFileSync(path.join(scratch, ".worktree.yml"), "utf8"),
    ).toContain("feature: feat/");
  });

  // Review of #318: a failed record must not leave a new file unannounced.
  it("announces the written file even when recording the answer fails", async () => {
    fakeGitConfig({ "branchPrefix.feature": "feat/" });
    const answer = mockRun.getMockImplementation() as (
      file: string,
      args: string[],
    ) => Promise<string>;
    mockRun.mockImplementation(async (file: string, args: string[]) => {
      if (args[2] === PROJECT_FILE_OFFER_KEY && args[3] !== undefined) {
        throw new Error("could not lock config file");
      }
      return answer(file, args);
    });
    vi.mocked(confirm).mockResolvedValue(true);

    await expect(offerProjectConfig()).rejects.toThrow("could not lock config");

    expect(fs.existsSync(path.join(scratch, ".worktree.yml"))).toBe(true);
    expect(say).toHaveBeenCalledWith(expect.stringContaining("Wrote "));
  });

  it("does not ask again after a yes, even once the file is deleted", async () => {
    fakeGitConfig({ "branchPrefix.feature": "feat/" });
    vi.mocked(confirm).mockResolvedValue(true);

    await offerProjectConfig();
    fs.rmSync(path.join(scratch, ".worktree.yml"));
    await offerProjectConfig();

    expect(confirm).toHaveBeenCalledTimes(1);
  });

  // #311: the read warns that an uncommitted copy is ignored; the offer must not
  // then claim the repository has no file, nor spend itself on a refused write.
  it("offers nothing, and records nothing, when the worktree has a copy of its own", async () => {
    const { local } = fakeGitConfig({ "branchPrefix.feature": "feat/" });
    const working = path.join(scratch, ".worktree.yml");
    fs.writeFileSync(working, "copy: [b]\n");

    await offerProjectConfig();

    expect(confirm).not.toHaveBeenCalled();
    expect(local.has(PROJECT_FILE_OFFER_KEY)).toBe(false);
    expect(fs.readFileSync(working, "utf8")).toBe("copy: [b]\n");
  });

  it("treats a dangling .worktree.yml link as a copy of its own", async () => {
    const { local } = fakeGitConfig({ "branchPrefix.feature": "feat/" });
    fs.symlinkSync(
      path.join(scratch, "gone.yml"),
      path.join(scratch, ".worktree.yml"),
    );

    await offerProjectConfig();

    expect(confirm).not.toHaveBeenCalled();
    expect(local.has(PROJECT_FILE_OFFER_KEY)).toBe(false);
  });

  it("does not record a yes whose write was refused by a copy made meanwhile", async () => {
    const { local } = fakeGitConfig({ "branchPrefix.feature": "feat/" });
    const working = path.join(scratch, ".worktree.yml");
    vi.mocked(confirm).mockImplementation(async () => {
      fs.writeFileSync(working, "copy: [b]\n");
      return true;
    });

    await offerProjectConfig();

    expect(local.has(PROJECT_FILE_OFFER_KEY)).toBe(false);
    expect(fs.readFileSync(working, "utf8")).toBe("copy: [b]\n");
  });

  it("offers nothing when git config holds only personal or secret keys", async () => {
    fakeGitConfig({ ...PERSONAL_VALUES, ...SECRET_VALUES });

    await offerProjectConfig();

    expect(confirm).not.toHaveBeenCalled();
  });

  it("offers nothing under --json, --yes, --non-interactive, CI or without a TTY", async () => {
    // All five resolve to isNonInteractive() (interaction.test.ts); the offer
    // must read that one answer and prompt, record and write nothing.
    const { local } = fakeGitConfig({ "branchPrefix.feature": "feat/" });
    setNonInteractive(true);

    await offerProjectConfig();

    expect(confirm).not.toHaveBeenCalled();
    expect(local.has(PROJECT_FILE_OFFER_KEY)).toBe(false);
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("offers nothing when the file cannot be read", async () => {
    fakeGitConfig({ "branchPrefix.feature": "feat/" });
    fromOriginMain("surprise: [unterminated\n");

    await offerProjectConfig();

    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("offerProjectConfig: removing the keys the file covers", () => {
  const FILE =
    "branchPrefix:\n  feature: feat/\n  bugfix: fix/\npostCreate:\n  - pnpm install\n";
  let say: ReturnType<typeof vi.spyOn>;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.mocked(confirm).mockReset();
    say = vi.spyOn(console, "log").mockImplementation(() => {});
    warn = vi.spyOn(console, "error").mockImplementation(() => {});
    setNonInteractive(false);
    fromOriginMain(FILE);
  });

  afterEach(() => {
    say.mockRestore();
    warn.mockRestore();
    vi.unstubAllEnvs();
    setNonInteractive(false);
  });

  // Rule (issue #289, project-configuration.mdx "Moving to the file"): a
  // local value identical to the file's is removed, silently; a differing
  // local value, a global value and a personal key are not.
  it("unsets local keys that hold the file's value, without asking or printing", async () => {
    const { local } = fakeGitConfig({
      "branchPrefix.feature": "feat/",
      "branchPrefix.bugfix": "bug/",
      postCreate: "pnpm install",
      postCreateApproval: postCreateApprovalHash(["pnpm install"]),
      opener: "herdr",
    });

    await offerProjectConfig();

    expect(confirm).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
    expect(local.has("northguild.worktree.branchPrefix.feature")).toBe(false);
    expect(local.has("northguild.worktree.postCreate")).toBe(false);
    // The differing value is the discouraged override; a personal key is not covered.
    expect(local.get("northguild.worktree.branchPrefix.bugfix")).toBe("bug/");
    expect(local.get("northguild.worktree.opener")).toBe("herdr");
    expect(mockRun).toHaveBeenCalledWith("git", [
      "config",
      "--local",
      "--unset",
      "northguild.worktree.branchPrefix.feature",
    ]);
  });

  // project-configuration.mdx: with no origin/HEAD the personal
  // defaultSourceBranch is what finds the file, so removing it would lose it.
  it("removes a covered defaultSourceBranch when origin/HEAD resolves", async () => {
    fromOriginMain("defaultSourceBranch: origin/main\n");
    const { local } = fakeGitConfig({ defaultSourceBranch: "origin/main" });

    await offerProjectConfig();

    expect(local.has("northguild.worktree.defaultSourceBranch")).toBe(false);
  });

  it("keeps a covered defaultSourceBranch when there is no origin/HEAD, other keys still go", async () => {
    mocked.gitResolveOriginHead.mockResolvedValue("");
    blob("defaultSourceBranch: origin/main\nbranchPrefix:\n  feature: feat/\n");
    const { local } = fakeGitConfig({
      defaultSourceBranch: "origin/main",
      "branchPrefix.feature": "feat/",
    });
    mockedConfig.gitGetConfigValue.mockImplementation(
      async (name: string) => local.get(`northguild.worktree.${name}`) ?? "",
    );

    await offerProjectConfig();

    expect(local.get("northguild.worktree.defaultSourceBranch")).toBe(
      "origin/main",
    );
    expect(local.has("northguild.worktree.branchPrefix.feature")).toBe(false);
  });

  it("leaves a global value alone", async () => {
    const { local, global } = fakeGitConfig({
      "branchPrefix.feature": "other/",
    });
    global.set("northguild.worktree.branchPrefix.bugfix", "fix/");

    await offerProjectConfig();

    expect(global.get("northguild.worktree.branchPrefix.bugfix")).toBe("fix/");
    expect(local.get("northguild.worktree.branchPrefix.feature")).toBe(
      "other/",
    );
    expect(mockRun).not.toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["--unset"]),
    );
  });

  // Review of #296: unsetting a local copy must not hand the key to another
  // scope's value, which would then win over the file (D2).
  it("leaves a local copy alone when another scope also sets the key", async () => {
    const { local, global } = fakeGitConfig({
      "branchPrefix.feature": "feat/",
    });
    global.set("northguild.worktree.branchPrefix.feature", "feature/");

    await offerProjectConfig();

    expect(local.get("northguild.worktree.branchPrefix.feature")).toBe("feat/");
    expect(mockRun).not.toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["--unset"]),
    );
  });

  // Review of #296: a personal postCreate is what skips the approval (D16).
  // Removing it while the file's step is unapproved would make every later
  // unattended `branch` stop on approval.
  it("keeps a covered postCreate while the file's step is not approved, so unattended runs still pass", async () => {
    const { local } = fakeGitConfig({ postCreate: "pnpm install" });

    await offerProjectConfig();
    setNonInteractive(true);

    expect(local.get("northguild.worktree.postCreate")).toBe("pnpm install");
    await expect(ensurePostCreateApproved({})).resolves.toBeUndefined();
  });

  it("removes a covered postCreate once the file's step is approved, and unattended runs still pass", async () => {
    const { local } = fakeGitConfig({
      postCreate: "pnpm install",
      postCreateApproval: postCreateApprovalHash(["pnpm install"]),
    });

    await offerProjectConfig();
    setNonInteractive(true);

    expect(local.has("northguild.worktree.postCreate")).toBe(false);
    await expect(ensurePostCreateApproved({})).resolves.toBeUndefined();
  });

  it("leaves a local postCreate alone when the file's is a list of several steps", async () => {
    fromOriginMain("postCreate:\n  - pnpm install\n  - pnpm build\n");
    const { local } = fakeGitConfig({ postCreate: "pnpm install; pnpm build" });

    await offerProjectConfig();

    expect(local.get("northguild.worktree.postCreate")).toBe(
      "pnpm install; pnpm build",
    );
  });

  it("removes nothing when the file came from WORKTREE_PROJECT_CONFIG, not the default branch", async () => {
    const draft = path.join(scratch, "draft.yml");
    fs.writeFileSync(draft, FILE);
    vi.stubEnv("WORKTREE_PROJECT_CONFIG", draft);
    const { local } = fakeGitConfig({ "branchPrefix.feature": "feat/" });

    await offerProjectConfig();

    expect(local.get("northguild.worktree.branchPrefix.feature")).toBe("feat/");
  });

  it("still removes under --json, --yes, --non-interactive, CI or without a TTY", async () => {
    const { local } = fakeGitConfig({ "branchPrefix.feature": "feat/" });
    setNonInteractive(true);

    await offerProjectConfig();

    expect(confirm).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
    expect(local.has("northguild.worktree.branchPrefix.feature")).toBe(false);
  });

  it("is a no-op the second time, and records no marker key", async () => {
    const { local } = fakeGitConfig({ "branchPrefix.feature": "feat/" });

    await offerProjectConfig();
    mockRun.mockClear();
    await offerProjectConfig();

    expect(mockRun).not.toHaveBeenCalledWith(
      "git",
      expect.arrayContaining(["--unset"]),
    );
    expect([...local.keys()]).toEqual([]);
  });

  it("leaves an existing migrationOffer value from an older version untouched", async () => {
    const { local } = fakeGitConfig({
      "branchPrefix.feature": "feat/",
      migrationOffer: "abc123",
    });

    await offerProjectConfig();

    expect(local.get("northguild.worktree.migrationOffer")).toBe("abc123");
    expect(local.has("northguild.worktree.branchPrefix.feature")).toBe(false);
  });

  it("rejects when an unset fails, so the caller can warn", async () => {
    mockRun.mockImplementation(async (_file: string, args: string[]) => {
      if (args.includes("--unset")) throw new Error("could not lock config");
      return args.at(-1) === "northguild.worktree.branchPrefix.feature"
        ? "local\tfeat/"
        : "";
    });

    await expect(offerProjectConfig()).rejects.toThrow("could not lock config");
  });

  // Review of #296: two runs at once both read the key, and the second unset
  // exits 5 because the first already removed it.
  it("treats an unset that finds the key already gone as done", async () => {
    const { local } = fakeGitConfig({ "branchPrefix.feature": "feat/" });
    const fake = mockRun.getMockImplementation() as (
      file: string,
      args: string[],
    ) => Promise<string>;
    mockRun.mockImplementation(async (file: string, args: string[]) => {
      if (args.includes("--unset")) {
        // The other run's unset lands first.
        local.delete(args.at(-1) as string);
        throw Object.assign(new Error("exit 5"), { code: 5 });
      }
      return fake(file, args);
    });

    await expect(offerProjectConfig()).resolves.toBeUndefined();
    expect(local.has("northguild.worktree.branchPrefix.feature")).toBe(false);
  });

  it("rejects an unset that exits 5 with the key still there", async () => {
    const { local } = fakeGitConfig({ "branchPrefix.feature": "feat/" });
    const fake = mockRun.getMockImplementation() as (
      file: string,
      args: string[],
    ) => Promise<string>;
    mockRun.mockImplementation(async (file: string, args: string[]) => {
      if (args.includes("--unset")) {
        throw Object.assign(new Error("has multiple values"), { code: 5 });
      }
      return fake(file, args);
    });

    await expect(offerProjectConfig()).rejects.toThrow("has multiple values");
    expect(local.get("northguild.worktree.branchPrefix.feature")).toBe("feat/");
  });

  it("does not repeat the file's warnings: reporting stays with the caller", async () => {
    // An unknown key makes the load carry a warning.
    fromOriginMain(`${FILE}surprise: 1\n`);
    const result = await loadProjectConfig();
    expect(result.warnings.length).toBeGreaterThan(0);
    fakeGitConfig({ "branchPrefix.feature": "feat/" });
    setNonInteractive(true);

    await offerProjectConfig();

    expect(warn).not.toHaveBeenCalled();
    expect(say).not.toHaveBeenCalled();
  });
});

describe("showLinesVisibly", () => {
  it("keeps line breaks and tabs, and escapes every other control character", () => {
    expect(
      showLinesVisibly("error: would be overwritten:\n\tsrc/foo.ts\u001b[2J\n"),
    ).toBe("error: would be overwritten:\n\tsrc/foo.ts\\x1b[2J\n");
  });

  it("drops the \\r of a CRLF line end but escapes a lone one", () => {
    expect(showLinesVisibly("one\r\ntwo\rthree")).toBe("one\ntwo\\x0dthree");
  });
});
