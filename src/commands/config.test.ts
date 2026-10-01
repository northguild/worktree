/** biome-ignore-all lint/suspicious/noExplicitAny: Allow any in tests */
import { confirm, input, select } from "@inquirer/prompts";
import * as cli from "../lib/cli.js";
import * as git from "../lib/git.js";
import { setNonInteractive } from "../lib/interaction.js";
import * as validators from "../lib/validators.js";
import Config from "./config.js";

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  input: vi.fn(),
  select: vi.fn(),
}));

describe("config command", () => {
  let config: Config;
  let mockConsoleLog: ReturnType<typeof vi.spyOn>;
  const mockInput = vi.mocked(input);
  const mockConfirm = vi.mocked(confirm);
  const mockSelect = vi.mocked(select);

  beforeEach(() => {
    vi.clearAllMocks();

    const mockConfig = {
      runCommand: vi.fn().mockResolvedValue(undefined),
    } as any;
    config = new Config([], mockConfig);
    mockConsoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    // Prevent config command tests from touching the low-level cmd wrapper.
    vi.spyOn(git, "gitSetConfigValue").mockResolvedValue();

    // Default mock to prevent config verification from running
    vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
      if (key === "has-called-config") return Promise.resolve("true");
      return Promise.resolve("");
    });
  });

  describe("--list flag", () => {
    it("should list all config values when they exist", async () => {
      // Mock the parse method to simulate --list flag
      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { list: true, missing: false },
      });

      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
        if (key === "has-called-config") return Promise.resolve("true");
        if (key === "jira.host")
          return Promise.resolve("https://test.atlassian.net");
        if (key === "jira.email") return Promise.resolve("test@example.com");
        if (key === "jira.apiToken") return Promise.resolve("api-token-123");
        if (key === "codeEditor") return Promise.resolve("code");
        if (key === "defaultSourceBranch")
          return Promise.resolve("origin/main");
        return Promise.resolve("");
      });

      await config.run();

      expect(mockConsoleLog).toHaveBeenCalledWith(
        "jira.host=https://test.atlassian.net",
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        "jira.email=test@example.com",
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        "jira.apiToken=api-token-123",
      );
      expect(mockConsoleLog).toHaveBeenCalledWith("codeEditor=code");
      expect(mockConsoleLog).toHaveBeenCalledWith(
        "defaultSourceBranch=origin/main",
      );
    });

    it("should list config names when values are missing", async () => {
      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { list: true, missing: false },
      });

      vi.spyOn(git, "gitGetConfigValue").mockResolvedValue(""); // All empty

      await config.run();

      expect(mockConsoleLog).toHaveBeenCalledWith("jira.host");
      expect(mockConsoleLog).toHaveBeenCalledWith("jira.email");
      expect(mockConsoleLog).toHaveBeenCalledWith("jira.apiToken");
      expect(mockConsoleLog).toHaveBeenCalledWith("codeEditor");
      expect(mockConsoleLog).toHaveBeenCalledWith("defaultSourceBranch");
      expect(mockConsoleLog).toHaveBeenCalledWith("github.autoAssign");
    });

    it("should handle --missing flag with no missing values", async () => {
      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { list: true, missing: true },
      });

      vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("some-value"); // All have values

      await config.run();

      expect(mockConsoleLog).toHaveBeenCalledWith(
        "No variables have missing values",
      );
    });
  });

  describe("setting config values", () => {
    it("should set a valid config value", async () => {
      const mockSetConfigValue = vi
        .spyOn(git, "gitSetConfigValue")
        .mockResolvedValue();
      const mockValidateConfigValue = vi
        .spyOn(validators, "validateConfigValue")
        .mockResolvedValue();

      // Mock the parse method to return the args we want
      (config as any).parse = vi.fn().mockResolvedValue({
        args: { name: "jira.email", value: "test@example.com" },
        flags: {},
      });

      await config.run();

      expect(mockValidateConfigValue).toHaveBeenCalledWith(
        "jira.email",
        "test@example.com",
      );
      expect(mockSetConfigValue).toHaveBeenCalledWith(
        "jira.email",
        "test@example.com",
      );
    });

    it("should get config value when only name is provided", async () => {
      const mockGetConfigValue = vi
        .spyOn(git, "gitGetConfigValue")
        .mockResolvedValue("test@example.com");

      (config as any).parse = vi.fn().mockResolvedValue({
        args: { name: "jira.email" },
        flags: {},
      });

      await config.run();

      expect(mockGetConfigValue).toHaveBeenCalledWith("jira.email");
      // The value alone, secrets included: scriptable as `$(worktree config k)`.
      expect(mockConsoleLog).toHaveBeenCalledTimes(1);
      expect(mockConsoleLog).toHaveBeenCalledWith("test@example.com");
    });

    it("should print a secret when only its name is provided", async () => {
      vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("tok_secret");
      (config as any).parse = vi.fn().mockResolvedValue({
        args: { name: "github.token" },
        flags: {},
      });

      await config.run();

      expect(mockConsoleLog).toHaveBeenCalledWith("tok_secret");
    });

    it("should print nothing for an unset key", async () => {
      (config as any).parse = vi.fn().mockResolvedValue({
        args: { name: "jira.email" },
        flags: {},
      });

      await config.run();

      expect(mockConsoleLog).not.toHaveBeenCalled();
    });

    it("should store opener none", async () => {
      const mockSetConfigValue = vi
        .spyOn(git, "gitSetConfigValue")
        .mockResolvedValue();
      (config as any).parse = vi.fn().mockResolvedValue({
        args: { name: "opener", value: "none" },
        flags: {},
      });

      await config.run();

      expect(mockSetConfigValue).toHaveBeenCalledWith("opener", "none");
    });

    it("should reject a bogus opener naming the accepted kinds", async () => {
      // Earlier tests stub the validator; this one wants the real one.
      vi.spyOn(validators, "validateConfigValue").mockRestore();
      const mockSetConfigValue = vi
        .spyOn(git, "gitSetConfigValue")
        .mockResolvedValue();
      (config as any).parse = vi.fn().mockResolvedValue({
        args: { name: "opener", value: "bogus" },
        flags: {},
      });

      await expect(config.run()).rejects.toThrow("editor, herdr or none");
      expect(mockSetConfigValue).not.toHaveBeenCalledWith(
        "opener",
        expect.anything(),
      );
    });
  });

  describe("error handling", () => {
    it("should handle unknown config name", async () => {
      (config as any).parse = vi.fn().mockResolvedValue({
        args: { name: "unknown.setting", value: "test" },
        flags: {},
      });

      await expect(config.run()).rejects.toThrow(
        "Unknown config name: unknown.setting",
      );
    });

    it("should handle invalid config value", async () => {
      vi.spyOn(validators, "validateConfigValue").mockRejectedValue(
        new validators.InvalidConfigValueError("Invalid email address"),
      );

      (config as any).parse = vi.fn().mockResolvedValue({
        args: { name: "jira.email", value: "invalid-email" },
        flags: {},
      });

      await expect(config.run()).rejects.toThrow("Invalid email address");
    });

    it("reports an invalid config value on stderr and exits 2", async () => {
      const originalExitCode = process.exitCode;
      const mockConsoleError = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      vi.spyOn(validators, "validateConfigValue").mockRejectedValue(
        new validators.InvalidConfigValueError("Invalid email address"),
      );
      (config as any).parse = vi.fn().mockResolvedValue({
        args: { name: "jira.email", value: "invalid-email" },
        flags: {},
      });

      try {
        await config.run().catch((error) => (config as any).catch(error));

        expect(mockConsoleError).toHaveBeenCalledTimes(1);
        expect(mockConsoleError.mock.calls[0][0]).toContain(
          "Error: Invalid email address",
        );
        expect(mockConsoleLog).not.toHaveBeenCalled();
        // A refused value is a value problem, as the README's table says.
        expect(process.exitCode).toBe(2);
      } finally {
        process.exitCode = originalExitCode;
      }
    });
  });

  describe("--names flag", () => {
    it("should only prompt for the specified config name", async () => {
      mockInput.mockResolvedValue("origin/main");

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: {
          list: false,
          missing: false,
          yes: false,
          names: "defaultSourceBranch",
        },
      });

      await config.run();

      expect(mockInput).toHaveBeenCalledTimes(1);
      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Which branch should new worktrees be based on?",
        }),
      );
    });

    it("should silently ignore unknown config names", async () => {
      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: {
          list: false,
          missing: false,
          yes: false,
          names: "unknown.setting",
        },
      });

      await config.run();

      expect(mockInput).not.toHaveBeenCalled();
      expect(mockConsoleLog).toHaveBeenCalledWith("No missing config found.");
    });
  });

  describe("branch prefix prompts", () => {
    it("should prompt for all branch prefix variables without a group confirm when the keys are named", async () => {
      mockInput
        .mockResolvedValueOnce("feature/")
        .mockResolvedValueOnce("fix/")
        .mockResolvedValueOnce("chore/");
      const mockSetConfigValue = vi
        .spyOn(git, "gitSetConfigValue")
        .mockResolvedValue();

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: {
          list: false,
          missing: false,
          yes: false,
          names: "branchPrefix.feature,branchPrefix.bugfix,branchPrefix.chore",
        },
      });

      await config.run();

      // Naming the keys is asking for them (R4): no group question.
      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Prefix for feature branches" }),
      );
      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Prefix for bugfix branches" }),
      );
      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Prefix for chore branches" }),
      );
      expect(mockSetConfigValue).toHaveBeenCalledWith(
        "branchPrefix.feature",
        "feature/",
      );
      expect(mockSetConfigValue).toHaveBeenCalledWith(
        "branchPrefix.bugfix",
        "fix/",
      );
      expect(mockSetConfigValue).toHaveBeenCalledWith(
        "branchPrefix.chore",
        "chore/",
      );
    });

    it("should skip branch prefix prompts when a bare run is declined", async () => {
      mockConfirm.mockResolvedValue(false);

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: {
          list: false,
          missing: false,
          yes: false,
        },
      });

      await config.run();

      expect(mockConfirm).toHaveBeenCalledWith({
        message: "Do you want to configure branch name prefixes?",
      });
      expect(mockInput).not.toHaveBeenCalledWith(
        expect.objectContaining({ message: "Prefix for feature branches" }),
      );
    });

    it("takes the defaults without asking when the run is non-interactive", async () => {
      setNonInteractive(true);
      const mockSetConfigValue = vi
        .spyOn(git, "gitSetConfigValue")
        .mockResolvedValue();

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: {
          list: false,
          missing: false,
          names: "branchPrefix.feature,branchPrefix.bugfix,branchPrefix.chore",
        },
      });

      await config.run();

      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockInput).not.toHaveBeenCalled();
      expect(mockSetConfigValue).toHaveBeenCalledWith(
        "branchPrefix.feature",
        "feature/",
      );
      expect(mockSetConfigValue).toHaveBeenCalledWith(
        "branchPrefix.bugfix",
        "fix/",
      );
      expect(mockSetConfigValue).toHaveBeenCalledWith(
        "branchPrefix.chore",
        "chore/",
      );
    });

    it("fails naming --names when a non-interactive run names no keys", async () => {
      setNonInteractive(true);

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { list: false, missing: false },
      });

      await expect(config.run()).rejects.toMatchObject({
        message: expect.stringContaining("pass --names <keys>"),
        oclif: { exit: 2 },
      });
      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockInput).not.toHaveBeenCalled();
    });
  });

  describe("defaultSourceBranch prompt pre-fill", () => {
    it("should pre-fill with the existing value when one is configured", async () => {
      mockInput.mockResolvedValue("origin/develop");
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
        if (key === "has-called-config") return Promise.resolve("true");
        if (key === "defaultSourceBranch")
          return Promise.resolve("origin/develop");
        return Promise.resolve("");
      });

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: {
          list: false,
          missing: false,
          yes: false,
          names: "defaultSourceBranch",
        },
      });

      await config.run();

      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Which branch should new worktrees be based on?",
          default: "origin/develop",
          prefill: "editable",
        }),
      );
    });

    it("should fall back to 'origin/main' with tab prefill when no value is configured", async () => {
      mockInput.mockResolvedValue("origin/main");

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: {
          list: false,
          missing: false,
          yes: false,
          names: "defaultSourceBranch",
        },
      });

      await config.run();

      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Which branch should new worktrees be based on?",
          default: "origin/main",
          prefill: "tab",
        }),
      );
    });
  });
  describe("postCreate prompt", () => {
    const postCreateFlags = {
      list: false,
      missing: false,
      yes: false,
      names: "postCreate",
    };

    it("prompts for the command and stores it trimmed, without a group confirm when named", async () => {
      mockInput.mockResolvedValue(" pnpm install ");
      const mockSetConfigValue = vi
        .spyOn(git, "gitSetConfigValue")
        .mockResolvedValue();
      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: postCreateFlags,
      });

      await config.run();

      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Command to run in each new"),
        }),
      );
      expect(mockSetConfigValue).toHaveBeenCalledWith(
        "postCreate",
        "pnpm install",
      );
    });

    it("accepts an empty answer, which declines a fixed command", async () => {
      mockInput.mockResolvedValue("");
      const mockSetConfigValue = vi
        .spyOn(git, "gitSetConfigValue")
        .mockResolvedValue();
      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: postCreateFlags,
      });

      await config.run();

      const { validate } = mockInput.mock.calls[0][0] as {
        validate: (value: string) => Promise<true | string>;
      };
      expect(await validate("")).toBe(true);
      expect(mockSetConfigValue).toHaveBeenCalledWith("postCreate", "");
    });

    it("skips the prompt when a bare run is declined", async () => {
      mockConfirm.mockResolvedValue(false);
      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { list: false, missing: false },
      });

      await config.run();

      expect(mockConfirm).toHaveBeenCalledWith({
        message:
          "Do you want to run a command in new worktrees after they are created?",
      });
      expect(mockInput).not.toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining("Command to run in each new"),
        }),
      );
    });

    it("keeps the stored value when a non-interactive run names the key", async () => {
      setNonInteractive(true);
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) =>
        Promise.resolve(key === "postCreate" ? "make setup" : "true"),
      );
      vi.spyOn(cli, "commandExists").mockResolvedValue(true);
      const mockSetConfigValue = vi
        .spyOn(git, "gitSetConfigValue")
        .mockResolvedValue();
      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: postCreateFlags,
      });

      await config.run();

      expect(mockInput).not.toHaveBeenCalled();
      expect(mockSetConfigValue).toHaveBeenCalledWith(
        "postCreate",
        "make setup",
      );
    });

    it("is listed with the other keys", async () => {
      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { list: true, missing: true },
      });
      const log = vi.spyOn(config, "log").mockImplementation(() => {});

      await config.run();

      expect(log.mock.calls.map((call) => call[0])).toContain("postCreate");
    });
  });

  describe("agent.command prompt", () => {
    const agentFlags = {
      list: false,
      missing: false,
      yes: false,
      names: "agent.command",
    };

    it("should prompt for the agent command and store it without a group confirm when the key is named", async () => {
      mockInput.mockResolvedValue("claude --bg");
      const mockSetConfigValue = vi
        .spyOn(git, "gitSetConfigValue")
        .mockResolvedValue();

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: agentFlags,
      });

      await config.run();

      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Command to start the coding agent?",
        }),
      );
      expect(mockSetConfigValue).toHaveBeenCalledWith(
        "agent.command",
        "claude --bg",
      );
    });

    it("should skip the agent prompt when a bare run is declined", async () => {
      mockConfirm.mockResolvedValue(false);

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { list: false, missing: false },
      });

      await config.run();

      expect(mockConfirm).toHaveBeenCalledWith({
        message: "Do you want to hand new worktrees to a coding agent?",
      });
      expect(mockInput).not.toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Command to start the coding agent?",
        }),
      );
    });

    it("fails naming the key when a non-interactive run has no agent command", async () => {
      setNonInteractive(true);

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: agentFlags,
      });

      await expect(config.run()).rejects.toMatchObject({
        message:
          "no default for agent.command; pass worktree config agent.command <value>",
        oclif: { exit: 2 },
      });
      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockInput).not.toHaveBeenCalled();
    });

    it("fails naming github.token when a non-interactive run has no token", async () => {
      setNonInteractive(true);
      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: {
          list: false,
          missing: false,
          names: "github.token",
        },
      });

      await expect(config.run()).rejects.toMatchObject({
        message:
          "no default for github.token; pass worktree config github.token <token>",
      });
      expect(mockInput).not.toHaveBeenCalled();
    });

    // No agent runtime is named as a fallback, unlike codeEditor's "code".
    // Suggesting one would make this tool depend on a particular CLI, which
    // AGENT-MODE-PLAN §2 rules out.
    it("should offer no default agent runtime when none is configured", async () => {
      mockInput.mockResolvedValue("claude");

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: agentFlags,
      });

      await config.run();

      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Command to start the coding agent?",
          default: "",
          prefill: "tab",
        }),
      );
    });

    it("should pre-fill with the existing value when one is configured", async () => {
      mockInput.mockResolvedValue("codex -q");
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
        if (key === "has-called-config") return Promise.resolve("true");
        if (key === "agent.command") return Promise.resolve("codex -q");
        return Promise.resolve("");
      });

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: agentFlags,
      });

      await config.run();

      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Command to start the coding agent?",
          default: "codex -q",
          prefill: "editable",
        }),
      );
    });

    // The prompt validates on the argv head, so a value carrying flags is
    // accepted while the program alone is what gets looked up. Exercising the
    // captured validate pins the behaviour rather than the function identity.
    it("should validate the entered command on its argv head", async () => {
      mockInput.mockResolvedValue("claude --bg");
      const mockCommandExists = vi
        .spyOn(cli, "commandExists")
        .mockResolvedValue(true);

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: agentFlags,
      });

      await config.run();

      const { validate } = mockInput.mock.calls[0][0] as {
        validate: (value: string) => Promise<true | string>;
      };

      expect(await validate("claude --bg")).toBe(true);
      expect(mockCommandExists).toHaveBeenCalledWith("claude");
      expect(await validate("   ")).toBe("Command cannot be empty");
    });
  });

  describe("the run verifyConfig delegates to", () => {
    it("asks no Jira group confirm for missing Jira keys, as before the flag changed", async () => {
      mockInput
        .mockResolvedValueOnce("example.atlassian.com")
        .mockResolvedValueOnce("me@example.com")
        .mockResolvedValueOnce("token");

      // Exactly the arguments BaseCommand.verifyConfig passes: no `--yes`.
      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: {
          list: false,
          missing: true,
          names: "jira.host,jira.email,jira.apiToken",
        },
      });

      await config.run();

      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockInput).toHaveBeenCalledTimes(3);
    });
  });

  describe("opener prompts", () => {
    it("should set both opener and herdr.focus from a prompt run", async () => {
      mockInput.mockResolvedValueOnce("herdr");
      mockConfirm.mockResolvedValueOnce(false);
      const mockSetConfigValue = vi
        .spyOn(git, "gitSetConfigValue")
        .mockResolvedValue();

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: {
          list: false,
          missing: false,
          yes: true,
          names: "opener,herdr.focus",
        },
      });

      await config.run();

      expect(mockInput).toHaveBeenCalledTimes(1);
      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            "Which opener should new worktrees use? (editor, herdr or none)",
          default: "editor",
          prefill: "tab",
          validate: validators.isValidOpener,
        }),
      );
      // Unset means yes: the documented default of herdr.focus is true.
      expect(mockConfirm).toHaveBeenCalledTimes(1);
      expect(mockConfirm).toHaveBeenCalledWith({
        message: "Should opening a worktree focus its Herdr space?",
        default: true,
      });
      expect(mockSetConfigValue).toHaveBeenCalledWith("opener", "herdr");
      expect(mockSetConfigValue).toHaveBeenCalledWith("herdr.focus", "false");
    });

    it("should write true when herdr.focus is confirmed", async () => {
      mockConfirm.mockResolvedValueOnce(true);
      const mockSetConfigValue = vi
        .spyOn(git, "gitSetConfigValue")
        .mockResolvedValue();

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { list: false, missing: false, names: "herdr.focus" },
      });

      await config.run();

      expect(mockSetConfigValue).toHaveBeenCalledWith("herdr.focus", "true");
    });

    it("should skip both prompts when a bare run is declined", async () => {
      mockConfirm.mockResolvedValue(false);

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: {
          list: false,
          missing: false,
          yes: false,
        },
      });

      await config.run();

      expect(mockConfirm).toHaveBeenCalledWith({
        message: "Do you want to choose where new worktrees are opened?",
      });
      expect(mockConfirm).toHaveBeenCalledWith({
        message: "Do you want to configure Herdr space options?",
      });
      expect(mockConfirm).not.toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Should opening a worktree focus its Herdr space?",
        }),
      );
    });

    it("should pre-fill both prompts with the configured values", async () => {
      mockInput.mockResolvedValue("herdr");
      mockConfirm.mockResolvedValue(false);
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
        if (key === "has-called-config") return Promise.resolve("true");
        if (key === "opener") return Promise.resolve("herdr");
        if (key === "herdr.focus") return Promise.resolve("false");
        return Promise.resolve("");
      });

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: {
          list: false,
          missing: false,
          yes: true,
          names: "opener,herdr.focus",
        },
      });

      await config.run();

      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({ default: "herdr", prefill: "editable" }),
      );
      // A stored "false" defaults the confirm to no.
      expect(mockConfirm).toHaveBeenCalledWith({
        message: "Should opening a worktree focus its Herdr space?",
        default: false,
      });
    });

    it("should default herdr.focus to yes when the stored value is empty", async () => {
      mockConfirm.mockResolvedValue(true);

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { list: false, missing: false, names: "herdr.focus" },
      });

      await config.run();

      expect(mockConfirm).toHaveBeenCalledWith({
        message: "Should opening a worktree focus its Herdr space?",
        default: true,
      });
    });

    it("should take the stored herdr.focus without prompting when non-interactive", async () => {
      setNonInteractive(true);
      const mockSetConfigValue = vi
        .spyOn(git, "gitSetConfigValue")
        .mockResolvedValue();
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
        if (key === "has-called-config") return Promise.resolve("true");
        if (key === "herdr.focus") return Promise.resolve("false");
        return Promise.resolve("");
      });

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { list: false, missing: false, yes: true, names: "herdr.focus" },
      });

      await config.run();

      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockSetConfigValue).toHaveBeenCalledWith("herdr.focus", "false");
    });

    it("should take yes for an unset herdr.focus without exiting 2 when non-interactive", async () => {
      setNonInteractive(true);
      const mockSetConfigValue = vi
        .spyOn(git, "gitSetConfigValue")
        .mockResolvedValue();

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { list: false, missing: false, yes: true, names: "herdr.focus" },
      });

      await config.run();

      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockSetConfigValue).toHaveBeenCalledWith("herdr.focus", "true");
    });

    it("should set herdr.agent from a prompt run", async () => {
      mockInput.mockResolvedValue("claude");
      const mockSetConfigValue = vi
        .spyOn(git, "gitSetConfigValue")
        .mockResolvedValue();

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: {
          list: false,
          missing: false,
          yes: true,
          names: "herdr.agent",
        },
      });

      await config.run();

      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({
          message:
            "Which agent should start in a new Herdr space? (empty for none)",
          default: "",
          prefill: "tab",
        }),
      );
      expect(mockSetConfigValue).toHaveBeenCalledWith("herdr.agent", "claude");
    });

    it("should let an empty answer decline the agent while still rejecting a malformed kind", async () => {
      mockInput.mockResolvedValue("");

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: {
          list: false,
          missing: false,
          yes: true,
          names: "herdr.agent",
        },
      });

      await config.run();

      const options = mockInput.mock.calls.at(0)?.[0] as {
        validate: (value: string) => true | string;
      };

      // The key is opt-in (D9), so this prompt has to be the way to say no as
      // well as the way to choose — otherwise a `--missing` run forces an agent
      // on someone who does not want one.
      expect(options.validate("")).toBe(true);
      // A stray space is someone hitting return, not a malformed kind.
      expect(options.validate("   ")).toBe(true);
      expect(options.validate("claude")).toBe(true);
      expect(options.validate("Claude!")).toBe(
        "Agent kind must be lowercase letters, digits and dashes, for example claude",
      );
    });
  });

  // `github.token` was in CONFIG_NAMES with no prompt block, so `--missing`
  // listed it as missing and then asked nothing. These pin that both GitHub
  // keys are actually answerable — the dead-key shape is what they guard.
  describe("GitHub issue prompts", () => {
    it("should set both github.token and github.autoAssign from a prompt run", async () => {
      mockInput.mockResolvedValueOnce("ghp_prompted_token");
      mockSelect.mockResolvedValueOnce("true");
      const mockSetConfigValue = vi
        .spyOn(git, "gitSetConfigValue")
        .mockResolvedValue();

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: {
          list: false,
          missing: false,
          yes: true,
          names: "github.token,github.autoAssign",
        },
      });

      await config.run();

      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "GitHub personal access token",
        }),
      );
      // objectContaining cannot assert an absence, and absence is the point: a
      // stored token must never be echoed back as a prompt default, the way
      // `jira.apiToken` is never echoed back either.
      const tokenPromptOptions = mockInput.mock.calls.at(0)?.[0] as {
        default?: string;
        prefill?: string;
      };
      expect(tokenPromptOptions.default).toBeUndefined();
      expect(tokenPromptOptions.prefill).toBeUndefined();
      expect(mockSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Should `branch --github` assign the issue to you?",
          default: "",
          choices: [
            { name: "Yes, always", value: "true" },
            { name: "No, never", value: "false" },
            { name: "Ask me each time", value: "" },
          ],
        }),
      );
      expect(mockSetConfigValue).toHaveBeenCalledWith(
        "github.token",
        "ghp_prompted_token",
      );
      expect(mockSetConfigValue).toHaveBeenCalledWith(
        "github.autoAssign",
        "true",
      );
    });

    it("should ask one confirm for the group and skip both prompts when a bare run is declined", async () => {
      mockConfirm.mockResolvedValue(false);

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: {
          list: false,
          missing: false,
          yes: false,
        },
      });

      await config.run();

      expect(mockConfirm).toHaveBeenCalledWith({
        message: "Do you want to configure GitHub issue options?",
      });
      expect(mockInput).not.toHaveBeenCalledWith(
        expect.objectContaining({ message: "GitHub personal access token" }),
      );
    });

    it("should keep a stored github.token when the prompt is answered empty", async () => {
      mockInput.mockResolvedValue("");
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
        if (key === "has-called-config") return Promise.resolve("true");
        if (key === "github.token") return Promise.resolve("ghp_stored_token");
        return Promise.resolve("");
      });
      const mockSetConfigValue = vi
        .spyOn(git, "gitSetConfigValue")
        .mockResolvedValue();

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: {
          list: false,
          missing: false,
          yes: true,
          names: "github.token",
        },
      });

      await config.run();

      // The prompt's own instruction line invites an empty answer — it is how
      // you say "use `gh auth token` instead" — so taking that invitation must
      // not clear the token. A bare `worktree config` prompts every key
      // whatever it already holds, which is what makes this reachable.
      expect(mockInput).toHaveBeenCalled();
      expect(mockSetConfigValue).not.toHaveBeenCalledWith(
        "github.token",
        expect.anything(),
      );
    });

    const withStoredAutoAssign = (stored: string) =>
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
        if (key === "has-called-config") return Promise.resolve("true");
        if (key === "github.autoAssign") return Promise.resolve(stored);
        return Promise.resolve("");
      });

    const parseAutoAssignRun = (flags: Record<string, unknown>) => {
      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: {
          list: false,
          missing: false,
          names: "github.autoAssign",
          ...flags,
        },
      });
    };

    it.each([
      ["true", "true"],
      ["false", "false"],
      ["", ""],
      ["maybe", ""],
    ])("should preselect the choice for a stored github.autoAssign of %j", async (stored, expected) => {
      mockSelect.mockResolvedValue(expected);
      withStoredAutoAssign(stored);
      parseAutoAssignRun({ yes: false });

      await config.run();

      expect(mockSelect).toHaveBeenCalledWith(
        expect.objectContaining({ default: expected }),
      );
      expect(mockInput).not.toHaveBeenCalled();
    });

    it.each([
      ["Yes, always", "true"],
      ["No, never", "false"],
      ["Ask me each time", ""],
    ])("should write the %s answer to github.autoAssign as %j", async (_label, answer) => {
      mockSelect.mockResolvedValue(answer);
      const mockSetConfigValue = vi
        .spyOn(git, "gitSetConfigValue")
        .mockResolvedValue();
      withStoredAutoAssign(answer === "true" ? "false" : "true");
      parseAutoAssignRun({ yes: false });

      await config.run();

      // "Ask me" writes an empty string, which is how a stored value is cleared.
      expect(mockSetConfigValue).toHaveBeenCalledWith(
        "github.autoAssign",
        answer,
      );
    });

    it.each([
      ["false", "false"],
      ["true", "true"],
      ["", ""],
    ])("should take a stored github.autoAssign of %j without exiting 2 when non-interactive", async (stored, expected) => {
      setNonInteractive(true);
      const mockSetConfigValue = vi
        .spyOn(git, "gitSetConfigValue")
        .mockResolvedValue();
      withStoredAutoAssign(stored);
      parseAutoAssignRun({ yes: true });

      await config.run();

      expect(mockSelect).not.toHaveBeenCalled();
      expect(mockSetConfigValue).toHaveBeenCalledWith(
        "github.autoAssign",
        expected,
      );
    });

    it("should still offer an unset github.autoAssign on a --missing run", async () => {
      // The key is tri-state through unset (D3): `--missing` must keep offering
      // it until it is settled, and "Ask me each time" must be a way to answer.
      mockSelect.mockResolvedValue("");
      const mockSetConfigValue = vi
        .spyOn(git, "gitSetConfigValue")
        .mockResolvedValue();
      parseAutoAssignRun({ missing: true, yes: false });

      await config.run();

      expect(mockSelect).toHaveBeenCalledTimes(1);
      expect(mockSetConfigValue).toHaveBeenCalledWith("github.autoAssign", "");
    });

    it("should not offer a settled github.autoAssign on a --missing run", async () => {
      withStoredAutoAssign("true");
      parseAutoAssignRun({ missing: true, yes: false });

      await config.run();

      expect(mockSelect).not.toHaveBeenCalled();
    });

    it("should not ask the GitHub confirm when no GitHub key is being prompted", async () => {
      mockInput.mockResolvedValue("code");

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: {
          list: false,
          missing: false,
          yes: false,
          names: "codeEditor",
        },
      });

      await config.run();

      const asked = mockConfirm.mock.calls.map(
        (call: unknown[]) => (call[0] as { message: string }).message,
      );
      expect(asked).not.toContain(
        "Do you want to configure GitHub issue options?",
      );
    });
  });

  // Phase 7: someone without the `herdr` binary should never be shown the keys
  // that only mean something with it. `commandExists` is stubbed true globally
  // in test-setup, so "installed" is the default every other suite sees.
  describe("hiding the Herdr keys when herdr is absent", () => {
    const herdrKeys = ["herdr.focus", "herdr.agent"];

    // vitest.config.ts sets no restoreMocks, and clearAllMocks keeps
    // implementations, so a commandExists stub left here would leak into any
    // test appended after this block.
    afterEach(() => {
      vi.restoreAllMocks();
    });

    function listedNames(): string[] {
      return mockConsoleLog.mock.calls.map((call: unknown[]) =>
        String(call[0]),
      );
    }

    it("omits them from --list when herdr is not installed", async () => {
      vi.spyOn(cli, "commandExists").mockResolvedValue(false);
      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { list: true, missing: true },
      });

      await config.run();

      for (const key of herdrKeys) {
        expect(listedNames()).not.toContain(key);
      }
      // The rest of the surface is untouched.
      expect(listedNames()).toContain("codeEditor");
      expect(listedNames()).toContain("agent.command");
    });

    it("lists them when herdr is installed", async () => {
      vi.spyOn(cli, "commandExists").mockResolvedValue(true);
      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { list: true, missing: true },
      });

      await config.run();

      for (const key of herdrKeys) {
        expect(listedNames()).toContain(key);
      }
    });

    it("still lists a Herdr key that already holds a value", async () => {
      // opener stays unset here, so this exercises the per-key carve-out on its
      // own rather than the opener=herdr opt-in covered below.
      vi.spyOn(cli, "commandExists").mockResolvedValue(false);
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
        if (key === "has-called-config") return Promise.resolve("true");
        if (key === "herdr.agent") return Promise.resolve("claude");
        return Promise.resolve("");
      });
      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { list: true, missing: false },
      });

      await config.run();

      expect(listedNames()).toContain("herdr.agent=claude");
      // The two that hold no value stay hidden.
      expect(listedNames()).not.toContain("herdr.focus");
    });

    it("always lists opener, because `none` is useful without herdr", async () => {
      vi.spyOn(cli, "commandExists").mockResolvedValue(false);
      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { list: true, missing: false },
      });

      await config.run();

      expect(listedNames()).toContain("opener");
    });

    it("asks the opener confirm but not the Herdr one when herdr is absent", async () => {
      vi.spyOn(cli, "commandExists").mockResolvedValue(false);
      mockConfirm.mockResolvedValue(false);
      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { list: false, missing: true, yes: false },
      });

      await config.run();

      const asked = mockConfirm.mock.calls.map((call) => call[0]?.message);
      expect(asked).toContain(
        "Do you want to choose where new worktrees are opened?",
      );
      expect(asked).not.toContain(
        "Do you want to configure Herdr space options?",
      );
    });

    it("asks both confirms when herdr is installed", async () => {
      vi.spyOn(cli, "commandExists").mockResolvedValue(true);
      mockConfirm.mockResolvedValue(false);
      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { list: false, missing: true, yes: false },
      });

      await config.run();

      const asked = mockConfirm.mock.calls.map((call) => call[0]?.message);
      expect(asked).toContain(
        "Do you want to choose where new worktrees are opened?",
      );
      expect(asked).toContain("Do you want to configure Herdr space options?");
    });

    it("un-hides every Herdr key when opener is explicitly herdr", async () => {
      vi.spyOn(cli, "commandExists").mockResolvedValue(false);
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) => {
        if (key === "has-called-config") return Promise.resolve("true");
        if (key === "opener") return Promise.resolve("herdr");
        return Promise.resolve("");
      });
      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { list: true, missing: true },
      });

      await config.run();

      // opener itself has a value so --missing skips it; the two it governs
      // have none and must still be offered.
      expect(listedNames()).toContain("herdr.focus");
      expect(listedNames()).toContain("herdr.agent");
    });

    it("leaves the Herdr keys out of the unknown-name error when herdr is absent", async () => {
      vi.spyOn(cli, "commandExists").mockResolvedValue(false);
      const errorSpy = vi
        .spyOn(config, "error")
        .mockImplementation((() => {}) as any);
      (config as any).parse = vi.fn().mockResolvedValue({
        args: { name: "bogus" },
        flags: { list: false, missing: false },
      });

      await config.run();

      const message = String(errorSpy.mock.calls[0]?.[0]);
      expect(message).toContain("codeEditor");
      expect(message).toContain("opener");
      for (const key of herdrKeys) {
        expect(message).not.toContain(key);
      }
    });

    it("honours an explicit --names request even when herdr is absent", async () => {
      // Naming the key is asking for it: someone configuring ahead of
      // installing Herdr must not be silently ignored.
      vi.spyOn(cli, "commandExists").mockResolvedValue(false);
      const setConfigValue = vi
        .spyOn(git, "gitSetConfigValue")
        .mockResolvedValue();
      mockInput.mockResolvedValue("herdr");
      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { list: false, missing: true, yes: false, names: "opener" },
      });

      await config.run();

      expect(mockConfirm).not.toHaveBeenCalled();
      expect(setConfigValue).toHaveBeenCalledWith("opener", "herdr");
    });
  });
});
