/** biome-ignore-all lint/suspicious/noExplicitAny: Allow any in tests */
import { confirm, input } from "@inquirer/prompts";
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
