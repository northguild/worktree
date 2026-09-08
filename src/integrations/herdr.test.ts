import * as cli from "../lib/cli.js";
import {
  HerdrError,
  isHerdrInstalled,
  openHerdrWorktree,
  startHerdrAgent,
  toHerdrAgentName,
} from "./herdr.js";

const mockRunCommand = vi.mocked(cli.runCommand);

const worktreePath =
  "/Users/baldur/Development/northguild/worktree/worktree.worktrees/feature/herdr-space-opener";
const gitRootPath = "/Users/baldur/Development/northguild/worktree/worktree";
const branchName = "feature/herdr-space-opener";

/**
 * A `worktree_opened` success envelope, carrying every field protocol 20 marks
 * required so the narrowing is exercised against the real shape rather than
 * against only the three fields it reads.
 */
function makeWorktreeOpenedEnvelope(alreadyOpen: boolean): string {
  return JSON.stringify({
    id: "cli:worktree:open",
    result: {
      type: "worktree_opened",
      already_open: alreadyOpen,
      workspace: {
        workspace_id: "wF",
        number: 6,
        label: branchName,
        focused: true,
        pane_count: 1,
        tab_count: 1,
        active_tab_id: "tF1",
        agent_status: "idle",
      },
      tab: {
        tab_id: "tF1",
        workspace_id: "wF",
        number: 1,
        label: "shell",
        focused: true,
        pane_count: 1,
        agent_status: "idle",
      },
      root_pane: {
        pane_id: "pF1",
        terminal_id: "term-f1",
        workspace_id: "wF",
        tab_id: "tF1",
        focused: true,
        agent_status: "idle",
        revision: 1,
      },
      worktree: {
        branch: branchName,
        is_bare: false,
        is_detached: false,
        is_linked_worktree: true,
        is_prunable: false,
        label: branchName,
        path: worktreePath,
      },
    },
  });
}

function makeErrorEnvelope(code: string, message: string): string {
  return JSON.stringify({ error: { code, message }, id: "cli:worktree:open" });
}

function openThisWorktree(focus = true) {
  return openHerdrWorktree({
    path: worktreePath,
    gitRootPath,
    label: branchName,
    focus,
  });
}

describe("isHerdrInstalled", () => {
  it("is true when the binary is on PATH", async () => {
    await expect(isHerdrInstalled()).resolves.toBe(true);
  });

  it("is false when the herdr binary is not installed", async () => {
    // Once, not for the rest of the suite: src/test-setup.ts's factory mock has
    // no implementation reset between tests, so a persistent `false` here would
    // short-circuit every test below and leave them unable to fail.
    vi.spyOn(cli, "commandExists").mockResolvedValueOnce(false);

    await expect(isHerdrInstalled()).resolves.toBe(false);
  });

  it("spawns no process of its own to answer", async () => {
    // The `herdr status server --json` probe was dropped (F-003): liveness is
    // `openHerdrWorktree`'s business, so nothing here may cost an extra spawn.
    await isHerdrInstalled();

    expect(mockRunCommand).not.toHaveBeenCalled();
  });
});

describe("openHerdrWorktree", () => {
  it("passes the path, cwd, label and an explicit focus flag", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: makeWorktreeOpenedEnvelope(false),
      stderr: "",
      exitCode: 0,
    });

    await expect(openThisWorktree()).resolves.toEqual({
      workspaceId: "wF",
      paneId: "pF1",
      alreadyOpen: false,
    });
    expect(mockRunCommand).toHaveBeenCalledWith("herdr", [
      "worktree",
      "open",
      "--path",
      worktreePath,
      "--cwd",
      gitRootPath,
      "--label",
      branchName,
      "--focus",
    ]);
  });

  it("sends --no-focus when focus is off", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: makeWorktreeOpenedEnvelope(false),
      stderr: "",
      exitCode: 0,
    });

    await openThisWorktree(false);

    expect(mockRunCommand).toHaveBeenCalledWith(
      "herdr",
      expect.arrayContaining(["--no-focus"]),
    );
    expect(mockRunCommand).not.toHaveBeenCalledWith(
      "herdr",
      expect.arrayContaining(["--focus"]),
    );
  });

  it("reports a space that was already open", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: makeWorktreeOpenedEnvelope(true),
      stderr: "",
      exitCode: 0,
    });

    await expect(openThisWorktree()).resolves.toMatchObject({
      alreadyOpen: true,
    });
  });

  it("surfaces a stderr error envelope as a HerdrError carrying the code", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "",
      stderr: makeErrorEnvelope(
        "worktree_not_found",
        `worktree ${worktreePath} not found`,
      ),
      exitCode: 1,
    });

    const error = await openThisWorktree().catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(HerdrError);
    expect(error).toMatchObject({ code: "worktree_not_found" });
    expect(error).toHaveProperty(
      "message",
      `Herdr: worktree ${worktreePath} not found (worktree_not_found)`,
    );
  });

  it("surfaces a non-zero exit that is not an error envelope verbatim", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "",
      stderr: "herdr: could not connect to the server socket",
      exitCode: 2,
    });

    await expect(openThisWorktree()).rejects.toThrow(
      "Herdr: `herdr worktree open --path",
    );
    await expect(openThisWorktree()).rejects.toThrow(
      "exited with code 2: herdr: could not connect to the server socket",
    );
  });

  it("rejects when the success envelope carries no result", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: JSON.stringify({ id: "cli:worktree:open" }),
      stderr: "",
      exitCode: 0,
    });

    await expect(openThisWorktree()).rejects.toThrow("returned no result");
  });

  it("rejects when the result is missing the fields it reads", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: JSON.stringify({
        id: "cli:worktree:open",
        result: { type: "worktree_opened", already_open: false },
      }),
      stderr: "",
      exitCode: 0,
    });

    await expect(openThisWorktree()).rejects.toThrow(
      "Herdr: `worktree open` returned no workspace id.",
    );
  });

  it("rejects when stdout is not JSON", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "not json at all",
      stderr: "",
      exitCode: 0,
    });

    await expect(openThisWorktree()).rejects.toThrow(
      "could not parse response as JSON: not json at all",
    );
  });
});

describe("toHerdrAgentName", () => {
  it.each`
    branch                                                  | expected                              | description
    ${"feature/herdr-space-opener"}                         | ${"feature-herdr-space-opener"}       | ${"a slash becomes a separator rather than vanishing"}
    ${"178-automate-package-publishing"}                    | ${"wt-178-automate-package-publishi"} | ${"a leading digit is prefixed, keeping the ticket number that tells branches apart"}
    ${"feature/a-really-long-branch-name-that-keeps-going"} | ${"feature-a-really-long-branch-nam"} | ${"longer than 32 characters is truncated"}
    ${"Feature/ABC-123"}                                    | ${"feature-abc-123"}                  | ${"uppercase is folded"}
    ${"feature/a thing"}                                    | ${"feature-a-thing"}                  | ${"a space is a separator"}
    ${"fix/oops!!!/again"}                                  | ${"fix-oops-again"}                   | ${"a run of illegal characters collapses to one separator"}
    ${"release/2026.09.08"}                                 | ${"release-2026-09-08"}               | ${"dots are separators"}
    ${"chore/tidy/"}                                        | ${"chore-tidy"}                       | ${"a trailing separator is trimmed"}
    ${"///"}                                                | ${"worktree"}                         | ${"a branch with nothing usable in it still yields a name"}
  `(
    'derives "$expected" from "$branch" ($description)',
    ({ branch, expected }) => {
      expect(toHerdrAgentName(branch)).toBe(expected);
    },
  );

  it.each([
    "feature/herdr-space-opener",
    "178-automate-package-publishing",
    "feature/a-really-long-branch-name-that-keeps-going",
    "Feature/ABC-123",
    "feature/a thing",
    "fix/oops!!!/again",
    "release/2026.09.08",
    "chore/tidy/",
    "///",
    "-",
    "9",
    "x",
  ])('always answers with a name Herdr accepts, for "%s"', (branch) => {
    // `[a-z][a-z0-9_-]{0,31}`, per `herdr --skill`. Asserted separately from
    // the exact strings above so a change to the derivation cannot quietly
    // start producing names Herdr will refuse.
    expect(toHerdrAgentName(branch)).toMatch(/^[a-z][a-z0-9_-]{0,31}$/);
  });

  it("does not collapse two branches that differ only in their ticket number", () => {
    // §5 names collisions as what goes wrong here, which is why the leading
    // digit is prefixed rather than stripped.
    expect(toHerdrAgentName("178-automate")).not.toBe(
      toHerdrAgentName("179-automate"),
    );
  });
});

describe("startHerdrAgent", () => {
  /** An `agent_started` result, per protocol 20: `type`, `agent` and `argv`. */
  function makeAgentStartedEnvelope(): string {
    return JSON.stringify({
      id: "cli:agent:start",
      result: {
        type: "agent_started",
        argv: ["claude"],
        agent: {
          pane_id: "pF1",
          agent: "claude",
          agent_status: "idle",
          name: "feature-herdr-space-opener",
          focused: true,
          interactive_ready: true,
          launch_pending: false,
        },
      },
    });
  }

  function startAgent() {
    return startHerdrAgent({
      name: "feature-herdr-space-opener",
      kind: "claude",
      paneId: "pF1",
    });
  }

  it("passes the name, kind, pane and an explicit timeout", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: makeAgentStartedEnvelope(),
      stderr: "",
      exitCode: 0,
    });

    await expect(startAgent()).resolves.toBeUndefined();
    expect(mockRunCommand).toHaveBeenCalledWith("herdr", [
      "agent",
      "start",
      "feature-herdr-space-opener",
      "--kind",
      "claude",
      "--pane",
      "pF1",
      "--timeout",
      "15000",
    ]);
  });

  it("asks for a timeout Herdr accepts and shorter than its own default", async () => {
    // `AgentStartParams.timeout_ms`: greater than 3000, at most 300000. The
    // default is 30000, and §5 asks for less than that because the call is
    // awaited after the worktree already exists.
    mockRunCommand.mockResolvedValue({
      stdout: makeAgentStartedEnvelope(),
      stderr: "",
      exitCode: 0,
    });

    await startAgent();

    const args = mockRunCommand.mock.calls[0]?.[1] as string[];
    const timeout = Number(args[args.indexOf("--timeout") + 1]);

    expect(timeout).toBeGreaterThan(3000);
    expect(timeout).toBeLessThan(30000);
  });

  it("surfaces a stderr error envelope as a HerdrError carrying the code", async () => {
    mockRunCommand.mockResolvedValue({
      stdout: "",
      stderr: makeErrorEnvelope(
        "agent_name_in_use",
        "agent feature-herdr-space-opener is already running",
      ),
      exitCode: 1,
    });

    const error = await startAgent().catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(HerdrError);
    expect(error).toMatchObject({ code: "agent_name_in_use" });
  });
});
