/** biome-ignore-all lint/suspicious/noExplicitAny: Allow any in tests */
import * as herdr from "../integrations/herdr.js";
import { BaseCommand } from "./base-command.js";
import * as cli from "./cli.js";
import * as git from "./git.js";
import type { ConfigName } from "./types.js";

const spinnerMocks = vi.hoisted(() => {
  const succeed = vi.fn();
  const fail = vi.fn();
  const warn = vi.fn();
  const start = vi.fn().mockReturnValue({ succeed, fail, warn });
  const oraFactory = vi.fn().mockReturnValue({ start });

  return {
    succeed,
    fail,
    warn,
    start,
    oraFactory,
  };
});

vi.mock("ora", () => ({
  default: spinnerMocks.oraFactory,
}));

class TestCommand extends BaseCommand {
  async run() {}
}

describe("openWorktreePath", () => {
  const gitRootPath = "/tmp/a b";
  const worktreePath = "/tmp/a b/c";
  let command: TestCommand;
  let mockLog: ReturnType<typeof vi.spyOn>;
  const mockRunCommand = vi.mocked(cli.runCommand);

  function openWorktreePath(path: string): Promise<void> {
    return (command as any).openWorktreePath(path);
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
    const mockConfig = {
      runCommand: vi.fn().mockResolvedValue(undefined),
    } as any;
    command = new TestCommand([], mockConfig);
    mockLog = vi.spyOn(command, "log").mockImplementation(() => {});
  });

  describe("the editor opener", () => {
    it("passes a path containing a space as a single argument", async () => {
      setConfig({ codeEditor: "code" });

      await openWorktreePath(worktreePath);

      expect(mockRunCommand).toHaveBeenCalledWith("code", ["/tmp/a b/c"]);
    });

    it("keeps a multi-word editor value working as executable plus arguments", async () => {
      setConfig({ codeEditor: "herdr worktree open --focus --path" });

      await openWorktreePath(worktreePath);

      expect(mockRunCommand).toHaveBeenCalledWith("herdr", [
        "worktree",
        "open",
        "--focus",
        "--path",
        worktreePath,
      ]);
    });

    it("logs the path and launches nothing when no editor is configured", async () => {
      setConfig({});

      await openWorktreePath(worktreePath);

      expect(mockRunCommand).not.toHaveBeenCalled();
      expect(mockLog).toHaveBeenCalledWith(
        `✔ Worktree created in ${worktreePath}`,
      );
    });

    it("is what an explicit opener of editor selects", async () => {
      setConfig({ opener: "editor", codeEditor: "code" });

      await openWorktreePath(worktreePath);

      expect(mockRunCommand).toHaveBeenCalledWith("code", [worktreePath]);
    });

    it("succeeds the spinner when the editor exits zero", async () => {
      setConfig({ codeEditor: "code" });

      await openWorktreePath(worktreePath);

      expect(spinnerMocks.oraFactory).toHaveBeenCalledWith("Opening in code");
      await vi.waitFor(() => expect(spinnerMocks.succeed).toHaveBeenCalled());
      expect(spinnerMocks.fail).not.toHaveBeenCalled();
    });

    it("fails the spinner with stderr when the editor exits non-zero", async () => {
      setConfig({ codeEditor: "code" });
      mockRunCommand.mockResolvedValue({
        stdout: "",
        stderr: "code: command failed",
        exitCode: 1,
      });

      await openWorktreePath(worktreePath);

      await vi.waitFor(() =>
        expect(spinnerMocks.fail).toHaveBeenCalledWith("code: command failed"),
      );
      expect(spinnerMocks.succeed).not.toHaveBeenCalled();
    });

    it("fails the spinner when the editor cannot be spawned", async () => {
      setConfig({ codeEditor: "code" });
      mockRunCommand.mockRejectedValue(new Error("spawn code ENOENT"));

      await openWorktreePath(worktreePath);

      await vi.waitFor(() =>
        expect(spinnerMocks.fail).toHaveBeenCalledWith("spawn code ENOENT"),
      );
      expect(spinnerMocks.succeed).not.toHaveBeenCalled();
    });
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
      expect(mockRunCommand).not.toHaveBeenCalled();
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
      expect(mockRunCommand).not.toHaveBeenCalled();
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
      expect(mockRunCommand).not.toHaveBeenCalled();
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
      expect(mockRunCommand).not.toHaveBeenCalled();
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
        mockRunCommand.mockResolvedValue({
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

        expect(mockRunCommand).toHaveBeenCalledWith("herdr", [
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
        expect(mockRunCommand).not.toHaveBeenCalled();
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
        expect(mockRunCommand).not.toHaveBeenCalled();
      });

      it("warns but still reports the space as opened when the agent fails to start", async () => {
        setConfig({ opener: "herdr", "herdr.agent": "claude" });
        mockRunCommand.mockResolvedValue({
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

        expect(mockRunCommand).toHaveBeenCalledWith(
          "herdr",
          expect.arrayContaining(["wt-178-automate"]),
        );
      });
    });
  });
});
