/** biome-ignore-all lint/suspicious/noExplicitAny: Allow any in tests */
import { confirm, input } from "@inquirer/prompts";
import * as git from "../lib/git.js";
import * as validators from "../lib/validators.js";
import Config from "./config.js";

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  input: vi.fn(),
}));

describe("config command", () => {
  let config: Config;
  let mockConsoleLog: ReturnType<typeof vi.spyOn>;
  const mockInput = vi.mocked(input);
  const mockConfirm = vi.mocked(confirm);

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
        if (key === "opener") return Promise.resolve("herdr");
        if (key === "herdr.focus") return Promise.resolve("false");
        if (key === "herdr.agent") return Promise.resolve("claude");
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
      expect(mockConsoleLog).toHaveBeenCalledWith("opener=herdr");
      expect(mockConsoleLog).toHaveBeenCalledWith("herdr.focus=false");
      expect(mockConsoleLog).toHaveBeenCalledWith("herdr.agent=claude");
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
      expect(mockConsoleLog).toHaveBeenCalledWith("opener");
      expect(mockConsoleLog).toHaveBeenCalledWith("herdr.focus");
      expect(mockConsoleLog).toHaveBeenCalledWith("herdr.agent");
      expect(mockConsoleLog).toHaveBeenCalledWith("defaultSourceBranch");
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
    it("should prompt for all branch prefix variables when user confirms", async () => {
      mockConfirm.mockResolvedValue(true);
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

      expect(mockConfirm).toHaveBeenCalledWith({
        message: "Do you want to configure branch name prefixes?",
      });
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

    it("should skip branch prefix prompts when user declines", async () => {
      mockConfirm.mockResolvedValue(false);

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

      expect(mockConfirm).toHaveBeenCalledWith({
        message: "Do you want to configure branch name prefixes?",
      });
      expect(mockInput).not.toHaveBeenCalled();
    });

    it("should skip the confirmation prompt when --yes is set", async () => {
      mockInput
        .mockResolvedValueOnce("feature/")
        .mockResolvedValueOnce("fix/")
        .mockResolvedValueOnce("chore/");

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: {
          list: false,
          missing: false,
          yes: true,
          names: "branchPrefix.feature,branchPrefix.bugfix,branchPrefix.chore",
        },
      });

      await config.run();

      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockInput).toHaveBeenCalledTimes(3);
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

  describe("opener prompts", () => {
    it("should set both opener and herdr.focus from a prompt run", async () => {
      mockInput.mockResolvedValueOnce("herdr").mockResolvedValueOnce("false");
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

      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Which opener should new worktrees use? (editor or herdr)",
          default: "editor",
          prefill: "tab",
          validate: validators.isValidOpener,
        }),
      );
      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Should opening a worktree focus its Herdr space?",
          default: "true",
          prefill: "tab",
          validate: validators.isValidBoolean,
        }),
      );
      expect(mockSetConfigValue).toHaveBeenCalledWith("opener", "herdr");
      expect(mockSetConfigValue).toHaveBeenCalledWith("herdr.focus", "false");
    });

    it("should skip both prompts when the user declines", async () => {
      mockConfirm.mockResolvedValue(false);

      (config as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: {
          list: false,
          missing: false,
          yes: false,
          names: "opener,herdr.focus",
        },
      });

      await config.run();

      expect(mockConfirm).toHaveBeenCalledWith({
        message: "Do you want to choose where new worktrees are opened?",
      });
      expect(mockConfirm).toHaveBeenCalledWith({
        message: "Do you want to configure Herdr space options?",
      });
      expect(mockInput).not.toHaveBeenCalled();
    });

    it("should pre-fill both prompts with the configured values", async () => {
      mockInput.mockResolvedValue("herdr");
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
      expect(mockInput).toHaveBeenCalledWith(
        expect.objectContaining({ default: "false", prefill: "editable" }),
      );
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
});
