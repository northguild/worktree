/** biome-ignore-all lint/suspicious/noExplicitAny: Allow any in tests */
import * as herdr from "../integrations/herdr.js";
import {
  expectCommands,
  mockRun,
  mockRunCapturing,
  mockSpawnDetached,
} from "../test-setup.js";
import { BaseCommand } from "./base-command.js";
import * as cli from "./cli.js";
import * as git from "./git.js";
import type { ConfigName } from "./types.js";

// openWorktreePath is the only method covered here that draws a spinner. Mock it
// so the suite neither writes to the terminal nor depends on a TTY.
const spinnerMocks = vi.hoisted(() => {
  const succeed = vi.fn();
  const fail = vi.fn();
  const warn = vi.fn();
  const start = vi.fn().mockReturnValue({ succeed, fail, warn });
  const oraFactory = vi.fn().mockReturnValue({ start });

  return { succeed, fail, warn, start, oraFactory };
});

vi.mock("ora", () => ({
  default: spinnerMocks.oraFactory,
}));

// BaseCommand is abstract and openWorktreePath is protected, so reaching it needs
// a concrete subclass. oclif requires run(); nothing in this file calls it.
class TestCommand extends BaseCommand {
  async run() {}

  open(path: string) {
    return this.openWorktreePath(path);
  }

  dispatch(path: string, prompt: string) {
    return this.dispatchAgent(path, prompt);
  }
}

describe("openWorktreePath", () => {
  const worktreePath = "/repo/project.worktrees/feature/test";
  let command: TestCommand;

  beforeEach(() => {
    vi.clearAllMocks();
    command = new TestCommand([], { runCommand: vi.fn() } as any);
    // git.ts reads the value through the mocked run(); stub it so the only
    // subprocess call each test sees is the editor launch itself.
    vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("code");
  });

  it("passes the worktree path as one argument, spaces and all", async () => {
    const spacedPath = "/repo/space demo.worktrees/feature/test";
    expectCommands(`code "${spacedPath}"`);
    mockRun.mockResolvedValueOnce("");

    await command.open(spacedPath);

    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRun).toHaveBeenCalledWith("code", [spacedPath]);
    expect(spinnerMocks.oraFactory).toHaveBeenCalledWith("Opening in code");
  });

  it("splits a configured command line into program and leading arguments", async () => {
    expectCommands(`code -n ${worktreePath}`);
    vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("code -n");
    mockRun.mockResolvedValueOnce("");

    await command.open(worktreePath);

    expect(mockRun).toHaveBeenCalledWith("code", ["-n", worktreePath]);
  });

  it("collapses repeated whitespace instead of passing an empty argument", async () => {
    expectCommands(`code -n ${worktreePath}`);
    vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("  code   -n  ");
    mockRun.mockResolvedValueOnce("");

    await command.open(worktreePath);

    expect(mockRun).toHaveBeenCalledWith("code", ["-n", worktreePath]);
  });

  it("succeeds the spinner once the editor has been launched", async () => {
    expectCommands(`code ${worktreePath}`);
    mockRun.mockResolvedValueOnce("");

    await command.open(worktreePath);

    // The launch is not awaited by openWorktreePath, so the spinner settles a
    // microtask after it returns.
    await vi.waitFor(() => expect(spinnerMocks.succeed).toHaveBeenCalled());
    expect(spinnerMocks.fail).not.toHaveBeenCalled();
  });

  it("fails the spinner with the error message when the launch is rejected", async () => {
    expectCommands(`code ${worktreePath}`);
    mockRun.mockRejectedValueOnce(new Error("spawn code ENOENT"));

    await command.open(worktreePath);

    await vi.waitFor(() =>
      expect(spinnerMocks.fail).toHaveBeenCalledWith("spawn code ENOENT"),
    );
    expect(spinnerMocks.succeed).not.toHaveBeenCalled();
  });

  it("keeps a quoted argument together as one argv element", async () => {
    expectCommands(`open -a "Sublime Text" ${worktreePath}`);
    mockRun.mockResolvedValueOnce("");
    vi.spyOn(git, "gitGetConfigValue").mockResolvedValue(
      `open -a "Sublime Text"`,
    );

    await command.open(worktreePath);

    expect(mockRun).toHaveBeenCalledWith("open", [
      "-a",
      "Sublime Text",
      worktreePath,
    ]);
  });

  it("launches nothing when the editor value is only whitespace", async () => {
    vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("   ");
    const logSpy = vi.spyOn(command, "log").mockImplementation(() => {});

    await command.open(worktreePath);

    expect(mockRun).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      `✔ Worktree created in ${worktreePath}`,
    );
  });

  it("logs the path and launches nothing when no editor is configured", async () => {
    vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("");
    const logSpy = vi.spyOn(command, "log").mockImplementation(() => {});

    await command.open(worktreePath);

    expect(mockRun).not.toHaveBeenCalled();
    expect(spinnerMocks.oraFactory).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      `✔ Worktree created in ${worktreePath}`,
    );
  });
});

describe("dispatchAgent", () => {
  const worktreePath = "/repo/project.worktrees/feature/test";
  const prompt = "implement the issue";
  let command: TestCommand;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    command = new TestCommand([], { runCommand: vi.fn() } as any);
    vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("claude --bg");
    logSpy = vi.spyOn(command, "log").mockImplementation(() => {});
  });

  it("splits the configured command line and runs it in the worktree", async () => {
    await command.dispatch(worktreePath, prompt);

    expect(mockSpawnDetached).toHaveBeenCalledTimes(1);
    expect(mockSpawnDetached).toHaveBeenCalledWith(
      "claude",
      ["--bg", prompt],
      expect.objectContaining({ cwd: worktreePath }),
    );
    expect(logSpy).toHaveBeenCalledWith(`✔ Agent started in ${worktreePath}`);
  });

  it("passes a prompt full of quotes as one argument", async () => {
    // No shell parses this value, so a prompt that would need escaping in a
    // command string arrives at the agent byte for byte.
    const quotedPrompt = `fix the 'login' bug in "auth.ts"; don't stop`;

    await command.dispatch(worktreePath, quotedPrompt);

    expect(mockSpawnDetached).toHaveBeenCalledWith(
      "claude",
      ["--bg", quotedPrompt],
      expect.objectContaining({ cwd: worktreePath }),
    );
  });

  it("collapses repeated whitespace instead of passing an empty argument", async () => {
    vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("  claude   --bg  ");

    await command.dispatch(worktreePath, prompt);

    expect(mockSpawnDetached).toHaveBeenCalledWith(
      "claude",
      ["--bg", prompt],
      expect.objectContaining({ cwd: worktreePath }),
    );
  });

  it("runs a bare command with the prompt as its only argument", async () => {
    vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("claude");

    await command.dispatch(worktreePath, prompt);

    expect(mockSpawnDetached).toHaveBeenCalledWith(
      "claude",
      [prompt],
      expect.objectContaining({ cwd: worktreePath }),
    );
  });

  it("points at the config command and starts nothing when no agent is configured", async () => {
    vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("");

    await command.dispatch(worktreePath, prompt);

    expect(mockSpawnDetached).not.toHaveBeenCalled();
    // The form named here has to be one that does something: `worktree config
    // <name>` with no value reads the key and discards it (config.ts:273-274).
    expect(logSpy).toHaveBeenCalledWith(
      'No agent configured. Run worktree config agent.command "<command>" to set one.',
    );
  });

  it("treats a whitespace-only command as no agent rather than spawning nothing", async () => {
    // The head is what spawn receives, and spawn("") throws synchronously —
    // which would take the editor launch down with it.
    vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("   ");

    await command.dispatch(worktreePath, prompt);

    expect(mockSpawnDetached).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      'No agent configured. Run worktree config agent.command "<command>" to set one.',
    );
  });

  it("reports a failed launch through the error handler it registers", async () => {
    await command.dispatch(worktreePath, prompt);

    // The launch is fire-and-forget, so a missing binary can only surface
    // through the handler passed to spawnDetached.
    const { onError } = mockSpawnDetached.mock.calls[0][2];
    onError(new Error("spawn claude ENOENT"));

    expect(logSpy).toHaveBeenCalledWith("Error: spawn claude ENOENT");
  });
});

// The Herdr opener. Separate from the editor suite above because the seam reads
// `opener` before anything else, so these tests answer per key rather than
// stubbing one value for every key.
describe("openWorktreePath — the Herdr opener", () => {
  const gitRootPath = "/tmp/a b";
  const worktreePath = "/tmp/a b/c";
  let command: TestCommand;
  let mockLog: ReturnType<typeof vi.spyOn>;

  function openWorktreePath(path: string): Promise<void> {
    return command.open(path);
  }

  /**
   * Answers per key, rather than one value for every key. The seam reads
   * `opener` before anything else, so a blanket `mockResolvedValue` would hand
   * the editor's command string back as the opener kind and route by accident.
   */
  function setConfig(values: Partial<Record<ConfigName, string>>) {
    vi.spyOn(git, "gitGetConfigValue").mockImplementation(
      async (name: ConfigName) => values[name] ?? "",
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    command = new TestCommand([], { runCommand: vi.fn() } as any);
    mockLog = vi.spyOn(command, "log").mockImplementation(() => {});
  });

  describe("the herdr opener", () => {
    let mockOpenHerdrWorktree: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.spyOn(git, "gitGetRootPath").mockResolvedValue(gitRootPath);
      vi.spyOn(git, "gitGetAbsoluteWorktreesPath").mockResolvedValue(
        `${gitRootPath}.worktrees`,
      );
      mockOpenHerdrWorktree = vi
        .spyOn(herdr, "openHerdrWorktree")
        .mockResolvedValue({
          workspaceId: "wF",
          paneId: "pF1",
          alreadyOpen: false,
        });
    });

    it("opens the space with the branch as its label and focus on", async () => {
      setConfig({ opener: "herdr" });

      await openWorktreePath(`${gitRootPath}.worktrees/feature/a thing`);

      expect(mockOpenHerdrWorktree).toHaveBeenCalledWith({
        path: `${gitRootPath}.worktrees/feature/a thing`,
        gitRootPath,
        label: "feature/a thing",
        focus: true,
      });
      expect(mockRunCapturing).not.toHaveBeenCalled();
      expect(spinnerMocks.succeed).toHaveBeenCalledWith(
        "Opened Herdr space feature/a thing",
      );
    });

    it("turns focus off when herdr.focus is false", async () => {
      setConfig({ opener: "herdr", "herdr.focus": "false" });

      await openWorktreePath(worktreePath);

      expect(mockOpenHerdrWorktree).toHaveBeenCalledWith(
        expect.objectContaining({ focus: false }),
      );
    });

    it("says so when the space was already open", async () => {
      setConfig({ opener: "herdr" });
      mockOpenHerdrWorktree.mockResolvedValue({
        workspaceId: "wF",
        paneId: "pF1",
        alreadyOpen: true,
      });

      await openWorktreePath(`${gitRootPath}.worktrees/chore/tidy`);

      expect(spinnerMocks.succeed).toHaveBeenCalledWith(
        "Herdr space chore/tidy was already open",
      );
    });

    it("ignores codeEditor entirely", async () => {
      setConfig({ opener: "herdr", codeEditor: "code" });

      await openWorktreePath(worktreePath);

      expect(mockOpenHerdrWorktree).toHaveBeenCalled();
      expect(mockRunCapturing).not.toHaveBeenCalled();
    });

    it("prints Herdr's code and message and the path, and opens no editor", async () => {
      setConfig({ opener: "herdr", codeEditor: "code" });
      mockOpenHerdrWorktree.mockRejectedValue(
        new herdr.HerdrError("worktree_not_found", "worktree not found"),
      );

      await openWorktreePath(worktreePath);

      expect(spinnerMocks.fail).toHaveBeenCalledWith(
        "Herdr: worktree not found (worktree_not_found)",
      );
      expect(mockLog).toHaveBeenCalledWith(
        `The worktree is at ${worktreePath}`,
      );
      // D5: no consolation editor window, and no success tick either.
      expect(mockRunCapturing).not.toHaveBeenCalled();
      expect(spinnerMocks.succeed).not.toHaveBeenCalled();
    });

    it("reports an absent herdr binary without contacting it", async () => {
      setConfig({ opener: "herdr", codeEditor: "code" });
      vi.spyOn(cli, "commandExists").mockResolvedValueOnce(false);

      await openWorktreePath(worktreePath);

      expect(mockOpenHerdrWorktree).not.toHaveBeenCalled();
      expect(spinnerMocks.fail).toHaveBeenCalledWith(
        "Herdr: `herdr` was not found on your PATH.",
      );
      expect(mockLog).toHaveBeenCalledWith(
        `The worktree is at ${worktreePath}`,
      );
      expect(mockRunCapturing).not.toHaveBeenCalled();
    });

    it("falls back to the last path segment for a worktree outside the layout", async () => {
      setConfig({ opener: "herdr" });

      await openWorktreePath("/somewhere/else/detached");

      expect(mockOpenHerdrWorktree).toHaveBeenCalledWith(
        expect.objectContaining({ label: "detached" }),
      );
    });

    describe("the optional agent", () => {
      const spacePath = `${gitRootPath}.worktrees/feature/a thing`;

      // `startHerdrAgent` is deliberately left unmocked here, so what these
      // assert is the argv that would reach the `herdr` binary — the seam's
      // decision and the integration's assembly of it, together.
      function mockAgentStarted() {
        mockRunCapturing.mockResolvedValue({
          stdout: JSON.stringify({
            id: "cli:agent:start",
            result: {
              type: "agent_started",
              argv: ["claude"],
              agent: { pane_id: "pF1", agent_status: "idle" },
            },
          }),
          stderr: "",
          exitCode: 0,
        });
      }

      it("starts the configured kind in the pane the space was built around", async () => {
        setConfig({ opener: "herdr", "herdr.agent": "claude" });
        mockAgentStarted();

        await openWorktreePath(spacePath);

        expect(mockRunCapturing).toHaveBeenCalledWith("herdr", [
          "agent",
          "start",
          "feature-a-thing",
          "--kind",
          "claude",
          "--pane",
          "pF1",
          "--timeout",
          "15000",
        ]);
        expect(spinnerMocks.succeed).toHaveBeenCalledWith(
          "Started claude as feature-a-thing",
        );
      });

      it("issues no agent-start argv when herdr.agent is unset", async () => {
        setConfig({ opener: "herdr" });

        await openWorktreePath(spacePath);

        // D9: 22 kinds and no canonical one, and `agent start` blocks until the
        // agent answers — nobody pays for it who did not ask for it.
        expect(mockRunCapturing).not.toHaveBeenCalled();
      });

      it("issues no agent-start argv when the space was already open", async () => {
        setConfig({ opener: "herdr", "herdr.agent": "claude" });
        mockOpenHerdrWorktree.mockResolvedValue({
          workspaceId: "wF",
          paneId: "pF1",
          alreadyOpen: true,
        });

        await openWorktreePath(spacePath);

        // The agent the user left running is still in that pane.
        expect(mockRunCapturing).not.toHaveBeenCalled();
      });

      it("warns but still reports the space as opened when the agent fails to start", async () => {
        setConfig({ opener: "herdr", "herdr.agent": "claude" });
        mockRunCapturing.mockResolvedValue({
          stdout: "",
          stderr: JSON.stringify({
            error: {
              code: "agent_name_in_use",
              message: "agent feature-a-thing is already running",
            },
            id: "cli:agent:start",
          }),
          exitCode: 1,
        });

        await openWorktreePath(spacePath);

        expect(spinnerMocks.warn).toHaveBeenCalledWith(
          "Herdr: agent feature-a-thing is already running (agent_name_in_use)",
        );
        // The space is open and correct by this point, so the open stands (§5).
        expect(spinnerMocks.succeed).toHaveBeenCalledWith(
          "Opened Herdr space feature/a thing",
        );
        expect(spinnerMocks.fail).not.toHaveBeenCalled();
        expect(mockLog).not.toHaveBeenCalledWith(
          `The worktree is at ${spacePath}`,
        );
      });

      it("derives a name Herdr accepts from a branch it would otherwise reject", async () => {
        setConfig({ opener: "herdr", "herdr.agent": "claude" });
        mockAgentStarted();

        await openWorktreePath(`${gitRootPath}.worktrees/178-automate`);

        expect(mockRunCapturing).toHaveBeenCalledWith(
          "herdr",
          expect.arrayContaining(["wt-178-automate"]),
        );
      });
    });
  });
});
