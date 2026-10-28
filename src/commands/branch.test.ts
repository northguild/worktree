/** biome-ignore-all lint/suspicious/noExplicitAny: Allow any in tests */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { confirm, input } from "@inquirer/prompts";
import ora from "ora";
import * as clickupIntegration from "../integrations/clickup.js";
import * as githubIntegration from "../integrations/github.js";
import * as herdr from "../integrations/herdr.js";
import * as jiraIntegration from "../integrations/jira.js";
import * as linearIntegration from "../integrations/linear.js";
import { copyEnvFilesFromRootPath } from "../lib/env.js";
import * as git from "../lib/git.js";
import { runInstall } from "../lib/install.js";
import { setNonInteractive } from "../lib/interaction.js";
import { MissingValueError } from "../lib/prompt.js";
import * as validators from "../lib/validators.js";
import { captureOutput, loadConfig } from "../test-setup.js";
import Branch from "./branch.js";

// Mock the inquirer module
vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  input: vi.fn(),
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
    vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
      if (key === "has-called-config") return Promise.resolve("true");
      if (key === "agent.command") return Promise.resolve("claude --bg");
      return Promise.resolve("");
    });

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
    vi.spyOn(git, "gitGetLocalBranches").mockResolvedValue([]);
    vi.spyOn(git, "gitSetConfigValue").mockResolvedValue();
    vi.spyOn(githubIntegration, "assignGitHubIssue").mockResolvedValue({
      login: "octocat",
      assigned: true,
    });
  });

  describe("basic functionality", () => {
    it("should create worktree with valid branch name and default source", async () => {
      const mockGitCreateWorktree = vi
        .spyOn(git, "gitCreateWorktree")
        .mockResolvedValue("/path/to/worktree");
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
        if (key === "has-called-config") return Promise.resolve("true");
        if (key === "defaultSourceBranch")
          return Promise.resolve("origin/main");
        return Promise.resolve("");
      });

      (branch as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feature/test" },
        flags: {},
      });

      await branch.run();

      expect(mockGitCreateWorktree).toHaveBeenCalledWith(
        "feature/test",
        "origin/main",
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
      vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("origin/main");

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
      );
    });

    it("should fallback to origin/main when no default source is configured", async () => {
      const mockGetConfigValue = vi
        .spyOn(git, "gitGetConfigValue")
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
      vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("origin/main");
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
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
        if (key === "has-called-config") return Promise.resolve("true");
        if (key === "defaultSourceBranch")
          return Promise.resolve("origin/main");
        if (key === "branchPrefix.feature") return Promise.resolve("feature/");
        if (key === "branchPrefix.bugfix") return Promise.resolve("fix/");
        if (key === "branchPrefix.chore") return Promise.resolve("chore/");
        return Promise.resolve("");
      });
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
      );
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
        vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
          if (key === "has-called-config") return Promise.resolve("true");
          if (key === "defaultSourceBranch")
            return Promise.resolve("origin/main");
          return Promise.resolve("");
        });
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
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
        if (key === "has-called-config") return Promise.resolve("true");
        if (key === "defaultSourceBranch")
          return Promise.resolve("origin/main");
        if (key === "branchPrefix.bugfix") return Promise.resolve("fix/");
        return Promise.resolve("");
      });
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
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
        if (key === "has-called-config") return Promise.resolve("true");
        if (key === "defaultSourceBranch")
          return Promise.resolve("origin/main");
        if (key === "branchPrefix.feature") return Promise.resolve("feature/");
        if (key === "branchPrefix.bugfix") return Promise.resolve("fix/");
        if (key === "branchPrefix.chore") return Promise.resolve("chore/");
        return Promise.resolve("");
      });
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
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
        if (key === "has-called-config") return Promise.resolve("true");
        if (key === "defaultSourceBranch")
          return Promise.resolve("origin/main");
        if (key === "branchPrefix.feature") return Promise.resolve("feature/");
        if (key === "branchPrefix.bugfix") return Promise.resolve("fix/");
        if (key === "branchPrefix.chore") return Promise.resolve("chore/");
        return Promise.resolve("");
      });
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
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
        if (key === "has-called-config") return Promise.resolve("true");
        if (key === "defaultSourceBranch")
          return Promise.resolve("origin/main");
        return Promise.resolve("");
      });
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
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
        if (key === "has-called-config") return Promise.resolve("true");
        if (key === "defaultSourceBranch")
          return Promise.resolve("origin/main");
        return Promise.resolve("");
      });
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
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
        if (key === "has-called-config") return Promise.resolve("true");
        if (key === "defaultSourceBranch")
          return Promise.resolve("origin/main");
        return Promise.resolve("");
      });
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
    it("should pre-fill input with branch name derived from jira issue", async () => {
      vi.spyOn(jiraIntegration, "getJiraBranchNameFromIssue").mockResolvedValue(
        "feature/DEV-123-add-dark-mode",
      );
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
        if (key === "has-called-config") return Promise.resolve("true");
        if (key === "defaultSourceBranch")
          return Promise.resolve("origin/main");
        if (key === "jira.host")
          return Promise.resolve("example.atlassian.net");
        if (key === "jira.email") return Promise.resolve("test@example.com");
        if (key === "jira.apiToken") return Promise.resolve("token");
        return Promise.resolve("");
      });
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
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
        if (key === "has-called-config") return Promise.resolve("true");
        if (key === "defaultSourceBranch")
          return Promise.resolve("origin/main");
        if (key === "linear.apiKey") return Promise.resolve(apiKey);
        if (key === "branchPrefix.feature") return Promise.resolve("feature/");
        if (key === "branchPrefix.bugfix") return Promise.resolve("fix/");
        return Promise.resolve("");
      });
    }

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

    function stubConfig(values: Record<string, string> = {}) {
      const config: Record<string, string> = {
        "has-called-config": "true",
        defaultSourceBranch: "origin/main",
        "clickup.apiToken": "pk_test",
        "branchPrefix.feature": "feature/",
        "branchPrefix.bugfix": "fix/",
        ...values,
      };
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) =>
        Promise.resolve(config[key] ?? ""),
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
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) =>
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
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) =>
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
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
        if (key === "has-called-config") return Promise.resolve("true");
        return Promise.resolve("");
      });

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
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
        if (key === "has-called-config") return Promise.resolve("true");
        if (key === "defaultSourceBranch")
          return Promise.resolve("origin/main");
        return Promise.resolve(configValues[key] ?? "");
      });
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
          .spyOn(git, "gitSetConfigValue")
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
          .spyOn(git, "gitSetConfigValue")
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
        );
        expect(mockCopyEnvFiles).toHaveBeenCalledWith("/path/to/worktree", {
          report: "stdout",
        });
        expect(mockOpenWorktreePath).toHaveBeenCalledWith(
          "/path/to/worktree",
          defaultOpenOptions,
        );
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

        // §2 is "never `fail`, never a throw", and only the throw half is
        // pinned by the case above. The last spinner of the run is the
        // assignment's; without this, swapping `warn` for `fail` or `succeed`
        // is invisible to the whole suite.
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
    });

    describe("the other issue sources", () => {
      it("still creates the worktree when persisting the answer fails", async () => {
        // The write is bookkeeping about whether to assign, not the assignment
        // itself, so §2 covers it just as firmly: a stale .git/config.lock must
        // not cost the user the branch they asked for.
        mockConfirm.mockResolvedValue(true);
        vi.spyOn(git, "gitSetConfigValue").mockRejectedValue(
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
        vi.spyOn(git, "gitSetConfigValue").mockRejectedValue(
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
        );
        expect(mockWarn).toHaveBeenCalledWith(
          "Could not save github.autoAssign, so you will be asked again next time. config file is locked",
        );
      });

      it("never reaches the assignment seam without --github or --jira", async () => {
        // The global spies in beforeEach would absorb a stray call silently,
        // so the plain path needs its own assertion that nothing is reached.
        const mockAssign = vi
          .spyOn(githubIntegration, "assignGitHubIssue")
          .mockResolvedValue({ login: "octocat", assigned: true });
        const mockSetConfigValue = vi
          .spyOn(git, "gitSetConfigValue")
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

      it("warns and continues for --jira --assign", async () => {
        vi.spyOn(
          jiraIntegration,
          "getJiraBranchNameFromIssue",
        ).mockResolvedValue("DEV-123-add-dark-mode");
        const mockAssign = vi
          .spyOn(githubIntegration, "assignGitHubIssue")
          .mockResolvedValue({ login: "octocat", assigned: true });
        const mockWarn = vi
          .spyOn(branch, "warn")
          .mockImplementation((input: any) => input);
        mockInput.mockResolvedValue("DEV-123-add-dark-mode");
        const mockGitCreateWorktree = vi
          .spyOn(git, "gitCreateWorktree")
          .mockResolvedValue("/path/to/worktree");

        (branch as any).parse = vi.fn().mockResolvedValue({
          args: {},
          flags: { jira: "DEV-123", assign: true },
        });

        await branch.run();

        // D2 reserves the flag name for Jira; only the GitHub path is built.
        expect(mockWarn).toHaveBeenCalledWith(
          "Assignment is not supported for Jira issues yet.",
        );
        expect(mockAssign).not.toHaveBeenCalled();
        expect(mockGitCreateWorktree).toHaveBeenCalled();
      });

      it.each([
        [true],
        [false],
      ])("errors when the assign flag is %s with none of --github, --jira, --linear or --clickup", async (assign) => {
        vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
          if (key === "has-called-config") return Promise.resolve("true");
          return Promise.resolve("");
        });
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
        vi.spyOn(git, "gitSetConfigValue").mockResolvedValue();
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
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
        if (key === "has-called-config") return Promise.resolve("true");
        if (key === "defaultSourceBranch")
          return Promise.resolve("origin/main");
        if (key === "agent.command") return Promise.resolve("claude --bg");
        return Promise.resolve("");
      });
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
        vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) =>
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
        .spyOn(git, "gitSetConfigValue")
        .mockResolvedValue();
      vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
        number: 42,
        title: "Add dark mode",
      } as any);
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) =>
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
      vi.spyOn(git, "gitSetConfigValue").mockResolvedValue();
      vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
        number: 42,
        title: "Add dark mode",
      } as any);
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) =>
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
      expect(git.gitSetConfigValue).not.toHaveBeenCalled();
    });

    it("cuts a long issue title to a 48-character slug without asking", async () => {
      vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
        number: 42,
        title:
          "Add a dark mode toggle to the settings page so that users can switch themes at runtime",
      } as any);
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) =>
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
      );
      expect(mockInput).not.toHaveBeenCalled();
    });

    it("still honours a configured github.autoAssign", async () => {
      vi.spyOn(githubIntegration, "fetchGitHubIssue").mockResolvedValue({
        number: 42,
        title: "Add dark mode",
      } as any);
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) =>
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
      vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("");
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
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) =>
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
        envFilesCopied: ["docs/.env.local"],
        installed: {
          ran: true,
          command: "pnpm install --frozen-lockfile",
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
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) =>
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
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) =>
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
        isCurrent: false,
        ...over,
      });
    };
    const expectNothingDone = () => {
      expect(git.gitCreateWorktree).not.toHaveBeenCalled();
      expect(mockCopyEnvFiles).not.toHaveBeenCalled();
      expect(mockRunInstall).not.toHaveBeenCalled();
      expect(githubIntegration.assignGitHubIssue).not.toHaveBeenCalled();
      expect(git.gitSetConfigValue).not.toHaveBeenCalled();
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
        vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) =>
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
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) =>
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
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) =>
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
      expect(create).toHaveBeenCalledWith("feat", "origin/main");
      expect(mockOpenWorktreePath).toHaveBeenCalledWith(
        "/path/to/worktree",
        defaultOpenOptions,
      );
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
    ]) {
      expect(help).toContain(key);
    }
    expect(help).toContain("0 success");
    expect(help).toContain("1 failure");
    expect(help).toContain("2 usage");
    expect(help).toContain('{provider:"linear", key, url|null}');
    expect(help).toContain('{provider:"clickup", key');
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
