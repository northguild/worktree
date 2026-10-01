import { mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expectCommands, mockRun, mockRunCapturing } from "../test-setup.js";
import {
  findSessionForPath,
  getAgentSessions,
  isSessionInteractive,
  isSessionLive,
  isSessionWaiting,
} from "./agent.js";
import * as cli from "./cli.js";
import * as git from "./git.js";
import type { AgentSession } from "./types.js";

// Nothing here launches an agent runtime: run() is the globally mocked
// subprocess helper and gitGetConfigValue is stubbed, so the suite passes on a
// machine with no agent CLI installed at all — see AGENT-MODE-PLAN §2.
const worktreePath = "/repo/project.worktrees/feature/test";

function session(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    name: "feature-test-1f",
    pid: 9187,
    cwd: worktreePath,
    ...overrides,
  };
}

function mockSessionsJson(sessions: unknown) {
  expectCommands("claude agents --json");
  mockRun.mockResolvedValueOnce(JSON.stringify(sessions));
}

describe("getAgentSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("claude");
  });

  it("returns every well-formed entry, optional fields included", async () => {
    mockSessionsJson([
      {
        pid: 9187,
        cwd: "/Users/dev/Documents/notes",
        kind: "interactive",
        startedAt: 1788600791123,
        sessionId: "53fac4da",
        name: "notes-1f",
      },
      {
        pid: 33471,
        id: "23f50fae",
        cwd: worktreePath,
        kind: "background",
        status: "idle",
        state: "working",
        name: "feature-test-1f",
      },
    ]);

    const sessions = await getAgentSessions();

    expect(sessions).toEqual([
      {
        name: "notes-1f",
        pid: 9187,
        cwd: "/Users/dev/Documents/notes",
        sessionId: "53fac4da",
        kind: "interactive",
        status: undefined,
        state: undefined,
      },
      {
        name: "feature-test-1f",
        pid: 33471,
        cwd: worktreePath,
        kind: "background",
        status: "idle",
        state: "working",
      },
    ]);
  });

  // The load-bearing assertion of this file. A regression to --all would pass
  // every other test here and only surface as a worktree nobody can delete,
  // because the default listing is what excludes completed sessions. D4/D6.
  it("never asks for completed sessions with --all", async () => {
    mockSessionsJson([]);

    await getAgentSessions();

    expect(mockRun).toHaveBeenCalledWith("claude", ["agents", "--json"], {
      timeout: 10_000,
    });
    expect(mockRun).toHaveBeenCalledTimes(1);
    const [, args] = mockRun.mock.calls[0];
    expect(args).not.toContain("--all");
  });

  it("invokes the head of agent.command, not its dispatch arguments", async () => {
    vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("claude --bg");
    mockSessionsJson([]);

    await getAgentSessions();

    expect(mockRun).toHaveBeenCalledWith("claude", ["agents", "--json"], {
      timeout: 10_000,
    });
  });

  it("returns nothing and runs nothing when agent.command is unset", async () => {
    vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("");

    await expect(getAgentSessions()).resolves.toEqual([]);

    expect(mockRun).not.toHaveBeenCalled();
  });

  it("treats a whitespace-only agent.command as unset", async () => {
    vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("   ");

    await expect(getAgentSessions()).resolves.toEqual([]);

    expect(mockRun).not.toHaveBeenCalled();
  });

  it("returns nothing when the command exits non-zero", async () => {
    expectCommands("claude agents --json");
    mockRun.mockRejectedValueOnce(new Error("Command failed: claude agents"));

    await expect(getAgentSessions()).resolves.toEqual([]);
  });

  it("returns nothing when the command is not installed", async () => {
    expectCommands("claude agents --json");
    mockRun.mockRejectedValueOnce(new Error("spawn claude ENOENT"));

    await expect(getAgentSessions()).resolves.toEqual([]);
  });

  it("returns nothing when stdout is not JSON", async () => {
    expectCommands("claude agents --json");
    mockRun.mockResolvedValueOnce("Usage: claude agents [options]");

    await expect(getAgentSessions()).resolves.toEqual([]);
  });

  it("returns nothing when stdout is empty", async () => {
    expectCommands("claude agents --json");
    mockRun.mockResolvedValueOnce("");

    await expect(getAgentSessions()).resolves.toEqual([]);
  });

  it("returns nothing when the JSON is not an array", async () => {
    mockSessionsJson({ sessions: [] });

    await expect(getAgentSessions()).resolves.toEqual([]);
  });

  it("keeps a session carrying no state, status or kind", async () => {
    mockSessionsJson([
      { name: "feature-test-1f", pid: 9187, cwd: worktreePath },
    ]);

    await expect(getAgentSessions()).resolves.toEqual([
      {
        name: "feature-test-1f",
        pid: 9187,
        cwd: worktreePath,
        kind: undefined,
        status: undefined,
        state: undefined,
      },
    ]);
  });

  it("reads a null status as absent rather than as a value", async () => {
    mockSessionsJson([
      { name: "feature-test-1f", pid: 9187, cwd: worktreePath, status: null },
    ]);

    const [parsed] = await getAgentSessions();

    expect(parsed.status).toBeUndefined();
  });

  it("drops malformed entries and keeps the rest", async () => {
    mockSessionsJson([
      null,
      "not-a-session",
      { name: "no-cwd", pid: 2 },
      { name: "empty-cwd", pid: 3, cwd: "" },
      { name: "feature-test-1f", pid: 9187, cwd: worktreePath },
    ]);

    const sessions = await getAgentSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.name).toBe("feature-test-1f");
  });

  // F-021. The runtime omits `pid` on a background session it has no process
  // for, and dropping the entry would read as "nobody is working here".
  it("keeps a session with no pid", async () => {
    mockSessionsJson([
      {
        cwd: worktreePath,
        id: "23f50fae",
        kind: "background",
        name: "feature-test-1f",
        sessionId: "s-1",
        startedAt: 1788600791123,
        state: "blocked",
      },
    ]);

    const [parsed] = await getAgentSessions();

    expect(parsed).toMatchObject({
      name: "feature-test-1f",
      cwd: worktreePath,
      state: "blocked",
    });
    expect(parsed?.pid).toBeUndefined();
  });

  it("keeps a session with no name, labelled by its id", async () => {
    mockSessionsJson([{ cwd: worktreePath, pid: 1, sessionId: "s-9" }]);

    const [parsed] = await getAgentSessions();

    expect(parsed?.name).toBe("s-9");
  });
});

// Shapes captured from Herdr 0.9.0 and Claude Code 2.1.286 on 2026-10-01.
const herdrSessionId = "a9141896-2083-492e-966d-46becf1cd48a";

function herdrAgent(overrides: Record<string, unknown> = {}) {
  return {
    agent: "claude",
    agent_session: {
      agent: "claude",
      kind: "id",
      source: "herdr:claude",
      value: herdrSessionId,
    },
    agent_status: "idle",
    cwd: worktreePath,
    focused: true,
    foreground_cwd: worktreePath,
    pane_id: "wA:p1",
    revision: 13,
    state_change_seq: 2248,
    tab_id: "wA:t1",
    terminal_id: "term_65b9ac75aed611",
    terminal_title: "✳ Work",
    terminal_title_stripped: "Work",
    workspace_id: "wA",
    ...overrides,
  };
}

function mockHerdrAgents(agents: unknown[]) {
  mockRunCapturing.mockResolvedValueOnce({
    stdout: JSON.stringify({
      id: "cli:agent:list",
      result: { type: "agent_list", agents },
    }),
    stderr: "",
    exitCode: 0,
  });
}

function runtimeEntry(overrides: Record<string, unknown> = {}) {
  return {
    cwd: worktreePath,
    kind: "interactive",
    name: "feature-test-1f",
    pid: 9187,
    sessionId: herdrSessionId,
    startedAt: 1788600791123,
    status: "idle",
    ...overrides,
  };
}

function mockConfig(values: Record<string, string>) {
  vi.spyOn(git, "gitGetConfigValue").mockImplementation(
    async (key) => values[key] ?? "",
  );
}

describe("getAgentSessions across Herdr and the runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("finds a session with agent.command unset and herdr.agent=claude, named by its sessionId", async () => {
    mockConfig({ "herdr.agent": "claude" });
    expectCommands("claude agents --json");
    mockRun.mockResolvedValueOnce(JSON.stringify([runtimeEntry()]));
    mockHerdrAgents([herdrAgent()]);

    const sessions = await getAgentSessions();

    expect(mockRun).toHaveBeenCalledWith("claude", ["agents", "--json"], {
      timeout: 10_000,
    });
    expect(mockRunCapturing).toHaveBeenCalledWith("herdr", ["agent", "list"], {
      timeout: 10_000,
    });
    expect(sessions).toEqual([
      expect.objectContaining({
        name: "feature-test-1f",
        sessionId: herdrSessionId,
        herdrAgent: "wA:p1",
        cwd: worktreePath,
      }),
    ]);
  });

  it("asks the agent.command program in preference to herdr.agent", async () => {
    mockConfig({ "agent.command": "codex --bg", "herdr.agent": "claude" });
    expectCommands("codex agents --json");
    mockRun.mockResolvedValueOnce("[]");
    mockHerdrAgents([]);

    await getAgentSessions();

    expect(mockRun).toHaveBeenCalledWith("codex", ["agents", "--json"], {
      timeout: 10_000,
    });
  });

  it("keeps a Herdr entry the runtime does not list, on its own", async () => {
    mockConfig({});
    mockHerdrAgents([herdrAgent()]);

    const sessions = await getAgentSessions();

    expect(sessions).toEqual([
      expect.objectContaining({
        name: "claude@wA:p1",
        herdrAgent: "wA:p1",
        status: "idle",
        cwd: worktreePath,
      }),
    ]);
    expect(isSessionLive(sessions[0] as AgentSession)).toBe(true);
  });

  // Herdr's `done` is a finished turn on a pane that is still open, so it must
  // never be the thing that frees a worktree.
  it("never reads a Herdr done status as a finished session", async () => {
    mockConfig({});
    mockHerdrAgents([herdrAgent({ agent_status: "done" })]);

    const [session] = await getAgentSessions();

    expect(isSessionLive(session as AgentSession)).toBe(true);
  });

  it("marks a Herdr-only agent that is blocked or idle as waiting", async () => {
    mockConfig({});
    mockHerdrAgents([
      herdrAgent({ agent_status: "blocked", pane_id: "wA:p2" }),
      herdrAgent({ agent_status: "working", pane_id: "wA:p3" }),
    ]);

    const sessions = await getAgentSessions();

    expect(sessions.map(isSessionWaiting)).toEqual([true, false]);
  });

  it("does not join on a session id when the working directories differ", async () => {
    mockConfig({ "herdr.agent": "claude" });
    expectCommands("claude agents --json");
    mockRun.mockResolvedValueOnce(JSON.stringify([runtimeEntry()]));
    mockHerdrAgents([herdrAgent({ cwd: "/repo/elsewhere" })]);

    const sessions = await getAgentSessions();

    expect(sessions).toHaveLength(2);
    expect(sessions.map((session) => session.herdrAgent)).toEqual([
      undefined,
      "wA:p1",
    ]);
  });

  it("keeps a pid-less background entry and still joins it to Herdr", async () => {
    mockConfig({ "herdr.agent": "claude" });
    expectCommands("claude agents --json");
    const { pid: _pid, ...withoutPid } = runtimeEntry({
      id: "23f50fae",
      kind: "background",
      state: "blocked",
    });
    mockRun.mockResolvedValueOnce(JSON.stringify([withoutPid]));
    mockHerdrAgents([herdrAgent()]);

    const [session] = await getAgentSessions();

    expect(session?.pid).toBeUndefined();
    expect(session?.herdrAgent).toBe("wA:p1");
    expect(isSessionWaiting(session as AgentSession)).toBe(true);
  });

  // #74: Herdr reports `name` for an agent it started, and none for one it
  // only detected; `herdrAgent` is the name, else the pane.
  it("reports Herdr's agent name as herdrAgent, joined or alone, and the pane when it has none", async () => {
    mockConfig({ "herdr.agent": "claude" });
    expectCommands("claude agents --json");
    mockRun.mockResolvedValueOnce(JSON.stringify([runtimeEntry()]));
    mockHerdrAgents([
      herdrAgent({
        name: "wt-139-festival-assistant-on-arc",
        interactive_ready: true,
      }),
      herdrAgent({
        name: "msg-check",
        pane_id: "wA:p2",
        agent_session: undefined,
        cwd: "/repo/elsewhere",
      }),
      herdrAgent({
        pane_id: "wA:p3",
        agent_session: undefined,
        cwd: "/repo/elsewhere",
      }),
    ]);

    const sessions = await getAgentSessions();

    expect(sessions.map((session) => session.herdrAgent)).toEqual([
      "wt-139-festival-assistant-on-arc",
      "msg-check",
      "wA:p3",
    ]);
    // The display name of a Herdr-only entry stays `<kind>@<pane>`.
    expect(sessions.map((session) => session.name)).toEqual([
      "feature-test-1f",
      "claude@wA:p2",
      "claude@wA:p3",
    ]);
  });

  // A live process has been seen reported `done` by the runtime while Herdr
  // still had it in a pane; the join must not let that free the worktree.
  it("does not let a runtime done state through when Herdr lists the session", async () => {
    mockConfig({ "herdr.agent": "claude" });
    expectCommands("claude agents --json");
    mockRun.mockResolvedValueOnce(
      JSON.stringify([runtimeEntry({ kind: "background", state: "done" })]),
    );
    mockHerdrAgents([herdrAgent()]);

    const [session] = await getAgentSessions();

    expect(session?.herdrAgent).toBe("wA:p1");
    expect(isSessionLive(session as AgentSession)).toBe(true);
  });

  it("still reads a runtime done state as finished when Herdr does not list it", async () => {
    mockConfig({ "herdr.agent": "claude" });
    expectCommands("claude agents --json");
    mockRun.mockResolvedValueOnce(
      JSON.stringify([runtimeEntry({ kind: "background", state: "done" })]),
    );
    mockHerdrAgents([]);

    const [session] = await getAgentSessions();

    expect(isSessionLive(session as AgentSession)).toBe(false);
  });

  describe("realpath", () => {
    let realDir: string;
    let linkParent: string;

    beforeEach(() => {
      realDir = realpathSync(mkdtempSync(join(tmpdir(), "worktree-agent-")));
      linkParent = realpathSync(
        mkdtempSync(join(tmpdir(), "worktree-agent-link-")),
      );
    });

    afterEach(() => {
      rmSync(realDir, { recursive: true, force: true });
      rmSync(linkParent, { recursive: true, force: true });
    });

    // The macOS `/tmp` -> `/private/tmp` case (F-022), made portable: a symlink
    // to a real directory is the same two spellings of one place.
    it("joins entries whose cwd differs only by a symlink", async () => {
      const linked = join(linkParent, "wt");
      symlinkSync(realDir, linked);
      mockConfig({ "herdr.agent": "claude" });
      expectCommands("claude agents --json");
      mockRun.mockResolvedValueOnce(
        JSON.stringify([runtimeEntry({ cwd: realDir })]),
      );
      mockHerdrAgents([herdrAgent({ cwd: linked })]);

      const sessions = await getAgentSessions();

      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        name: "feature-test-1f",
        herdrAgent: "wA:p1",
        cwd: realDir,
      });
    });

    it("hands back real paths, so a symlinked cwd matches a real worktree", async () => {
      const linked = join(linkParent, "wt");
      symlinkSync(realDir, linked);
      mockConfig({ "herdr.agent": "claude" });
      expectCommands("claude agents --json");
      mockRun.mockResolvedValueOnce(
        JSON.stringify([runtimeEntry({ cwd: linked })]),
      );
      mockHerdrAgents([]);

      const sessions = await getAgentSessions();

      expect(findSessionForPath(sessions, realDir)).toBeDefined();
    });

    it("keeps a cwd that does not exist as given", async () => {
      mockConfig({ "herdr.agent": "claude" });
      expectCommands("claude agents --json");
      mockRun.mockResolvedValueOnce(
        JSON.stringify([runtimeEntry({ cwd: "/gone/away" })]),
      );
      mockHerdrAgents([]);

      const [session] = await getAgentSessions();

      expect(session?.cwd).toBe("/gone/away");
    });
  });

  describe("with a source missing", () => {
    it("lists no agents and raises no error when neither source exists", async () => {
      mockConfig({});
      vi.spyOn(cli, "commandExists").mockResolvedValueOnce(false);

      await expect(getAgentSessions()).resolves.toEqual([]);
      expect(mockRun).not.toHaveBeenCalled();
      expect(mockRunCapturing).not.toHaveBeenCalled();
    });

    it("still lists the runtime's sessions when herdr is not installed", async () => {
      mockConfig({ "agent.command": "claude --bg" });
      vi.spyOn(cli, "commandExists").mockResolvedValueOnce(false);
      expectCommands("claude agents --json");
      mockRun.mockResolvedValueOnce(JSON.stringify([runtimeEntry()]));

      const sessions = await getAgentSessions();

      expect(sessions).toHaveLength(1);
      expect(mockRunCapturing).not.toHaveBeenCalled();
    });

    it("still lists Herdr's agents when the runtime listing fails", async () => {
      mockConfig({ "herdr.agent": "claude" });
      expectCommands("claude agents --json");
      mockRun.mockRejectedValueOnce(new Error("spawn claude ENOENT"));
      mockHerdrAgents([herdrAgent()]);

      await expect(getAgentSessions()).resolves.toHaveLength(1);
    });

    it("lists no Herdr agents when herdr exits non-zero or answers nonsense", async () => {
      mockConfig({});
      mockRunCapturing.mockResolvedValueOnce({
        stdout: "",
        stderr: '{"error":{"code":"server_not_running","message":"down"}}',
        exitCode: 1,
      });
      await expect(getAgentSessions()).resolves.toEqual([]);

      mockRunCapturing.mockResolvedValueOnce({
        stdout: JSON.stringify({ result: { agents: "nope" } }),
        stderr: "",
        exitCode: 0,
      });
      await expect(getAgentSessions()).resolves.toEqual([]);
    });

    it("drops a Herdr entry with no cwd and keeps the rest", async () => {
      mockConfig({});
      mockHerdrAgents([herdrAgent({ cwd: undefined }), herdrAgent()]);

      await expect(getAgentSessions()).resolves.toHaveLength(1);
    });
  });
});

describe("findSessionForPath", () => {
  it("matches a session whose cwd is the worktree itself", () => {
    const target = session();

    expect(findSessionForPath([target], worktreePath)).toBe(target);
  });

  it("matches a session sitting in a subdirectory of the worktree", () => {
    const target = session({ cwd: `${worktreePath}/src/lib` });

    expect(findSessionForPath([target], worktreePath)).toBe(target);
  });

  it("does not match a sibling worktree whose name shares a prefix", () => {
    const target = session({ cwd: `${worktreePath}-two` });

    expect(findSessionForPath([target], worktreePath)).toBeUndefined();
  });

  it("does not match the directory containing the worktree", () => {
    const target = session({ cwd: "/repo/project.worktrees" });

    expect(findSessionForPath([target], worktreePath)).toBeUndefined();
  });

  // The prefix trap this tool's own layout sets: every worktree path starts with
  // the repository path, so a session in the main checkout must not be reported
  // as living in each of that repository's worktrees.
  it("does not match a session sitting in the main checkout", () => {
    const target = session({ cwd: "/repo/project" });

    expect(findSessionForPath([target], worktreePath)).toBeUndefined();
  });

  // Two sessions in one worktree is the ordinary --agent case: an agent this CLI
  // dispatched, plus the editor or terminal the human opened. If the finished one
  // is listed first, returning it would report the worktree as free.
  it("prefers a live session over a finished one in the same worktree", () => {
    const finished = session({ name: "finished", state: "done" });
    const live = session({ name: "live", state: "working" });

    expect(findSessionForPath([finished, live], worktreePath)).toBe(live);
  });

  it("still returns a finished session when it is the only one there", () => {
    const finished = session({ state: "done" });

    expect(findSessionForPath([finished], worktreePath)).toBe(finished);
  });

  it("returns undefined when nothing matches", () => {
    expect(findSessionForPath([], worktreePath)).toBeUndefined();
    expect(
      findSessionForPath([session({ cwd: "/elsewhere" })], worktreePath),
    ).toBeUndefined();
  });
});

describe("isSessionLive", () => {
  it("counts a working session as live", () => {
    expect(isSessionLive(session({ state: "working" }))).toBe(true);
  });

  it("counts a finished session as not live", () => {
    expect(isSessionLive(session({ state: "done" }))).toBe(false);
  });

  it("counts a session with no state as live", () => {
    expect(isSessionLive(session())).toBe(true);
  });

  it("counts an unrecognised state as live", () => {
    expect(isSessionLive(session({ state: "hibernating" }))).toBe(true);
  });
});

describe("isSessionWaiting", () => {
  it("marks a blocked session as waiting", () => {
    expect(isSessionWaiting(session({ state: "blocked" }))).toBe(true);
  });

  it("marks an idle session as waiting", () => {
    expect(
      isSessionWaiting(session({ state: "working", status: "idle" })),
    ).toBe(true);
  });

  it("does not mark a working session as waiting", () => {
    expect(
      isSessionWaiting(session({ state: "working", status: "running" })),
    ).toBe(false);
  });

  it("does not mark a finished session as waiting", () => {
    expect(isSessionWaiting(session({ state: "done", status: "idle" }))).toBe(
      false,
    );
  });

  // Passing a status an interactive entry does not carry today, so this pins the
  // kind test rather than the mere absence of the field. §4.1's invariant is that
  // waiting is only ever true for a background session.
  it("does not mark an interactive session as waiting", () => {
    expect(
      isSessionWaiting(session({ kind: "interactive", status: "idle" })),
    ).toBe(false);
  });
});

describe("isSessionInteractive", () => {
  it("recognises an interactive session", () => {
    expect(isSessionInteractive(session({ kind: "interactive" }))).toBe(true);
  });

  it("does not mark a background session as interactive", () => {
    expect(isSessionInteractive(session({ kind: "background" }))).toBe(false);
  });

  it("does not mark a session with no kind as interactive", () => {
    expect(isSessionInteractive(session())).toBe(false);
  });
});
