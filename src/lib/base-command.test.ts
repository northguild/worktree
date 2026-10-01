/** biome-ignore-all lint/suspicious/noExplicitAny: Allow any in tests */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { confirm } from "@inquirer/prompts";
import { Config } from "@oclif/core";
import * as herdr from "../integrations/herdr.js";
import {
  captureOutput,
  expectCommands,
  mockRun,
  mockRunCapturing,
  mockSpawnDetached,
} from "../test-setup.js";
import {
  AGENT_BRIEF_MAX_BYTES,
  BaseCommand,
  type OpenWorktreeOptions,
  readAgentBrief,
} from "./base-command.js";
import * as cli from "./cli.js";
import * as git from "./git.js";
import { isNonInteractive, setNonInteractive } from "./interaction.js";
import { MissingValueError } from "./prompt.js";
import { redactSecrets } from "./redact.js";
import type { ConfigName } from "./types.js";

// openWorktreePath is the only method covered here that draws a spinner. Mock it
// so the suite neither writes to the terminal nor depends on a TTY.
const spinnerMocks = vi.hoisted(() => {
  const succeed = vi.fn();
  const fail = vi.fn();
  const warn = vi.fn();
  // The closer's lookup spinner is stopped rather than resolved: it covers
  // preparation the user did not ask to watch, and only says anything when it
  // fails.
  const stop = vi.fn();
  const start = vi.fn().mockReturnValue({ succeed, fail, warn, stop });
  const oraFactory = vi.fn().mockReturnValue({ start });

  return { succeed, fail, warn, stop, start, oraFactory };
});

vi.mock("@inquirer/prompts", () => ({ confirm: vi.fn() }));

vi.mock("ora", () => ({
  default: spinnerMocks.oraFactory,
}));

// BaseCommand is abstract and openWorktreePath is protected, so reaching it needs
// a concrete subclass. oclif requires run(); nothing in this file calls it.
class TestCommand extends BaseCommand {
  async run() {}

  open(path: string, options?: OpenWorktreeOptions) {
    return this.openWorktreePath(path, options);
  }

  dispatch(path: string, prompt: string) {
    return this.dispatchAgent(path, prompt);
  }

  closer() {
    return this.resolveSpaceCloser();
  }

  verify(names?: ConfigName[]) {
    return this.verifyConfig(names);
  }

  catchError(error: Error) {
    return this.catch(error);
  }

  raise(message: string): never {
    return this.error(message);
  }
}

describe("openWorktreePath", () => {
  const worktreePath = "/repo/project.worktrees/feature/test";
  let command: TestCommand;

  /**
   * Answers per key, rather than one value for every key. The seam reads
   * `opener` before anything else, so a blanket `mockResolvedValue` would hand
   * the editor's command string back as the opener kind — these tests would
   * still reach the editor, but only because "code" is not "herdr", which is
   * not what they mean to assert.
   */
  function setConfig(values: Partial<Record<ConfigName, string>>) {
    vi.spyOn(git, "gitGetConfigValue").mockImplementation(
      async (name: ConfigName) => values[name] ?? "",
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    command = new TestCommand([], { runCommand: vi.fn() } as any);
    // git.ts reads the value through the mocked run(); stub it so the only
    // subprocess call each test sees is the editor launch itself.
    setConfig({ codeEditor: "code" });
  });

  it("opens nothing and prints the path when opener is none", async () => {
    setConfig({ opener: "none", codeEditor: "code" });
    const logSpy = vi.spyOn(command, "log").mockImplementation(() => {});

    await command.open(worktreePath);

    expect(logSpy).toHaveBeenCalledWith(`Worktree created at ${worktreePath}`);
    expect(mockRun).not.toHaveBeenCalled();
    expect(spinnerMocks.start).not.toHaveBeenCalled();
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
    setConfig({ codeEditor: "code -n" });
    mockRun.mockResolvedValueOnce("");

    await command.open(worktreePath);

    expect(mockRun).toHaveBeenCalledWith("code", ["-n", worktreePath]);
  });

  it("collapses repeated whitespace instead of passing an empty argument", async () => {
    expectCommands(`code -n ${worktreePath}`);
    setConfig({ codeEditor: "  code   -n  " });
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

  it("keeps the interim herdr workaround working as executable plus arguments", async () => {
    // The §2 constraint: multi-word `codeEditor` values are in the wild
    // precisely because this one worked before `opener` existed, and it has to
    // go on working for anyone who has not migrated.
    const workaround = "herdr worktree open --focus --path";
    expectCommands(`herdr worktree open --focus --path ${worktreePath}`);
    setConfig({ codeEditor: workaround });
    mockRun.mockResolvedValueOnce("");

    await command.open(worktreePath);

    expect(mockRun).toHaveBeenCalledWith("herdr", [
      "worktree",
      "open",
      "--focus",
      "--path",
      worktreePath,
    ]);
  });

  it("is what an explicit opener of editor selects", async () => {
    expectCommands(`code ${worktreePath}`);
    setConfig({ opener: "editor", codeEditor: "code" });
    mockRun.mockResolvedValueOnce("");

    await command.open(worktreePath);

    expect(mockRun).toHaveBeenCalledWith("code", [worktreePath]);
  });

  it("keeps a quoted argument together as one argv element", async () => {
    expectCommands(`open -a "Sublime Text" ${worktreePath}`);
    mockRun.mockResolvedValueOnce("");
    setConfig({ codeEditor: `open -a "Sublime Text"` });

    await command.open(worktreePath);

    expect(mockRun).toHaveBeenCalledWith("open", [
      "-a",
      "Sublime Text",
      worktreePath,
    ]);
  });

  it("launches nothing when the editor value is only whitespace", async () => {
    setConfig({ codeEditor: "   " });
    const logSpy = vi.spyOn(command, "log").mockImplementation(() => {});

    await command.open(worktreePath);

    expect(mockRun).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      `✔ Worktree created in ${worktreePath}`,
    );
  });

  it("logs the path and launches nothing when no editor is configured", async () => {
    setConfig({});
    const logSpy = vi.spyOn(command, "log").mockImplementation(() => {});

    await command.open(worktreePath);

    expect(mockRun).not.toHaveBeenCalled();
    expect(spinnerMocks.oraFactory).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      `✔ Worktree created in ${worktreePath}`,
    );
  });
});

describe("openWorktreePath — the editor and none openers", () => {
  const worktreePath = "/repo/project.worktrees/feature/test";
  let command: TestCommand;
  let logSpy: ReturnType<typeof vi.spyOn>;

  function setConfig(values: Partial<Record<ConfigName, string>>) {
    vi.spyOn(git, "gitGetConfigValue").mockImplementation(
      async (name: ConfigName) => values[name] ?? "",
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    command = new TestCommand([], { runCommand: vi.fn() } as any);
    logSpy = vi.spyOn(command, "log").mockImplementation(() => {});
    mockRun.mockResolvedValue("");
  });

  it("makes no editor call for --no-open, and reports opener none", async () => {
    setConfig({ opener: "editor", codeEditor: "code" });

    const outcome = await command.open(worktreePath, { open: false });

    expect(mockRun).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(`Worktree created at ${worktreePath}`);
    expect(outcome).toEqual({ opener: "none", agent: undefined });
  });

  it("dispatches the brief detached when the opener is not Herdr", async () => {
    setConfig({
      opener: "editor",
      codeEditor: "code",
      "agent.command": "claude",
    });

    expectCommands(`code ${worktreePath}`);

    const outcome = await command.open(worktreePath, { brief: "do it" });

    expect(mockSpawnDetached).toHaveBeenCalledWith(
      "claude",
      ["do it"],
      expect.objectContaining({ cwd: worktreePath }),
    );
    expect(outcome).toMatchObject({
      opener: "editor",
      agent: { name: null, command: ["claude"], prompted: true },
    });
  });

  it("dispatches no agent for --no-agent, but still opens the editor", async () => {
    setConfig({
      opener: "editor",
      codeEditor: "code",
      "agent.command": "claude",
    });

    expectCommands(`code ${worktreePath}`);

    const outcome = await command.open(worktreePath, {
      agent: false,
      brief: "do it",
    });

    expect(mockSpawnDetached).not.toHaveBeenCalled();
    expect(mockRun).toHaveBeenCalledWith("code", [worktreePath]);
    expect(outcome.agent).toBeUndefined();
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
  let mockLogToStderr: ReturnType<typeof vi.spyOn>;

  function openWorktreePath(path: string, options?: OpenWorktreeOptions) {
    return command.open(path, options);
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
    mockLogToStderr = vi
      .spyOn(command, "logToStderr")
      .mockImplementation(() => {});
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

    // F-052 / F-041: the bound on the Herdr calls exists so a server that
    // accepts the socket and never answers stops the command instead of hanging
    // it. What the user is left with is whatever this prints, so it is pinned
    // here — the string, not just the fact that something failed.
    //
    // The spy on openHerdrWorktree is restored for this one case: the point is
    // that the wording src/integrations/herdr.ts puts on a killed child is what
    // reaches the screen, and a stub returning a pre-worded message would prove
    // only that the seam echoes what it was handed.
    it("says the call timed out, and how long it waited, when Herdr never answers", async () => {
      mockOpenHerdrWorktree.mockRestore();
      setConfig({ opener: "herdr", codeEditor: "code" });
      mockRunCapturing.mockRejectedValue(
        Object.assign(new Error("Command failed: herdr worktree open"), {
          killed: true,
          signal: "SIGTERM",
          code: null,
        }),
      );

      await openWorktreePath(worktreePath);

      const printed = spinnerMocks.fail.mock.calls[0]?.[0] as string;

      expect(printed).toMatch(/did not answer within 10s\./);
      expect(printed).toContain("herdr worktree open");
      // The bare `Command failed: <argv>` Node produces for a killed child
      // names neither the timeout nor its length, and that is the regression
      // this guards: an edit that stops rewording the kill lands back on it,
      // while the docs promise the command prints what Herdr said.
      expect(printed).not.toMatch(/^Command failed:/);
      expect(mockLog).toHaveBeenCalledWith(
        `The worktree is at ${worktreePath}`,
      );
      // D5 holds for a timeout exactly as for a refusal: no consolation editor
      // window, no success tick, and the command still exits 0.
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

        expect(mockRunCapturing).toHaveBeenCalledWith(
          "herdr",
          [
            "agent",
            "start",
            "feature-a-thing",
            "--kind",
            "claude",
            "--pane",
            "pF1",
            "--timeout",
            "15000",
            "--",
            "--name",
            "a-b-feature-a-thing",
          ],
          // The bound the integration puts on its own subprocess, which is a
          // different thing from the `--timeout` above that Herdr is asked to
          // wait. src/integrations/herdr.test.ts owns the relationship between
          // the two; this only has to not care what the number is.
          { timeout: expect.any(Number) },
        );
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
          expect.anything(),
        );
      });

      describe("one agent per tree, with the brief", () => {
        const brief = "line one\n\nline $(touch pwned); 'two'";

        /** The argv of every `herdr agent …` call, in order. */
        function agentCalls(): string[][] {
          return mockRunCapturing.mock.calls
            .map((call) => call[1] as string[])
            .filter((args) => args[0] === "agent");
        }

        function startArgs(): string[] {
          const args = agentCalls().find((call) => call[1] === "start") ?? [];
          return args.slice(args.indexOf("--") + 1);
        }

        it("delivers the brief only through `agent prompt`, never `agent start`", async () => {
          setConfig({ opener: "herdr", "herdr.agent": "claude" });
          mockAgentStarted();

          await openWorktreePath(spacePath, { brief });

          const [start, prompt, ...rest] = agentCalls();

          expect(start?.slice(0, 2)).toEqual(["agent", "start"]);
          expect(start?.join("\u0000")).not.toContain("line one");
          expect(prompt).toEqual(["agent", "prompt", "pF1", brief]);
          expect(rest).toEqual([]);
          expect(prompt).not.toContain("--wait");
        });

        it("starts no detached agent beside the one Herdr started", async () => {
          setConfig({
            opener: "herdr",
            "herdr.agent": "claude",
            "agent.command": "claude --bg",
          });
          mockAgentStarted();

          await openWorktreePath(spacePath, { brief });

          expect(mockSpawnDetached).not.toHaveBeenCalled();
        });

        it("drops --bg and --background from agent.command, and says so on stderr", async () => {
          setConfig({
            opener: "herdr",
            "herdr.agent": "claude",
            "agent.command": "claude --bg --model opus --background",
          });
          mockAgentStarted();

          await openWorktreePath(spacePath, { brief });

          expect(startArgs()).toEqual([
            "--model",
            "opus",
            "--name",
            "a-b-feature-a-thing",
          ]);
          expect(mockLogToStderr).toHaveBeenCalledWith(
            expect.stringContaining("Dropped --bg/--background"),
          );
        });

        it("names a claude session with the whole branch, however long", async () => {
          const branch = `70-${"a".repeat(97)}`;
          setConfig({ opener: "herdr", "herdr.agent": "claude" });
          mockAgentStarted();

          const outcome = await openWorktreePath(
            `${gitRootPath}.worktrees/${branch}`,
            { brief },
          );

          expect(branch).toHaveLength(100);
          expect(startArgs()).toEqual(["--name", `a-b-${branch}`]);
          expect(outcome.agent?.name).toBe(`a-b-${branch}`);
          // Herdr's own handle keeps its 32-character cap.
          const handle = agentCalls()[0]?.[2] ?? "";
          expect(handle.length).toBeLessThanOrEqual(32);
          expect(mockLogToStderr).toHaveBeenCalledWith(
            `Agent session name: a-b-${branch}`,
          );
        });

        it("takes the kind from agent.command when herdr.agent is unset", async () => {
          setConfig({
            opener: "herdr",
            "agent.command": "/usr/local/bin/claude --bg --model opus",
          });
          mockAgentStarted();

          await openWorktreePath(spacePath, { brief });

          const start = agentCalls()[0] ?? [];
          expect(start[start.indexOf("--kind") + 1]).toBe("claude");
          expect(startArgs()).toEqual([
            "--model",
            "opus",
            "--name",
            "a-b-feature-a-thing",
          ]);
        });

        it("reuses agent.command's arguments only when its head is the kind", async () => {
          setConfig({
            opener: "herdr",
            "herdr.agent": "codex",
            "agent.command": "claude --model opus",
          });
          mockAgentStarted();

          await openWorktreePath(spacePath, { brief });

          expect(agentCalls()[0]).not.toContain("--");
          expect(agentCalls()[1]).toEqual(["agent", "prompt", "pF1", brief]);
        });

        it("adds no --name for a kind other than claude", async () => {
          setConfig({
            opener: "herdr",
            "herdr.agent": "codex",
            "agent.command": "codex --full-auto",
          });
          mockAgentStarted();

          const outcome = await openWorktreePath(spacePath, { brief });

          expect(startArgs()).toEqual(["--full-auto"]);
          expect(outcome.agent?.name).toBeNull();
        });

        it("fails naming herdr.agent, before opening a space, when a brief has no kind", async () => {
          setConfig({ opener: "herdr" });

          const error = await openWorktreePath(spacePath, { brief }).catch(
            (thrown: unknown) => thrown,
          );

          expect(error).toBeInstanceOf(MissingValueError);
          expect((error as Error).message).toBe(
            "no default for the agent kind; pass `worktree config herdr.agent <kind>`",
          );
          expect(mockOpenHerdrWorktree).not.toHaveBeenCalled();
          expect(mockSpawnDetached).not.toHaveBeenCalled();
        });

        it("starts nothing, and does not fail, with no kind and no brief", async () => {
          // `agent.command` alone must not start an agent without a brief.
          setConfig({ opener: "herdr", "agent.command": "claude --bg" });

          const outcome = await openWorktreePath(spacePath);

          expect(mockRunCapturing).not.toHaveBeenCalled();
          expect(outcome.agent).toBeUndefined();
        });

        it("warns, and reports the brief as not delivered, when the prompt fails", async () => {
          setConfig({ opener: "herdr", "herdr.agent": "claude" });
          const warn = vi
            .spyOn(command, "warn")
            .mockImplementation((input) => input);
          mockRunCapturing.mockResolvedValueOnce({
            stdout: JSON.stringify({ id: "cli:agent:start", result: {} }),
            stderr: "",
            exitCode: 0,
          });
          mockRunCapturing.mockResolvedValueOnce({
            stdout: "",
            stderr: JSON.stringify({
              error: { code: "agent_blocked", message: "agent is blocked" },
            }),
            exitCode: 1,
          });

          const outcome = await openWorktreePath(spacePath, { brief });

          expect(warn).toHaveBeenCalledWith(
            expect.stringContaining("the brief was not delivered"),
          );
          expect(outcome.agent?.prompted).toBe(false);
          expect(mockSpawnDetached).not.toHaveBeenCalled();
        });

        it("falls back to the detached dispatch only when Herdr did not open", async () => {
          setConfig({ opener: "herdr", "agent.command": "claude --bg" });
          mockOpenHerdrWorktree.mockRejectedValue(
            new herdr.HerdrError("server_down", "no server"),
          );
          vi.spyOn(command, "logToStderr").mockImplementation(() => {});

          const outcome = await openWorktreePath(spacePath, { brief });

          expect(mockSpawnDetached).toHaveBeenCalledWith(
            "claude",
            ["--bg", brief],
            expect.objectContaining({ cwd: spacePath }),
          );
          expect(outcome.herdr).toBeUndefined();
          expect(outcome.agent).toMatchObject({ name: null, prompted: true });
        });

        it("warns, and starts no second agent, when the space was already open", async () => {
          setConfig({ opener: "herdr", "herdr.agent": "claude" });
          const warn = vi
            .spyOn(command, "warn")
            .mockImplementation((input) => input);
          mockOpenHerdrWorktree.mockResolvedValue({
            workspaceId: "wF",
            paneId: "pF1",
            alreadyOpen: true,
          });

          await openWorktreePath(spacePath, { brief });

          expect(warn).toHaveBeenCalledWith(
            expect.stringContaining("brief was not delivered"),
          );
          expect(mockRunCapturing).not.toHaveBeenCalled();
          expect(mockSpawnDetached).not.toHaveBeenCalled();
        });

        it("opens the space but starts no agent for --no-agent", async () => {
          setConfig({
            opener: "herdr",
            "herdr.agent": "claude",
            "agent.command": "claude --bg",
          });

          const outcome = await openWorktreePath(spacePath, {
            agent: false,
            brief,
          });

          expect(mockOpenHerdrWorktree).toHaveBeenCalled();
          expect(mockRunCapturing).not.toHaveBeenCalled();
          expect(mockSpawnDetached).not.toHaveBeenCalled();
          expect(outcome).toEqual({
            opener: "herdr",
            herdr: { space: "wF", pane: "pF1", agent: null },
            agent: undefined,
          });
        });

        it("reports the space, pane, Herdr handle and agent as the outcome", async () => {
          setConfig({ opener: "herdr", "herdr.agent": "claude" });
          mockAgentStarted();

          const outcome = await openWorktreePath(spacePath, { brief });

          expect(outcome).toEqual({
            opener: "herdr",
            herdr: { space: "wF", pane: "pF1", agent: "feature-a-thing" },
            agent: {
              name: "a-b-feature-a-thing",
              kind: "claude",
              command: ["claude", "--name", "a-b-feature-a-thing"],
              prompted: true,
            },
          });
        });

        it("makes no Herdr or editor call for --no-open, and prints the path", async () => {
          setConfig({
            opener: "herdr",
            "herdr.agent": "claude",
            codeEditor: "code",
          });
          const isInstalled = vi.spyOn(herdr, "isHerdrInstalled");

          const outcome = await openWorktreePath(spacePath, {
            open: false,
            agent: false,
          });

          expect(isInstalled).not.toHaveBeenCalled();
          expect(mockOpenHerdrWorktree).not.toHaveBeenCalled();
          expect(mockRunCapturing).not.toHaveBeenCalled();
          expect(mockRun).not.toHaveBeenCalled();
          expect(mockLog).toHaveBeenCalledWith(
            `Worktree created at ${spacePath}`,
          );
          expect(outcome).toEqual({ opener: "none", agent: undefined });
        });
      });
    });
  });
});

/**
 * The closer seam: what it resolves before anything is removed, and what it
 * closes afterwards.
 *
 * Two constraints shape every case here. **Nothing may reach Herdr for a user
 * who did not ask for it** (§2) — which is why the negative cases assert on the
 * integration spies and on `mockRunCapturing`, not just on the absence of a
 * close. And **a failure here may never fail the command** (D5): by the time
 * the closer runs the worktrees are deleted, the branches are gone and
 * `git worktree prune` has run, so there is nothing left to retry.
 */
describe("resolveSpaceCloser", () => {
  const gitRootPath = "/repo/project";
  const worktreesRootPath = `${gitRootPath}.worktrees`;
  const onePath = `${worktreesRootPath}/feature/one`;
  const twoPath = `${worktreesRootPath}/feature/two`;
  const noSpacePath = `${worktreesRootPath}/feature/no-space`;

  let command: TestCommand;
  let mockList: ReturnType<typeof vi.spyOn>;
  let mockClose: ReturnType<typeof vi.spyOn>;
  let mockInstalled: ReturnType<typeof vi.spyOn>;

  function setConfig(values: Partial<Record<ConfigName, string>>) {
    vi.spyOn(git, "gitGetConfigValue").mockImplementation(
      async (name: ConfigName) => values[name] ?? "",
    );
  }

  /**
   * The repository as Herdr sees it: its own checkout, two worktrees with
   * spaces open, and one with none. `w5` is the source workspace — the window
   * the user is sitting in — and D7 says it is never closed.
   */
  function listResolves() {
    mockList.mockResolvedValue({
      sourceWorkspaceId: "w5",
      worktrees: [
        { path: gitRootPath, workspaceId: "w5" },
        { path: onePath, workspaceId: "wQ" },
        { path: twoPath, workspaceId: "wR" },
        { path: noSpacePath, workspaceId: undefined },
      ],
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    command = new TestCommand([], { runCommand: vi.fn() } as any);
    vi.spyOn(command, "log").mockImplementation(() => {});
    vi.spyOn(git, "gitGetRootPath").mockResolvedValue(gitRootPath);
    vi.spyOn(git, "gitGetAbsoluteWorktreesPath").mockResolvedValue(
      worktreesRootPath,
    );
    mockInstalled = vi.spyOn(herdr, "isHerdrInstalled").mockResolvedValue(true);
    mockList = vi.spyOn(herdr, "listHerdrWorktrees");
    mockClose = vi.spyOn(herdr, "closeHerdrWorkspace").mockResolvedValue();
    setConfig({ opener: "herdr" });
    listResolves();
  });

  describe("the gate", () => {
    it.each([
      "",
      "editor",
      "code",
    ])("spawns nothing at all when opener is %o", async (opener) => {
      setConfig({ opener });

      const closeSpaces = await command.closer();
      await closeSpaces([onePath, twoPath]);

      expect(mockInstalled).not.toHaveBeenCalled();
      expect(mockList).not.toHaveBeenCalled();
      expect(mockClose).not.toHaveBeenCalled();
      expect(mockRunCapturing).not.toHaveBeenCalled();
    });

    it("spawns nothing when herdr is not on PATH", async () => {
      // Silent rather than a warning: the open already said so, loudly, and a
      // warning on every remove is noise about something nobody can act on
      // here.
      mockInstalled.mockResolvedValue(false);

      const closeSpaces = await command.closer();
      await closeSpaces([onePath]);

      expect(mockList).not.toHaveBeenCalled();
      expect(mockClose).not.toHaveBeenCalled();
      expect(spinnerMocks.warn).not.toHaveBeenCalled();
    });

    it("looks the spaces up once for the whole run", async () => {
      // cleanup removes a set, so a lookup per worktree would be N subprocesses
      // where one does (D2).
      const closeSpaces = await command.closer();
      await closeSpaces([onePath, twoPath]);

      expect(mockList).toHaveBeenCalledTimes(1);
      expect(mockList).toHaveBeenCalledWith({ gitRootPath });
    });
  });

  describe("what it closes", () => {
    it("closes the space of each worktree it is given", async () => {
      const closeSpaces = await command.closer();
      await closeSpaces([onePath, twoPath]);

      expect(mockClose).toHaveBeenCalledTimes(2);
      expect(mockClose).toHaveBeenCalledWith("wQ");
      expect(mockClose).toHaveBeenCalledWith("wR");
      expect(spinnerMocks.succeed).toHaveBeenCalledWith(
        "Closed Herdr space feature/one",
      );
    });

    it("closes only the worktrees it is given, not every space it found", async () => {
      // The listing knows about wR too. Closing a space whose worktree is still
      // on disk is worse than the orphan this feature exists to prevent (D4).
      const closeSpaces = await command.closer();
      await closeSpaces([onePath]);

      expect(mockClose).toHaveBeenCalledTimes(1);
      expect(mockClose).toHaveBeenCalledWith("wQ");
      expect(mockClose).not.toHaveBeenCalledWith("wR");
    });

    it("says nothing and closes nothing for a worktree with no space open", async () => {
      // D9 — not an error, and not worth a line of output.
      const closeSpaces = await command.closer();
      await closeSpaces([noSpacePath]);

      expect(mockClose).not.toHaveBeenCalled();
      expect(spinnerMocks.warn).not.toHaveBeenCalled();
      expect(spinnerMocks.succeed).not.toHaveBeenCalled();
    });

    it("never closes the source workspace", async () => {
      // D7 — the repository's own checkout is in the listing like any other,
      // and closing it takes down the window the user is sitting in.
      const closeSpaces = await command.closer();
      await closeSpaces([gitRootPath, onePath]);

      expect(mockClose).not.toHaveBeenCalledWith("w5");
      expect(mockClose).toHaveBeenCalledWith("wQ");
    });

    it("spawns no close at all when the repository has no open spaces", async () => {
      mockList.mockResolvedValue({
        sourceWorkspaceId: undefined,
        worktrees: [{ path: onePath, workspaceId: undefined }],
      });

      const closeSpaces = await command.closer();
      await closeSpaces([onePath]);

      expect(mockClose).not.toHaveBeenCalled();
    });
  });

  describe("when something fails", () => {
    it("warns and carries on when one close throws, still closing the rest", async () => {
      // Each space gets its own catch, so one failure does not take the run
      // with it (D5).
      mockClose.mockRejectedValueOnce(
        new herdr.HerdrError("workspace_not_found", "workspace wQ not found"),
      );

      const closeSpaces = await command.closer();

      await expect(closeSpaces([onePath, twoPath])).resolves.toEqual(["wR"]);
      expect(spinnerMocks.warn).toHaveBeenCalledWith(
        "Herdr: workspace wQ not found (workspace_not_found)",
      );
      expect(mockClose).toHaveBeenCalledWith("wR");
    });

    it("warns once and closes nothing when the lookup throws", async () => {
      // All-or-nothing by construction: without the listing there is no
      // path-to-space mapping for anything to act on (F-056).
      mockList.mockRejectedValue(
        new herdr.HerdrError("not_a_git_repository", "not a git repository"),
      );

      const closeSpaces = await command.closer();

      await expect(closeSpaces([onePath, twoPath])).resolves.toEqual([]);
      expect(spinnerMocks.warn).toHaveBeenCalledTimes(1);
      expect(mockClose).not.toHaveBeenCalled();
    });

    it("leaves the command's exit path untouched however it fails", async () => {
      // The whole of D5: the worktrees are already deleted, so neither a failed
      // lookup nor a failed close may reject — a non-zero exit would misreport
      // what actually happened.
      mockList.mockRejectedValue(new Error("herdr did not answer"));
      const afterFailedLookup = await command.closer();
      await expect(afterFailedLookup([onePath])).resolves.toEqual([]);

      listResolves();
      mockClose.mockRejectedValue(new Error("herdr did not answer"));
      const afterFailedClose = await command.closer();

      await expect(afterFailedClose([onePath])).resolves.toEqual([]);
    });
  });
});

// `catch` is what turns a thrown error into the process's exit status, so these
// read process.exitCode and the two streams rather than any internal.
describe("catch", () => {
  const originalExitCode = process.exitCode;
  let command: TestCommand;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    command = new TestCommand([], {} as any);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it("prints a plain error to stderr only and exits 1", async () => {
    await command.catchError(new Error("boom"));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toContain("Error: boom");
    expect(logSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
  });

  it("exits 2 for an error raised through this.error", async () => {
    let thrown: unknown;
    try {
      command.raise("bad input");
    } catch (error) {
      thrown = error;
    }

    await command.catchError(thrown as Error);

    expect(errorSpy.mock.calls[0][0]).toContain("Error: bad input");
    expect(process.exitCode).toBe(2);
  });

  it("prints a missing value as the one D2 line and exits 2", async () => {
    await command.catchError(new MissingValueError("the thing", "--thing"));

    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(
      "worktree: no default for the thing; pass --thing",
    );
    expect(logSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(2);
  });

  it("stays silent and exits 0 when the prompt is cancelled", async () => {
    const cancelled = new Error("User force closed the prompt");
    cancelled.name = "ExitPromptError";

    await command.catchError(cancelled);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
  });
});

describe("init — interaction mode", () => {
  const originalCi = process.env.CI;
  const stdinIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");

  async function initWith(argv: string[]) {
    const { Config } = await import("@oclif/core");
    const command = new TestCommand(argv, await Config.load(process.cwd()));
    await command.init();
    return command;
  }

  beforeEach(() => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: true,
      configurable: true,
    });
    delete process.env.CI;
  });

  afterEach(() => {
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

  it("stays interactive for a human at a terminal", async () => {
    expect(await initWith([])).toMatchObject({ nonInteractive: false });
    expect(isNonInteractive()).toBe(false);
  });

  it.each([
    "--non-interactive",
    "--yes",
    "-y",
  ])("resolves %s as non-interactive", async (flag) => {
    expect(await initWith([flag])).toMatchObject({ nonInteractive: true });
    expect(isNonInteractive()).toBe(true);
  });

  it("resolves CI as non-interactive, but not CI=false", async () => {
    process.env.CI = "true";
    expect(await initWith([])).toMatchObject({ nonInteractive: true });
    process.env.CI = "false";
    expect(await initWith([])).toMatchObject({ nonInteractive: false });
  });
});

describe("verifyConfig", () => {
  const mockConfirm = vi.mocked(confirm);
  let runCommand: ReturnType<typeof vi.fn>;
  let command: TestCommand;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  // `defaultSourceBranch` is the missing one; the first-time flag is set.
  beforeEach(() => {
    runCommand = vi.fn().mockResolvedValue(undefined);
    command = new TestCommand([], { runCommand } as any);
    warnSpy = vi.spyOn(command, "warn").mockImplementation((input) => input);
    vi.spyOn(git, "gitGetConfigValue").mockImplementation((name: string) =>
      Promise.resolve(name === "has-called-config" ? "true" : ""),
    );
  });

  it("offers config, and runs it for the named keys without --yes, for a human", async () => {
    mockConfirm.mockResolvedValue(true);

    await command.verify(["defaultSourceBranch"]);

    expect(mockConfirm).toHaveBeenCalledWith({
      message:
        "Some required configuration values are missing. Do you want to run the config command now?",
    });
    expect(runCommand).toHaveBeenCalledWith("config", [
      "--missing",
      "--names",
      "defaultSourceBranch",
    ]);
  });

  it("offers nothing and names the missing keys when non-interactive", async () => {
    setNonInteractive(true);

    await command.verify(["defaultSourceBranch", "jira.host"]);

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Missing config: defaultSourceBranch, jira.host"),
    );
  });

  it("skips the first-time offer when non-interactive", async () => {
    setNonInteractive(true);
    vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("");

    await command.verify([]);

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(runCommand).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("readAgentBrief", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "worktree-brief-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function stdinOf(chunks: string[], isTTY?: boolean) {
    return Object.assign(Readable.from(chunks), { isTTY });
  }

  it("is undefined when no source was given", async () => {
    await expect(readAgentBrief({})).resolves.toBeUndefined();
  });

  it("returns --agent unchanged", async () => {
    await expect(readAgentBrief({ agent: "  keep\nas is " })).resolves.toBe(
      "  keep\nas is ",
    );
  });

  it("reads a file whole", async () => {
    const file = join(tempDir, "brief.md");
    writeFileSync(file, "# Brief\n\nDo it.\n");

    await expect(readAgentBrief({ agentFile: file })).resolves.toBe(
      "# Brief\n\nDo it.\n",
    );
  });

  it("reads piped stdin whole, across chunks", async () => {
    await expect(
      readAgentBrief({ agentStdin: true }, stdinOf(["part one\n", "part two"])),
    ).resolves.toBe("part one\npart two");
  });

  it("rejects stdin that is a terminal instead of waiting on it", async () => {
    await expect(
      readAgentBrief({ agentStdin: true }, stdinOf([], true)),
    ).rejects.toThrow(/stdin is a terminal/);
  });

  it.each([
    ["--agent", { agent: "" }],
    ["--agent", { agent: "   \n" }],
    ["--agent-stdin", { agentStdin: true }],
  ])("rejects an empty brief from %s", async (_source, sources) => {
    await expect(readAgentBrief(sources, stdinOf([" \n"]))).rejects.toThrow(
      /empty/,
    );
  });

  it("caps the brief where Linux's single-argument limit allows a spawn (#71)", () => {
    // MAX_ARG_STRLEN is 131,072 bytes including the terminating NUL.
    expect(AGENT_BRIEF_MAX_BYTES).toBe(131_071);
  });

  it("accepts a brief of exactly the cap and rejects one byte more", async () => {
    const atCap = "x".repeat(AGENT_BRIEF_MAX_BYTES);

    await expect(readAgentBrief({ agent: atCap })).resolves.toBe(atCap);
    await expect(readAgentBrief({ agent: `${atCap}x` })).rejects.toThrow(
      /over 131071 bytes/,
    );
  });

  it("stops reading stdin once the cap is passed", async () => {
    const chunk = "x".repeat(100 * 1024);

    await expect(
      readAgentBrief(
        { agentStdin: true },
        stdinOf([chunk, chunk, chunk, chunk]),
      ),
    ).rejects.toThrow(/over 131071 bytes/);
  });
});

// A command that supports `--json`, which is how a subclass opts in (D6).
class JsonTestCommand extends TestCommand {
  static override enableJsonFlag = true;

  say(message: string) {
    this.log(message);
  }

  sayToStderr(message: string) {
    this.logToStderr(message);
  }

  noteWarning(message: string) {
    return this.warn(message);
  }

  printJson(document: unknown) {
    this.logJson(document);
  }

  get collected() {
    return this.warnings;
  }
}

describe("--json output", () => {
  const originalExitCode = process.exitCode;
  let output: ReturnType<typeof captureOutput>;
  let command: JsonTestCommand;

  beforeEach(async () => {
    process.exitCode = undefined;
    // Loaded first: oclif warns about the .ts command files it cannot import
    // here, and that is not what these tests are about.
    command = new JsonTestCommand(["--json"], await Config.load(process.cwd()));
    output = captureOutput();
  });

  afterEach(() => {
    output.restore();
    process.exitCode = originalExitCode;
  });

  it("sends log and logToStderr to stderr and nothing to stdout", () => {
    command.say("Worktree created at /tmp/x");
    command.sayToStderr("Agent session name: demo");

    expect(output.stdout()).toBe("");
    expect(output.stderr()).toContain("Worktree created at /tmp/x");
    expect(output.stderr()).toContain("Agent session name: demo");
  });

  it("still logs to stdout when --json was not given", async () => {
    output.restore();
    const plain = new JsonTestCommand([], await Config.load(process.cwd()));
    output = captureOutput();

    plain.say("hello");

    expect(output.stdout()).toContain("hello");
    expect(output.stderr()).toBe("");
  });

  it("prints a document as one uncoloured line", () => {
    command.printJson({ a: 1, b: [null, "x"] });

    expect(output.stdout()).toBe('{"a":1,"b":[null,"x"]}\n');
  });

  it("says a warning on stderr and keeps it for the document", () => {
    command.noteWarning("something odd");

    expect(output.stdout()).toBe("");
    expect(output.stderr()).toContain("Warning: something odd");
    expect(command.collected).toEqual(["something odd"]);
  });

  it("keeps a warning a spinner already printed", () => {
    (command as any).recordWarning("Herdr: gone");

    expect(output.stderr()).toBe("");
    expect(command.collected).toEqual(["Herdr: gone"]);
  });

  it("resolves non-interactive from --json alone", async () => {
    setNonInteractive(false);
    (command as any).parse = vi.fn().mockResolvedValue({ args: {}, flags: {} });

    await command.init();

    expect(isNonInteractive()).toBe(true);
  });

  describe("catch", () => {
    async function failWith(error: Error) {
      await command.catchError(error);
      return output.document() as {
        error: { code: string; message: string; details?: unknown };
      };
    }

    it("prints the failure as the one document, and the line on stderr", async () => {
      const document = await failWith(new Error("boom"));

      expect(document).toEqual({ error: { code: "failed", message: "boom" } });
      expect(output.stdout().trim().split("\n")).toHaveLength(1);
      expect(output.stderr()).toContain("Error: boom");
      expect(process.exitCode).toBe(1);
    });

    it("gives a missing value its code, details and exit 2", async () => {
      const document = await failWith(
        new MissingValueError("the thing", "--thing"),
      );

      expect(document.error).toEqual({
        code: "missing_value",
        message: "no default for the thing; pass --thing",
        details: { value: "the thing", flag: "--thing" },
      });
      expect(process.exitCode).toBe(2);
    });

    it("takes an explicit code from this.error", async () => {
      let thrown: unknown;
      try {
        command.error("nothing there", { code: "not_found" });
      } catch (error) {
        thrown = error;
      }

      expect((await failWith(thrown as Error)).error.code).toBe("not_found");
      expect(process.exitCode).toBe(2);
    });

    it("calls a usage error invalid_value", async () => {
      let thrown: unknown;
      try {
        command.raise("bad input");
      } catch (error) {
        thrown = error;
      }

      expect((await failWith(thrown as Error)).error.code).toBe(
        "invalid_value",
      );
    });

    it.each([
      "GitHub: /repos/o/r/issues/1 did not answer within 15s.",
      "Herdr: herdr agent start did not answer within 60s.",
      "pnpm did not finish within 600s",
    ])("calls %s a timeout", async (message) => {
      expect((await failWith(new Error(message))).error.code).toBe("timeout");
    });

    it("leaves a human's Ctrl-C silent on both streams, exiting 0", async () => {
      const cancelled = new Error("User force closed the prompt");
      cancelled.name = "ExitPromptError";

      await command.catchError(cancelled);

      expect(output.stdout()).toBe("");
      expect(output.stderr()).toBe("");
      expect(process.exitCode).toBeUndefined();
    });

    it("prints no credential from a message that quotes one", async () => {
      const document = await failWith(
        new Error(
          'origin remote "https://octocat:ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/o/r.git"',
        ),
      );

      expect(document.error.message).toBe(
        'origin remote "https://***@github.com/o/r.git"',
      );
      expect(`${output.stdout()}${output.stderr()}`).not.toMatch(
        /octocat|ghp_/,
      );
    });
  });
});

describe("redactSecrets", () => {
  it("hides URL credentials and token shapes, and leaves the rest alone", () => {
    expect(redactSecrets("https://user:pw@host/x")).toBe("https://***@host/x");
    expect(redactSecrets("ssh://git@host/x")).toBe("ssh://***@host/x");
    expect(
      redactSecrets("token github_pat_11ABCDEFG0123456789abcdefghij used"),
    ).toBe("token *** used");
    expect(redactSecrets("git@github.com:acme/demo.git")).toBe(
      "git@github.com:acme/demo.git",
    );
    expect(redactSecrets("plain text")).toBe("plain text");
  });
});
