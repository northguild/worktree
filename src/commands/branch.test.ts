/** biome-ignore-all lint/suspicious/noExplicitAny: Allow any in tests */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { confirm, input, select } from "@inquirer/prompts";
import ora from "ora";
import * as clickupIntegration from "../integrations/clickup.js";
import * as githubIntegration from "../integrations/github.js";
import * as herdr from "../integrations/herdr.js";
import * as jiraIntegration from "../integrations/jira.js";
import * as linearIntegration from "../integrations/linear.js";
import * as gitConfig from "../lib/config.js";
import { copyEnvFilesFromRootPath } from "../lib/env.js";
import * as git from "../lib/git.js";
import { runInstall } from "../lib/install.js";
import { setNonInteractive } from "../lib/interaction.js";
import * as projectConfig from "../lib/project-config.js";
import { resetProjectConfigCache } from "../lib/project-config.js";
import { MissingValueError } from "../lib/prompt.js";
import * as validators from "../lib/validators.js";
import {
  captureOutput,
  expectCommands,
  loadConfig,
  mockRun,
} from "../test-setup.js";
import Branch from "./branch.js";

// Mock the inquirer module
vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  input: vi.fn(),
  select: vi.fn(),
}));

// Mock env functions
vi.mock("../lib/env.js", () => ({
  copyEnvFilesFromRootPath: vi.fn().mockResolvedValue([]),
}));

// The step itself is covered by install.test.ts; here only what branch does
// with its result. Skipped is the benign default.
vi.mock("../lib/install.js", () => ({
  runInstall: vi.fn().mockResolvedValue({ ran: false, reason: "skipped" }),
}));

// Mock ora to suppress spinner output during tests
vi.mock("ora", () => ({
  default: vi.fn(() => ({
    start: vi.fn(function (this: any) {
      return this;
    }),
    succeed: vi.fn(function (this: any) {
      return this;
    }),
    fail: vi.fn(function (this: any) {
      return this;
    }),
    warn: vi.fn(function (this: any) {
      return this;
    }),
    stop: vi.fn(function (this: any) {
      return this;
    }),
  })),
}));

// What `branch` passes the opener when no handoff flag was given.
const defaultOpenOptions = { open: true, agent: true, brief: undefined };

describe("branch command", () => {
  let branch: Branch;
  let mockOpenWorktreePath: ReturnType<typeof vi.spyOn>;
  let mockDispatchAgent: ReturnType<typeof vi.spyOn>;
  const mockInput = vi.mocked(input);
  const mockConfirm = vi.mocked(confirm);
  const mockCopyEnvFiles = vi.mocked(copyEnvFilesFromRootPath);
  const mockRunInstall = vi.mocked(runInstall);

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunInstall.mockResolvedValue({ ran: false, reason: "skipped" });
    mockCopyEnvFiles.mockResolvedValue([]);
    const mockConfig = {
      runCommand: vi.fn().mockResolvedValue(undefined),
    } as any;
    branch = new Branch([], mockConfig);
    mockOpenWorktreePath = vi
      .spyOn(branch as any, "openWorktreePath")
      .mockResolvedValue({ opener: "editor" });
    mockDispatchAgent = vi
      .spyOn(branch as any, "dispatchAgent")
      .mockResolvedValue(undefined);

    // Mock config verification to prevent first-time config prompts. An agent
    // is configured, so a case that passes a brief clears the preflight that
    // refuses one nothing would take; that preflight has its own cases.
    vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
      (key: string) => {
        if (key === "has-called-config") return Promise.resolve("true");
        if (key === "agent.command") return Promise.resolve("claude --bg");
        return Promise.resolve("");
      },
    );

    // From this phase on, any --github run can reach the assignment seam: an
    // unset `github.autoAssign` means ask (D3), so a case that never mentions
    // assignment still passes through the confirm. Neither the config write nor
    // the API call belongs in a test that is not about assignment — without
    // these two, whichever value `confirm` happens to be left returning decides
    // it, which is order-dependent. config.test.ts guards gitSetConfigValue for
    // the same reason.
    // Nothing collides unless a case says so; the lookup is git, which these
    // cases are not about.
    vi.spyOn(git, "gitFindBranchCheckout").mockResolvedValue(undefined);

    // D7: branch fetches once itself, so nothing here touches a remote. The
    // repository has an origin/HEAD and no .worktree.yml: the run every case
    // below was written for, which the project-config cases then vary.
    resetProjectConfigCache();
    // The offers of D21 have their own cases at the end of this file.
    vi.spyOn(projectConfig, "offerProjectConfig").mockResolvedValue();
    vi.spyOn(git, "gitFetch").mockResolvedValue("");
    vi.spyOn(git, "gitResolveOriginHead").mockResolvedValue("origin/main");
    vi.spyOn(git, "gitReadBlobAtRef").mockResolvedValue({
      status: "absent-path",
    });
    vi.spyOn(git, "gitHasOriginRemote").mockResolvedValue(true);
    vi.spyOn(git, "gitGetTopLevelPath").mockResolvedValue("/nonexistent");
    vi.spyOn(git, "gitGetLocalBranches").mockResolvedValue([]);
    vi.spyOn(gitConfig, "gitSetConfigValue").mockResolvedValue();
    vi.spyOn(githubIntegration, "assignGitHubIssue").mockResolvedValue({
      login: "octocat",
      assigned: true,
    });
    vi.spyOn(jiraIntegration, "assignJiraIssue").mockResolvedValue({
      outcome: "assigned",
      displayName: "Ada Lovelace",
    });
  });

  describe("basic functionality", () => {
    it("should create worktree with valid branch name and default source", async () => {
      const mockGitCreateWorktree = vi
        .spyOn(git, "gitCreateWorktree")
        .mockResolvedValue("/path/to/worktree");
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) => {
          if (key === "has-called-config") return Promise.resolve("true");
          if (key === "defaultSourceBranch")
            return Promise.resolve("origin/main");
          return Promise.resolve("");
        },
      );

      (branch as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feature/test" },
        flags: {},
      });

      await branch.run();

      expect(mockGitCreateWorktree).toHaveBeenCalledWith(
        "feature/test",
        "origin/main",
        { fetch: false },
      );
      expect(mockCopyEnvFiles).toHaveBeenCalledWith("/path/to/worktree", {
        report: "stdout",
      });
      expect(mockOpenWorktreePath).toHaveBeenCalledWith(
        "/path/to/worktree",
        defaultOpenOptions,
      );
    });

    it("should prompt for branch name when not provided", async () => {
      mockInput.mockResolvedValue("prompted-branch");
      const mockGitCreateWorktree = vi
        .spyOn(git, "gitCreateWorktree")
        .mockResolvedValue("/path/to/worktree");
      vi.spyOn(gitConfig, "gitGetConfigValue").mockResolvedValue("origin/main");

      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: {},
      });

      await branch.run();

      expect(mockInput).toHaveBeenCalledWith({
        message: "Branch name",
        default: "",
        prefill: "editable",
        validate: validators.isValidBranchName,
      });
      expect(mockGitCreateWorktree).toHaveBeenCalledWith(
        "prompted-branch",
        "origin/main",
        { fetch: false },
      );
    });

    it("should use custom source branch when provided", async () => {
      const mockGitCreateWorktree = vi
        .spyOn(git, "gitCreateWorktree")
        .mockResolvedValue("/path/to/worktree");
      vi.spyOn(git, "gitGetRemoteBranches").mockResolvedValue([
        "origin/main",
        "origin/develop",
      ]);

      (branch as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feature/test" },
        flags: { source: "origin/develop" },
      });

      await branch.run();

      expect(mockGitCreateWorktree).toHaveBeenCalledWith(
        "feature/test",
        "origin/develop",
        { fetch: false },
      );
    });
  });

  // Phase 2 of the project-config plan (#181): precedence, the simple team
  // keys, and the order inside run() (D2, D3, D4, D7, D17). Expected values
  // come from the plan's example file and its Done-when list.
  describe("the project file (.worktree.yml)", () => {
    const PROJECT_FILE = `defaultSourceBranch: origin/develop
branchPrefix:
  feature: feat/
  bugfix: fix/
  chore: chore/
jira:
  host: https://acme.atlassian.net
`;

    // `has-called-config` is set; everything else is whatever the case gives.
    function personalConfig(values: Record<string, string> = {}) {
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) => {
          if (key === "has-called-config") return Promise.resolve("true");
          if (key === "agent.command") return Promise.resolve("claude --bg");
          return Promise.resolve(values[key] ?? "");
        },
      );
    }

    function projectFile(content: string) {
      vi.spyOn(git, "gitReadBlobAtRef").mockResolvedValue({
        status: "found",
        content,
      });
    }

    function run(flags: Record<string, unknown>, branchName?: string) {
      (branch as any).parse = vi
        .fn()
        .mockResolvedValue({ args: { branchName }, flags });
      return branch.run();
    }

    beforeEach(() => {
      vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");
      vi.spyOn(git, "gitGetRemoteBranches").mockResolvedValue([
        "origin/main",
        "origin/develop",
      ]);
    });

    describe("a repository without a file", () => {
      it("makes the calls it always did, and prints nothing extra", async () => {
        personalConfig({ defaultSourceBranch: "origin/main" });
        const warn = vi.spyOn(branch, "warn");

        await run({}, "feature/test");

        expect(git.gitCreateWorktree).toHaveBeenCalledWith(
          "feature/test",
          "origin/main",
          { fetch: false },
        );
        expect(mockCopyEnvFiles).toHaveBeenCalledWith("/path/to/worktree", {
          report: "stdout",
        });
        expect(mockOpenWorktreePath).toHaveBeenCalledWith(
          "/path/to/worktree",
          defaultOpenOptions,
        );
        expect(warn).not.toHaveBeenCalled();
        // The only new reads: the ref, and the file at it.
        expect(git.gitReadBlobAtRef).toHaveBeenCalledTimes(1);
      });

      it("falls back to origin/main with no source key anywhere", async () => {
        personalConfig();

        await run({}, "feature/test");

        expect(git.gitCreateWorktree).toHaveBeenCalledWith(
          "feature/test",
          "origin/main",
          { fetch: false },
        );
      });
    });

    // Phase 6 (#181), D14. The pattern is the example file's `config/master.key`.
    describe("copy patterns (D14)", () => {
      it("hands the file's copy patterns to the copy step, with the report on stdout", async () => {
        personalConfig({ defaultSourceBranch: "origin/main" });
        projectFile("copy:\n  - config/master.key\n");

        await run({}, "feature/test");

        expect(mockCopyEnvFiles).toHaveBeenCalledWith("/path/to/worktree", {
          report: "stdout",
          copy: ["config/master.key"],
        });
      });

      it("passes no patterns for a file without a copy key", async () => {
        personalConfig({ defaultSourceBranch: "origin/main" });
        projectFile("defaultSourceBranch: origin/develop\n");

        await run({}, "feature/test");

        expect(mockCopyEnvFiles).toHaveBeenCalledWith("/path/to/worktree", {
          report: "stdout",
          copy: undefined,
        });
      });
    });

    describe("fetching (D7)", () => {
      it("fetches exactly once, before the file is read, and tells creation not to", async () => {
        personalConfig();
        const order: string[] = [];
        vi.mocked(git.gitFetch).mockImplementation(async () => {
          order.push("fetch");
          return "";
        });
        vi.mocked(git.gitReadBlobAtRef).mockImplementation(async () => {
          order.push("read");
          return { status: "absent-path" };
        });

        await run({}, "feature/test");

        expect(order).toEqual(["fetch", "read"]);
        expect(git.gitFetch).toHaveBeenCalledTimes(1);
        expect(git.gitCreateWorktree).toHaveBeenCalledWith(
          "feature/test",
          expect.any(String),
          { fetch: false },
        );
      });

      it("does not fetch a second time to list the remote branches for --source", async () => {
        personalConfig();

        await run({ source: "origin/develop" }, "feature/test");

        expect(git.gitFetch).toHaveBeenCalledTimes(1);
        expect(git.gitGetRemoteBranches).toHaveBeenCalledWith({
          fetch: false,
        });
      });
    });

    // Phase 4 (#181): github/linear/clickup rules and branchName. Prefixes
    // and kinds are the plan's example file (section 4): feat/ fix/ chore/,
    // `Type: Bug` is a bugfix, `Labels: [chore, maintenance]` a chore.
    describe("branch-type rules and branchName", () => {
      const PREFIXES = `branchPrefix:
  feature: feat/
  bugfix: fix/
  chore: chore/
`;
      const GITHUB_RULES = `github:
  branchType:
    - when: { Type: Bug }
      type: bugfix
    - when: { Labels: [chore, maintenance] }
      type: chore
`;

      function githubIssue(overrides: Record<string, unknown> = {}) {
        vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
          number: 8,
          title: "Fix memory leak",
          state: "open",
          type: null,
          labels: [],
          pullRequest: null,
          ...overrides,
        } as any);
      }

      beforeEach(() => {
        personalConfig();
        mockInput.mockImplementation(async (config: any) => config.default);
      });

      it("a GitHub rule on the label decides the prefix", async () => {
        projectFile(PREFIXES + GITHUB_RULES);
        githubIssue({ labels: [{ id: 3, name: "Maintenance" }] });

        await run({ github: "8" });

        expect(git.gitCreateWorktree).toHaveBeenCalledWith(
          "chore/8-fix-memory-leak",
          "origin/main",
          { fetch: false },
        );
      });

      it("a GitHub issue no rule matches gets no prefix", async () => {
        projectFile(PREFIXES + GITHUB_RULES);
        githubIssue({ type: { id: 1, name: "Feature" } });

        await run({ github: "8" });

        expect(git.gitCreateWorktree).toHaveBeenCalledWith(
          "8-fix-memory-leak",
          "origin/main",
          { fetch: false },
        );
      });

      it("keeps a rule warning in the run's warnings", async () => {
        projectFile(`${PREFIXES}github:
  branchType:
    - when: { Priority: High }
      type: bugfix
`);
        githubIssue();

        await run({ github: "8" });

        expect((branch as any).warnings).toEqual([
          expect.stringContaining(
            'Rule 1 of github.branchType names the field "Priority"',
          ),
        ]);
      });

      it("a Linear rule on the label decides the prefix", async () => {
        personalConfig({ "linear.apiKey": "lin_api_test" });
        projectFile(`${PREFIXES}linear:
  branchType:
    - when: { Labels: Urgent }
      type: bugfix
`);
        vi.spyOn(linearIntegration, "startLinearIssue").mockResolvedValue({
          outcome: "already-started",
          state: "In Progress",
        });
        vi.spyOn(linearIntegration, "fetchLinearIssue").mockResolvedValue({
          identifier: "ENG-1",
          title: "Add dark mode",
          url: null,
          labels: ["Urgent"],
          labelNodes: [{ id: "l1", name: "Urgent" }],
        });

        await run({ linear: "eng-1" });

        expect(git.gitCreateWorktree).toHaveBeenCalledWith(
          "fix/ENG-1-add-dark-mode",
          "origin/main",
          { fetch: false },
        );
      });

      it("a ClickUp rule on the tag decides the prefix", async () => {
        personalConfig({ "clickup.apiToken": "pk_test" });
        projectFile(`${PREFIXES}clickup:
  branchType:
    - when: { Tags: hotfix }
      type: bugfix
`);
        vi.spyOn(clickupIntegration, "startClickUpTask").mockResolvedValue({
          outcome: "started",
          from: "to do",
          to: "in progress",
        });
        vi.spyOn(clickupIntegration, "fetchClickUpTask").mockResolvedValue({
          id: "9hx",
          customId: null,
          name: "Fix login",
          url: null,
          tags: ["Hotfix"],
        });

        await run({ clickup: "9hx" });

        expect(git.gitCreateWorktree).toHaveBeenCalledWith(
          "fix/CU-9hx-fix-login",
          "origin/main",
          { fetch: false },
        );
      });

      it("applies the branchName template to an issue-derived name", async () => {
        projectFile(`${PREFIXES}branchName: "{prefix}{slug}-{id}"\n`);
        githubIssue({ type: { id: 1, name: "Bug" } });

        await run({ github: "8" });

        expect(git.gitCreateWorktree).toHaveBeenCalledWith(
          "fix/fix-memory-leak-8",
          "origin/main",
          { fetch: false },
        );
      });

      it("never applies the template to a positional name", async () => {
        projectFile(`${PREFIXES}branchName: "{prefix}{slug}-{id}"\n`);

        await run({}, "my/own-name");

        expect(git.gitCreateWorktree).toHaveBeenCalledWith(
          "my/own-name",
          "origin/main",
          { fetch: false },
        );
      });

      // A space is valid in a template (the schema only checks braces), and
      // isValidBranchName refuses it: "Branch name cannot contain spaces".
      it("refuses a template that produces an invalid name when nothing can be asked", async () => {
        setNonInteractive(true);
        projectFile(`${PREFIXES}branchName: "{prefix}{id} {slug}"\n`);
        githubIssue();

        await expect(run({ github: "8" })).rejects.toMatchObject({
          code: "invalid_value",
          message: "Branch name cannot contain spaces",
        });
        expect(git.gitCreateWorktree).not.toHaveBeenCalled();
      });

      it("offers a template's invalid name to the prompt, which validates it", async () => {
        projectFile(`${PREFIXES}branchName: "{prefix}{id} {slug}"\n`);
        githubIssue();
        mockInput.mockResolvedValue("8-fix-memory-leak");

        await run({ github: "8" });

        const config = mockInput.mock.calls[0]?.[0] as any;
        expect(config.default).toBe("8 fix-memory-leak");
        expect(config.validate(config.default)).toBe(
          "Branch name cannot contain spaces",
        );
      });
    });

    describe("a bad file (D4)", () => {
      it("stops with exit 2 before a worktree is added or anything is prompted", async () => {
        personalConfig();
        projectFile("defaultSourceBranch: [not, text]\n");

        const failure = await run({}, "feature/test").then(
          () => undefined,
          (error: unknown) => error,
        );

        expect(failure).toMatchObject({
          code: "invalid_value",
          oclif: { exit: 2 },
        });
        expect((failure as Error).message).toContain(
          ".worktree.yml at origin/main",
        );
        expect(git.gitCreateWorktree).not.toHaveBeenCalled();
        expect(mockCopyEnvFiles).not.toHaveBeenCalled();
        expect(mockConfirm).not.toHaveBeenCalled();
        expect(mockInput).not.toHaveBeenCalled();
      });

      it("names the secret and the rotation when a file holds one", async () => {
        personalConfig();
        projectFile("jira:\n  apiToken: abc\n");

        await expect(run({}, "feature/test")).rejects.toThrow(/rotated/);
        expect(git.gitCreateWorktree).not.toHaveBeenCalled();
      });
    });

    describe("precedence: flag, git config, file, default (D2)", () => {
      beforeEach(() => projectFile(PROJECT_FILE));

      it("takes the source branch from the file when git config has none", async () => {
        personalConfig();

        await run({}, "feature/test");

        expect(git.gitCreateWorktree).toHaveBeenCalledWith(
          "feature/test",
          "origin/develop",
          { fetch: false },
        );
      });

      it("prefers a personal defaultSourceBranch to the file's", async () => {
        personalConfig({ defaultSourceBranch: "origin/release" });

        await run({}, "feature/test");

        expect(git.gitCreateWorktree).toHaveBeenCalledWith(
          "feature/test",
          "origin/release",
          { fetch: false },
        );
      });

      it("prefers --source to both", async () => {
        personalConfig({ defaultSourceBranch: "origin/release" });
        vi.spyOn(git, "gitGetRemoteBranches").mockResolvedValue([
          "origin/main",
          "origin/hotfix",
        ]);

        await run({ source: "origin/hotfix" }, "feature/test");

        expect(git.gitCreateWorktree).toHaveBeenCalledWith(
          "feature/test",
          "origin/hotfix",
          { fetch: false },
        );
      });

      it("does not offer to configure a source branch the file supplies", async () => {
        personalConfig();

        await run({}, "feature/test");

        expect(mockConfirm).not.toHaveBeenCalled();
        expect(vi.mocked(branch.config.runCommand)).not.toHaveBeenCalled();
      });

      it.each([
        ["Feature", "feat/"],
        ["Bug", "fix/"],
        ["Task", "chore/"],
      ])("prefixes a GitHub %s issue with the file's %s", async (type, prefix) => {
        personalConfig();
        vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
          number: 8,
          title: "Fix memory leak",
          type: { name: type },
        } as any);
        mockInput.mockImplementation(async (config: any) => config.default);

        await run({ github: "8" });

        expect(git.gitCreateWorktree).toHaveBeenCalledWith(
          `${prefix}8-fix-memory-leak`,
          "origin/develop",
          { fetch: false },
        );
      });

      it("prefers a personal prefix to the file's for GitHub", async () => {
        personalConfig({ "branchPrefix.bugfix": "bug/" });
        vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
          number: 8,
          title: "Fix memory leak",
          type: { name: "Bug" },
        } as any);
        mockInput.mockImplementation(async (config: any) => config.default);

        await run({ github: "8" });

        expect(git.gitCreateWorktree).toHaveBeenCalledWith(
          "bug/8-fix-memory-leak",
          "origin/develop",
          { fetch: false },
        );
      });

      it("builds the Jira issue url from the file's host, without a prompt (D17)", async () => {
        personalConfig({ "jira.email": "me@acme.test", "jira.apiToken": "t" });
        vi.spyOn(
          jiraIntegration,
          "getJiraBranchNameFromIssue",
        ).mockResolvedValue("feat/DEV-1-x");
        mockInput.mockImplementation(async (config: any) => config.default);
        const output = captureOutput();

        try {
          const command = new Branch(["--json"], await loadConfig());
          (command as any).parse = vi.fn().mockResolvedValue({
            args: {},
            flags: { jira: "dev-1", assign: false },
          });
          (command as any).parsed = true;
          vi.spyOn(command as any, "openWorktreePath").mockResolvedValue({
            opener: "none",
          });
          await (command as any)._run();

          expect(output.document().issue).toEqual({
            provider: "jira",
            key: "DEV-1",
            url: "https://acme.atlassian.net/browse/DEV-1",
          });
        } finally {
          output.restore();
        }
        expect(mockConfirm).not.toHaveBeenCalled();
      });
    });

    it("prints the loader's warnings once, before anything is created", async () => {
      personalConfig();
      projectFile("opener: herdr\ndefaultSourceBranch: origin/main\n");
      const warn = vi.spyOn(branch, "warn");

      await run({}, "feature/test");

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("`opener` is a personal setting"),
      );
    });
  });

  describe("branch name validation", () => {
    it("should validate branch name and throw error for invalid name", async () => {
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "invalid..branch" },
        flags: {},
      });

      const mockError = vi.spyOn(branch, "error").mockImplementation(() => {
        throw new Error("Branch name cannot contain double dots");
      });

      await expect(branch.run()).rejects.toThrow(
        "Branch name cannot contain double dots",
      );
      expect(mockError).toHaveBeenCalledWith(
        "Branch name cannot contain double dots",
      );
    });
  });

  describe("source branch handling", () => {
    it("should handle non-existing origin source branch", async () => {
      vi.spyOn(git, "gitGetRemoteBranches").mockResolvedValue(["origin/main"]);

      (branch as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feature/test" },
        flags: { source: "origin/nonexistent" },
      });

      const mockError = vi.spyOn(branch, "error").mockImplementation(() => {
        throw new Error("Source branch doesn't exist: origin/nonexistent");
      });

      await expect(branch.run()).rejects.toThrow(
        "Source branch doesn't exist: origin/nonexistent",
      );
      expect(mockError).toHaveBeenCalledWith(
        "Source branch doesn't exist: origin/nonexistent",
        { code: "not_found" },
      );
    });

    it("should handle local source branch with confirmation", async () => {
      vi.spyOn(git, "gitGetRemoteBranches").mockResolvedValue(["origin/main"]);
      vi.spyOn(git, "gitGetLocalBranches").mockResolvedValue([
        "main",
        "develop",
      ]);
      mockConfirm.mockResolvedValue(true);
      const mockGitCreateWorktree = vi
        .spyOn(git, "gitCreateWorktree")
        .mockResolvedValue("/path/to/worktree");

      (branch as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feature/test" },
        flags: { source: "develop" },
      });

      await branch.run();

      expect(mockConfirm).toHaveBeenCalledWith({
        message:
          "The source branch does not start with 'origin/'. Are you sure you want to use a local source?",
      });
      expect(mockGitCreateWorktree).toHaveBeenCalledWith(
        "feature/test",
        "develop",
        { fetch: false },
      );
    });

    it("should handle local source branch with remote conflict confirmation", async () => {
      vi.spyOn(git, "gitGetRemoteBranches").mockResolvedValue([
        "origin/main",
        "origin/develop",
      ]);
      vi.spyOn(git, "gitGetLocalBranches").mockResolvedValue([
        "main",
        "develop",
      ]);
      mockConfirm
        .mockResolvedValueOnce(true) // Confirm using local source
        .mockResolvedValueOnce(true); // Confirm using remote instead
      const mockGitCreateWorktree = vi
        .spyOn(git, "gitCreateWorktree")
        .mockResolvedValue("/path/to/worktree");

      (branch as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feature/test" },
        flags: { source: "develop" },
      });

      await branch.run();

      expect(mockConfirm).toHaveBeenCalledWith({
        message:
          "A remote branch with the same name exists. Do you want to use the remote branch instead?",
      });
      expect(mockGitCreateWorktree).toHaveBeenCalledWith(
        "feature/test",
        "origin/develop",
        { fetch: false },
      );
    });

    it("should fallback to origin/main when no default source is configured", async () => {
      const mockGetConfigValue = vi
        .spyOn(gitConfig, "gitGetConfigValue")
        .mockResolvedValue("");
      const mockGitCreateWorktree = vi
        .spyOn(git, "gitCreateWorktree")
        .mockResolvedValue("/path/to/worktree");

      (branch as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feature/test" },
        flags: {},
      });

      await branch.run();

      expect(mockGetConfigValue).toHaveBeenCalledWith("defaultSourceBranch");
      expect(mockGitCreateWorktree).toHaveBeenCalledWith(
        "feature/test",
        "origin/main",
        { fetch: false },
      );
    });

    it("should handle non-existing local source branch", async () => {
      vi.spyOn(git, "gitGetRemoteBranches").mockResolvedValue(["origin/main"]);
      vi.spyOn(git, "gitGetLocalBranches").mockResolvedValue(["main"]);
      mockConfirm.mockResolvedValue(true);

      (branch as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feature/test" },
        flags: { source: "nonexistent" },
      });

      const mockError = vi.spyOn(branch, "error").mockImplementation(() => {
        throw new Error("Source branch doesn't exist: nonexistent");
      });

      await expect(branch.run()).rejects.toThrow(
        "Source branch doesn't exist: nonexistent",
      );
      expect(mockError).toHaveBeenCalledWith(
        "Source branch doesn't exist: nonexistent",
        { code: "not_found" },
      );
    });

    it("should reject using local source when confirmation is denied", async () => {
      vi.spyOn(git, "gitGetRemoteBranches").mockResolvedValue(["origin/main"]);
      mockConfirm.mockResolvedValue(false);
      vi.spyOn(gitConfig, "gitGetConfigValue").mockResolvedValue("origin/main");
      const mockGitCreateWorktree = vi
        .spyOn(git, "gitCreateWorktree")
        .mockResolvedValue("/path/to/worktree");

      (branch as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feature/test" },
        flags: { source: "develop" },
      });

      await branch.run();

      expect(mockConfirm).toHaveBeenCalledWith({
        message:
          "The source branch does not start with 'origin/'. Are you sure you want to use a local source?",
      });
      // Should fallback to default source branch
      expect(mockGitCreateWorktree).toHaveBeenCalledWith(
        "feature/test",
        "origin/main",
        { fetch: false },
      );
    });
  });

  describe("--github flag", () => {
    it("should pre-fill input with branch name derived from github issue", async () => {
      vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
        number: 42,
        title: "Add dark mode",
        type: { name: "Feature" },
      } as any);
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) => {
          if (key === "has-called-config") return Promise.resolve("true");
          if (key === "defaultSourceBranch")
            return Promise.resolve("origin/main");
          if (key === "branchPrefix.feature")
            return Promise.resolve("feature/");
          if (key === "branchPrefix.bugfix") return Promise.resolve("fix/");
          if (key === "branchPrefix.chore") return Promise.resolve("chore/");
          return Promise.resolve("");
        },
      );
      mockInput.mockResolvedValue("feature/42-add-dark-mode");
      const mockGitCreateWorktree = vi
        .spyOn(git, "gitCreateWorktree")
        .mockResolvedValue("/path/to/worktree");

      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { github: "42" },
      });

      await branch.run();

      expect(githubIntegration.fetchGitHubIssue).toHaveBeenCalledWith(42);
      expect(mockInput).toHaveBeenCalledWith({
        message: "Branch name",
        default: "feature/42-add-dark-mode",
        prefill: "editable",
        validate: validators.isValidBranchName,
      });
      expect(mockGitCreateWorktree).toHaveBeenCalledWith(
        "feature/42-add-dark-mode",
        "origin/main",
        { fetch: false },
      );
    });

    it.each([
      ["upstream", "Fetching GitHub issue #42 from acme/widgets (upstream)"],
      [
        "github.repository",
        "Fetching GitHub issue #42 from acme/widgets (github.repository)",
      ],
    ] as const)("names the repository read in the settled spinner line when it came from %s (D4)", async (source, line) => {
      vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
        number: 42,
        title: "Add dark mode",
        type: { name: "Feature" },
        pullRequest: null,
        repository: { owner: "acme", name: "widgets", source },
      } as any);
      mockInput.mockResolvedValue("42-add-dark-mode");
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { github: "42" },
      });

      await branch.run();

      const spinner = vi.mocked(ora).mock.results[0]?.value;
      expect(vi.mocked(ora).mock.calls[0]?.[0]).toBe(
        "Fetching GitHub issue #42",
      );
      expect(spinner.succeed).toHaveBeenCalledWith(line);
    });

    it("leaves the fetch spinner untouched when the repository is origin's", async () => {
      vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
        number: 42,
        title: "Add dark mode",
        type: { name: "Feature" },
        pullRequest: null,
        repository: { owner: "acme", name: "widgets", source: "origin" },
      } as any);
      mockInput.mockResolvedValue("42-add-dark-mode");
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { github: "42" },
      });

      await branch.run();

      const spinner = vi.mocked(ora).mock.results[0]?.value;
      expect(spinner.succeed).toHaveBeenCalledWith();
    });

    it("refuses a pull request and names its checkout", async () => {
      vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
        number: 105,
        title: "Update ai-workflow",
        type: null,
        state: "open",
        pullRequest: { headBranch: "chore/update-ai-workflow" },
      } as any);
      const mockGitCreateWorktree = vi.spyOn(git, "gitCreateWorktree");
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { github: "105" },
      });

      const refusal = branch.run();
      await expect(refusal).rejects.toThrow(
        "worktree checkout chore/update-ai-workflow",
      );
      await expect(refusal).rejects.toMatchObject({
        code: "invalid_value",
        oclif: { exit: 2 },
      });
      expect(mockGitCreateWorktree).not.toHaveBeenCalled();
    });

    it.each([
      ["is unknown", null],
      ["would not paste as one shell word", "a;curl$IFS`x`|sh"],
    ])("refuses a pull request whose branch %s without naming it", async (_case, headBranch) => {
      vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
        number: 106,
        title: "From a fork",
        type: null,
        state: "open",
        pullRequest: { headBranch },
      } as any);
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { github: "106" },
      });

      await expect(branch.run()).rejects.toThrow(
        "To work on its branch, run `worktree checkout` and pick it.",
      );
    });

    describe("a closed issue", () => {
      beforeEach(() => {
        vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
          number: 7,
          title: "Old bug",
          type: null,
          state: "closed",
          stateReason: "not_planned",
          pullRequest: null,
        } as any);
        vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
          (key: string) => {
            if (key === "has-called-config") return Promise.resolve("true");
            if (key === "defaultSourceBranch")
              return Promise.resolve("origin/main");
            return Promise.resolve("");
          },
        );
        mockInput.mockResolvedValue("7-old-bug");
        (branch as any).parse = vi.fn().mockResolvedValue({
          args: {},
          flags: { github: "7", assign: false },
        });
      });

      it("asks before continuing, and stops when declined", async () => {
        mockConfirm.mockResolvedValue(false);
        const mockGitCreateWorktree = vi.spyOn(git, "gitCreateWorktree");

        await expect(branch.run()).rejects.toMatchObject({
          message: "Not creating a branch for closed issue #7.",
          oclif: { exit: 1 },
        });
        expect(mockConfirm).toHaveBeenCalledWith({
          message:
            "Issue #7 is closed as not planned. Create a branch for it anyway?",
        });
        expect(mockGitCreateWorktree).not.toHaveBeenCalled();
      });

      it("continues when confirmed", async () => {
        mockConfirm.mockResolvedValue(true);
        const mockGitCreateWorktree = vi
          .spyOn(git, "gitCreateWorktree")
          .mockResolvedValue("/path/to/worktree");

        await branch.run();

        expect(mockGitCreateWorktree).toHaveBeenCalledWith(
          "7-old-bug",
          "origin/main",
          { fetch: false },
        );
      });

      it("warns instead of asking when non-interactive", async () => {
        setNonInteractive(true);
        vi.spyOn(git, "gitCreateWorktree").mockResolvedValue(
          "/path/to/worktree",
        );

        await branch.run();

        expect(mockConfirm).not.toHaveBeenCalled();
        expect((branch as any).warnings).toContain(
          "Issue #7 is closed as not planned.",
        );
      });

      it("neither asks nor warns when the issue is open", async () => {
        vi.mocked(githubIntegration.fetchGitHubIssue).mockResolvedValue({
          number: 7,
          title: "Old bug",
          type: null,
          state: "open",
          stateReason: null,
          pullRequest: null,
        } as any);
        vi.spyOn(git, "gitCreateWorktree").mockResolvedValue(
          "/path/to/worktree",
        );

        await branch.run();

        expect(mockConfirm).not.toHaveBeenCalled();
        expect((branch as any).warnings).toEqual([]);
      });
    });

    it("should strip # prefix from issue number flag", async () => {
      const mockFetchGitHubIssue = vi
        .spyOn(githubIntegration, "fetchGitHubIssue")
        .mockResolvedValue({
          number: 13,
          title: "Fix login bug",
          type: { name: "Bug" },
        } as any);
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) => {
          if (key === "has-called-config") return Promise.resolve("true");
          if (key === "defaultSourceBranch")
            return Promise.resolve("origin/main");
          if (key === "branchPrefix.bugfix") return Promise.resolve("fix/");
          return Promise.resolve("");
        },
      );
      mockInput.mockResolvedValue("fix/13-fix-login-bug");
      vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");

      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { github: "#13" },
      });

      await branch.run();

      expect(mockFetchGitHubIssue).toHaveBeenCalledWith(13);
    });

    it("should apply bugfix prefix for Bug issue type", async () => {
      vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
        number: 8,
        title: "Fix memory leak",
        type: { name: "Bug" },
      } as any);
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) => {
          if (key === "has-called-config") return Promise.resolve("true");
          if (key === "defaultSourceBranch")
            return Promise.resolve("origin/main");
          if (key === "branchPrefix.feature")
            return Promise.resolve("feature/");
          if (key === "branchPrefix.bugfix") return Promise.resolve("fix/");
          if (key === "branchPrefix.chore") return Promise.resolve("chore/");
          return Promise.resolve("");
        },
      );
      mockInput.mockResolvedValue("fix/8-fix-memory-leak");
      vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");

      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { github: "8" },
      });

      await branch.run();

      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({ default: "fix/8-fix-memory-leak" }),
      );
    });

    it("should apply chore prefix for Task issue type", async () => {
      vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
        number: 9,
        title: "Update CI config",
        type: { name: "Task" },
      } as any);
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) => {
          if (key === "has-called-config") return Promise.resolve("true");
          if (key === "defaultSourceBranch")
            return Promise.resolve("origin/main");
          if (key === "branchPrefix.feature")
            return Promise.resolve("feature/");
          if (key === "branchPrefix.bugfix") return Promise.resolve("fix/");
          if (key === "branchPrefix.chore") return Promise.resolve("chore/");
          return Promise.resolve("");
        },
      );
      mockInput.mockResolvedValue("chore/9-update-ci-config");
      vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");

      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { github: "9" },
      });

      await branch.run();

      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({ default: "chore/9-update-ci-config" }),
      );
    });

    it("should use no prefix when issue has no type", async () => {
      vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
        number: 7,
        title: "Update dependencies",
        type: null,
      } as any);
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) => {
          if (key === "has-called-config") return Promise.resolve("true");
          if (key === "defaultSourceBranch")
            return Promise.resolve("origin/main");
          return Promise.resolve("");
        },
      );
      mockInput.mockResolvedValue("7-update-dependencies");
      vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");

      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { github: "7" },
      });

      await branch.run();

      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({ default: "7-update-dependencies" }),
      );
    });

    it("should sanitize special characters in the issue title", async () => {
      vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
        number: 5,
        title: "Fix: user's email (login)",
        type: null,
      } as any);
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) => {
          if (key === "has-called-config") return Promise.resolve("true");
          if (key === "defaultSourceBranch")
            return Promise.resolve("origin/main");
          return Promise.resolve("");
        },
      );
      mockInput.mockResolvedValue("5-fix-users-email-login");
      vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");

      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { github: "5" },
      });

      await branch.run();

      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({ default: "5-fix-users-email-login" }),
      );
    });

    it("should fall back to 'issue' when the sanitized title is empty", async () => {
      vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
        number: 3,
        title: "!!!",
        type: null,
      } as any);
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) => {
          if (key === "has-called-config") return Promise.resolve("true");
          if (key === "defaultSourceBranch")
            return Promise.resolve("origin/main");
          return Promise.resolve("");
        },
      );
      mockInput.mockResolvedValue("3-issue");
      vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");

      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { github: "3" },
      });

      await branch.run();

      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({ default: "3-issue" }),
      );
    });
  });

  describe("--jira flag", () => {
    it("keeps a rule warning from the Jira integration in the run's warnings", async () => {
      vi.spyOn(
        jiraIntegration,
        "getJiraBranchNameFromIssue",
      ).mockImplementation(async (_issueId, onWarning) => {
        onWarning?.('Rule 1 of jira.branchType names the field "Nope".');
        return "DEV-123-add-dark-mode";
      });
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) => {
          if (key === "has-called-config") return Promise.resolve("true");
          if (key === "defaultSourceBranch")
            return Promise.resolve("origin/main");
          if (key === "jira.host")
            return Promise.resolve("example.atlassian.net");
          if (key === "jira.email") return Promise.resolve("test@example.com");
          if (key === "jira.apiToken") return Promise.resolve("token");
          return Promise.resolve("");
        },
      );
      mockInput.mockResolvedValue("DEV-123-add-dark-mode");
      vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { jira: "dev-123" },
      });

      await branch.run();

      expect((branch as any).warnings).toContain(
        'Rule 1 of jira.branchType names the field "Nope".',
      );
    });

    it("should pre-fill input with branch name derived from jira issue", async () => {
      vi.spyOn(jiraIntegration, "getJiraBranchNameFromIssue").mockResolvedValue(
        "feature/DEV-123-add-dark-mode",
      );
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) => {
          if (key === "has-called-config") return Promise.resolve("true");
          if (key === "defaultSourceBranch")
            return Promise.resolve("origin/main");
          if (key === "jira.host")
            return Promise.resolve("example.atlassian.net");
          if (key === "jira.email") return Promise.resolve("test@example.com");
          if (key === "jira.apiToken") return Promise.resolve("token");
          return Promise.resolve("");
        },
      );
      mockInput.mockResolvedValue("feature/DEV-123-add-dark-mode");
      const mockGitCreateWorktree = vi
        .spyOn(git, "gitCreateWorktree")
        .mockResolvedValue("/path/to/worktree");

      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { jira: "dev-123" },
      });

      await branch.run();

      expect(jiraIntegration.getJiraBranchNameFromIssue).toHaveBeenCalledWith(
        "dev-123",
        expect.any(Function),
      );
      expect(mockInput).toHaveBeenCalledWith({
        message: "Branch name",
        default: "feature/DEV-123-add-dark-mode",
        prefill: "editable",
        validate: validators.isValidBranchName,
      });
      expect(mockGitCreateWorktree).toHaveBeenCalledWith(
        "feature/DEV-123-add-dark-mode",
        "origin/main",
        { fetch: false },
      );
    });
  });

  describe("--linear flag", () => {
    const linearIssue = {
      identifier: "ENG-123",
      title: "Add dark mode",
      url: "https://linear.app/acme/issue/ENG-123/add-dark-mode",
      labels: [] as string[],
    };

    function stubConfig(apiKey = "lin_api_test") {
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) => {
          if (key === "has-called-config") return Promise.resolve("true");
          if (key === "defaultSourceBranch")
            return Promise.resolve("origin/main");
          if (key === "linear.apiKey") return Promise.resolve(apiKey);
          if (key === "branchPrefix.feature")
            return Promise.resolve("feature/");
          if (key === "branchPrefix.bugfix") return Promise.resolve("fix/");
          return Promise.resolve("");
        },
      );
    }

    // `linear.autoStart` is unset in every case here, which under D4 attempts a
    // start. These cases are about naming, so the write is stubbed explicitly
    // rather than the key being set to `false`, which would hide that default.
    beforeEach(() => {
      vi.spyOn(linearIntegration, "startLinearIssue").mockResolvedValue({
        outcome: "started",
        from: "Todo",
        to: "In Progress",
      });
    });

    it("pre-fills the derived name, with the prefix for the labels", async () => {
      stubConfig();
      const fetchSpy = vi
        .spyOn(linearIntegration, "fetchLinearIssue")
        .mockResolvedValue({ ...linearIssue, labels: ["Bug"] });
      mockInput.mockResolvedValue("fix/ENG-123-add-dark-mode");
      const mockGitCreateWorktree = vi
        .spyOn(git, "gitCreateWorktree")
        .mockResolvedValue("/path/to/worktree");
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { linear: "eng-123" },
      });

      await branch.run();

      // One fetch feeds both the name and `issue.url` (D9); Linear rate-limits
      // per key, so a second request is a regression.
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith("eng-123");
      expect(mockInput).toHaveBeenCalledWith({
        message: "Branch name",
        default: "fix/ENG-123-add-dark-mode",
        prefill: "editable",
        validate: validators.isValidBranchName,
      });
      expect(mockGitCreateWorktree).toHaveBeenCalledWith(
        "fix/ENG-123-add-dark-mode",
        "origin/main",
        { fetch: false },
      );
    });

    it("uses the feature prefix when no label decides otherwise", async () => {
      stubConfig();
      vi.spyOn(linearIntegration, "fetchLinearIssue").mockResolvedValue(
        linearIssue,
      );
      mockInput.mockImplementation(async (config: any) => config.default);
      const mockGitCreateWorktree = vi
        .spyOn(git, "gitCreateWorktree")
        .mockResolvedValue("/path/to/worktree");
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { linear: "ENG-123" },
      });

      await branch.run();

      expect(mockGitCreateWorktree).toHaveBeenCalledWith(
        "feature/ENG-123-add-dark-mode",
        "origin/main",
        { fetch: false },
      );
    });

    it("reports the issue with the url the API returned", async () => {
      stubConfig();
      vi.spyOn(linearIntegration, "fetchLinearIssue").mockResolvedValue(
        linearIssue,
      );
      mockInput.mockImplementation(async (config: any) => config.default);
      vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { linear: "ENG-123" },
      });

      const document = await branch.run();

      expect(document?.issue).toEqual({
        provider: "linear",
        key: "ENG-123",
        url: "https://linear.app/acme/issue/ENG-123/add-dark-mode",
      });
      expect(document?.assigned).toBeNull();
    });

    it("includes linear.apiKey in the config it verifies", async () => {
      stubConfig();
      vi.spyOn(linearIntegration, "fetchLinearIssue").mockResolvedValue(
        linearIssue,
      );
      mockInput.mockImplementation(async (config: any) => config.default);
      vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");
      const verify = vi.spyOn(branch as any, "verifyConfig");
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { linear: "ENG-123" },
      });

      await branch.run();

      expect(verify).toHaveBeenCalledWith([
        "defaultSourceBranch",
        "linear.apiKey",
      ]);
    });

    it("warns and carries on for --assign", async () => {
      stubConfig();
      vi.spyOn(linearIntegration, "fetchLinearIssue").mockResolvedValue(
        linearIssue,
      );
      const mockAssign = vi.spyOn(githubIntegration, "assignGitHubIssue");
      const mockWarn = vi
        .spyOn(branch, "warn")
        .mockImplementation((input: any) => input);
      mockInput.mockImplementation(async (config: any) => config.default);
      const mockGitCreateWorktree = vi
        .spyOn(git, "gitCreateWorktree")
        .mockResolvedValue("/path/to/worktree");
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { linear: "ENG-123", assign: true },
      });

      await branch.run();

      expect(mockWarn).toHaveBeenCalledWith(
        "Assignment is not supported for Linear issues yet.",
      );
      expect(mockAssign).not.toHaveBeenCalled();
      expect(mockGitCreateWorktree).toHaveBeenCalled();
    });

    describe("starting the issue", () => {
      // Expected values come from the plan, not from the code: precedence and
      // the document's `started` from D4 and D8, the order of the write from
      // D6 (after gitCreateWorktree, before env files and install), the
      // warnings from D7 (a failure names the issue and the reason, exit 0).
      const started = {
        outcome: "started",
        from: "Todo",
        to: "In Progress",
      } as const;
      let calls: string[];
      let mockStart: ReturnType<typeof vi.spyOn>;
      let mockCreate: ReturnType<typeof vi.spyOn>;

      function config(values: Record<string, string> = {}) {
        vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
          (key: string) =>
            Promise.resolve(
              {
                "has-called-config": "true",
                defaultSourceBranch: "origin/main",
                "linear.apiKey": "lin_api_test",
                "clickup.apiToken": "pk_test",
                "branchPrefix.feature": "feature/",
                ...values,
              }[key] ?? "",
            ),
        );
      }

      beforeEach(() => {
        calls = [];
        config();
        vi.spyOn(linearIntegration, "fetchLinearIssue").mockResolvedValue(
          linearIssue,
        );
        mockInput.mockImplementation(async (c: any) => c.default);
        mockCreate = vi
          .spyOn(git, "gitCreateWorktree")
          .mockImplementation(async () => {
            calls.push("create");
            return "/path/to/worktree";
          });
        mockCopyEnvFiles.mockImplementation(async () => {
          calls.push("env");
          return [];
        });
        mockStart = vi
          .spyOn(linearIntegration, "startLinearIssue")
          .mockImplementation(async () => {
            calls.push("start");
            return started;
          });
        vi.spyOn(branch, "warn").mockImplementation((input: any) => input);
      });

      async function go(flags: Record<string, unknown>) {
        (branch as any).parse = vi.fn().mockResolvedValue({
          args: {},
          flags: { linear: "ENG-123", ...flags },
        });
        return branch.run();
      }

      it("--start moves the issue right after the worktree exists, before the env files", async () => {
        const document = await go({ start: true });

        expect(mockStart).toHaveBeenCalledWith("ENG-123");
        expect(calls).toEqual(["create", "start", "env"]);
        expect(document?.started).toBe(true);
      });

      it("never moves the issue when the creation fails", async () => {
        mockCreate.mockRejectedValue(new Error("git failed"));

        await expect(go({ start: true })).rejects.toThrow("git failed");

        expect(mockStart).not.toHaveBeenCalled();
      });

      it("--no-start makes no call and reports null", async () => {
        const document = await go({ start: false });

        expect(mockStart).not.toHaveBeenCalled();
        expect(document?.started).toBeNull();
      });

      it("linear.autoStart true starts without asking", async () => {
        config({ "linear.autoStart": "true" });

        const document = await go({});

        expect(mockConfirm).not.toHaveBeenCalled();
        expect(mockStart).toHaveBeenCalledTimes(1);
        expect(document?.started).toBe(true);
      });

      it("linear.autoStart false never starts, and --start still wins over it", async () => {
        config({ "linear.autoStart": "false" });

        expect((await go({}))?.started).toBeNull();
        expect(mockStart).not.toHaveBeenCalled();

        expect((await go({ start: true }))?.started).toBe(true);
        expect(mockStart).toHaveBeenCalledTimes(1);
      });

      it("asks once when the key is unset and saves the answer under the key", async () => {
        const mockSet = vi
          .spyOn(gitConfig, "gitSetConfigValue")
          .mockResolvedValue();
        mockConfirm.mockResolvedValue(true);

        const document = await go({});

        expect(mockConfirm).toHaveBeenCalledWith({
          message:
            "Move this issue to started? (saved as linear.autoStart; change it later with `worktree config linear.autoStart <true|false>`)",
        });
        expect(mockSet).toHaveBeenCalledWith("linear.autoStart", "true");
        expect(document?.started).toBe(true);
      });

      it("a declined prompt moves nothing and reports null", async () => {
        mockConfirm.mockResolvedValue(false);

        const document = await go({});

        expect(mockStart).not.toHaveBeenCalled();
        expect(document?.started).toBeNull();
      });

      it("asks before the worktree is created", async () => {
        mockConfirm.mockImplementation(async () => {
          calls.push("ask");
          return true;
        });

        await go({});

        expect(calls.slice(0, 2)).toEqual(["ask", "create"]);
      });

      it("a non-interactive run with the key unset starts and saves nothing", async () => {
        setNonInteractive(true);
        const mockSet = vi
          .spyOn(gitConfig, "gitSetConfigValue")
          .mockResolvedValue();

        const document = await go({});

        expect(mockConfirm).not.toHaveBeenCalled();
        expect(mockSet).not.toHaveBeenCalled();
        expect(mockStart).toHaveBeenCalledTimes(1);
        expect(document?.started).toBe(true);
      });

      it("already-started reports true", async () => {
        mockStart.mockResolvedValue({
          outcome: "already-started",
          state: "In Review",
        });

        const document = await go({ start: true });

        expect(document?.started).toBe(true);
        expect(document?.warnings).toEqual([]);
      });

      it.each([
        [
          "left-alone",
          { outcome: "left-alone", state: "Triage", type: "triage" },
          "ENG-123 is in Triage (a triage state), so it was not moved to started.",
        ],
        [
          "no-started-state",
          { outcome: "no-started-state", state: "Todo" },
          "ENG-123 was not moved to started: its team has no started state (it is in Todo).",
        ],
      ])("%s warns with the issue and the reason, and reports false", async (_label, result, message) => {
        mockStart.mockResolvedValue(result as any);

        const document = await go({ start: true });

        expect(document?.started).toBe(false);
        expect(document?.warnings).toEqual([message]);
        expect(mockCreate).toHaveBeenCalled();
      });

      it("a thrown failure warns, reports false, exits 0 and keeps the worktree", async () => {
        const originalExitCode = process.exitCode;
        process.exitCode = undefined;
        mockStart.mockRejectedValue(
          new Error(
            "Linear: You do not have permission. Moving an issue needs a key with the Write permission and access to the issue's team.",
          ),
        );

        const document = await go({ start: true });

        expect(document?.started).toBe(false);
        expect(document?.warnings).toEqual([
          "Could not move ENG-123 to started. Linear: You do not have permission. Moving an issue needs a key with the Write permission and access to the issue's team.",
        ]);
        expect(document?.path).toBe("/path/to/worktree");
        expect(process.exitCode).toBeUndefined();
        expect(calls).toContain("env");
        process.exitCode = originalExitCode;
      });

      it("never lets the stored key into the warnings", async () => {
        mockStart.mockRejectedValue(
          new Error("Linear: rejected the key lin_api_test1234567890abcdef"),
        );

        const document = await go({ start: true });

        expect(JSON.stringify(document?.warnings)).not.toContain(
          "lin_api_test1234567890abcdef",
        );
      });

      it("carries started on the document of a failed install", async () => {
        mockRunInstall.mockResolvedValue({
          ran: true,
          command: "npm ci",
          steps: ["npm ci"],
          from: "lockfile",
          inferred: true,
          ok: false,
          reason: "exited with code 1",
        });
        const originalExitCode = process.exitCode;
        const command = new Branch(["--json"], await loadConfig());
        (command as any).parse = vi.fn().mockResolvedValue({
          args: {},
          flags: { linear: "ENG-123", start: true },
        });
        (command as any).parsed = true;
        const output = captureOutput();

        try {
          await (command as any)._run();
          expect(output.document()).toMatchObject({
            installed: { ran: true, ok: false },
            started: true,
          });
          expect(calls).toEqual(["create", "start", "env"]);
        } finally {
          output.restore();
          process.exitCode = originalExitCode;
        }
      });

      it("does not move the issue when the branch already has a worktree", async () => {
        vi.spyOn(git, "gitFindBranchCheckout").mockResolvedValue({
          path: "/repo.worktrees/feature/ENG-123-add-dark-mode",
          pathExists: true,
          inWorktreesRoot: true,
        });
        mockConfirm.mockResolvedValue(true);

        const result = await go({ start: true });

        expect(result).toBeUndefined();
        expect(mockStart).not.toHaveBeenCalled();
        expect(mockCreate).not.toHaveBeenCalled();
      });

      it("--start with none of the issue flags is a usage error", async () => {
        (branch as any).parse = vi.fn().mockResolvedValue({
          args: { branchName: "my-branch" },
          flags: { start: true },
        });

        await expect(branch.run()).rejects.toThrow(
          "--start/--no-start requires one of --github, --jira, --linear or --clickup.",
        );
        await expect(branch.run()).rejects.toMatchObject({
          oclif: { exit: 2 },
        });
        expect(mockStart).not.toHaveBeenCalled();
        expect(mockCreate).not.toHaveBeenCalled();
      });

      it.each([
        [
          "github",
          "42",
          "Moving an issue to started is not supported for GitHub issues.",
        ],
        [
          "jira",
          "DEV-1",
          "Moving an issue to started is not supported for Jira issues yet.",
        ],
      ])("--start with --%s warns and carries on", async (provider, id, message) => {
        vi.spyOn(branch as any, "verifyConfig").mockResolvedValue(undefined);
        vi.spyOn(branch as any, "getBranchName").mockResolvedValue({
          branchName: "feature/x",
          issue: null,
        });
        (branch as any).parse = vi.fn().mockResolvedValue({
          args: {},
          flags: { [provider]: id, start: true, assign: false },
        });

        await branch.run();

        expect(branch.warn).toHaveBeenCalledWith(message);
        expect(mockCreate).toHaveBeenCalled();
        expect(mockStart).not.toHaveBeenCalled();
      });

      it.each([
        ["github", "42"],
        ["jira", "DEV-1"],
        ["clickup", "9hx"],
      ])("--no-start with --%s warns nothing and carries on", async (provider, id) => {
        vi.spyOn(branch as any, "verifyConfig").mockResolvedValue(undefined);
        vi.spyOn(branch as any, "getBranchName").mockResolvedValue({
          branchName: "feature/x",
          issue: null,
        });
        (branch as any).parse = vi.fn().mockResolvedValue({
          args: {},
          flags: { [provider]: id, start: false, assign: false },
        });

        await branch.run();

        expect(branch.warn).not.toHaveBeenCalledWith(
          expect.stringContaining("Moving an issue to started"),
        );
        expect(mockCreate).toHaveBeenCalled();
        expect(mockStart).not.toHaveBeenCalled();
      });

      it.each([
        ["github", "42"],
        ["jira", "DEV-1"],
      ])("a plain --%s run never reads linear.autoStart or asks", async (provider, id) => {
        vi.spyOn(branch as any, "verifyConfig").mockResolvedValue(undefined);
        vi.spyOn(branch as any, "getBranchName").mockResolvedValue({
          branchName: "feature/x",
          issue: null,
        });
        (branch as any).parse = vi.fn().mockResolvedValue({
          args: {},
          flags: { [provider]: id, assign: false },
        });
        const getConfig = vi.mocked(gitConfig.gitGetConfigValue);
        getConfig.mockClear();

        await branch.run();

        expect(getConfig).not.toHaveBeenCalledWith("linear.autoStart");
        expect(getConfig).not.toHaveBeenCalledWith("clickup.autoStart");
        expect(mockConfirm).not.toHaveBeenCalled();
        expect(mockStart).not.toHaveBeenCalled();
      });

      it("a dry run never calls it and never asks", async () => {
        const dryRun = vi
          .spyOn(branch as any, "reportDryRun")
          .mockReturnValue(undefined);

        await go({ "dry-run": true, start: true });

        expect(dryRun).toHaveBeenCalled();
        expect(mockStart).not.toHaveBeenCalled();
        expect(mockConfirm).not.toHaveBeenCalled();
        expect(mockCreate).not.toHaveBeenCalled();
      });
    });

    describe("with --json", () => {
      let output: ReturnType<typeof captureOutput>;
      const originalExitCode = process.exitCode;

      beforeEach(() => {
        output = captureOutput();
        process.exitCode = undefined;
      });

      afterEach(() => {
        output.restore();
        process.exitCode = originalExitCode;
      });

      async function runJson(flags: Record<string, unknown>) {
        const command = new Branch(["--json"], await loadConfig());
        (command as any).parse = vi.fn().mockResolvedValue({ args: {}, flags });
        (command as any).parsed = true;
        vi.spyOn(command as any, "openWorktreePath").mockResolvedValue({
          opener: "none",
        });
        return (command as any)._run();
      }

      it("carries {provider, key, url} in the document", async () => {
        stubConfig();
        vi.spyOn(linearIntegration, "fetchLinearIssue").mockResolvedValue(
          linearIssue,
        );
        vi.spyOn(git, "gitCreateWorktree").mockResolvedValue(
          "/path/to/worktree",
        );

        await runJson({ linear: "ENG-123" });

        expect(output.document()).toMatchObject({
          branch: "feature/ENG-123-add-dark-mode",
          issue: {
            provider: "linear",
            key: "ENG-123",
            url: "https://linear.app/acme/issue/ENG-123/add-dark-mode",
          },
          assigned: null,
        });
      });

      it("gives a missing key as missing_value with exit 2 and no worktree", async () => {
        stubConfig("");
        const fetchSpy = vi.spyOn(linearIntegration, "fetchLinearIssue");
        const create = vi.spyOn(git, "gitCreateWorktree");

        await runJson({ linear: "ENG-123" });

        expect(output.document()).toMatchObject({
          error: { code: "missing_value" },
        });
        expect(process.exitCode).toBe(2);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
      });

      it("gives a failed fetch as failed with exit 1 and no worktree", async () => {
        stubConfig();
        vi.spyOn(linearIntegration, "fetchLinearIssue").mockRejectedValue(
          new Error("Linear: Unable to find issue ENG-123."),
        );
        const create = vi.spyOn(git, "gitCreateWorktree");

        await runJson({ linear: "ENG-123" });

        expect(output.document()).toMatchObject({
          error: { code: "failed" },
        });
        expect(process.exitCode).toBe(1);
        expect(create).not.toHaveBeenCalled();
      });
    });
  });

  describe("--clickup flag", () => {
    // Expected names come from D6: `${prefix}CU-<id>-<slug>` for a short id,
    // `${prefix}<CUSTOM-ID>-<slug>` for a custom one.
    const shortTask = {
      id: "9hx",
      customId: null,
      name: "Add dark mode",
      url: "https://app.clickup.com/t/9hx",
      tags: [] as string[],
    };
    const customTask = {
      id: "86abc",
      customId: "DEV-123",
      name: "Add dark mode",
      url: "https://app.clickup.com/t/86abc",
      tags: [] as string[],
    };

    // `clickup.autoStart` is unset in every case here outside "starting the
    // task", which under D4 attempts a start. These cases are about naming, so
    // the write is stubbed explicitly rather than the key being set to
    // `false`, which would hide that default.
    beforeEach(() => {
      vi.spyOn(clickupIntegration, "startClickUpTask").mockResolvedValue({
        outcome: "started",
        from: "to do",
        to: "in progress",
      });
    });

    function stubConfig(values: Record<string, string> = {}) {
      const config: Record<string, string> = {
        "has-called-config": "true",
        defaultSourceBranch: "origin/main",
        "clickup.apiToken": "pk_test",
        "branchPrefix.feature": "feature/",
        "branchPrefix.bugfix": "fix/",
        ...values,
      };
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) => Promise.resolve(config[key] ?? ""),
      );
    }

    it("names a short id CU-<id> with the feature prefix", async () => {
      stubConfig();
      const fetchSpy = vi
        .spyOn(clickupIntegration, "fetchClickUpTask")
        .mockResolvedValue(shortTask);
      mockInput.mockImplementation(async (config: any) => config.default);
      const create = vi
        .spyOn(git, "gitCreateWorktree")
        .mockResolvedValue("/path/to/worktree");
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { clickup: "9hx" },
      });

      await branch.run();

      // One fetch feeds both the name and `issue.url` (D9).
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(create).toHaveBeenCalledWith(
        "feature/CU-9hx-add-dark-mode",
        "origin/main",
        { fetch: false },
      );
    });

    it("names a custom id upper-cased, with the bugfix prefix for a bug tag", async () => {
      stubConfig();
      vi.spyOn(clickupIntegration, "fetchClickUpTask").mockResolvedValue({
        ...customTask,
        tags: ["Bug"],
      });
      mockInput.mockImplementation(async (config: any) => config.default);
      const create = vi
        .spyOn(git, "gitCreateWorktree")
        .mockResolvedValue("/path/to/worktree");
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { clickup: "dev-123" },
      });

      await branch.run();

      expect(create).toHaveBeenCalledWith(
        "fix/DEV-123-add-dark-mode",
        "origin/main",
        { fetch: false },
      );
    });

    it("names DEV-123 with the feature prefix", async () => {
      stubConfig();
      vi.spyOn(clickupIntegration, "fetchClickUpTask").mockResolvedValue(
        customTask,
      );
      mockInput.mockImplementation(async (config: any) => config.default);
      const create = vi
        .spyOn(git, "gitCreateWorktree")
        .mockResolvedValue("/path/to/worktree");
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { clickup: "DEV-123" },
      });

      await branch.run();

      expect(create).toHaveBeenCalledWith(
        "feature/DEV-123-add-dark-mode",
        "origin/main",
        { fetch: false },
      );
    });

    it("reports a short id's key and the url the API returned", async () => {
      stubConfig();
      vi.spyOn(clickupIntegration, "fetchClickUpTask").mockResolvedValue(
        shortTask,
      );
      mockInput.mockImplementation(async (config: any) => config.default);
      vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { clickup: "9hx" },
      });

      const document = await branch.run();

      expect(document?.issue).toEqual({
        provider: "clickup",
        key: "9hx",
        url: "https://app.clickup.com/t/9hx",
      });
      expect(document?.assigned).toBeNull();
    });

    it("reports the task's custom_id as the key, not the id that was typed (D9)", async () => {
      stubConfig();
      // A short id typed against a task that also has a custom id: D9 says the
      // key is custom_id; D6 says the name still follows the typed shape.
      vi.spyOn(clickupIntegration, "fetchClickUpTask").mockResolvedValue({
        ...shortTask,
        customId: "DEV-123",
      });
      mockInput.mockImplementation(async (config: any) => config.default);
      const create = vi
        .spyOn(git, "gitCreateWorktree")
        .mockResolvedValue("/path/to/worktree");
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { clickup: "9hx" },
      });

      const document = await branch.run();

      expect(document?.issue).toMatchObject({
        provider: "clickup",
        key: "DEV-123",
      });
      expect(create).toHaveBeenCalledWith(
        "feature/CU-9hx-add-dark-mode",
        "origin/main",
        { fetch: false },
      );
    });

    it("reports the custom id as the key when the task has one (D9)", async () => {
      stubConfig();
      vi.spyOn(clickupIntegration, "fetchClickUpTask").mockResolvedValue(
        customTask,
      );
      mockInput.mockImplementation(async (config: any) => config.default);
      vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { clickup: "DEV-123" },
      });

      const document = await branch.run();

      expect(document?.issue).toEqual({
        provider: "clickup",
        key: "DEV-123",
        url: "https://app.clickup.com/t/86abc",
      });
    });

    it("includes clickup.apiToken in the config it verifies", async () => {
      stubConfig();
      vi.spyOn(clickupIntegration, "fetchClickUpTask").mockResolvedValue(
        shortTask,
      );
      mockInput.mockImplementation(async (config: any) => config.default);
      vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");
      const verify = vi.spyOn(branch as any, "verifyConfig");
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { clickup: "9hx" },
      });

      await branch.run();

      expect(verify).toHaveBeenCalledWith([
        "defaultSourceBranch",
        "clickup.apiToken",
      ]);
    });

    it("warns and carries on for --assign", async () => {
      stubConfig();
      vi.spyOn(clickupIntegration, "fetchClickUpTask").mockResolvedValue(
        shortTask,
      );
      const mockAssign = vi.spyOn(githubIntegration, "assignGitHubIssue");
      const mockWarn = vi
        .spyOn(branch, "warn")
        .mockImplementation((input: any) => input);
      mockInput.mockImplementation(async (config: any) => config.default);
      const create = vi
        .spyOn(git, "gitCreateWorktree")
        .mockResolvedValue("/path/to/worktree");
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { clickup: "9hx", assign: true },
      });

      await branch.run();

      expect(mockWarn).toHaveBeenCalledWith(
        "Assignment is not supported for ClickUp tasks yet.",
      );
      expect(mockAssign).not.toHaveBeenCalled();
      expect(create).toHaveBeenCalled();
    });

    describe("starting the task", () => {
      // Expected values come from the plan, not from the code: precedence from
      // D4 (flag, then clickup.autoStart, then non-interactive true and not
      // saved, then a saved prompt), the order of the write from D6 (after
      // gitCreateWorktree, before the env files), the warnings from D7 (a
      // failure names the task and the reason, exit 0, never the token) and
      // `started` from D8 (true / false / null).
      const started = {
        outcome: "started",
        from: "to do",
        to: "in progress",
      } as const;
      let calls: string[];
      let mockStart: ReturnType<typeof vi.spyOn>;
      let mockCreate: ReturnType<typeof vi.spyOn>;

      beforeEach(() => {
        calls = [];
        stubConfig();
        vi.spyOn(clickupIntegration, "fetchClickUpTask").mockResolvedValue(
          shortTask,
        );
        mockInput.mockImplementation(async (c: any) => c.default);
        mockCreate = vi
          .spyOn(git, "gitCreateWorktree")
          .mockImplementation(async () => {
            calls.push("create");
            return "/path/to/worktree";
          });
        mockCopyEnvFiles.mockImplementation(async () => {
          calls.push("env");
          return [];
        });
        mockStart = vi
          .spyOn(clickupIntegration, "startClickUpTask")
          .mockImplementation(async () => {
            calls.push("start");
            return started;
          });
        vi.spyOn(branch, "warn").mockImplementation((input: any) => input);
      });

      async function go(flags: Record<string, unknown>) {
        (branch as any).parse = vi.fn().mockResolvedValue({
          args: {},
          flags: { clickup: "9hx", ...flags },
        });
        return branch.run();
      }

      it("--start moves the task right after the worktree exists, before the env files", async () => {
        const document = await go({ start: true });

        expect(mockStart).toHaveBeenCalledWith("9hx");
        expect(calls).toEqual(["create", "start", "env"]);
        expect(document?.started).toBe(true);
        expect(branch.warn).not.toHaveBeenCalledWith(
          expect.stringContaining("Moving an issue to started"),
        );
      });

      it("never moves the task when the creation fails", async () => {
        mockCreate.mockRejectedValue(new Error("git failed"));

        await expect(go({ start: true })).rejects.toThrow("git failed");

        expect(mockStart).not.toHaveBeenCalled();
      });

      it("--no-start makes no call and reports null", async () => {
        const document = await go({ start: false });

        expect(mockStart).not.toHaveBeenCalled();
        expect(document?.started).toBeNull();
      });

      it("clickup.autoStart true starts without asking", async () => {
        stubConfig({ "clickup.autoStart": "true" });

        const document = await go({});

        expect(mockConfirm).not.toHaveBeenCalled();
        expect(mockStart).toHaveBeenCalledTimes(1);
        expect(document?.started).toBe(true);
      });

      it("clickup.autoStart false never starts, and --start still wins over it", async () => {
        stubConfig({ "clickup.autoStart": "false" });

        expect((await go({}))?.started).toBeNull();
        expect(mockStart).not.toHaveBeenCalled();

        expect((await go({ start: true }))?.started).toBe(true);
        expect(mockStart).toHaveBeenCalledTimes(1);
      });

      it("asks once when the key is unset and saves the answer under the key", async () => {
        const mockSet = vi
          .spyOn(gitConfig, "gitSetConfigValue")
          .mockResolvedValue();
        mockConfirm.mockResolvedValue(true);

        const document = await go({});

        expect(mockConfirm).toHaveBeenCalledWith({
          message:
            "Move this issue to started? (saved as clickup.autoStart; change it later with `worktree config clickup.autoStart <true|false>`)",
        });
        expect(mockSet).toHaveBeenCalledWith("clickup.autoStart", "true");
        expect(document?.started).toBe(true);
      });

      it("asks before the worktree is created", async () => {
        mockConfirm.mockImplementation(async () => {
          calls.push("ask");
          return true;
        });

        await go({});

        expect(calls.slice(0, 2)).toEqual(["ask", "create"]);
      });

      it("a non-interactive run with the key unset starts and saves nothing", async () => {
        setNonInteractive(true);
        const mockSet = vi
          .spyOn(gitConfig, "gitSetConfigValue")
          .mockResolvedValue();

        const document = await go({});

        expect(mockConfirm).not.toHaveBeenCalled();
        expect(mockSet).not.toHaveBeenCalled();
        expect(mockStart).toHaveBeenCalledTimes(1);
        expect(document?.started).toBe(true);
      });

      it("already-started reports true", async () => {
        mockStart.mockResolvedValue({
          outcome: "already-started",
          status: "in review",
        });

        const document = await go({ start: true });

        expect(document?.started).toBe(true);
        expect(document?.warnings).toEqual([]);
      });

      it.each([
        [
          "left-alone",
          { outcome: "left-alone", status: "complete", type: "closed" },
          "9hx is in complete (a closed status), so it was not moved to in progress.",
        ],
        [
          "no-in-progress-status",
          { outcome: "no-in-progress-status", status: "to do" },
          "9hx was not moved to in progress: its List has no in-progress status (it is in to do).",
        ],
      ])("%s warns with the task and the reason, and reports false", async (_label, result, message) => {
        mockStart.mockResolvedValue(result as any);

        const document = await go({ start: true });

        expect(document?.started).toBe(false);
        expect(document?.warnings).toEqual([message]);
        expect(mockCreate).toHaveBeenCalled();
      });

      it("a thrown failure warns, reports false, exits 0 and keeps the worktree", async () => {
        const originalExitCode = process.exitCode;
        process.exitCode = undefined;
        mockStart.mockRejectedValue(
          new Error(
            'ClickUp: Failed to move task 9hx to "in progress". 400 Bad Request: Status does not exist. Moving a task needs edit access to it.',
          ),
        );

        const document = await go({ start: true });

        expect(document?.started).toBe(false);
        expect(document?.warnings).toEqual([
          'Could not move 9hx to in progress. ClickUp: Failed to move task 9hx to "in progress". 400 Bad Request: Status does not exist. Moving a task needs edit access to it.',
        ]);
        expect(document?.path).toBe("/path/to/worktree");
        expect(process.exitCode).toBeUndefined();
        expect(calls).toContain("env");
        process.exitCode = originalExitCode;
      });

      it("never lets the stored token into the warnings", async () => {
        // Phase 1 pins that the integration's own messages never hold the
        // token; this pins that branch adds nothing of its own to a warning.
        stubConfig({ "clickup.apiToken": "pk_test1234567890abcdef" });
        mockStart.mockRejectedValue(
          new Error("ClickUp: rejected the token pk_test1234567890abcdef", {
            cause: new Error("sent pk_test1234567890abcdef"),
          }),
        );

        const document = await go({ start: true });

        expect(document?.warnings).toHaveLength(1);
        expect(JSON.stringify(document?.warnings)).not.toContain(
          "pk_test1234567890abcdef",
        );
      });

      it("carries started on the document of a failed install", async () => {
        mockRunInstall.mockResolvedValue({
          ran: true,
          command: "npm ci",
          steps: ["npm ci"],
          from: "lockfile",
          inferred: true,
          ok: false,
          reason: "exited with code 1",
        });
        const originalExitCode = process.exitCode;
        const command = new Branch(["--json"], await loadConfig());
        (command as any).parse = vi.fn().mockResolvedValue({
          args: {},
          flags: { clickup: "9hx", start: true },
        });
        (command as any).parsed = true;
        const output = captureOutput();

        try {
          await (command as any)._run();
          expect(output.document()).toMatchObject({
            installed: { ran: true, ok: false },
            started: true,
          });
          expect(calls).toEqual(["create", "start", "env"]);
        } finally {
          output.restore();
          process.exitCode = originalExitCode;
        }
      });

      it("does not move the task when the branch already has a worktree", async () => {
        vi.spyOn(git, "gitFindBranchCheckout").mockResolvedValue({
          path: "/repo.worktrees/feature/CU-9hx-add-dark-mode",
          pathExists: true,
          inWorktreesRoot: true,
        });
        mockConfirm.mockResolvedValue(true);

        const result = await go({ start: true });

        expect(result).toBeUndefined();
        expect(mockStart).not.toHaveBeenCalled();
        expect(mockCreate).not.toHaveBeenCalled();
      });

      it("a dry run never calls it and never asks", async () => {
        const dryRun = vi
          .spyOn(branch as any, "reportDryRun")
          .mockReturnValue(undefined);

        await go({ "dry-run": true, start: true });

        expect(dryRun).toHaveBeenCalled();
        expect(mockStart).not.toHaveBeenCalled();
        expect(mockConfirm).not.toHaveBeenCalled();
        expect(mockCreate).not.toHaveBeenCalled();
      });
    });

    describe("with --json", () => {
      let output: ReturnType<typeof captureOutput>;
      const originalExitCode = process.exitCode;

      beforeEach(() => {
        output = captureOutput();
        process.exitCode = undefined;
      });

      afterEach(() => {
        output.restore();
        process.exitCode = originalExitCode;
      });

      async function runJson(flags: Record<string, unknown>) {
        const command = new Branch(["--json"], await loadConfig());
        (command as any).parse = vi.fn().mockResolvedValue({ args: {}, flags });
        (command as any).parsed = true;
        vi.spyOn(command as any, "openWorktreePath").mockResolvedValue({
          opener: "none",
        });
        return (command as any)._run();
      }

      it("carries {provider, key, url} in the document", async () => {
        stubConfig();
        vi.spyOn(clickupIntegration, "fetchClickUpTask").mockResolvedValue(
          shortTask,
        );
        vi.spyOn(git, "gitCreateWorktree").mockResolvedValue(
          "/path/to/worktree",
        );

        await runJson({ clickup: "9hx" });

        expect(output.document()).toMatchObject({
          branch: "feature/CU-9hx-add-dark-mode",
          issue: {
            provider: "clickup",
            key: "9hx",
            url: "https://app.clickup.com/t/9hx",
          },
          assigned: null,
        });
      });

      it("gives a missing token as missing_value with exit 2 and no worktree", async () => {
        stubConfig({ "clickup.apiToken": "" });
        const fetchSpy = vi.spyOn(clickupIntegration, "fetchClickUpTask");
        const create = vi.spyOn(git, "gitCreateWorktree");

        await runJson({ clickup: "9hx" });

        expect(output.document()).toMatchObject({
          error: { code: "missing_value" },
        });
        expect(process.exitCode).toBe(2);
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
      });

      it("gives a custom id with no workspace id as missing_value with exit 2 and no request", async () => {
        stubConfig();
        // Earlier tests leave fetchClickUpTask stubbed; this one needs the real
        // function, which refuses before any request.
        vi.spyOn(clickupIntegration, "fetchClickUpTask").mockRestore();
        const httpSpy = vi.spyOn(globalThis, "fetch");
        const create = vi.spyOn(git, "gitCreateWorktree");

        await runJson({ clickup: "DEV-123" });

        expect(output.document()).toMatchObject({
          error: { code: "missing_value" },
        });
        expect(process.exitCode).toBe(2);
        expect(httpSpy).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
      });

      it("gives a failed fetch as failed with exit 1 and no worktree", async () => {
        stubConfig();
        vi.spyOn(clickupIntegration, "fetchClickUpTask").mockRejectedValue(
          new Error("ClickUp: Unable to find task 9hx."),
        );
        const create = vi.spyOn(git, "gitCreateWorktree");

        await runJson({ clickup: "9hx" });

        expect(output.document()).toMatchObject({
          error: { code: "failed" },
        });
        expect(process.exitCode).toBe(1);
        expect(create).not.toHaveBeenCalled();
      });
    });
  });

  describe("flag validation", () => {
    it.each([
      ["--github", { github: "42", linear: "ENG-1" }],
      ["--jira", { jira: "DEV-42", linear: "ENG-1" }],
    ])("refuses --linear with %s", async (_label, flags) => {
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) =>
          Promise.resolve(key === "has-called-config" ? "true" : ""),
      );
      const fetchSpy = vi.spyOn(linearIntegration, "fetchLinearIssue");
      (branch as any).parse = vi.fn().mockResolvedValue({ args: {}, flags });
      const mockError = vi.spyOn(branch, "error").mockImplementation(() => {
        throw new Error("refused");
      });

      await expect(branch.run()).rejects.toThrow("refused");
      expect(mockError).toHaveBeenCalledWith(
        "Please provide only one of --github, --jira, --linear or --clickup, not several.",
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it.each([
      ["--github", { github: "42", clickup: "9hx" }],
      ["--jira", { jira: "DEV-42", clickup: "9hx" }],
      ["--linear", { linear: "ENG-1", clickup: "9hx" }],
    ])("refuses --clickup with %s", async (_label, flags) => {
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) =>
          Promise.resolve(key === "has-called-config" ? "true" : ""),
      );
      const fetchSpy = vi.spyOn(clickupIntegration, "fetchClickUpTask");
      (branch as any).parse = vi.fn().mockResolvedValue({ args: {}, flags });
      const mockError = vi.spyOn(branch, "error").mockImplementation(() => {
        throw new Error("refused");
      });

      await expect(branch.run()).rejects.toThrow("refused");
      expect(mockError).toHaveBeenCalledWith(
        "Please provide only one of --github, --jira, --linear or --clickup, not several.",
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("should error when both --github and --jira are provided", async () => {
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) => {
          if (key === "has-called-config") return Promise.resolve("true");
          return Promise.resolve("");
        },
      );

      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { github: "42", jira: "DEV-42" },
      });

      const mockError = vi.spyOn(branch, "error").mockImplementation(() => {
        throw new Error(
          "Please provide only one of --github, --jira, --linear or --clickup, not several.",
        );
      });

      await expect(branch.run()).rejects.toThrow(
        "Please provide only one of --github, --jira, --linear or --clickup, not several.",
      );
      expect(mockError).toHaveBeenCalledWith(
        "Please provide only one of --github, --jira, --linear or --clickup, not several.",
      );
    });
  });

  describe("--assign flag", () => {
    // One place to set up a --github run whose only variable is the assignment
    // decision, so each precedence case below reads as just its own inputs.
    function githubRun(
      flags: Record<string, unknown>,
      configValues: Record<string, string> = {},
    ) {
      vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
        number: 42,
        title: "Add dark mode",
      } as any);
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) => {
          if (key === "has-called-config") return Promise.resolve("true");
          if (key === "defaultSourceBranch")
            return Promise.resolve("origin/main");
          return Promise.resolve(configValues[key] ?? "");
        },
      );
      mockInput.mockResolvedValue("42-add-dark-mode");
      vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");

      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { github: "42", ...flags },
      });
    }

    describe("precedence: flag, then config, then prompt", () => {
      it("assigns on --assign, outranking a configured false, without prompting", async () => {
        const mockAssign = vi
          .spyOn(githubIntegration, "assignGitHubIssue")
          .mockResolvedValue({ login: "octocat", assigned: true });
        githubRun({ assign: true }, { "github.autoAssign": "false" });

        await branch.run();

        // The flag outranks a configured `false` — that is what makes it a
        // one-run override rather than a second way to spell the key.
        expect(mockAssign).toHaveBeenCalledWith(42);
        expect(mockConfirm).not.toHaveBeenCalled();
      });

      it("does not assign on --no-assign, even with autoAssign true", async () => {
        const mockAssign = vi
          .spyOn(githubIntegration, "assignGitHubIssue")
          .mockResolvedValue({ login: "octocat", assigned: true });
        githubRun({ assign: false }, { "github.autoAssign": "true" });

        await branch.run();

        expect(mockAssign).not.toHaveBeenCalled();
        expect(mockConfirm).not.toHaveBeenCalled();
      });

      it("assigns when autoAssign is true and no flag is given", async () => {
        const mockAssign = vi
          .spyOn(githubIntegration, "assignGitHubIssue")
          .mockResolvedValue({ login: "octocat", assigned: true });
        githubRun({}, { "github.autoAssign": "true" });

        await branch.run();

        expect(mockAssign).toHaveBeenCalledWith(42);
        expect(mockConfirm).not.toHaveBeenCalled();
      });

      it("does not assign when autoAssign is false and no flag is given", async () => {
        const mockAssign = vi
          .spyOn(githubIntegration, "assignGitHubIssue")
          .mockResolvedValue({ login: "octocat", assigned: true });
        githubRun({}, { "github.autoAssign": "false" });

        await branch.run();

        expect(mockAssign).not.toHaveBeenCalled();
        expect(mockConfirm).not.toHaveBeenCalled();
      });

      it("asks when the key is unset, and assigns on yes", async () => {
        const mockAssign = vi
          .spyOn(githubIntegration, "assignGitHubIssue")
          .mockResolvedValue({ login: "octocat", assigned: true });
        const mockSetConfigValue = vi
          .spyOn(gitConfig, "gitSetConfigValue")
          .mockResolvedValue();
        mockConfirm.mockResolvedValue(true);
        githubRun({});

        await branch.run();

        expect(mockConfirm).toHaveBeenCalledWith({
          message:
            "Assign this issue to you? (saved as github.autoAssign; change it later with `worktree config github.autoAssign <true|false>`)",
        });
        expect(mockAssign).toHaveBeenCalledWith(42);
        // D5: the answer persists, so the most common path is taxed once and
        // not forever. The message above has to name the key it writes (R1).
        expect(mockSetConfigValue).toHaveBeenCalledWith(
          "github.autoAssign",
          "true",
        );
      });

      it("asks when the key is unset, and persists a no without assigning", async () => {
        const mockAssign = vi
          .spyOn(githubIntegration, "assignGitHubIssue")
          .mockResolvedValue({ login: "octocat", assigned: true });
        const mockSetConfigValue = vi
          .spyOn(gitConfig, "gitSetConfigValue")
          .mockResolvedValue();
        mockConfirm.mockResolvedValue(false);
        githubRun({});

        await branch.run();

        expect(mockAssign).not.toHaveBeenCalled();
        expect(mockSetConfigValue).toHaveBeenCalledWith(
          "github.autoAssign",
          "false",
        );
      });
    });

    describe("the decision is shared across providers", () => {
      // Phase 4 calls this with "jira.autoAssign"; proving the seam here keeps
      // that phase from re-deriving flag, config, non-interactive and prompt.
      const decide = (flag?: boolean) =>
        (branch as any).shouldAssignIssue("jira.autoAssign", flag);

      function configured(values: Record<string, string>) {
        vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
          (key: string) => Promise.resolve(values[key] ?? ""),
        );
      }

      it("honours the flag, then the given key, and ignores github.autoAssign", async () => {
        configured({ "jira.autoAssign": "false", "github.autoAssign": "true" });
        expect(await decide(true)).toBe(true);
        expect(await decide()).toBe(false);

        configured({ "jira.autoAssign": "true", "github.autoAssign": "false" });
        expect(await decide()).toBe(true);
      });

      it("assigns without saving when non-interactive and unset", async () => {
        const mockSet = vi
          .spyOn(gitConfig, "gitSetConfigValue")
          .mockResolvedValue();
        configured({});
        setNonInteractive(true);

        expect(await decide()).toBe(true);
        expect(mockSet).not.toHaveBeenCalled();
      });

      it("prompts naming the key and saves the answer under it", async () => {
        const mockSet = vi
          .spyOn(gitConfig, "gitSetConfigValue")
          .mockResolvedValue();
        configured({});
        mockConfirm.mockResolvedValue(false);

        expect(await decide()).toBe(false);
        expect(mockConfirm).toHaveBeenCalledWith({
          message:
            "Assign this issue to you? (saved as jira.autoAssign; change it later with `worktree config jira.autoAssign <true|false>`)",
        });
        expect(mockSet).toHaveBeenCalledWith("jira.autoAssign", "false");
      });

      it("names the given key when saving the answer fails", async () => {
        vi.spyOn(gitConfig, "gitSetConfigValue").mockRejectedValue(
          new Error("config file is locked"),
        );
        const mockWarn = vi
          .spyOn(branch, "warn")
          .mockImplementation((input: any) => input);
        configured({});
        mockConfirm.mockResolvedValue(true);

        expect(await decide()).toBe(true);
        expect(mockWarn).toHaveBeenCalledWith(
          "Could not save jira.autoAssign, so you will be asked again next time. config file is locked",
        );
      });
    });

    describe("the start decision shares the assign precedence", () => {
      // Expected values: D4 (flag, then key true/false, then non-interactive
      // true unsaved, then a prompt that saves under the key and names it).
      const decide = (flag?: boolean) =>
        (branch as any).shouldStartIssue("linear.autoStart", flag);

      function configured(values: Record<string, string>) {
        vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
          (key: string) => Promise.resolve(values[key] ?? ""),
        );
      }

      it("honours the flag, then the key, and non-interactive starts without saving", async () => {
        const mockSet = vi
          .spyOn(gitConfig, "gitSetConfigValue")
          .mockResolvedValue();
        configured({ "linear.autoStart": "false" });
        expect(await decide(true)).toBe(true);
        expect(await decide()).toBe(false);

        configured({ "linear.autoStart": "true" });
        expect(await decide(false)).toBe(false);
        expect(await decide()).toBe(true);

        configured({});
        setNonInteractive(true);
        expect(await decide()).toBe(true);
        expect(mockSet).not.toHaveBeenCalled();
      });

      it("prompts naming the key and saves the answer under it", async () => {
        const mockSet = vi
          .spyOn(gitConfig, "gitSetConfigValue")
          .mockResolvedValue();
        configured({});
        mockConfirm.mockResolvedValue(false);

        expect(await decide()).toBe(false);
        expect(mockConfirm).toHaveBeenCalledWith({
          message:
            "Move this issue to started? (saved as linear.autoStart; change it later with `worktree config linear.autoStart <true|false>`)",
        });
        expect(mockSet).toHaveBeenCalledWith("linear.autoStart", "false");
      });
    });

    describe("the worktree is the deliverable", () => {
      it("still creates and opens the worktree when the assignment throws", async () => {
        vi.spyOn(githubIntegration, "assignGitHubIssue").mockRejectedValue(
          new Error("GitHub: Failed to assign issue 42 in o/r. 403 Forbidden"),
        );
        githubRun({ assign: true });
        const mockGitCreateWorktree = vi
          .spyOn(git, "gitCreateWorktree")
          .mockResolvedValue("/path/to/worktree");

        // §2: nothing here may abort `branch`. A rejected assignment is a
        // warning on the spinner, never a `fail` and never a re-throw.
        await expect(branch.run()).resolves.toMatchObject({
          path: "/path/to/worktree",
        });

        expect(mockGitCreateWorktree).toHaveBeenCalledWith(
          "42-add-dark-mode",
          "origin/main",
          { fetch: false },
        );
        expect(mockCopyEnvFiles).toHaveBeenCalledWith("/path/to/worktree", {
          report: "stdout",
        });
        expect(mockOpenWorktreePath).toHaveBeenCalledWith(
          "/path/to/worktree",
          defaultOpenOptions,
        );

        // The last spinner of the run is the assignment's. The warning carries
        // the rejection's own text (the fixture's input above); `fail` and
        // `succeed` must stay untouched.
        const spinner = vi.mocked(ora).mock.results.at(-1)?.value;
        expect(spinner.warn).toHaveBeenCalledWith(
          expect.stringContaining(
            "GitHub: Failed to assign issue 42 in o/r. 403 Forbidden",
          ),
        );
        expect(spinner.fail).not.toHaveBeenCalled();
        expect(spinner.succeed).not.toHaveBeenCalled();
      });

      it("still creates the worktree when the issue comes back unassigned", async () => {
        // D6's silent no-op shape: a 201 whose assignees never gained the
        // login. Reported as a warning, not as success.
        vi.spyOn(githubIntegration, "assignGitHubIssue").mockResolvedValue({
          login: "octocat",
          assigned: false,
        });
        githubRun({ assign: true });
        const mockGitCreateWorktree = vi
          .spyOn(git, "gitCreateWorktree")
          .mockResolvedValue("/path/to/worktree");

        await expect(branch.run()).resolves.toMatchObject({
          path: "/path/to/worktree",
        });

        expect(mockGitCreateWorktree).toHaveBeenCalled();
        expect(mockOpenWorktreePath).toHaveBeenCalledWith(
          "/path/to/worktree",
          defaultOpenOptions,
        );

        // §2 is "never `fail`, never a throw". The case above pins the throwing
        // path's spinner; this pins the silent no-op's. The last spinner of the
        // run is the assignment's; without this, swapping this `warn` for
        // `fail` or `succeed` is invisible to the whole suite.
        const spinner = vi.mocked(ora).mock.results.at(-1)?.value;
        // The silent-ignore case GitHub documents for an account without push
        // access (not observed, #162). The fine-grained permission is named on
        // the 403 instead, which is what a token missing it gets.
        expect(spinner.warn).toHaveBeenCalledWith(
          "Issue #42 was not assigned to octocat. Assigning needs a token whose account has push access to the repository.",
        );
        expect(spinner.fail).not.toHaveBeenCalled();
        expect(spinner.succeed).not.toHaveBeenCalled();
      });

      it("names the repository and its source in the unassigned warning when it is not origin's (D4)", async () => {
        vi.spyOn(githubIntegration, "assignGitHubIssue").mockResolvedValue({
          login: "octocat",
          assigned: false,
          repository: { owner: "acme", name: "widgets", source: "upstream" },
        });
        githubRun({ assign: true });

        await branch.run();

        const spinner = vi.mocked(ora).mock.results.at(-1)?.value;
        expect(spinner.warn).toHaveBeenCalledWith(
          "Issue #42 was not assigned to octocat in acme/widgets (upstream). Assigning needs a token whose account has push access to the repository.",
        );
      });

      it("names the repository on the assigned line when it is not origin's, and not when it is", async () => {
        const mockAssign = vi.spyOn(githubIntegration, "assignGitHubIssue");
        githubRun({ assign: true });

        mockAssign.mockResolvedValueOnce({
          login: "octocat",
          assigned: true,
          repository: {
            owner: "acme",
            name: "widgets",
            source: "github.repository",
          },
        });
        await branch.run();
        expect(
          vi.mocked(ora).mock.results.at(-1)?.value.succeed,
        ).toHaveBeenCalledWith(
          "Assigned issue #42 to octocat in acme/widgets (github.repository)",
        );

        vi.mocked(ora).mockClear();
        githubRun({ assign: true });
        mockAssign.mockResolvedValueOnce({
          login: "octocat",
          assigned: true,
          repository: { owner: "acme", name: "widgets", source: "origin" },
        });
        await branch.run();
        expect(
          vi.mocked(ora).mock.results.at(-1)?.value.succeed,
        ).toHaveBeenCalledWith("Assigned issue #42 to octocat");
      });

      it("assigns before the worktree is created", async () => {
        const calls: string[] = [];
        vi.spyOn(githubIntegration, "assignGitHubIssue").mockImplementation(
          async () => {
            calls.push("assign");
            return { login: "octocat", assigned: true };
          },
        );
        githubRun({ assign: true });
        vi.spyOn(git, "gitCreateWorktree").mockImplementation(async () => {
          calls.push("createWorktree");
          return "/path/to/worktree";
        });

        await branch.run();

        // D7: deciding early is what keeps the prompt off the far side of the
        // creation spinners and a launched editor.
        expect(calls).toEqual(["assign", "createWorktree"]);
      });

      it("still creates the worktree when persisting the answer fails", async () => {
        // The write is bookkeeping about whether to assign, not the assignment
        // itself, so §2 covers it just as firmly: a stale .git/config.lock must
        // not cost the user the branch they asked for.
        mockConfirm.mockResolvedValue(true);
        vi.spyOn(gitConfig, "gitSetConfigValue").mockRejectedValue(
          new Error("error: could not lock config file .git/config"),
        );
        const mockWarn = vi
          .spyOn(branch, "warn")
          .mockImplementation((input: any) => input);
        githubRun({});
        const mockGitCreateWorktree = vi
          .spyOn(git, "gitCreateWorktree")
          .mockResolvedValue("/path/to/worktree");

        await expect(branch.run()).resolves.toMatchObject({
          path: "/path/to/worktree",
        });

        expect(mockGitCreateWorktree).toHaveBeenCalledWith(
          "42-add-dark-mode",
          "origin/main",
          { fetch: false },
        );
        expect(mockOpenWorktreePath).toHaveBeenCalledWith(
          "/path/to/worktree",
          defaultOpenOptions,
        );
        expect(mockWarn).toHaveBeenCalledWith(
          "Could not save github.autoAssign, so you will be asked again next time. error: could not lock config file .git/config",
        );
      });

      it("puts a non-Error rejection into the warning when persisting the answer fails", async () => {
        // The write is bookkeeping about whether to assign, not the assignment
        // itself, so §2 covers it just as firmly: a stale .git/config.lock must
        // not cost the user the branch they asked for.
        mockConfirm.mockResolvedValue(true);
        vi.spyOn(gitConfig, "gitSetConfigValue").mockRejectedValue(
          "config file is locked",
        );
        const mockWarn = vi
          .spyOn(branch, "warn")
          .mockImplementation((input: any) => input);
        githubRun({});
        const mockGitCreateWorktree = vi
          .spyOn(git, "gitCreateWorktree")
          .mockResolvedValue("/path/to/worktree");

        await expect(branch.run()).resolves.toMatchObject({
          path: "/path/to/worktree",
        });

        expect(mockGitCreateWorktree).toHaveBeenCalledWith(
          "42-add-dark-mode",
          "origin/main",
          { fetch: false },
        );
        expect(mockWarn).toHaveBeenCalledWith(
          "Could not save github.autoAssign, so you will be asked again next time. config file is locked",
        );
      });
    });

    describe("the other issue sources", () => {
      it("never reaches the assignment seam without --github or --jira", async () => {
        // The global spies in beforeEach would absorb a stray call silently,
        // so the plain path needs its own assertion that nothing is reached.
        const mockAssign = vi
          .spyOn(githubIntegration, "assignGitHubIssue")
          .mockResolvedValue({ login: "octocat", assigned: true });
        const mockAssignJira = vi
          .spyOn(jiraIntegration, "assignJiraIssue")
          .mockResolvedValue({ outcome: "assigned", displayName: "Me" });
        const mockSetConfigValue = vi
          .spyOn(gitConfig, "gitSetConfigValue")
          .mockResolvedValue();
        vi.spyOn(git, "gitCreateWorktree").mockResolvedValue(
          "/path/to/worktree",
        );

        (branch as any).parse = vi.fn().mockResolvedValue({
          args: { branchName: "my-branch" },
          flags: {},
        });

        await branch.run();

        expect(mockAssign).not.toHaveBeenCalled();
        expect(mockAssignJira).not.toHaveBeenCalled();
        // Not "no confirm at all" — verifyConfig asks its own missing-config
        // question on this path. Only the assignment one must be absent.
        const asked = mockConfirm.mock.calls.map(
          (call: unknown[]) => (call[0] as { message: string }).message,
        );
        expect(
          asked.some((message) => message.includes("Assign this issue")),
        ).toBe(false);
        expect(mockSetConfigValue).not.toHaveBeenCalledWith(
          "github.autoAssign",
          expect.anything(),
        );
      });

      describe("Jira assignment", () => {
        // One place to set up a --jira run whose only variable is the
        // assignment decision, as githubRun does for GitHub.
        function jiraRun(
          flags: Record<string, unknown>,
          configValues: Record<string, string> = {},
        ) {
          vi.spyOn(
            jiraIntegration,
            "getJiraBranchNameFromIssue",
          ).mockResolvedValue("DEV-123-add-dark-mode");
          vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
            (key: string) => {
              if (key === "has-called-config") return Promise.resolve("true");
              if (key === "defaultSourceBranch")
                return Promise.resolve("origin/main");
              if (key === "jira.host")
                return Promise.resolve("example.atlassian.net");
              if (key === "jira.email")
                return Promise.resolve("test@example.com");
              if (key === "jira.apiToken") return Promise.resolve("token");
              return Promise.resolve(configValues[key] ?? "");
            },
          );
          mockInput.mockResolvedValue("DEV-123-add-dark-mode");
          vi.spyOn(git, "gitCreateWorktree").mockResolvedValue(
            "/path/to/worktree",
          );

          (branch as any).parse = vi.fn().mockResolvedValue({
            args: {},
            flags: { jira: "dev-123", ...flags },
          });
        }

        const spyAssign = (
          result: Awaited<ReturnType<typeof jiraIntegration.assignJiraIssue>>,
        ) =>
          vi
            .spyOn(jiraIntegration, "assignJiraIssue")
            .mockResolvedValue(result);
        const assignedToMe = {
          outcome: "assigned",
          displayName: "Ada Lovelace",
        } as const;
        const lastSpinner = () => vi.mocked(ora).mock.results.at(-1)?.value;

        it("assigns on --assign and reports assigned: true", async () => {
          const mockAssign = spyAssign(assignedToMe);
          const mockGithubAssign = vi.spyOn(
            githubIntegration,
            "assignGitHubIssue",
          );
          jiraRun({ assign: true });

          const document = await branch.run();

          // The key is passed as typed; assignJiraIssue normalises it itself.
          expect(mockAssign).toHaveBeenCalledWith("dev-123");
          expect(mockGithubAssign).not.toHaveBeenCalled();
          // D6: `true` means the issue is the caller's after this run.
          expect(document?.assigned).toBe(true);
          expect(lastSpinner().succeed).toHaveBeenCalledWith(
            "Assigned DEV-123 to Ada Lovelace",
          );
        });

        it("reports already-yours as success, with assigned: true", async () => {
          spyAssign({ outcome: "already-yours", displayName: "Ada Lovelace" });
          jiraRun({ assign: true });

          const document = await branch.run();

          expect(document?.assigned).toBe(true);
          expect(lastSpinner().succeed).toHaveBeenCalledWith(
            "DEV-123 is already assigned to you",
          );
        });

        it("does not call Jira on --no-assign, and reports assigned: null", async () => {
          const mockAssign = spyAssign(assignedToMe);
          jiraRun({ assign: false }, { "jira.autoAssign": "true" });

          const document = await branch.run();

          expect(mockAssign).not.toHaveBeenCalled();
          expect(document?.assigned).toBeNull();
        });

        it("assigns when jira.autoAssign is true and no flag is given", async () => {
          const mockAssign = spyAssign(assignedToMe);
          jiraRun({}, { "jira.autoAssign": "true" });

          await branch.run();

          expect(mockAssign).toHaveBeenCalledWith("dev-123");
          expect(mockConfirm).not.toHaveBeenCalled();
        });

        it("does not assign when jira.autoAssign is false and no flag is given", async () => {
          const mockAssign = spyAssign(assignedToMe);
          jiraRun({}, { "jira.autoAssign": "false" });

          const document = await branch.run();

          expect(mockAssign).not.toHaveBeenCalled();
          expect(document?.assigned).toBeNull();
        });

        it("ignores github.autoAssign for a Jira run", async () => {
          const mockAssign = spyAssign(assignedToMe);
          jiraRun(
            {},
            { "github.autoAssign": "true", "jira.autoAssign": "false" },
          );

          await branch.run();

          expect(mockAssign).not.toHaveBeenCalled();
        });

        it("asks when the key is unset, assigns on yes and saves it under jira.autoAssign", async () => {
          const mockAssign = spyAssign(assignedToMe);
          const mockSet = vi
            .spyOn(gitConfig, "gitSetConfigValue")
            .mockResolvedValue();
          mockConfirm.mockResolvedValue(true);
          jiraRun({});

          await branch.run();

          expect(mockConfirm).toHaveBeenCalledWith({
            message:
              "Assign this issue to you? (saved as jira.autoAssign; change it later with `worktree config jira.autoAssign <true|false>`)",
          });
          expect(mockAssign).toHaveBeenCalledWith("dev-123");
          expect(mockSet).toHaveBeenCalledWith("jira.autoAssign", "true");
        });

        it("assigns without asking or saving when non-interactive and unset", async () => {
          const mockAssign = spyAssign(assignedToMe);
          const mockSet = vi
            .spyOn(gitConfig, "gitSetConfigValue")
            .mockResolvedValue();
          jiraRun({});
          setNonInteractive(true);

          await branch.run();

          expect(mockAssign).toHaveBeenCalledWith("dev-123");
          expect(mockConfirm).not.toHaveBeenCalled();
          expect(mockSet).not.toHaveBeenCalledWith(
            "jira.autoAssign",
            expect.anything(),
          );
        });

        it("leaves an issue held by someone else alone: a warning naming them, assigned: false, worktree created", async () => {
          // D1: held-by-other means no write; the holder is named so the
          // person knows whose work it is.
          spyAssign({
            outcome: "held-by-other",
            displayName: "Ada Lovelace",
            heldBy: "Grace Hopper",
          });
          jiraRun({ assign: true });
          const mockGitCreateWorktree = vi
            .spyOn(git, "gitCreateWorktree")
            .mockResolvedValue("/path/to/worktree");

          const document = await branch.run();

          expect(document?.assigned).toBe(false);
          expect(document?.path).toBe("/path/to/worktree");
          expect(mockGitCreateWorktree).toHaveBeenCalled();
          const spinner = lastSpinner();
          expect(spinner.warn).toHaveBeenCalledWith(
            "DEV-123 is already assigned to Grace Hopper, so it was left alone. Reassign it in Jira if it should be yours.",
          );
          expect(spinner.fail).not.toHaveBeenCalled();
          expect(spinner.succeed).not.toHaveBeenCalled();
          expect(document?.warnings).toContain(
            "DEV-123 is already assigned to Grace Hopper, so it was left alone. Reassign it in Jira if it should be yours.",
          );
        });

        it("still creates the worktree when the assignment is rejected", async () => {
          vi.spyOn(jiraIntegration, "assignJiraIssue").mockRejectedValue(
            new Error(
              "Jira: Your account lacks the Assign Issues permission on the project of DEV-123.",
            ),
          );
          jiraRun({ assign: true });
          const mockGitCreateWorktree = vi
            .spyOn(git, "gitCreateWorktree")
            .mockResolvedValue("/path/to/worktree");

          const document = await branch.run();

          expect(document?.path).toBe("/path/to/worktree");
          expect(document?.assigned).toBe(false);
          expect(mockGitCreateWorktree).toHaveBeenCalled();
          expect(mockOpenWorktreePath).toHaveBeenCalled();
          const spinner = lastSpinner();
          expect(spinner.warn).toHaveBeenCalledWith(
            "Could not assign DEV-123. Jira: Your account lacks the Assign Issues permission on the project of DEV-123.",
          );
          expect(spinner.fail).not.toHaveBeenCalled();
          expect(document?.warnings).toContain(
            "Could not assign DEV-123. Jira: Your account lacks the Assign Issues permission on the project of DEV-123.",
          );
        });

        it("assigns before the worktree is created", async () => {
          const calls: string[] = [];
          vi.spyOn(jiraIntegration, "assignJiraIssue").mockImplementation(
            async () => {
              calls.push("assign");
              return assignedToMe;
            },
          );
          jiraRun({ assign: true });
          vi.spyOn(git, "gitCreateWorktree").mockImplementation(async () => {
            calls.push("createWorktree");
            return "/path/to/worktree";
          });

          await branch.run();

          expect(calls).toEqual(["assign", "createWorktree"]);
        });

        it("keeps the --json document's existing keys", async () => {
          spyAssign(assignedToMe);
          jiraRun({ assign: true });

          const document = await branch.run();

          // The keys the command's description documents for --json; D6
          // changes a value's meaning, never the shape.
          expect(Object.keys(document ?? {}).sort()).toEqual(
            [
              "path",
              "branch",
              "source",
              "issue",
              "assigned",
              "started",
              "envFilesCopied",
              "installed",
              "herdr",
              "agent",
              "warnings",
            ].sort(),
          );
        });
      });

      it.each([
        [true],
        [false],
      ])("errors when the assign flag is %s with none of --github, --jira, --linear or --clickup", async (assign) => {
        vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
          (key: string) => {
            if (key === "has-called-config") return Promise.resolve("true");
            return Promise.resolve("");
          },
        );
        const mockError = vi.spyOn(branch, "error").mockImplementation(() => {
          throw new Error(
            "--assign/--no-assign requires one of --github, --jira, --linear or --clickup.",
          );
        });

        (branch as any).parse = vi.fn().mockResolvedValue({
          args: { branchName: "my-branch" },
          flags: { assign },
        });

        // Both spellings are one flag under `allowNo`, and neither has an
        // issue to act on here.
        await expect(branch.run()).rejects.toThrow(
          "--assign/--no-assign requires one of --github, --jira, --linear or --clickup.",
        );
        expect(mockError).toHaveBeenCalledWith(
          "--assign/--no-assign requires one of --github, --jira, --linear or --clickup.",
        );
      });

      it("leaves a plain --github run untouched when no flag and no key", async () => {
        // The confirm is the only new prompt on this path, and a `no` must
        // leave the run exactly as it was before this feature.
        const mockAssign = vi
          .spyOn(githubIntegration, "assignGitHubIssue")
          .mockResolvedValue({ login: "octocat", assigned: true });
        vi.spyOn(gitConfig, "gitSetConfigValue").mockResolvedValue();
        mockConfirm.mockResolvedValue(false);
        githubRun({});
        const mockGitCreateWorktree = vi
          .spyOn(git, "gitCreateWorktree")
          .mockResolvedValue("/path/to/worktree");

        await branch.run();

        expect(mockAssign).not.toHaveBeenCalled();
        expect(mockGitCreateWorktree).toHaveBeenCalledWith(
          "42-add-dark-mode",
          "origin/main",
          { fetch: false },
        );
        expect(mockOpenWorktreePath).toHaveBeenCalledWith(
          "/path/to/worktree",
          defaultOpenOptions,
        );
      });
    });

    it("derives the issue number the same way the branch name does", async () => {
      const mockAssign = vi
        .spyOn(githubIntegration, "assignGitHubIssue")
        .mockResolvedValue({ login: "octocat", assigned: true });
      githubRun({ assign: true, github: "#42" });

      await branch.run();

      // Both readers of --github go through one helper, so a leading `#`
      // cannot be stripped for the branch name and left on for the assignment.
      expect(githubIntegration.fetchGitHubIssue).toHaveBeenCalledWith(42);
      expect(mockAssign).toHaveBeenCalledWith(42);
    });
  });

  describe("the agent handoff flags", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "worktree-brief-"));
      vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) => {
          if (key === "has-called-config") return Promise.resolve("true");
          if (key === "defaultSourceBranch")
            return Promise.resolve("origin/main");
          if (key === "agent.command") return Promise.resolve("claude --bg");
          return Promise.resolve("");
        },
      );
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    function parsed(flags: Record<string, unknown>) {
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feature/test" },
        flags,
      });
    }

    it("hands the prompt to the opener as the brief", async () => {
      parsed({ agent: "implement the issue" });

      await branch.run();

      expect(mockOpenWorktreePath).toHaveBeenCalledWith("/path/to/worktree", {
        open: true,
        agent: true,
        brief: "implement the issue",
      });
    });

    it("never dispatches itself, so the opener alone decides Herdr or detached", async () => {
      parsed({ agent: "implement the issue" });

      await branch.run();

      expect(mockDispatchAgent).not.toHaveBeenCalled();
    });

    it("opens after the env files are copied", async () => {
      parsed({ agent: "implement the issue" });

      await branch.run();

      // The agent starts working immediately, so the worktree has to be
      // complete before it is handed over.
      expect(mockCopyEnvFiles.mock.invocationCallOrder[0]).toBeLessThan(
        mockOpenWorktreePath.mock.invocationCallOrder[0],
      );
    });

    it("reads the brief from --agent-file", async () => {
      const file = join(tempDir, "brief.md");
      writeFileSync(file, "line one\nline two\n");
      parsed({ "agent-file": file });

      await branch.run();

      expect(mockOpenWorktreePath).toHaveBeenCalledWith("/path/to/worktree", {
        open: true,
        agent: true,
        brief: "line one\nline two\n",
      });
    });

    it("rejects an empty --agent before creating anything", async () => {
      parsed({ agent: "  " });

      await expect(branch.run()).rejects.toThrow(/empty/);

      expect(git.gitCreateWorktree).not.toHaveBeenCalled();
    });

    it("rejects a --agent-file that is empty, missing, a directory, or over the 131,071-byte cap", async () => {
      const empty = join(tempDir, "empty.md");
      const big = join(tempDir, "big.md");
      writeFileSync(empty, "");
      writeFileSync(big, "x".repeat(131_072));

      for (const [file, message] of [
        [empty, /empty/],
        [join(tempDir, "missing.md"), /does not exist/],
        [tempDir, /not a regular file/],
        [big, /over 131071 bytes/],
      ] as const) {
        parsed({ "agent-file": file });
        await expect(branch.run()).rejects.toThrow(message);
      }

      expect(git.gitCreateWorktree).not.toHaveBeenCalled();
    });

    it("rejects a --agent over the cap measured in bytes, not characters", async () => {
      // 90,000 three-byte characters are under 131,071 characters and over 131,071 bytes.
      parsed({ agent: "€".repeat(90_000) });

      await expect(branch.run()).rejects.toThrow(/over 131071 bytes/);
    });

    // #75: a brief nothing would take used to be found out only after the tree
    // was created and installed — as an error with no `path` on the Herdr path,
    // and as an exit 0 with `agent: null` on every other.
    describe("a brief with no agent to hand it to", () => {
      function configure(values: Record<string, string>) {
        vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
          (key: string) =>
            Promise.resolve(
              key === "has-called-config"
                ? "true"
                : key === "defaultSourceBranch"
                  ? "origin/main"
                  : (values[key] ?? ""),
            ),
        );
      }

      beforeEach(() => {
        vi.spyOn(herdr, "isHerdrInstalled").mockResolvedValue(true);
      });

      it("fails as a missing value before the worktree is created", async () => {
        configure({ opener: "herdr" });
        parsed({ agent: "implement the issue" });

        const error = await branch.run().catch((thrown: unknown) => thrown);

        expect(error).toBeInstanceOf(MissingValueError);
        expect(error).toMatchObject({
          value: "the agent kind",
          flag: "`worktree config herdr.agent <kind>`",
        });
        expect(git.gitCreateWorktree).not.toHaveBeenCalled();
        expect(mockCopyEnvFiles).not.toHaveBeenCalled();
        expect(mockRunInstall).not.toHaveBeenCalled();
        expect(mockOpenWorktreePath).not.toHaveBeenCalled();
      });

      // Every run Herdr does not open falls to the detached dispatch, and that
      // takes `agent.command` — `herdr.agent` alone is no use to it.
      it.each([
        ["the opener is the editor", { opener: "code" }, {}],
        ["the opener is none", { opener: "none" }, {}],
        ["--no-open is given", { opener: "herdr" }, { "no-open": true }],
        [
          "only herdr.agent is set and --no-open is given",
          { opener: "herdr", "herdr.agent": "claude" },
          { "no-open": true },
        ],
      ])("fails naming agent.command, before the worktree is created, when %s", async (_label, values, flags) => {
        configure(values);
        parsed({ agent: "implement the issue", ...flags });

        const error = await branch.run().catch((thrown: unknown) => thrown);

        expect(error).toBeInstanceOf(MissingValueError);
        expect(error).toMatchObject({
          value: "the agent command",
          flag: '`worktree config agent.command "<command>"`',
        });
        expect(git.gitCreateWorktree).not.toHaveBeenCalled();
      });

      it("fails naming agent.command when Herdr is not installed, for the detached path", async () => {
        vi.spyOn(herdr, "isHerdrInstalled").mockResolvedValue(false);
        configure({ opener: "herdr", "herdr.agent": "claude" });
        parsed({ agent: "implement the issue" });

        await expect(branch.run()).rejects.toMatchObject({
          value: "the agent command",
        });
        expect(git.gitCreateWorktree).not.toHaveBeenCalled();
      });

      it.each([
        [
          "herdr.agent is set",
          { opener: "herdr", "herdr.agent": "claude" },
          {},
        ],
        [
          "agent.command names a program",
          { opener: "herdr", "agent.command": "claude --bg" },
          {},
        ],
        [
          "the opener is the editor and agent.command is set",
          { opener: "code", "agent.command": "claude --bg" },
          {},
        ],
        [
          "--no-open is given and agent.command is set",
          { opener: "herdr", "agent.command": "claude --bg" },
          { "no-open": true },
        ],
        ["--no-agent is given", { opener: "herdr" }, { "no-agent": true }],
      ])("still creates the worktree when %s", async (_label, values, flags) => {
        configure(values);
        parsed({ agent: "implement the issue", ...flags });
        // --no-agent excludes the brief flags, so it carries none.
        if ("no-agent" in flags) {
          parsed({ ...flags });
        }

        await branch.run();

        expect(git.gitCreateWorktree).toHaveBeenCalled();
      });

      it("still creates the worktree when Herdr is not installed and agent.command is set", async () => {
        vi.spyOn(herdr, "isHerdrInstalled").mockResolvedValue(false);
        configure({ opener: "herdr", "agent.command": "claude --bg" });
        parsed({ agent: "implement the issue" });

        await branch.run();

        expect(git.gitCreateWorktree).toHaveBeenCalled();
      });

      it("still creates the worktree when there is no brief", async () => {
        configure({ opener: "herdr" });
        parsed({});

        await branch.run();

        expect(git.gitCreateWorktree).toHaveBeenCalled();
      });
    });

    it("declares the three brief flags and --no-agent as mutually exclusive", () => {
      const { flags } = Branch;

      expect(flags.agent.exclusive).toEqual(
        expect.arrayContaining(["agent-file", "agent-stdin"]),
      );
      expect(flags["agent-file"].exclusive).toEqual(
        expect.arrayContaining(["agent", "agent-stdin"]),
      );
      expect(flags["agent-stdin"].exclusive).toEqual(
        expect.arrayContaining(["agent", "agent-file"]),
      );
      for (const flag of [
        flags.agent,
        flags["agent-file"],
        flags["agent-stdin"],
      ]) {
        expect(flag.exclusive).toContain("no-agent");
      }
    });

    it("passes --no-open and --no-agent to the opener", async () => {
      parsed({ "no-open": true, "no-agent": true });

      await branch.run();

      expect(mockOpenWorktreePath).toHaveBeenCalledWith("/path/to/worktree", {
        open: false,
        agent: false,
        brief: undefined,
      });
    });

    it("passes no brief when no flag was given", async () => {
      parsed({});

      await branch.run();

      expect(mockOpenWorktreePath).toHaveBeenCalledWith(
        "/path/to/worktree",
        defaultOpenOptions,
      );
    });
  });

  describe("when non-interactive", () => {
    beforeEach(() => {
      setNonInteractive(true);
    });

    it("takes the issue-derived name, asks nothing, assigns by default and saves nothing", async () => {
      const mockSetConfigValue = vi
        .spyOn(gitConfig, "gitSetConfigValue")
        .mockResolvedValue();
      vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
        number: 42,
        title: "Add dark mode",
      } as any);
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) =>
          Promise.resolve(
            key === "has-called-config" || key === "defaultSourceBranch"
              ? "origin/main"
              : "",
          ),
      );
      const mockGitCreateWorktree = vi
        .spyOn(git, "gitCreateWorktree")
        .mockResolvedValue("/path/to/worktree");
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { github: "42" },
      });

      await branch.run();

      expect(mockGitCreateWorktree).toHaveBeenCalledWith(
        "42-add-dark-mode",
        "origin/main",
        { fetch: false },
      );
      expect(mockInput).not.toHaveBeenCalled();
      expect(mockConfirm).not.toHaveBeenCalled();
      // D8: unset means assign when non-interactive.
      expect(githubIntegration.assignGitHubIssue).toHaveBeenCalledWith(42);
      // One unattended run must not settle the key for a human's later runs.
      expect(mockSetConfigValue).not.toHaveBeenCalledWith(
        "github.autoAssign",
        expect.anything(),
      );
    });

    it.each([
      ["a configured false", { assign: undefined }, "false"],
      ["--no-assign", { assign: false }, ""],
    ])("does not assign with %s", async (_label, flagOverride, configured) => {
      vi.spyOn(gitConfig, "gitSetConfigValue").mockResolvedValue();
      vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
        number: 42,
        title: "Add dark mode",
      } as any);
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) =>
          Promise.resolve(
            key === "github.autoAssign"
              ? configured
              : key === "has-called-config" || key === "defaultSourceBranch"
                ? "origin/main"
                : "",
          ),
      );
      vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { github: "42", ...flagOverride },
      });

      await branch.run();

      expect(githubIntegration.assignGitHubIssue).not.toHaveBeenCalled();
      expect(gitConfig.gitSetConfigValue).not.toHaveBeenCalled();
    });

    it("cuts a long issue title to a 48-character slug without asking", async () => {
      vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
        number: 42,
        title:
          "Add a dark mode toggle to the settings page so that users can switch themes at runtime",
      } as any);
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) =>
          Promise.resolve(
            key === "has-called-config" || key === "defaultSourceBranch"
              ? "origin/main"
              : "",
          ),
      );
      const mockGitCreateWorktree = vi
        .spyOn(git, "gitCreateWorktree")
        .mockResolvedValue("/path/to/worktree");
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { github: "42" },
      });

      await branch.run();

      expect(mockGitCreateWorktree).toHaveBeenCalledWith(
        "42-add-a-dark-mode-toggle-to-the-settings-page-so",
        "origin/main",
        { fetch: false },
      );
      expect(mockInput).not.toHaveBeenCalled();
    });

    it("still honours a configured github.autoAssign", async () => {
      vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
        number: 42,
        title: "Add dark mode",
      } as any);
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) =>
          Promise.resolve(
            key === "github.autoAssign"
              ? "true"
              : key === "has-called-config" || key === "defaultSourceBranch"
                ? "origin/main"
                : "",
          ),
      );
      vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { github: "42" },
      });

      await branch.run();

      expect(githubIntegration.assignGitHubIssue).toHaveBeenCalledWith(42);
    });

    it("fails naming <branchName> when there is no name and no issue", async () => {
      const mockGitCreateWorktree = vi.spyOn(git, "gitCreateWorktree");
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: {},
      });

      await expect(branch.run()).rejects.toMatchObject({
        message: "no default for the branch name; pass <branchName>",
        oclif: { exit: 2 },
      });
      expect(mockInput).not.toHaveBeenCalled();
      expect(mockGitCreateWorktree).not.toHaveBeenCalled();
    });

    it("fails naming --source origin/<branch> for a local source", async () => {
      vi.spyOn(git, "gitGetRemoteBranches").mockResolvedValue(["origin/main"]);
      const mockGitCreateWorktree = vi.spyOn(git, "gitCreateWorktree");
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feature/test" },
        flags: { source: "develop" },
      });

      await expect(branch.run()).rejects.toMatchObject({
        message:
          "no default for whether to use the local source branch develop; pass --source origin/develop",
        oclif: { exit: 2 },
      });
      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockGitCreateWorktree).not.toHaveBeenCalled();
    });

    it("names the missing config instead of offering to run config", async () => {
      const warnSpy = vi
        .spyOn(branch, "warn")
        .mockImplementation((input) => input);
      vi.spyOn(gitConfig, "gitGetConfigValue").mockResolvedValue("");
      vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feature/test" },
        flags: {},
      });

      await branch.run();

      expect(mockConfirm).not.toHaveBeenCalled();
      expect(branch.config.runCommand).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Missing config: defaultSourceBranch"),
      );
    });
  });
  describe("install step", () => {
    beforeEach(() => {
      vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");
    });

    function parsed(flags: Record<string, unknown>) {
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feature/test" },
        flags,
      });
    }

    it("installs in the new tree, after the env files and before the open", async () => {
      mockRunInstall.mockResolvedValue({
        ran: true,
        command: "pnpm install --frozen-lockfile",
        steps: ["pnpm install --frozen-lockfile"],
        from: "lockfile",
        inferred: true,
        ok: true,
      });
      parsed({ agent: "implement the issue" });

      await branch.run();

      expect(mockRunInstall).toHaveBeenCalledWith(
        "/path/to/worktree",
        undefined,
      );
      const installOrder = mockRunInstall.mock.invocationCallOrder[0];
      expect(mockCopyEnvFiles.mock.invocationCallOrder[0]).toBeLessThan(
        installOrder,
      );
      expect(installOrder).toBeLessThan(
        mockOpenWorktreePath.mock.invocationCallOrder[0],
      );
    });

    it("passes --install and --no-install through as given", async () => {
      parsed({ install: true });
      await branch.run();
      expect(mockRunInstall).toHaveBeenLastCalledWith(
        "/path/to/worktree",
        true,
      );

      parsed({ install: false });
      await branch.run();
      expect(mockRunInstall).toHaveBeenLastCalledWith(
        "/path/to/worktree",
        false,
      );
    });

    it("carries on to the opener when the install is skipped", async () => {
      parsed({});

      await branch.run();

      expect(mockOpenWorktreePath).toHaveBeenCalledWith(
        "/path/to/worktree",
        defaultOpenOptions,
      );
    });

    it("keeps the tree, starts neither agent nor opener, and exits 1 when the install fails", async () => {
      mockRunInstall.mockResolvedValue({
        ran: true,
        command: "npm ci",
        steps: ["npm ci"],
        from: "lockfile",
        inferred: true,
        ok: false,
        reason: "exited with code 1",
      });
      parsed({ agent: "implement the issue" });

      await expect(branch.run()).rejects.toMatchObject({
        message: expect.stringContaining(
          "`npm ci` failed (exited with code 1). The worktree was created at /path/to/worktree, but nothing was opened and no agent was started. Fix the install there and run `worktree open feature/test`, or run `worktree remove feature/test -f` and re-run with --no-install.",
        ),
        oclif: { exit: 1 },
      });

      expect(mockDispatchAgent).not.toHaveBeenCalled();
      expect(mockOpenWorktreePath).not.toHaveBeenCalled();
    });
  });
  describe("--json", () => {
    const originalExitCode = process.exitCode;
    let output: ReturnType<typeof captureOutput>;

    beforeEach(() => {
      process.exitCode = undefined;
      output = captureOutput();
      vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) =>
          Promise.resolve(
            key === "has-called-config" || key === "defaultSourceBranch"
              ? "origin/main"
              : "",
          ),
      );
    });

    afterEach(() => {
      output.restore();
      process.exitCode = originalExitCode;
    });

    // Through `_run`, as oclif does: that is what prints the returned document
    // and what routes a throw to `catch`.
    async function runJson(
      args: Record<string, unknown>,
      flags: Record<string, unknown>,
      outcome: Record<string, unknown> = { opener: "none" },
    ) {
      const command = new Branch(["--json"], await loadConfig());
      (command as any).parse = vi.fn().mockResolvedValue({ args, flags });
      (command as any).parsed = true;
      vi.spyOn(command as any, "openWorktreePath").mockResolvedValue(outcome);
      return (command as any)._run();
    }

    it("prints exactly one document with the contract's keys and nothing else on stdout", async () => {
      vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
        number: 42,
        title: "Add dark mode",
        htmlUrl: "https://github.com/acme/demo/issues/42",
      } as any);
      mockCopyEnvFiles.mockResolvedValue(["docs/.env.local"]);
      mockRunInstall.mockResolvedValue({
        ran: true,
        command: "pnpm install --frozen-lockfile",
        steps: ["pnpm install --frozen-lockfile"],
        from: "lockfile",
        inferred: true,
        ok: true,
      });

      await runJson(
        {},
        { github: "42" },
        {
          opener: "herdr",
          herdr: { space: "w5", pane: "w5:p1", agent: "wt-42-add-dark-mode" },
          agent: {
            name: "demo-42-add-dark-mode",
            kind: "claude",
            command: ["claude", "--name", "demo-42-add-dark-mode"],
            prompted: true,
          },
        },
      );

      // The whole of stdout, not a line of it: any stray text would throw here.
      expect(output.stdout().trim().split("\n")).toHaveLength(1);
      const document = output.document();
      expect(Object.keys(document).sort()).toEqual(
        [
          "agent",
          "assigned",
          "branch",
          "envFilesCopied",
          "herdr",
          "installed",
          "issue",
          "path",
          "source",
          "started",
          "warnings",
        ].sort(),
      );
      expect(document).toEqual({
        path: "/path/to/worktree",
        branch: "42-add-dark-mode",
        source: "origin/main",
        issue: {
          provider: "github",
          number: 42,
          url: "https://github.com/acme/demo/issues/42",
        },
        assigned: true,
        started: null,
        envFilesCopied: ["docs/.env.local"],
        installed: {
          ran: true,
          command: "pnpm install --frozen-lockfile",
          steps: ["pnpm install --frozen-lockfile"],
          from: "lockfile",
          inferred: true,
          ok: true,
        },
        herdr: { space: "w5", pane: "w5:p1", agent: "wt-42-add-dark-mode" },
        agent: {
          name: "demo-42-add-dark-mode",
          kind: "claude",
          command: ["claude", "--name", "demo-42-add-dark-mode"],
          prompted: true,
        },
        warnings: [],
      });
    });

    it("lists a copy-pattern file in envFilesCopied beside the env files, and sends the report to stderr", async () => {
      vi.spyOn(git, "gitReadBlobAtRef").mockResolvedValue({
        status: "found",
        content: "copy:\n  - config/master.key\n",
      });
      mockCopyEnvFiles.mockResolvedValue([".env", "config/master.key"]);

      await runJson({ branchName: "feature/test" }, { "no-open": true });

      expect(mockCopyEnvFiles).toHaveBeenCalledWith("/path/to/worktree", {
        report: "stderr",
        copy: ["config/master.key"],
      });
      expect(output.document()).toMatchObject({
        envFilesCopied: [".env", "config/master.key"],
      });
    });

    it("reports what was skipped as null, not omitted", async () => {
      await runJson(
        { branchName: "feature/test" },
        { "no-open": true },
        { opener: "none" },
      );

      const document = output.document();
      expect(document).toMatchObject({
        branch: "feature/test",
        issue: null,
        assigned: null,
        envFilesCopied: [],
        installed: { ran: false, reason: "skipped" },
        herdr: null,
        agent: null,
        warnings: [],
      });
      // `toMatchObject` would pass a missing key against null: assert presence.
      for (const key of ["issue", "assigned", "herdr", "agent"]) {
        expect(document).toHaveProperty(key, null);
      }
    });

    it("reports a failed assignment as false, and a declined one as null", async () => {
      vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
        number: 42,
        title: "Add dark mode",
      } as any);
      vi.spyOn(githubIntegration, "assignGitHubIssue").mockRejectedValue(
        new Error("403 Forbidden"),
      );

      await runJson({}, { github: "42" });

      expect(output.document()).toMatchObject({
        assigned: false,
        issue: { provider: "github", number: 42, url: null },
        warnings: [expect.stringContaining("403 Forbidden")],
      });
    });

    it("sends the env-file report to stderr", async () => {
      await runJson({ branchName: "feature/test" }, {});

      expect(mockCopyEnvFiles).toHaveBeenCalledWith("/path/to/worktree", {
        report: "stderr",
      });
    });

    it("says warnings on stderr and keeps them in the document", async () => {
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) =>
          Promise.resolve(key === "has-called-config" ? "true" : ""),
      );

      await runJson({ branchName: "feature/test" }, {});

      expect(output.stderr()).toContain("Warning: Missing config:");
      // The text is in the document only; no `Warning:` line shares stdout.
      expect(output.stdout()).not.toContain("Warning:");
      expect(output.stdout().trim().split("\n")).toHaveLength(1);
      expect(output.document()).toMatchObject({
        warnings: [
          expect.stringContaining("Missing config: defaultSourceBranch"),
        ],
      });
    });

    it("is non-interactive, so a missing name is an error and not a prompt", async () => {
      await runJson({}, {});

      expect(mockInput).not.toHaveBeenCalled();
      expect(output.document()).toEqual({
        error: {
          code: "missing_value",
          message: "no default for the branch name; pass <branchName>",
          details: { value: "the branch name", flag: "<branchName>" },
        },
      });
      expect(output.stderr()).toContain(
        "worktree: no default for the branch name; pass <branchName>",
      );
      expect(process.exitCode).toBe(2);
    });

    it("gives a brief with no agent kind as missing_value, before a tree exists (#75)", async () => {
      vi.spyOn(herdr, "isHerdrInstalled").mockResolvedValue(true);
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) =>
          Promise.resolve(
            key === "has-called-config" || key === "defaultSourceBranch"
              ? "origin/main"
              : key === "opener"
                ? "herdr"
                : "",
          ),
      );

      await runJson({ branchName: "feature/test" }, { agent: "do it" });

      expect(output.document()).toMatchObject({
        error: { code: "missing_value" },
      });
      expect(mockGitCreateWorktreeCalls()).toBe(0);
      expect(process.exitCode).toBe(2);
    });

    it("gives an invalid name as invalid_value with a non-zero exit", async () => {
      await runJson({ branchName: "invalid..branch" }, {});

      expect(output.document()).toMatchObject({
        error: { code: "invalid_value" },
      });
      expect(process.exitCode).toBe(2);
      expect(mockGitCreateWorktreeCalls()).toBe(0);
    });

    it.each([
      ["--github abc", { github: "abc" }],
      ["a malformed --jira key", { jira: "not-a-key" }],
    ])("gives %s as invalid_value without creating a worktree", async (_label, flags) => {
      // Earlier tests leave these stubbed; this one needs the real validation.
      vi.spyOn(githubIntegration, "fetchGitHubIssue").mockRestore();
      vi.spyOn(jiraIntegration, "getJiraBranchNameFromIssue").mockRestore();

      await runJson({}, flags);

      expect(output.document()).toMatchObject({
        error: { code: "invalid_value" },
      });
      expect(process.exitCode).toBe(2);
      expect(mockGitCreateWorktreeCalls()).toBe(0);
    });

    it("gives a missing source branch as not_found", async () => {
      vi.spyOn(git, "gitGetRemoteBranches").mockResolvedValue(["origin/main"]);

      await runJson(
        { branchName: "feature/test" },
        { source: "origin/nonexistent" },
      );

      expect(output.document()).toEqual({
        error: {
          code: "not_found",
          message: "Source branch doesn't exist: origin/nonexistent",
        },
      });
      expect(process.exitCode).toBe(2);
    });

    it("keeps the document and exits 1 when the install fails", async () => {
      mockRunInstall.mockResolvedValue({
        ran: true,
        command: "npm ci",
        steps: ["npm ci"],
        from: "lockfile",
        inferred: true,
        ok: false,
        reason: "exited with code 1",
      });

      await runJson({ branchName: "feature/test" }, {});

      expect(process.exitCode).toBe(1);
      expect(output.document()).toMatchObject({
        path: "/path/to/worktree",
        installed: { ran: true, ok: false },
        herdr: null,
        agent: null,
        warnings: [expect.stringContaining("`npm ci` failed")],
      });
    });

    it("prints no credential from a message that quotes one", async () => {
      vi.spyOn(githubIntegration, "fetchGitHubIssue").mockRejectedValue(
        new Error(
          'GitHub: Unable to determine the current repository from origin remote "https://octocat:ghp_abcdefghijklmnopqrstuvwxyz0123456789@example.com/o/r.git".',
        ),
      );

      await runJson({}, { github: "42" });

      expect(output.stdout()).not.toContain("ghp_");
      expect(output.stdout()).not.toContain("octocat:");
      expect(output.stderr()).not.toContain("ghp_");
      expect(output.document()).toMatchObject({ error: { code: "failed" } });
    });

    function mockGitCreateWorktreeCalls() {
      return vi.mocked(git.gitCreateWorktree).mock.calls.length;
    }
  });

  // Expected values come from plan #121 section 1 (git's four states, observed
  // with real git) and D2-D4: exit 2 and `invalid_value` for a refusal (the
  // InvalidValueError contract), exit 1 for a declined reopen (the closed-issue
  // decline), and no side effect before the check (D1).
  describe("a branch name that is already taken", () => {
    const worktreePath = "/repo.worktrees/feat";
    const mockCreate = () => vi.spyOn(git, "gitCreateWorktree");
    const run = (flags: Record<string, unknown> = {}) => {
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feat" },
        flags: { github: undefined, ...flags },
      });
      return branch.run();
    };
    // In git, a branch checked out anywhere is also a local branch (section 1's
    // table), so the fixture says so: only asking the worktree list first, then
    // the branch list (section 4), keeps A, C and D from being read as B.
    const checkout = (over: Partial<git.BranchCheckout> = {}) => {
      vi.spyOn(git, "gitGetLocalBranches").mockResolvedValue(["main", "feat"]);
      return vi.spyOn(git, "gitFindBranchCheckout").mockResolvedValue({
        path: worktreePath,
        pathExists: true,
        inWorktreesRoot: true,
        ...over,
      });
    };
    const expectNothingDone = () => {
      expect(git.gitCreateWorktree).not.toHaveBeenCalled();
      expect(mockCopyEnvFiles).not.toHaveBeenCalled();
      expect(mockRunInstall).not.toHaveBeenCalled();
      expect(githubIntegration.assignGitHubIssue).not.toHaveBeenCalled();
      expect(gitConfig.gitSetConfigValue).not.toHaveBeenCalled();
    };

    const refusals: [string, () => void, string][] = [
      [
        "B: a branch with no worktree",
        () => {
          vi.spyOn(git, "gitGetLocalBranches").mockResolvedValue([
            "main",
            "feat",
          ]);
        },
        'Branch "feat" already exists but has no worktree. Choose another branch name, or delete the branch with `git branch -d feat`.',
      ],
      [
        "C: checked out outside the worktrees directory",
        () => {
          checkout({ path: "/repo", inWorktreesRoot: false });
        },
        'Branch "feat" is already checked out at /repo, outside the worktrees directory. Choose another branch name.',
      ],
      [
        "D: a worktree whose directory is gone",
        () => {
          checkout({ pathExists: false });
        },
        'Branch "feat" has a worktree record at /repo.worktrees/feat, but that directory no longer exists. Run `git worktree prune` to clear it, then re-run.',
      ],
    ];

    describe.each([
      ["interactive", false],
      ["non-interactive", true],
    ])("when %s", (_mode, nonInteractive) => {
      beforeEach(() => {
        setNonInteractive(nonInteractive);
        mockCreate().mockResolvedValue("/path/to/worktree");
        vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
          (key: string) =>
            Promise.resolve(
              key === "has-called-config"
                ? "true"
                : key === "defaultSourceBranch"
                  ? "origin/main"
                  : "",
            ),
        );
      });

      it.each(refusals)("refuses %s", async (_label, arrange, message) => {
        arrange();

        await expect(run()).rejects.toMatchObject({
          name: "InvalidValueError",
          message,
          oclif: { exit: 2 },
          code: "invalid_value",
        });
        expect(mockConfirm).not.toHaveBeenCalled();
        expect(mockOpenWorktreePath).not.toHaveBeenCalled();
        expectNothingDone();
      });
    });

    it("A, non-interactive: refuses and names the path and `worktree open`", async () => {
      setNonInteractive(true);
      checkout();
      mockCreate();

      await expect(run()).rejects.toMatchObject({
        name: "InvalidValueError",
        message:
          'Branch "feat" already has a worktree at /repo.worktrees/feat. Run `worktree open feat` to open it, or choose another branch name.',
        oclif: { exit: 2 },
        code: "invalid_value",
      });
      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockOpenWorktreePath).not.toHaveBeenCalled();
      expectNothingDone();
    });

    it("A, interactive: asks, and reopens the existing worktree when confirmed", async () => {
      checkout();
      mockCreate();
      mockConfirm.mockResolvedValue(true);

      const result = await run();

      expect(mockConfirm).toHaveBeenCalledWith({
        message:
          'Branch "feat" already has a worktree at /repo.worktrees/feat. Open it instead?',
      });
      expect(mockOpenWorktreePath).toHaveBeenCalledWith(
        worktreePath,
        defaultOpenOptions,
      );
      expect(result).toBeUndefined();
      expectNothingDone();
    });

    it("A, interactive: hands the run's own open, agent and brief to the opener", async () => {
      checkout();
      mockCreate();
      mockConfirm.mockResolvedValue(true);

      await run({ "no-open": true, agent: "implement it" });

      expect(mockOpenWorktreePath).toHaveBeenCalledWith(worktreePath, {
        open: false,
        agent: true,
        brief: "implement it",
      });
    });

    it("A, interactive with a brief: says a yes starts a new agent there", async () => {
      checkout();
      mockCreate();
      mockConfirm.mockResolvedValue(true);

      await run({ agent: "implement it" });

      expect(mockConfirm).toHaveBeenCalledWith({
        message:
          'Branch "feat" already has a worktree at /repo.worktrees/feat. Open it and hand the brief to a new agent there? One may already be running in it.',
      });
    });

    it("A, interactive: exits 1 and creates nothing when declined", async () => {
      checkout();
      mockCreate();
      mockConfirm.mockResolvedValue(false);

      await expect(run()).rejects.toMatchObject({
        message:
          'Not opening the existing worktree for "feat"; nothing was created.',
        oclif: { exit: 1 },
      });
      expect(mockOpenWorktreePath).not.toHaveBeenCalled();
      expectNothingDone();
    });

    it("A, with --github: no assignment prompt or save before the check", async () => {
      vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
        number: 42,
        title: "Add dark mode",
        state: "open",
      } as any);
      setNonInteractive(true);
      checkout();
      mockCreate();

      await expect(run({ github: "42" })).rejects.toMatchObject({
        code: "invalid_value",
      });
      expectNothingDone();
    });

    it("A, interactive with --github: checks the edited name, before the assignment question", async () => {
      vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
        number: 42,
        title: "Add dark mode",
        state: "open",
      } as any);
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) =>
          Promise.resolve(
            key === "has-called-config"
              ? "true"
              : key === "defaultSourceBranch"
                ? "origin/main"
                : "",
          ),
      );
      // The derived name would be "42-add-dark-mode"; the person edits it.
      mockInput.mockResolvedValue("feat");
      mockConfirm.mockResolvedValue(true);
      const find = checkout();
      mockCreate();

      await run({ github: "42" });

      expect(find).toHaveBeenCalledWith("feat");
      expect(mockConfirm).toHaveBeenCalledTimes(1);
      expect(mockConfirm).toHaveBeenCalledWith({
        message:
          'Branch "feat" already has a worktree at /repo.worktrees/feat. Open it instead?',
      });
      expect(mockOpenWorktreePath).toHaveBeenCalledWith(
        worktreePath,
        defaultOpenOptions,
      );
      expectNothingDone();
    });

    it("proceeds as before when nothing collides", async () => {
      const create = mockCreate().mockResolvedValue("/path/to/worktree");
      vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
        (key: string) =>
          Promise.resolve(
            key === "has-called-config"
              ? "true"
              : key === "defaultSourceBranch"
                ? "origin/main"
                : "",
          ),
      );

      await run();

      expect(git.gitFindBranchCheckout).toHaveBeenCalledWith("feat");
      expect(create).toHaveBeenCalledWith("feat", "origin/main", {
        fetch: false,
      });
      expect(mockOpenWorktreePath).toHaveBeenCalledWith(
        "/path/to/worktree",
        defaultOpenOptions,
      );
    });
  });
});

// Phase 5 of the project-config plan (#181): D13. Expected values come from the
// plan's Done-when line, the #181 example file (§4) and D9; none is read back
// from the code under test.
describe("branch command — --dry-run", () => {
  const originalExitCode = process.exitCode;
  let output: ReturnType<typeof captureOutput>;
  const mockInput = vi.mocked(input);
  const mockConfirm = vi.mocked(confirm);
  const mockCopyEnvFiles = vi.mocked(copyEnvFilesFromRootPath);
  const mockRunInstall = vi.mocked(runInstall);

  // The example file of §4 for GitHub, plus prefixes.
  const FILE = `branchPrefix:
  feature: feat/
  bugfix: fix/
  chore: chore/
github:
  branchType:
    - when: { Type: Bug }
      type: bugfix
    - when: { Labels: [chore, maintenance] }
      type: chore
`;

  function projectFile(content: string) {
    vi.spyOn(git, "gitReadBlobAtRef").mockResolvedValue({
      status: "found",
      content,
    });
  }

  function githubIssue(overrides: Record<string, unknown> = {}) {
    return vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
      number: 8,
      title: "Fix memory leak",
      state: "open",
      htmlUrl: "https://github.com/acme/demo/issues/8",
      type: null,
      labels: [{ id: 5, name: "Maintenance" }],
      pullRequest: null,
      ...overrides,
    } as any);
  }

  // `run` itself: a dry run prints its own document, so there is no result.
  async function runDry(
    flags: Record<string, unknown>,
    argv: string[] = [],
    args: Record<string, unknown> = {},
  ) {
    const command = new Branch(argv, await loadConfig());
    (command as any).parse = vi
      .fn()
      .mockResolvedValue({ args, flags: { "dry-run": true, ...flags } });
    (command as any).parsed = true;
    const open = vi.spyOn(command as any, "openWorktreePath");
    const result = await command.run();
    return { command, open, result };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    resetProjectConfigCache();
    output = captureOutput();
    vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation((key: string) =>
      // autoAssign is unset, so a real run would ask whether to assign.
      Promise.resolve(key === "has-called-config" ? "true" : ""),
    );
    vi.spyOn(git, "gitFetch").mockResolvedValue("");
    vi.spyOn(git, "gitResolveOriginHead").mockResolvedValue("origin/main");
    vi.spyOn(git, "gitReadBlobAtRef").mockResolvedValue({
      status: "absent-path",
    });
    vi.spyOn(git, "gitGetTopLevelPath").mockResolvedValue("/nonexistent");
    vi.spyOn(git, "gitFindBranchCheckout").mockResolvedValue(undefined);
    vi.spyOn(git, "gitGetLocalBranches").mockResolvedValue([]);
    vi.spyOn(gitConfig, "gitSetConfigValue").mockResolvedValue();
    vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");
    vi.spyOn(githubIntegration, "assignGitHubIssue").mockResolvedValue({
      login: "octocat",
      assigned: true,
    });
    vi.spyOn(jiraIntegration, "assignJiraIssue").mockResolvedValue({
      outcome: "assigned",
      displayName: "Ada Lovelace",
    });
  });

  afterEach(() => {
    output.restore();
    process.exitCode = originalExitCode;
  });

  it("needs an issue to look at", async () => {
    const dry = runDry({}, [], { branchName: "my/own-name" });

    await expect(dry).rejects.toThrow(
      "--dry-run requires one of --github, --jira, --linear or --clickup.",
    );
    expect(git.gitCreateWorktree).not.toHaveBeenCalled();
  });

  it("creates, assigns, saves and asks nothing", async () => {
    projectFile(FILE);
    githubIssue({ state: "closed", stateReason: "completed" });

    const { open, result } = await runDry({ github: "8" });

    expect(result).toBeUndefined();
    expect(git.gitCreateWorktree).not.toHaveBeenCalled();
    expect(githubIntegration.assignGitHubIssue).not.toHaveBeenCalled();
    expect(gitConfig.gitSetConfigValue).not.toHaveBeenCalled();
    expect(mockInput).not.toHaveBeenCalled();
    // A closed issue is a prompt in a real run; a dry run only says so.
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(mockRunInstall).not.toHaveBeenCalled();
    expect(mockCopyEnvFiles).not.toHaveBeenCalled();
    expect(output.stderr()).toContain("Issue #8 is closed as completed.");
  });

  it("copies nothing even when the file lists copy patterns", async () => {
    projectFile(`${FILE}copy:\n  - config/master.key\n`);
    githubIssue();

    await runDry({ github: "8" });

    expect(mockCopyEnvFiles).not.toHaveBeenCalled();
    expect(git.gitCreateWorktree).not.toHaveBeenCalled();
  });

  it("assigns no Jira issue and asks Jira for names", async () => {
    const naming = vi
      .spyOn(jiraIntegration, "getJiraBranchNaming")
      .mockResolvedValue({
        branchName: "DEV-7-fix-login-bug",
        kind: undefined,
        fields: [],
        match: { source: "none" },
      });

    await runDry({ jira: "dev-7" });

    expect(naming).toHaveBeenCalledWith(
      "dev-7",
      expect.objectContaining({ dryRun: true }),
    );
    expect(jiraIntegration.assignJiraIssue).not.toHaveBeenCalled();
    expect(git.gitCreateWorktree).not.toHaveBeenCalled();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("asks Linear for label ids, and ClickUp lists tags by name", async () => {
    vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation((key: string) =>
      Promise.resolve(
        key === "linear.apiKey"
          ? "lin_api_test"
          : key === "clickup.apiToken"
            ? "pk_test"
            : "",
      ),
    );
    const linear = vi
      .spyOn(linearIntegration, "fetchLinearIssue")
      .mockResolvedValue({
        identifier: "ENG-1",
        title: "Add dark mode",
        url: null,
        labels: ["Urgent"],
        labelNodes: [{ id: "l1", name: "Urgent" }],
      });
    vi.spyOn(clickupIntegration, "fetchClickUpTask").mockResolvedValue({
      id: "9hx",
      customId: null,
      name: "Fix login",
      url: null,
      tags: ["Hotfix"],
    });

    await runDry({ linear: "eng-1" });
    expect(linear).toHaveBeenCalledWith("eng-1", { labelIds: true });
    expect(output.stdout()).toContain('- when: { Labels: { id: "l1" } }');

    await runDry({ clickup: "9hx" });
    expect(output.stdout()).toContain(
      "- when: { Tags: Hotfix }   # Tags = Hotfix",
    );
  });

  it("ignores the agent flags, since it starts no agent", async () => {
    // No agent.command is configured, which a real run with a brief refuses.
    vi.spyOn(gitConfig, "gitGetConfigValue").mockResolvedValue("");
    githubIssue();

    await expect(
      runDry({ github: "8", agent: "do the work" }),
    ).resolves.toMatchObject({ result: undefined });
    expect(git.gitCreateWorktree).not.toHaveBeenCalled();
  });

  describe("the human output", () => {
    it("names the branch, the matching rule and each non-empty field with ids", async () => {
      projectFile(FILE);
      githubIssue();

      await runDry({ github: "8" });

      const text = output.stdout();
      expect(text).toContain("Branch name: chore/8-fix-memory-leak");
      expect(text).toContain(
        "Rule: rule 2 of github.branchType: when: { Labels: [chore, maintenance] }, type: chore",
      );
      // Labels has a value; Type is empty on this issue and is not listed.
      expect(text).toContain("Labels (id Labels)");
      expect(text).toContain("Maintenance (id 5)");
      expect(text).not.toContain("Type (id Type)");
    });

    // D7: the text names the list that decided; the plan's `rule N of branchType`.
    it("names the shared list when it decided", async () => {
      projectFile(`branchPrefix:
  chore: chore/
branchType:
  - when: { Type: Bug }
    type: bugfix
  - when: { Labels: [chore, maintenance] }
    type: chore
`);
      githubIssue();

      await runDry({ github: "8" });

      expect(output.stdout()).toContain(
        "Rule: rule 2 of branchType: when: { Labels: [chore, maintenance] }, type: chore",
      );
      expect(output.stdout()).toContain(
        "each with a line to paste into branchType:",
      );
    });

    it("says none matched in the shared list when nothing did", async () => {
      projectFile("branchType:\n  - when: { Type: Bug }\n    type: bugfix\n");
      githubIssue();

      await runDry({ github: "8" });

      expect(output.stdout()).toContain(
        "Rule: none matched in branchType, so the name has no prefix",
      );
    });

    it("prints a paste-ready line per value in the form of the plan", async () => {
      githubIssue({ type: { id: 9, name: "Bug" } });

      await runDry({ github: "8" });

      expect(output.stdout()).toContain(
        '- when: { Labels: { id: "5" } }   # Labels = Maintenance',
      );
      expect(output.stdout()).toContain(
        '- when: { Type: { id: "9" } }   # Type = Bug',
      );
    });

    it("writes the Jira select option line exactly as #181 does", async () => {
      vi.spyOn(jiraIntegration, "getJiraBranchNaming").mockResolvedValue({
        branchName: "chore/DEV-7-fix-login-bug",
        kind: "chore",
        fields: [
          {
            id: "customfield_10359",
            name: "Work Category",
            values: [{ id: "10301", name: "Maintenance" }],
          },
          { id: "labels", name: "Labels", values: [] },
        ],
        match: {
          source: "rule",
          position: 1,
          rule: { when: { customfield_10359: { id: "10301" } }, type: "chore" },
        },
      });

      await runDry({ jira: "dev-7" });

      expect(output.stdout()).toContain(
        '- when: { customfield_10359: { id: "10301" } }   # Work Category = Maintenance',
      );
      expect(output.stdout()).toContain("Work Category (id customfield_10359)");
      expect(output.stdout()).not.toContain("Labels (id labels)");
    });

    it("says built-in when the file has no rules for the provider", async () => {
      githubIssue({ type: { id: 9, name: "Bug" } });

      await runDry({ github: "8" });

      expect(output.stdout()).toContain("Rule: built-in");
      expect(output.stdout()).toContain("Branch name: 8-fix-memory-leak");
    });

    // Finding 1: the built-in mapping needs both lists absent, so the line says so.
    it("words the built-in line with both lists a file lacks", async () => {
      projectFile("branchPrefix:\n  feature: feat/\n");
      githubIssue({ type: { id: 9, name: "Bug" } });

      await runDry({ github: "8" });

      expect(output.stdout()).toContain(
        "Rule: built-in mapping (the project file has no github.branchType or shared branchType)",
      );
    });

    // Finding 2: a dry run is where rules are checked, so it passes the flag on.
    it("warns about a shared rule naming an absent field, because it is a dry run", async () => {
      projectFile("branchType:\n  - when: { Lables: bug }\n    type: bugfix\n");
      githubIssue();

      const { command } = await runDry({ github: "8" });

      expect((command as any).warnings).toEqual([
        expect.stringContaining("Rule 1 of branchType names"),
      ]);
    });

    // An id belongs to one provider, so the shared list gets the name.
    it("offers by-name lines for Type and Labels when the shared list decided", async () => {
      projectFile("branchType:\n  - when: { Type: Bug }\n    type: bugfix\n");
      githubIssue({ type: { id: 9, name: "Bug" } });

      await runDry({ github: "8" });

      expect(output.stdout()).toContain(
        "each with a line to paste into branchType:",
      );
      expect(output.stdout()).toContain("- when: { Type: Bug }   # Type = Bug");
      expect(output.stdout()).toContain(
        "- when: { Labels: Maintenance }   # Labels = Maintenance",
      );
      expect(output.stdout()).not.toContain("{ id:");
    });

    // A Jira-only field pasted into the shared list never matches elsewhere, and
    // on a real run it does not warn, so the output says where it belongs.
    it("points a provider-only field at the provider's own list when the shared list decided", async () => {
      projectFile("branchType:\n  - when: { Type: Bug }\n    type: bugfix\n");
      vi.spyOn(jiraIntegration, "getJiraBranchNaming").mockResolvedValue({
        branchName: "chore/DEV-7-fix-login-bug",
        kind: "chore",
        fields: [
          {
            id: "customfield_10359",
            name: "Work Category",
            values: [{ id: "10301", name: "Maintenance" }],
          },
          // As an English Jira emits it: this id, no id on the values, no alias.
          { id: "labels", name: "Labels", values: [{ name: "chore" }] },
        ],
        match: { source: "none" },
      });

      await runDry({ jira: "dev-7" });

      const text = output.stdout();
      expect(text).toContain("except where a field says otherwise:");
      expect(text).toContain(
        "Work Category (id customfield_10359) - only jira has this field: paste into jira.branchType, not branchType",
      );
      // `labels` finds every other provider's Labels by name, so it stays shared.
      expect(text).toContain("  Labels (id labels)\n");
    });

    it("names each field's list in the --json when the shared list decided", async () => {
      projectFile("branchType:\n  - when: { Type: Bug }\n    type: bugfix\n");
      vi.spyOn(jiraIntegration, "getJiraBranchNaming").mockResolvedValue({
        branchName: "DEV-7-fix-login-bug",
        kind: undefined,
        fields: [
          {
            id: "customfield_10359",
            name: "Work Category",
            values: [{ id: "10301", name: "Maintenance" }],
          },
          { id: "labels", name: "Labels", values: [{ name: "chore" }] },
        ],
        match: { source: "none" },
      });

      await runDry({ jira: "dev-7" }, ["--json"]);

      const doc = output.document() as any;
      expect(doc.fields.map((f: any) => f.pasteInto)).toEqual([
        "jira.branchType",
        "branchType",
      ]);
    });

    it("says nothing about another list when the provider's own decided", async () => {
      projectFile(
        'jira:\n  branchType:\n    - when: { customfield_10359: { id: "10301" } }\n      type: chore\n',
      );
      vi.spyOn(jiraIntegration, "getJiraBranchNaming").mockResolvedValue({
        branchName: "chore/DEV-7-fix-login-bug",
        kind: "chore",
        fields: [
          {
            id: "customfield_10359",
            name: "Work Category",
            values: [{ id: "10301", name: "Maintenance" }],
          },
        ],
        match: { source: "none" },
      });

      await runDry({ jira: "dev-7" });

      const text = output.stdout();
      expect(text).toContain("each with a line to paste into jira.branchType:");
      expect(text).toContain("  Work Category (id customfield_10359)\n");
    });

    it("keeps the id lines when the provider's own list decided", async () => {
      projectFile(FILE);
      githubIssue({ type: { id: 9, name: "Bug" } });

      await runDry({ github: "8" });

      expect(output.stdout()).toContain(
        '- when: { Type: { id: "9" } }   # Type = Bug',
      );
      expect(output.stdout()).toContain(
        '- when: { Labels: { id: "5" } }   # Labels = Maintenance',
      );
    });

    it("gives the --json the same by-name line under the shared list", async () => {
      projectFile("branchType:\n  - when: { Type: Bug }\n    type: bugfix\n");
      githubIssue({ type: { id: 9, name: "Bug" } });

      await runDry({ github: "8" }, ["--json"]);

      const doc = output.document() as any;
      expect(doc.fields.map((f: any) => f.values[0].when)).toEqual([
        "- when: { Type: Bug }   # Type = Bug",
        "- when: { Labels: Maintenance }   # Labels = Maintenance",
      ]);
      expect(doc.fields[0].values[0].id).toBe("9");
    });

    it("says no rule matched when rules exist and none did", async () => {
      projectFile(FILE);
      githubIssue({ labels: [] });

      await runDry({ github: "8" });

      expect(output.stdout()).toContain("Rule: none matched");
    });

    it("does not depend on colour to say any of it", async () => {
      projectFile(FILE);
      githubIssue();

      await runDry({ github: "8" });

      // biome-ignore lint/suspicious/noControlCharactersInRegex: looking for ANSI escapes
      expect(output.stdout()).not.toMatch(/\u001b\[/);
    });
  });

  describe("with --json", () => {
    it("prints exactly one document, its own and not the branch document", async () => {
      projectFile(FILE);
      githubIssue();

      await runDry({ github: "8" }, ["--json"]);

      expect(output.stdout().trim().split("\n")).toHaveLength(1);
      expect(output.document()).toEqual({
        dryRun: true,
        branch: "chore/8-fix-memory-leak",
        issue: {
          provider: "github",
          number: 8,
          url: "https://github.com/acme/demo/issues/8",
        },
        kind: "chore",
        match: {
          source: "rule",
          position: 2,
          rule: "when: { Labels: [chore, maintenance] }, type: chore",
        },
        fields: [
          {
            id: "Labels",
            name: "Labels",
            pasteInto: "github.branchType",
            values: [
              {
                id: "5",
                name: "Maintenance",
                when: '- when: { Labels: { id: "5" } }   # Labels = Maintenance',
              },
            ],
          },
        ],
        warnings: [],
      });
    });

    it("reports a rule warning in warnings", async () => {
      projectFile(`${FILE.split("github:")[0]}github:
  branchType:
    - when: { Priority: High }
      type: bugfix
`);
      githubIssue();

      await runDry({ github: "8" }, ["--json"]);

      expect(output.document().warnings).toEqual([
        expect.stringContaining('names the field "Priority"'),
      ]);
    });
  });
});

describe("branch command — --help", () => {
  it("documents the --json shape and the exit codes", () => {
    const help = Branch.description ?? "";

    for (const key of [
      "envFilesCopied",
      "installed",
      "prompted",
      "herdr",
      "issue",
      "assigned",
      "started",
      "--start",
    ]) {
      expect(help).toContain(key);
    }
    expect(help).toContain("0 success");
    expect(help).toContain("1 failure");
    expect(help).toContain("2 usage");
    expect(help).toContain('{provider:"linear", key, url|null}');
    expect(help).toContain('{provider:"clickup", key');
  });

  it("documents --dry-run in the flags, the description and its own --json document", () => {
    expect(Branch.flags["dry-run"]).toBeDefined();
    const help = Branch.description ?? "";
    expect(help).toContain("--dry-run");
    expect(help).toContain("paste-ready");
    expect(help).toContain('{source:"rule", position, rule}');
  });

  // D1: `--clickup` is `-c`.
  it("gives --clickup the short flag -c", () => {
    expect(Branch.flags.clickup.char).toBe("c");
  });

  // D1: `--linear` is `-l`, beside `-g` and `-j`.
  it("gives --linear the short flag -l", () => {
    expect(Branch.flags.linear.char).toBe("l");
  });
});

// Phase 7 of the project-config plan (#181): D16, D13. Expected values come
// from the plan's Done-when line and D16's wording; the hash is the one
// `shasum -a 256` gives for the example file's steps (see project-config.test).
describe("branch command — approval of the project's postCreate steps", () => {
  const HASH =
    "085b75c700b8be5a24f7d7c0fe76efa00d5cad067c3895aed7dddf53a79f56de";
  const FILE = "postCreate:\n  - pnpm install\n  - pnpm prisma generate\n";
  const KEY = "northguild.worktree.postCreateApproval";
  let personal: string;
  let stored: string;
  const mockConfirm = vi.mocked(confirm);
  const mockRunInstall = vi.mocked(runInstall);
  const originalExitCode = process.exitCode;

  async function run(flags: Record<string, unknown> = {}) {
    const command = new Branch([], await loadConfig());
    (command as any).parse = vi.fn().mockResolvedValue({
      args: { branchName: "feature/test" },
      flags,
    });
    (command as any).parsed = true;
    vi.spyOn(command as any, "openWorktreePath").mockResolvedValue({
      opener: "editor",
    });
    return command.run();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    personal = "";
    stored = "";
    expectCommands(
      `git config --local ${KEY}`,
      `git config --local ${KEY} ${HASH}`,
    );
    mockRun.mockImplementation(async (_file: string, args: string[]) => {
      if (args.length === 3) {
        if (stored) return stored;
        throw new Error("exit 1");
      }
      stored = args[args.length - 1] ?? "";
      return "";
    });
    mockRunInstall.mockResolvedValue({ ran: false, reason: "skipped" });
    resetProjectConfigCache();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
      async (key: string) => {
        if (key === "has-called-config") return "true";
        if (key === "defaultSourceBranch") return "origin/main";
        if (key === "postCreate") return personal;
        return "";
      },
    );
    vi.spyOn(git, "gitFetch").mockResolvedValue("");
    vi.spyOn(git, "gitResolveOriginHead").mockResolvedValue("origin/main");
    vi.spyOn(git, "gitReadBlobAtRef").mockResolvedValue({
      status: "found",
      content: FILE,
    });
    vi.spyOn(git, "gitHasOriginRemote").mockResolvedValue(true);
    vi.spyOn(git, "gitGetTopLevelPath").mockResolvedValue("/nonexistent");
    vi.spyOn(git, "gitFindBranchCheckout").mockResolvedValue(undefined);
    vi.spyOn(git, "gitGetLocalBranches").mockResolvedValue([]);
    vi.spyOn(gitConfig, "gitSetConfigValue").mockResolvedValue();
    vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
    setNonInteractive(false);
  });

  it("fails closed non-interactively: exit 2, nothing created, both ways out named, no hash", async () => {
    setNonInteractive(true);

    const error = await run().then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(MissingValueError);
    const text = JSON.stringify({
      message: (error as Error).message,
      value: (error as MissingValueError).value,
      flag: (error as MissingValueError).flag,
    });
    expect(text).toContain("worktree config --approve");
    expect(text).toContain("--no-install");
    expect(text).not.toMatch(/[0-9a-f]{64}/);
    expect((error as any).oclif.exit).toBe(2);
    expect(git.gitCreateWorktree).not.toHaveBeenCalled();
    expect(mockRunInstall).not.toHaveBeenCalled();
    expect(stored).toBe("");
  });

  it("asks interactively, stores the hash on yes and installs", async () => {
    mockConfirm.mockResolvedValue(true);

    await run();

    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(stored).toBe(HASH);
    expect(git.gitCreateWorktree).toHaveBeenCalled();
    expect(mockRunInstall).toHaveBeenCalled();
  });

  it("exits 1 with nothing created when the answer is no", async () => {
    mockConfirm.mockResolvedValue(false);

    const error = await run().then(
      () => undefined,
      (e: unknown) => e,
    );

    expect((error as any).oclif.exit).toBe(1);
    expect(git.gitCreateWorktree).not.toHaveBeenCalled();
    expect(mockRunInstall).not.toHaveBeenCalled();
    expect(stored).toBe("");
  });

  it("does not ask again once approved", async () => {
    stored = HASH;
    setNonInteractive(true);

    await run();

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(git.gitCreateWorktree).toHaveBeenCalled();
  });

  it("a taken name gets the reopen guidance, not an approval it would not use", async () => {
    setNonInteractive(true);
    vi.spyOn(git, "gitFindBranchCheckout").mockResolvedValue({
      path: "/repo.worktrees/feature/test",
      pathExists: true,
      inWorktreesRoot: true,
    });

    const error = await run().then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(error).not.toBeInstanceOf(MissingValueError);
    expect((error as Error).message).toContain("worktree open feature/test");
    expect((error as any).oclif.exit).toBe(2);
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(stored).toBe("");
  });

  it("--no-install needs no approval", async () => {
    setNonInteractive(true);

    await run({ install: false });

    expect(git.gitCreateWorktree).toHaveBeenCalled();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("a personal postCreate runs without approval", async () => {
    personal = "make setup";
    setNonInteractive(true);

    await run();

    expect(git.gitCreateWorktree).toHaveBeenCalled();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("--dry-run runs no approval and no prompt, even non-interactively", async () => {
    setNonInteractive(true);
    vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
      number: 8,
      title: "Fix it",
      state: "open",
      htmlUrl: "https://github.com/acme/demo/issues/8",
      type: null,
      labels: [],
      pullRequest: null,
    } as any);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await run({ "dry-run": true, github: "8" });

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(git.gitCreateWorktree).not.toHaveBeenCalled();
    expect(stored).toBe("");
  });

  it("documents the installed fields in --help", () => {
    const help = Branch.description ?? "";
    expect(help).toContain("steps");
    expect(help).toContain('"git-config", "project" or "lockfile"');
  });
});

// Phase 8 of the project-config plan (#181): D21. Expected values come from the
// plan's Done-when line and §4 ("the nudge runs only interactively, after the
// worktree is opened"); the offer's own rules are pinned in project-config.test.
describe("branch command — the offers of D21", () => {
  const mockConfirm = vi.mocked(confirm);
  const OFFER_KEY = "northguild.worktree.projectFileOffer";
  let open: ReturnType<typeof vi.spyOn>;

  async function run(flags: Record<string, unknown> = {}) {
    const command = new Branch([], await loadConfig());
    (command as any).parse = vi.fn().mockResolvedValue({
      args: { branchName: "feature/test" },
      flags,
    });
    (command as any).parsed = true;
    open = vi
      .spyOn(command as any, "openWorktreePath")
      .mockResolvedValue({ opener: "editor" });
    return { command, result: await command.run() };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    resetProjectConfigCache();
    // The earlier suites stub the offers out; these cases need the real ones.
    vi.mocked(projectConfig.offerProjectConfig).mockRestore?.();
    setNonInteractive(false);
    mockRun.mockResolvedValue("");
    mockConfirm.mockReset();
    mockConfirm.mockResolvedValue(false);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    // A team key in git config and no .worktree.yml on origin/HEAD: the
    // repository the nudge is for.
    vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
      async (key: string) => {
        if (key === "has-called-config") return "true";
        if (key === "defaultSourceBranch") return "origin/main";
        return "";
      },
    );
    vi.spyOn(git, "gitFetch").mockResolvedValue("");
    vi.spyOn(git, "gitResolveOriginHead").mockResolvedValue("origin/main");
    vi.spyOn(git, "gitReadBlobAtRef").mockResolvedValue({
      status: "absent-path",
    });
    vi.spyOn(git, "gitHasOriginRemote").mockResolvedValue(true);
    vi.spyOn(git, "gitGetTopLevelPath").mockResolvedValue("/nonexistent");
    vi.spyOn(git, "gitFindBranchCheckout").mockResolvedValue(undefined);
    vi.spyOn(git, "gitGetLocalBranches").mockResolvedValue([]);
    vi.spyOn(gitConfig, "gitSetConfigValue").mockResolvedValue();
    vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");
  });

  afterEach(() => {
    setNonInteractive(false);
  });

  const offered = () =>
    mockConfirm.mock.calls.filter(([prompt]) =>
      (prompt as { message: string }).message.includes("--project"),
    );

  it("offers --project only after the worktree is opened", async () => {
    await run();

    expect(offered()).toHaveLength(1);
    const openedAt = open.mock.invocationCallOrder[0] ?? Infinity;
    const askedAt = mockConfirm.mock.invocationCallOrder[0] ?? 0;
    expect(askedAt).toBeGreaterThan(openedAt);
    expect(mockRun).toHaveBeenCalledWith("git", [
      "config",
      "--local",
      OFFER_KEY,
      "declined",
    ]);
  });

  it("offers nothing when the run is non-interactive (--json, --yes, CI, no TTY)", async () => {
    setNonInteractive(true);

    await run();

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalledWith(
      "git",
      expect.arrayContaining([OFFER_KEY]),
    );
  });

  it("offers nothing on a dry run", async () => {
    vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
      number: 8,
      title: "Fix memory leak",
      state: "open",
      htmlUrl: "https://github.com/acme/demo/issues/8",
      type: null,
      labels: [],
      pullRequest: null,
    } as any);

    await run({ github: "8", "dry-run": true });

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalledWith(
      "git",
      expect.arrayContaining([OFFER_KEY]),
    );
  });

  it("does not offer before the worktree exists: a failed creation asks nothing", async () => {
    vi.spyOn(git, "gitCreateWorktree").mockRejectedValue(new Error("no"));

    await expect(run()).rejects.toThrow("no");

    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it("warns and still returns the document when an offer fails", async () => {
    mockConfirm.mockRejectedValue(new Error("prompt closed"));

    const { command, result } = await run();

    expect(result?.path).toBe("/path/to/worktree");
    expect(result?.warnings.join(" ")).toContain("prompt closed");
    expect(command).toBeDefined();
  });
});

// #113: `--linear` with no identifier picks one of the viewer's own issues.
// Expected values come from the plan: the refusal text and exit code from D7
// (the format in prompt.ts and the exit-code list in branch's description), the
// empty-list text from D8, the choice text from D6, the escapes from
// showVisibly's documented behaviour, and every spelling's parse from oclif's
// own parser (probed against parse.js, not read off the rewrite).
describe("branch command — --linear with no identifier", () => {
  const originalExitCode = process.exitCode;
  const originalCi = process.env.CI;
  const stdinIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  const mockInput = vi.mocked(input);
  const mockSelect = vi.mocked(select);
  const mockOra = vi.mocked(ora);
  let output: ReturnType<typeof captureOutput>;

  const ASSIGNED = {
    issues: [
      {
        identifier: "ENG-7",
        title: "Add dark mode",
        state: { name: "In Progress", type: "started" },
      },
      {
        identifier: "ENG-9",
        title: "Fix login",
        state: { name: "Todo", type: "unstarted" },
      },
    ],
    hasMore: false,
  };
  const REFUSAL = "no default for the Linear issue; pass --linear <identifier>";

  function terminal(isTTY: boolean) {
    Object.defineProperty(process.stdin, "isTTY", {
      value: isTTY,
      configurable: true,
    });
  }

  async function runPick(argv: string[]) {
    const command = new Branch(argv, await loadConfig());
    vi.spyOn(command as any, "openWorktreePath").mockResolvedValue({
      opener: "none",
    });
    return (command as any)._run();
  }

  let list: ReturnType<typeof vi.spyOn>;
  let fetchIssue: ReturnType<typeof vi.spyOn>;
  let startIssue: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    terminal(true);
    delete process.env.CI;
    resetProjectConfigCache();
    output = captureOutput();
    vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation(
      (key: string) => {
        if (key === "has-called-config") return Promise.resolve("true");
        if (key === "defaultSourceBranch")
          return Promise.resolve("origin/main");
        if (key === "linear.apiKey") return Promise.resolve("lin_api_test");
        return Promise.resolve("");
      },
    );
    vi.spyOn(projectConfig, "offerProjectConfig").mockResolvedValue();
    vi.spyOn(git, "gitFetch").mockResolvedValue("");
    vi.spyOn(git, "gitResolveOriginHead").mockResolvedValue("origin/main");
    vi.spyOn(git, "gitReadBlobAtRef").mockResolvedValue({
      status: "absent-path",
    });
    vi.spyOn(git, "gitGetTopLevelPath").mockResolvedValue("/nonexistent");
    vi.spyOn(git, "gitFindBranchCheckout").mockResolvedValue(undefined);
    vi.spyOn(git, "gitGetLocalBranches").mockResolvedValue([]);
    vi.spyOn(gitConfig, "gitSetConfigValue").mockResolvedValue();
    vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");
    mockInput.mockImplementation(async (config: any) => config.default);
    mockRunInstallSkipped();
    list = vi
      .spyOn(linearIntegration, "listAssignedLinearIssues")
      .mockResolvedValue(ASSIGNED);
    // The picked identifier comes back as the issue, so what reaches the fetch
    // is what the document reports.
    fetchIssue = vi
      .spyOn(linearIntegration, "fetchLinearIssue")
      .mockImplementation(async (id: string) => ({
        identifier: id.trim().toUpperCase(),
        title: "Add dark mode",
        url: null,
        labels: [],
      }));
    startIssue = vi
      .spyOn(linearIntegration, "startLinearIssue")
      .mockResolvedValue({
        outcome: "started",
        from: "Todo",
        to: "In Progress",
      });
    mockSelect.mockResolvedValue("ENG-7");
    // `linear.autoStart` is unset, so a terminal is asked once whether to start.
    vi.mocked(confirm).mockResolvedValue(true);
  });

  function mockRunInstallSkipped() {
    vi.mocked(runInstall).mockResolvedValue({ ran: false, reason: "skipped" });
  }

  afterEach(() => {
    output.restore();
    process.exitCode = originalExitCode;
    if (stdinIsTTY) {
      Object.defineProperty(process.stdin, "isTTY", stdinIsTTY);
    } else {
      Reflect.deleteProperty(process.stdin, "isTTY");
    }
    if (originalCi === undefined) {
      delete process.env.CI;
    } else {
      process.env.CI = originalCi;
    }
    setNonInteractive(undefined);
  });

  describe("the spellings", () => {
    it.each([
      [["--linear"], true],
      [["-l"], true],
      [["--linear", "--no-start"], false],
      [["-l", "--no-start"], false],
      [["--no-start", "--linear"], false],
      [["--linear", "--no-open"], true],
      [["--linear", "--"], true],
    ])("%j offers the issues and carries the pick through", async (argv, starts) => {
      const document = await runPick(argv);

      expect(list).toHaveBeenCalledTimes(1);
      expect(mockSelect).toHaveBeenCalledTimes(1);
      // The pick reaches the fetch, the start and the document as if typed.
      expect(fetchIssue).toHaveBeenCalledTimes(1);
      expect(fetchIssue).toHaveBeenCalledWith("ENG-7");
      if (starts) {
        expect(startIssue).toHaveBeenCalledWith("ENG-7");
      } else {
        expect(startIssue).not.toHaveBeenCalled();
      }
      expect(document?.issue).toEqual({
        provider: "linear",
        key: "ENG-7",
        url: null,
      });
      expect(document?.started).toBe(starts ? true : null);
      expect(git.gitCreateWorktree).toHaveBeenCalledTimes(1);
    });

    it.each([
      [["--linear", "ENG-1"], "ENG-1"],
      [["-l", "eng-1"], "eng-1"],
      [["--linear=ENG-1"], "ENG-1"],
      [["-l=eng-1"], "eng-1"],
      [["-leng-1"], "eng-1"],
      [["--no-start", "-l", "ENG-1"], "ENG-1"],
    ])("%j names an issue, so there is no pick and no request", async (argv, typed) => {
      const document = await runPick(argv);

      expect(list).not.toHaveBeenCalled();
      expect(mockSelect).not.toHaveBeenCalled();
      expect(fetchIssue).toHaveBeenCalledWith(typed);
      expect(document?.issue).toMatchObject({ key: "ENG-1" });
    });

    it("leaves a --linear after -- alone: it is an argument, not the flag", async () => {
      await runPick(["--", "--linear"]);

      expect(list).not.toHaveBeenCalled();
      expect(mockSelect).not.toHaveBeenCalled();
      expect(fetchIssue).not.toHaveBeenCalled();
    });

    it("reads --linear -x as a bare flag, so -x is left for oclif to report as unknown", async () => {
      await runPick(["--linear", "-x"]);

      expect(mockSelect).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(2);
      expect(output.stderr()).toContain("Nonexistent flag: -x");
    });

    it.each([
      [["--agent", "--linear"], "--agent"],
      [["-a", "-l"], "--agent"],
      [["--source", "--linear"], "--source"],
      [["--github", "-l"], "--github"],
    ])("%j after a value-taking flag is that flag's missing value, as today", async (argv, flag) => {
      await runPick(argv);

      expect(list).not.toHaveBeenCalled();
      expect(mockSelect).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(2);
      expect(output.stderr()).toContain(`Flag ${flag} expects a value`);
    });

    it("still reports a cluster that is not boolean flags then -l as oclif does", async () => {
      await runPick(["-nl"]);

      expect(mockSelect).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(2);
      expect(output.stderr()).toContain("Nonexistent flag: -nl");
    });
  });

  describe("the menu", () => {
    it("lists identifier, title and state in words, and returns the identifier", async () => {
      await runPick(["--linear"]);

      expect(mockSelect).toHaveBeenCalledWith({
        message: "Pick one of your unstarted and started Linear issues.",
        choices: [
          { name: "ENG-7  Add dark mode  (In Progress)", value: "ENG-7" },
          { name: "ENG-9  Fix login  (Todo)", value: "ENG-9" },
        ],
      });
    });

    it("carries a different pick, not the first one", async () => {
      mockSelect.mockResolvedValue("ENG-9");

      const document = await runPick(["--linear"]);

      expect(fetchIssue).toHaveBeenCalledWith("ENG-9");
      expect(document?.issue).toMatchObject({ key: "ENG-9" });
    });

    it("shows a title and a state name with their control and formatting characters escaped", async () => {
      list.mockResolvedValue({
        issues: [
          {
            identifier: "ENG-7",
            title: "Fix \u001b[2J\u202egnp",
            state: { name: "Done\u0007", type: "started" },
          },
        ],
        hasMore: false,
      });

      await runPick(["--linear"]);

      const config = mockSelect.mock.calls[0]?.[0] as any;
      expect(config.choices[0].name).toBe(
        "ENG-7  Fix \\x1b[2J\\u{202e}gnp  (Done\\x07)",
      );
      expect(config.choices[0].value).toBe("ENG-7");
    });

    it("says in words that more exist and names the way out, only when they do", async () => {
      await runPick(["--linear"]);
      expect((mockSelect.mock.calls[0]?.[0] as any).message).not.toContain(
        "worktree branch --linear <identifier>",
      );

      list.mockResolvedValue({ ...ASSIGNED, hasMore: true });
      await runPick(["--linear"]);

      expect((mockSelect.mock.calls[1]?.[0] as any).message).toBe(
        "Pick one of your unstarted and started Linear issues. More match than the 2 listed; if yours is not here, quit and pass its identifier: worktree branch --linear <identifier>.",
      );
    });

    it("stops the spinner before the menu opens", async () => {
      await runPick(["--linear"]);

      const index = mockOra.mock.calls.findIndex(
        ([text]) => text === "Fetching your Linear issues",
      );
      expect(index).toBeGreaterThanOrEqual(0);
      const spinner = mockOra.mock.results[index]?.value;
      expect(spinner.start).toHaveBeenCalledTimes(1);
      expect(spinner.stop).toHaveBeenCalledTimes(1);
      expect(spinner.stop.mock.invocationCallOrder[0]).toBeLessThan(
        mockSelect.mock.invocationCallOrder[0] ?? 0,
      );
    });

    it("never shows the stand-in value", async () => {
      await runPick(["--linear"]);

      expect(JSON.stringify(mockOra.mock.calls)).not.toContain("pick-a-linear");
      expect(JSON.stringify(mockSelect.mock.calls)).not.toContain(
        "pick-a-linear",
      );
      expect(`${output.stdout()}${output.stderr()}`).not.toContain(
        "pick-a-linear",
      );
    });
  });

  describe("the ways it ends without a worktree", () => {
    it("exits 1 with D8's text when no issue is assigned, and asks nothing", async () => {
      list.mockResolvedValue({ issues: [], hasMore: false });

      await runPick(["--linear"]);

      expect(process.exitCode).toBe(1);
      expect(output.stderr()).toContain(
        "Error: Linear: no unstarted or started issues are assigned to you. Pass an identifier: worktree branch --linear <identifier>.",
      );
      expect(mockSelect).not.toHaveBeenCalled();
      expect(git.gitCreateWorktree).not.toHaveBeenCalled();
    });

    it("reports a failed lookup, fails the spinner and creates nothing", async () => {
      list.mockRejectedValue(
        new Error("Linear: Failed to fetch your issues. 500 Server Error"),
      );

      await runPick(["--linear"]);

      expect(process.exitCode).toBe(1);
      expect(output.stderr()).toContain(
        "Linear: Failed to fetch your issues. 500 Server Error",
      );
      const index = mockOra.mock.calls.findIndex(
        ([text]) => text === "Fetching your Linear issues",
      );
      expect(mockOra.mock.results[index]?.value.fail).toHaveBeenCalled();
      expect(mockSelect).not.toHaveBeenCalled();
      expect(git.gitCreateWorktree).not.toHaveBeenCalled();
    });

    it("ends silently with exit 0 and creates nothing on Ctrl-C at the menu", async () => {
      const cancelled = new Error("User force closed the prompt with SIGINT");
      cancelled.name = "ExitPromptError";
      mockSelect.mockRejectedValue(cancelled);

      await runPick(["--linear"]);

      expect(process.exitCode).toBeUndefined();
      expect(output.stderr()).toBe("");
      expect(output.stdout()).toBe("");
      expect(fetchIssue).not.toHaveBeenCalled();
      expect(startIssue).not.toHaveBeenCalled();
      expect(git.gitCreateWorktree).not.toHaveBeenCalled();
    });
  });

  describe("a run that cannot ask", () => {
    function expectRefusedBeforeAnyWork() {
      expect(process.exitCode).toBe(2);
      expect(list).not.toHaveBeenCalled();
      expect(mockSelect).not.toHaveBeenCalled();
      expect(fetchIssue).not.toHaveBeenCalled();
      expect(startIssue).not.toHaveBeenCalled();
      expect(git.gitFetch).not.toHaveBeenCalled();
      expect(git.gitCreateWorktree).not.toHaveBeenCalled();
      expect(`${output.stdout()}${output.stderr()}`).not.toContain(
        "pick-a-linear",
      );
    }

    it.each([
      [["--linear", "--yes"]],
      [["-yl"]],
      [["--linear", "--non-interactive"]],
    ])("%j exits 2 with the missing-value line", async (argv) => {
      await runPick(argv);

      expect(output.stderr()).toContain(`worktree: ${REFUSAL}`);
      expectRefusedBeforeAnyWork();
    });

    it("exits 2 under CI", async () => {
      process.env.CI = "true";

      await runPick(["--linear"]);

      expect(output.stderr()).toContain(`worktree: ${REFUSAL}`);
      expectRefusedBeforeAnyWork();
    });

    it("exits 2 with no terminal", async () => {
      terminal(false);

      await runPick(["--linear"]);

      expect(output.stderr()).toContain(`worktree: ${REFUSAL}`);
      expectRefusedBeforeAnyWork();
    });

    it("gives missing_value and its details as the one --json document", async () => {
      await runPick(["--linear", "--json"]);

      expect(output.document()).toEqual({
        error: {
          code: "missing_value",
          message: REFUSAL,
          details: {
            value: "the Linear issue",
            flag: "--linear <identifier>",
          },
        },
      });
      expectRefusedBeforeAnyWork();
    });

    it("refuses --dry-run in a terminal too, and asks nothing", async () => {
      await runPick(["--linear", "--dry-run"]);

      expect(output.stderr()).toContain(`worktree: ${REFUSAL}`);
      expectRefusedBeforeAnyWork();
    });

    it("refuses --dry-run --json as missing_value", async () => {
      await runPick(["--linear", "--dry-run", "--json"]);

      expect(output.document()).toMatchObject({
        error: { code: "missing_value", message: REFUSAL },
      });
      expectRefusedBeforeAnyWork();
    });

    it("still takes a named identifier non-interactively", async () => {
      const document = await runPick(["--linear", "ENG-1", "--json"]);

      expect(list).not.toHaveBeenCalled();
      expect(document).toMatchObject({ issue: { key: "ENG-1" } });
      expect(output.document()).toMatchObject({
        issue: { provider: "linear", key: "ENG-1" },
      });
    });
  });
});
