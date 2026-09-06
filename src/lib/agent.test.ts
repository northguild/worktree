import { expectCommands, mockRun } from "../test-setup.js";
import {
  findSessionForPath,
  getAgentSessions,
  isSessionInteractive,
  isSessionLive,
  isSessionWaiting,
} from "./agent.js";
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

    expect(mockRun).toHaveBeenCalledWith("claude", ["agents", "--json"]);
    expect(mockRun).toHaveBeenCalledTimes(1);
    const [, args] = mockRun.mock.calls[0];
    expect(args).not.toContain("--all");
  });

  it("invokes the head of agent.command, not its dispatch arguments", async () => {
    vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("claude --bg");
    mockSessionsJson([]);

    await getAgentSessions();

    expect(mockRun).toHaveBeenCalledWith("claude", ["agents", "--json"]);
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
      { name: "no-pid", cwd: worktreePath },
      { pid: 1, cwd: worktreePath },
      { name: "no-cwd", pid: 2 },
      { name: "empty-cwd", pid: 3, cwd: "" },
      { name: "feature-test-1f", pid: 9187, cwd: worktreePath },
    ]);

    const sessions = await getAgentSessions();

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.name).toBe("feature-test-1f");
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
