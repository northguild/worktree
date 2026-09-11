import * as cli from "../lib/cli.js";
import {
  closeHerdrWorkspace,
  HerdrError,
  isHerdrInstalled,
  listHerdrWorktrees,
  openHerdrWorktree,
  startHerdrAgent,
  toHerdrAgentName,
} from "./herdr.js";

const mockRunCapturing = vi.mocked(cli.runCapturing);

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

/** The `timeout` a given runCapturing call was bounded with, if any. */
function timeoutOf(callIndex: number): number | undefined {
  const options = mockRunCapturing.mock.calls[callIndex]?.[2] as
    | { timeout?: number }
    | undefined;
  return options?.timeout;
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
    // The `herdr status server --json` probe was dropped (F-040): liveness is
    // `openHerdrWorktree`'s business, so nothing here may cost an extra spawn.
    await isHerdrInstalled();

    expect(mockRunCapturing).not.toHaveBeenCalled();
  });
});

describe("openHerdrWorktree", () => {
  it("passes the path, cwd, label and an explicit focus flag", async () => {
    mockRunCapturing.mockResolvedValue({
      stdout: makeWorktreeOpenedEnvelope(false),
      stderr: "",
      exitCode: 0,
    });

    await expect(openThisWorktree()).resolves.toEqual({
      workspaceId: "wF",
      paneId: "pF1",
      alreadyOpen: false,
    });
    expect(mockRunCapturing).toHaveBeenCalledWith(
      "herdr",
      [
        "worktree",
        "open",
        "--path",
        worktreePath,
        "--cwd",
        gitRootPath,
        "--label",
        branchName,
        "--focus",
      ],
      { timeout: expect.any(Number) },
    );
  });

  it("sends --no-focus when focus is off", async () => {
    mockRunCapturing.mockResolvedValue({
      stdout: makeWorktreeOpenedEnvelope(false),
      stderr: "",
      exitCode: 0,
    });

    await openThisWorktree(false);

    expect(mockRunCapturing).toHaveBeenCalledWith(
      "herdr",
      expect.arrayContaining(["--no-focus"]),
      expect.anything(),
    );
    expect(mockRunCapturing).not.toHaveBeenCalledWith(
      "herdr",
      expect.arrayContaining(["--focus"]),
      expect.anything(),
    );
  });

  it("reports a space that was already open", async () => {
    mockRunCapturing.mockResolvedValue({
      stdout: makeWorktreeOpenedEnvelope(true),
      stderr: "",
      exitCode: 0,
    });

    await expect(openThisWorktree()).resolves.toMatchObject({
      alreadyOpen: true,
    });
  });

  it("surfaces a stderr error envelope as a HerdrError carrying the code", async () => {
    mockRunCapturing.mockResolvedValue({
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
    mockRunCapturing.mockResolvedValue({
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
    mockRunCapturing.mockResolvedValue({
      stdout: JSON.stringify({ id: "cli:worktree:open" }),
      stderr: "",
      exitCode: 0,
    });

    await expect(openThisWorktree()).rejects.toThrow("returned no result");
  });

  it("rejects when the result is missing the fields it reads", async () => {
    mockRunCapturing.mockResolvedValue({
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
    mockRunCapturing.mockResolvedValue({
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
    mockRunCapturing.mockResolvedValue({
      stdout: makeAgentStartedEnvelope(),
      stderr: "",
      exitCode: 0,
    });

    await expect(startAgent()).resolves.toBeUndefined();
    expect(mockRunCapturing).toHaveBeenCalledWith(
      "herdr",
      [
        "agent",
        "start",
        "feature-herdr-space-opener",
        "--kind",
        "claude",
        "--pane",
        "pF1",
        "--timeout",
        "15000",
      ],
      { timeout: expect.any(Number) },
    );
  });

  it("asks for a timeout Herdr accepts and shorter than its own default", async () => {
    // `AgentStartParams.timeout_ms`: greater than 3000, at most 300000. The
    // default is 30000, and §5 asks for less than that because the call is
    // awaited after the worktree already exists.
    mockRunCapturing.mockResolvedValue({
      stdout: makeAgentStartedEnvelope(),
      stderr: "",
      exitCode: 0,
    });

    await startAgent();

    const args = mockRunCapturing.mock.calls[0]?.[1] as string[];
    const timeout = Number(args[args.indexOf("--timeout") + 1]);

    expect(timeout).toBeGreaterThan(3000);
    expect(timeout).toBeLessThan(30000);
  });

  it("bounds the call at longer than the wait it asks Herdr to make", async () => {
    // Herdr holds `agent start` open for the `--timeout` this sends while the
    // agent boots. A local bound at or below that number would kill the call
    // while Herdr was doing exactly what it was asked to, so the two are
    // ordered rather than equal — which is what catches a future edit that
    // collapses them onto a single constant.
    mockRunCapturing.mockResolvedValue({
      stdout: makeAgentStartedEnvelope(),
      stderr: "",
      exitCode: 0,
    });

    await startAgent();

    const args = mockRunCapturing.mock.calls[0]?.[1] as string[];
    const herdrWait = Number(args[args.indexOf("--timeout") + 1]);

    expect(timeoutOf(0)).toBeGreaterThan(herdrWait);
  });

  it("surfaces a stderr error envelope as a HerdrError carrying the code", async () => {
    mockRunCapturing.mockResolvedValue({
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

/**
 * A `worktree_list` success envelope, captured verbatim from the live 0.8.2
 * server on 2026-09-11 and then extended with the two shapes that capture could
 * not produce on its own:
 *
 * - `wt/no-space`, a checkout Herdr has no space open for. Forced with a
 *   throwaway `git worktree add --detach` and re-listed: the key is **omitted
 *   entirely**, not set to `null` — and the same entry omitted `branch` too,
 *   being detached. More of the schema is optional in practice than the plan's
 *   §3 capture suggested, which is why the narrowing reads two fields and
 *   ignores the rest.
 * - `wt/null-space`, the `null` D9 originally assumed. Kept alongside the
 *   omission so a future server that starts sending it is still handled.
 */
function makeWorktreeListEnvelope(): string {
  return JSON.stringify({
    id: "cli:worktree:list",
    result: {
      type: "worktree_list",
      source: {
        repo_key: `${gitRootPath}/.git`,
        repo_name: "worktree",
        repo_root: gitRootPath,
        source_checkout_path: gitRootPath,
        source_workspace_id: "w5",
      },
      worktrees: [
        {
          branch: "main",
          is_bare: false,
          is_detached: false,
          is_linked_worktree: false,
          is_prunable: false,
          label: "worktree",
          open_workspace_id: "w5",
          path: gitRootPath,
        },
        {
          branch: branchName,
          is_bare: false,
          is_detached: false,
          is_linked_worktree: true,
          is_prunable: false,
          label: "worktree",
          open_workspace_id: "wQ",
          path: worktreePath,
        },
        {
          is_bare: false,
          is_detached: true,
          is_linked_worktree: true,
          is_prunable: false,
          label: "worktree",
          path: "/tmp/wt/no-space",
        },
        {
          branch: "chore/tidy",
          is_bare: false,
          is_detached: false,
          is_linked_worktree: true,
          is_prunable: false,
          label: "worktree",
          open_workspace_id: null,
          path: "/tmp/wt/null-space",
        },
      ],
    },
  });
}

function makeListResult(worktrees: unknown[], source?: unknown): string {
  return JSON.stringify({
    id: "cli:worktree:list",
    result: { type: "worktree_list", source, worktrees },
  });
}

function listWorktrees() {
  return listHerdrWorktrees({ gitRootPath });
}

describe("listHerdrWorktrees", () => {
  beforeEach(() => {
    mockRunCapturing.mockResolvedValue({
      stdout: makeWorktreeListEnvelope(),
      stderr: "",
      exitCode: 0,
    });
  });

  it("asks for this repository's worktrees by git root, and nothing else", async () => {
    // `--cwd` is the whole point: without it Herdr resolves against whichever
    // space was last focused, which on a machine with several repos open is not
    // this one.
    await listWorktrees();

    expect(mockRunCapturing).toHaveBeenCalledWith(
      "herdr",
      ["worktree", "list", "--cwd", gitRootPath],
      { timeout: expect.any(Number) },
    );
    expect(mockRunCapturing).toHaveBeenCalledTimes(1);
  });

  it("narrows each entry to its path and the space it is open in", async () => {
    await expect(listWorktrees()).resolves.toEqual({
      sourceWorkspaceId: "w5",
      worktrees: [
        { path: gitRootPath, workspaceId: "w5" },
        { path: worktreePath, workspaceId: "wQ" },
        { path: "/tmp/wt/no-space", workspaceId: undefined },
        { path: "/tmp/wt/null-space", workspaceId: undefined },
      ],
    });
  });

  it("reports no workspace id for a checkout that has no space open", async () => {
    // D9, verified: the key is absent rather than null, and a caller must be
    // able to tell that apart from a space it should close.
    const { worktrees } = await listWorktrees();

    expect(worktrees[2]?.workspaceId).toBeUndefined();
    expect(worktrees[3]?.workspaceId).toBeUndefined();
  });

  it("keeps the source workspace id, which is what the caller must not close", async () => {
    // D7. The repository's own checkout is in the listing like any other, and
    // `source.source_workspace_id` names it a second time.
    await expect(listWorktrees()).resolves.toMatchObject({
      sourceWorkspaceId: "w5",
    });
  });

  it("reports no source workspace for a repository Herdr has never opened", async () => {
    // Verified 2026-09-11: a fresh `git init` lists successfully, exit 0, with
    // no `source_workspace_id` anywhere. Someone with opener=herdr who has
    // never opened this repo in Herdr must not get a warning on every remove.
    mockRunCapturing.mockResolvedValue({
      stdout: makeListResult([{ path: "/tmp/unseen", is_bare: false }], {
        repo_name: "unseen",
        repo_root: "/tmp/unseen",
      }),
      stderr: "",
      exitCode: 0,
    });

    await expect(listWorktrees()).resolves.toEqual({
      sourceWorkspaceId: undefined,
      worktrees: [{ path: "/tmp/unseen", workspaceId: undefined }],
    });
  });

  it("treats an empty workspace id as no space rather than something to close", async () => {
    mockRunCapturing.mockResolvedValue({
      stdout: makeListResult([
        { path: "/tmp/wt/empty", open_workspace_id: "" },
      ]),
      stderr: "",
      exitCode: 0,
    });

    const { worktrees } = await listWorktrees();

    expect(worktrees[0]?.workspaceId).toBeUndefined();
  });

  it("answers with an empty list rather than throwing when there are no worktrees", async () => {
    mockRunCapturing.mockResolvedValue({
      stdout: makeListResult([]),
      stderr: "",
      exitCode: 0,
    });

    await expect(listWorktrees()).resolves.toEqual({
      sourceWorkspaceId: undefined,
      worktrees: [],
    });
  });

  it("rejects when the result carries no worktrees array", async () => {
    mockRunCapturing.mockResolvedValue({
      stdout: JSON.stringify({
        id: "cli:worktree:list",
        result: { type: "worktree_list" },
      }),
      stderr: "",
      exitCode: 0,
    });

    await expect(listWorktrees()).rejects.toThrow(
      "Herdr: `worktree list` returned no worktrees array.",
    );
  });

  it("rejects an entry with no path rather than dropping it silently", async () => {
    // A dropped entry is a space left open with nothing said about it, which
    // is the orphan this feature exists to prevent.
    mockRunCapturing.mockResolvedValue({
      stdout: makeListResult([
        { path: worktreePath, open_workspace_id: "wQ" },
        { open_workspace_id: "wR", branch: "chore/tidy" },
      ]),
      stderr: "",
      exitCode: 0,
    });

    await expect(listWorktrees()).rejects.toThrow(
      "returned a worktree with no path at index 1",
    );
  });

  it("rejects an entry that is not an object", async () => {
    mockRunCapturing.mockResolvedValue({
      stdout: makeListResult(["not a worktree"]),
      stderr: "",
      exitCode: 0,
    });

    await expect(listWorktrees()).rejects.toThrow(
      "returned a worktree that is not an object at index 0",
    );
  });

  it("surfaces a stderr error envelope as a HerdrError carrying the code", async () => {
    mockRunCapturing.mockResolvedValue({
      stdout: "",
      stderr: makeErrorEnvelope(
        "not_a_git_repository",
        `${gitRootPath} is not a git repository`,
      ),
      exitCode: 1,
    });

    const error = await listWorktrees().catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(HerdrError);
    expect(error).toMatchObject({ code: "not_a_git_repository" });
  });
});

describe("closeHerdrWorkspace", () => {
  /**
   * What a close actually answers with. `workspace.close` has no result variant
   * of its own in the bundled API schema (`herdr api schema --json`, protocol
   * 20) — it takes a `WorkspaceTarget` and answers `{"type":"ok"}` — but
   * `result` is required on every success response, which is what
   * `runHerdrRequest` insists on.
   */
  function makeOkEnvelope(): string {
    return JSON.stringify({
      id: "cli:workspace:close",
      result: { type: "ok" },
    });
  }

  it("passes the workspace id as a bare positional", async () => {
    // D1: `herdr workspace close <workspace_id>`, one positional and no
    // options. Not `herdr worktree remove --workspace`, which would ask Herdr
    // to delete a checkout that is already gone.
    mockRunCapturing.mockResolvedValue({
      stdout: makeOkEnvelope(),
      stderr: "",
      exitCode: 0,
    });

    await expect(closeHerdrWorkspace("wQ")).resolves.toBeUndefined();
    expect(mockRunCapturing).toHaveBeenCalledWith(
      "herdr",
      ["workspace", "close", "wQ"],
      { timeout: expect.any(Number) },
    );
  });

  it("resolves on the generic ok result a close answers with", async () => {
    mockRunCapturing.mockResolvedValue({
      stdout: makeOkEnvelope(),
      stderr: "",
      exitCode: 0,
    });

    await expect(closeHerdrWorkspace("wQ")).resolves.toBeUndefined();
  });

  it("surfaces a stderr error envelope as a HerdrError carrying the code", async () => {
    // The seam branches on `code`, never on the message — a space closed
    // between the lookup and the close is the expected race (§5) and must
    // arrive as something a caller can recognise.
    mockRunCapturing.mockResolvedValue({
      stdout: "",
      stderr: makeErrorEnvelope(
        "workspace_not_found",
        "workspace wQ not found",
      ),
      exitCode: 1,
    });

    const error = await closeHerdrWorkspace("wQ").catch(
      (thrown: unknown) => thrown,
    );

    expect(error).toBeInstanceOf(HerdrError);
    expect(error).toMatchObject({ code: "workspace_not_found" });
    expect(error).toHaveProperty(
      "message",
      "Herdr: workspace wQ not found (workspace_not_found)",
    );
  });
});

/**
 * F-041: every Herdr call here is awaited, so an unresponsive server freezes
 * the command that spawned it. These pin that the bound exists rather than its
 * value — a number re-typed in a test is a number nobody may tune — with one
 * deliberate exception: F-052 closed on the printed line naming the wait, so
 * `10s` is asserted below and again in `src/lib/base-command.test.ts`. Tuning
 * HERDR_REQUEST_TIMEOUT_MS means editing both (F-053).
 *
 * Those three ids are this feature's own and live on issue #52, not in
 * `context/findings.md` — F-052 and F-053 were reused there by findings that
 * arrived with the 2026-09-11 triage.
 */
describe("the request timeout", () => {
  it("bounds a worktree open", async () => {
    mockRunCapturing.mockResolvedValue({
      stdout: makeWorktreeOpenedEnvelope(false),
      stderr: "",
      exitCode: 0,
    });

    await openThisWorktree();

    const timeout = timeoutOf(0);

    expect(timeout).toBeGreaterThan(0);
    expect(Number.isFinite(timeout)).toBe(true);
  });

  /** The shape Node reports for a child it killed when the timeout expired. */
  function makeKilledError(): Error {
    return Object.assign(new Error("Command failed: herdr worktree open"), {
      killed: true,
      signal: "SIGTERM",
      code: null,
    });
  }

  it("reports a timed-out call as a timeout, naming the command and the wait", async () => {
    // Node's own message for a killed child is `Command failed: <argv>`, which
    // says nothing about a timeout. The seam prints `error.message` verbatim,
    // so the rewording has to happen here or the user is told only that
    // something failed (F-052).
    mockRunCapturing.mockRejectedValue(makeKilledError());

    const error = await openThisWorktree().catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/did not answer within 10s\.$/);
    expect((error as Error).message).toContain("herdr worktree open");
    // It is not reshaped into a parse failure for the stdout that never came.
    expect((error as Error).message).not.toMatch(/parse/i);
  });

  it("keeps the killed child as the cause", async () => {
    const killed = makeKilledError();
    mockRunCapturing.mockRejectedValue(killed);

    const error = await openThisWorktree().catch((thrown: unknown) => thrown);

    expect((error as Error).cause).toBe(killed);
  });

  it("bounds a worktree list", async () => {
    mockRunCapturing.mockResolvedValue({
      stdout: makeListResult([]),
      stderr: "",
      exitCode: 0,
    });

    await listHerdrWorktrees({ gitRootPath });

    expect(timeoutOf(0)).toBeGreaterThan(0);
  });

  it("bounds a workspace close, which runs after the checkout is already gone", async () => {
    // The worst call to leave unbounded: by the time it runs the worktree is
    // deleted, so there is nothing to retry and nothing to do but interrupt.
    mockRunCapturing.mockResolvedValue({
      stdout: JSON.stringify({
        id: "cli:workspace:close",
        result: { type: "ok" },
      }),
      stderr: "",
      exitCode: 0,
    });

    await closeHerdrWorkspace("wQ");

    expect(timeoutOf(0)).toBeGreaterThan(0);
  });

  it("passes a rejection that is not a timeout through untouched", async () => {
    // An absent binary or a maxBuffer overflow already says what went wrong;
    // only the kill is reworded, so this must not be relabelled a timeout.
    const enoent = Object.assign(new Error("spawn herdr ENOENT"), {
      code: "ENOENT",
    });
    mockRunCapturing.mockRejectedValue(enoent);

    await expect(openThisWorktree()).rejects.toBe(enoent);
  });
});
