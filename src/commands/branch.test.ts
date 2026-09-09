/** biome-ignore-all lint/suspicious/noExplicitAny: Allow any in tests */
import { confirm, input } from "@inquirer/prompts";
import ora from "ora";
import * as githubIntegration from "../integrations/github.js";
import * as jiraIntegration from "../integrations/jira.js";
import { copyEnvFilesFromRootPath } from "../lib/env.js";
import * as git from "../lib/git.js";
import * as validators from "../lib/validators.js";
import Branch from "./branch.js";

// Mock the inquirer module
vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  input: vi.fn(),
}));

// Mock env functions
vi.mock("../lib/env.js", () => ({
  copyEnvFilesFromRootPath: vi.fn().mockResolvedValue(undefined),
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

describe("branch command", () => {
  let branch: Branch;
  let mockOpenWorktreePath: ReturnType<typeof vi.spyOn>;
  let mockDispatchAgent: ReturnType<typeof vi.spyOn>;
  const mockInput = vi.mocked(input);
  const mockConfirm = vi.mocked(confirm);
  const mockCopyEnvFiles = vi.mocked(copyEnvFilesFromRootPath);

  beforeEach(() => {
    vi.clearAllMocks();
    const mockConfig = {
      runCommand: vi.fn().mockResolvedValue(undefined),
    } as any;
    branch = new Branch([], mockConfig);
    mockOpenWorktreePath = vi
      .spyOn(branch as any, "openWorktreePath")
      .mockResolvedValue(undefined);
    mockDispatchAgent = vi
      .spyOn(branch as any, "dispatchAgent")
      .mockResolvedValue(undefined);

    // Mock config verification to prevent first-time config prompts
    vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
      if (key === "has-called-config") return Promise.resolve("true");
      return Promise.resolve("");
    });

    // From this phase on, any --github run can reach the assignment seam: an
    // unset `github.autoAssign` means ask (D3), so a case that never mentions
    // assignment still passes through the confirm. Neither the config write nor
    // the API call belongs in a test that is not about assignment — without
    // these two, whichever value `confirm` happens to be left returning decides
    // it, which is order-dependent. config.test.ts guards gitSetConfigValue for
    // the same reason.
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
      expect(mockCopyEnvFiles).toHaveBeenCalledWith("/path/to/worktree");
      expect(mockOpenWorktreePath).toHaveBeenCalledWith("/path/to/worktree");
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

  describe("flag validation", () => {
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
        throw new Error("Please provide either --github or --jira, not both.");
      });

      await expect(branch.run()).rejects.toThrow(
        "Please provide either --github or --jira, not both.",
      );
      expect(mockError).toHaveBeenCalledWith(
        "Please provide either --github or --jira, not both.",
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
        await expect(branch.run()).resolves.toBeUndefined();

        expect(mockGitCreateWorktree).toHaveBeenCalledWith(
          "42-add-dark-mode",
          "origin/main",
        );
        expect(mockCopyEnvFiles).toHaveBeenCalledWith("/path/to/worktree");
        expect(mockOpenWorktreePath).toHaveBeenCalledWith("/path/to/worktree");
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

        await expect(branch.run()).resolves.toBeUndefined();

        expect(mockGitCreateWorktree).toHaveBeenCalled();
        expect(mockOpenWorktreePath).toHaveBeenCalledWith("/path/to/worktree");

        // §2 is "never `fail`, never a throw", and only the throw half is
        // pinned by the case above. The last spinner of the run is the
        // assignment's; without this, swapping `warn` for `fail` or `succeed`
        // is invisible to the whole suite.
        const spinner = vi.mocked(ora).mock.results.at(-1)?.value;
        expect(spinner.warn).toHaveBeenCalled();
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
        githubRun({});
        const mockGitCreateWorktree = vi
          .spyOn(git, "gitCreateWorktree")
          .mockResolvedValue("/path/to/worktree");

        await expect(branch.run()).resolves.toBeUndefined();

        expect(mockGitCreateWorktree).toHaveBeenCalledWith(
          "42-add-dark-mode",
          "origin/main",
        );
        expect(mockOpenWorktreePath).toHaveBeenCalledWith("/path/to/worktree");
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
      ])("errors when the assign flag is %s with neither --github nor --jira", async (assign) => {
        vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
          if (key === "has-called-config") return Promise.resolve("true");
          return Promise.resolve("");
        });
        const mockError = vi.spyOn(branch, "error").mockImplementation(() => {
          throw new Error(
            "--assign/--no-assign requires either --github or --jira.",
          );
        });

        (branch as any).parse = vi.fn().mockResolvedValue({
          args: { branchName: "my-branch" },
          flags: { assign },
        });

        // Both spellings are one flag under `allowNo`, and neither has an
        // issue to act on here.
        await expect(branch.run()).rejects.toThrow(
          "--assign/--no-assign requires either --github or --jira.",
        );
        expect(mockError).toHaveBeenCalledWith(
          "--assign/--no-assign requires either --github or --jira.",
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
        expect(mockOpenWorktreePath).toHaveBeenCalledWith("/path/to/worktree");
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

  describe("--agent flag", () => {
    beforeEach(() => {
      vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
        if (key === "has-called-config") return Promise.resolve("true");
        if (key === "defaultSourceBranch")
          return Promise.resolve("origin/main");
        return Promise.resolve("");
      });
    });

    it("hands the new worktree to the agent with the prompt", async () => {
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feature/test" },
        flags: { agent: "implement the issue" },
      });

      await branch.run();

      expect(mockDispatchAgent).toHaveBeenCalledWith(
        "/path/to/worktree",
        "implement the issue",
      );
    });

    it("dispatches after the env files are copied and before the editor opens", async () => {
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feature/test" },
        flags: { agent: "implement the issue" },
      });

      await branch.run();

      // The agent starts working immediately, so the worktree has to be
      // complete before it is handed over.
      expect(mockCopyEnvFiles.mock.invocationCallOrder[0]).toBeLessThan(
        mockDispatchAgent.mock.invocationCallOrder[0],
      );
      expect(mockDispatchAgent.mock.invocationCallOrder[0]).toBeLessThan(
        mockOpenWorktreePath.mock.invocationCallOrder[0],
      );
    });

    it("opens the editor as well, since the two are independent", async () => {
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feature/test" },
        flags: { agent: "implement the issue" },
      });

      await branch.run();

      expect(mockOpenWorktreePath).toHaveBeenCalledWith("/path/to/worktree");
    });

    it("still dispatches when the prompt is empty, since the flag was given", async () => {
      // `--agent ""` is a request for an agent with no prompt, not an absent
      // flag: the prompt reaches the agent as an empty argument.
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feature/test" },
        flags: { agent: "" },
      });

      await branch.run();

      expect(mockDispatchAgent).toHaveBeenCalledWith("/path/to/worktree", "");
    });

    it("dispatches nothing when the flag is absent", async () => {
      (branch as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feature/test" },
        flags: {},
      });

      await branch.run();

      expect(mockDispatchAgent).not.toHaveBeenCalled();
      expect(mockOpenWorktreePath).toHaveBeenCalledWith("/path/to/worktree");
    });
  });
});
