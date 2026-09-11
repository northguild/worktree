/** biome-ignore-all lint/suspicious/noExplicitAny: Allow any in tests */
import { confirm } from "@inquirer/prompts";
import ora from "ora";
import * as herdr from "../integrations/herdr.js";
import * as git from "../lib/git.js";
import type { ConfigName } from "../lib/types.js";
import { mockRunCapturing } from "../test-setup.js";
import Cleanup from "./cleanup.js";

const spinnerMocks = vi.hoisted(() => {
  const stop = vi.fn();
  const succeed = vi.fn();
  const info = vi.fn();
  const start = vi.fn().mockReturnValue({ stop, succeed, info });
  const oraFactory = vi.fn().mockReturnValue({ start });

  return {
    stop,
    succeed,
    info,
    start,
    oraFactory,
  };
});

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
}));

vi.mock("ora", () => ({
  default: spinnerMocks.oraFactory,
}));

describe("cleanup command", () => {
  let cleanup: Cleanup;
  const mockConfirm = vi.mocked(confirm);

  const safeWorktree = {
    path: "/path/to/project.worktrees/feature/safe",
    branchName: "feature/safe",
    remote: "origin/feature/safe",
    ahead: 0,
    behind: 0,
    remoteExists: false,
    pathExists: true,
    uncommittedChanges: 0,
    safeToRemove: true,
  };

  const safeWorktreeTwo = {
    path: "/path/to/project.worktrees/feature/safe-two",
    branchName: "feature/safe-two",
    remote: "origin/feature/safe-two",
    ahead: 0,
    behind: 0,
    remoteExists: false,
    pathExists: true,
    uncommittedChanges: 0,
    safeToRemove: true,
  };

  const unsafeWorktree = {
    path: "/path/to/project.worktrees/feature/unsafe",
    branchName: "feature/unsafe",
    remote: "origin/feature/unsafe",
    ahead: 2,
    behind: 0,
    remoteExists: true,
    pathExists: true,
    uncommittedChanges: 3,
    safeToRemove: false,
  };

  // A stale worktree — its remote branch is gone — that holds uncommitted work.
  // Phase 2 made `isSafeToRemove` decline it; this is what cleanup must report.
  const staleWorktreeWithChanges = {
    path: "/path/to/project.worktrees/feature/stale-dirty",
    branchName: "feature/stale-dirty",
    remote: "origin/feature/stale-dirty",
    remoteExists: false,
    pathExists: true,
    uncommittedChanges: 3,
    safeToRemove: false,
  };

  // A stale worktree an agent is living in. Nothing else holds it back, so it is
  // the live session alone that has to keep it out of the sweep.
  const agentWorktree = {
    path: "/path/to/project.worktrees/feature/agent-live",
    branchName: "feature/agent-live",
    remote: "origin/feature/agent-live",
    remoteExists: false,
    pathExists: true,
    uncommittedChanges: 0,
    agent: {
      name: "feature-agent-1f",
      pid: 9187,
      live: true,
      interactive: false,
      waiting: false,
    },
    safeToRemove: false,
  };

  // The ordinary shape of a worktree an agent is working in: a live session and
  // the uncommitted work it has produced so far. It belongs under one heading,
  // not both.
  const agentWorktreeWithChanges = {
    path: "/path/to/project.worktrees/feature/agent-dirty",
    branchName: "feature/agent-dirty",
    remote: "origin/feature/agent-dirty",
    remoteExists: false,
    pathExists: true,
    uncommittedChanges: 2,
    agent: {
      name: "feature-dirty-2a",
      pid: 9188,
      live: true,
      interactive: false,
      waiting: false,
    },
    safeToRemove: false,
  };

  // The session finished and the worktree went back to being ordinary stale
  // work. `list` still names the session; cleanup must not be held by it.
  const finishedAgentWorktree = {
    path: "/path/to/project.worktrees/feature/agent-done",
    branchName: "feature/agent-done",
    remote: "origin/feature/agent-done",
    remoteExists: false,
    pathExists: true,
    uncommittedChanges: 0,
    agent: {
      name: "feature-done-3b",
      pid: 9189,
      live: false,
      interactive: false,
      waiting: false,
    },
    safeToRemove: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    const mockConfig = {
      runCommand: vi.fn().mockResolvedValue(undefined),
    } as any;
    cleanup = new Cleanup([], mockConfig);
    // No opener configured: every test in this block routes to `closeNothing`
    // and spawns no Herdr process. Spied rather than left to the global run()
    // mock so the gate is explicit, and so the undeclared `git config` call
    // does not warn on every test here.
    vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("");
  });

  it("returns early with success message when no stale worktrees exist", async () => {
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([unsafeWorktree]);
    const mockRemove = vi
      .spyOn(git, "gitRemoveWorktreesWithProgress")
      .mockImplementation(async (worktrees) => worktrees);

    (cleanup as any).parse = vi.fn().mockResolvedValue({
      flags: { force: false },
    });

    await cleanup.run();

    expect((cleanup as any).parse).toHaveBeenCalledWith(Cleanup);
    expect(ora).toHaveBeenCalledWith("Gathering worktree branches");
    expect(spinnerMocks.start).toHaveBeenCalledTimes(1);
    expect(spinnerMocks.succeed).toHaveBeenCalledWith(
      "No stale worktree branches found.",
    );
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("prompts for confirmation and removes only safe worktrees when approved", async () => {
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([
      safeWorktree,
      unsafeWorktree,
    ]);
    const logSpy = vi.spyOn(cleanup, "log").mockImplementation(() => {});
    mockConfirm.mockResolvedValue(true);
    const mockRemove = vi
      .spyOn(git, "gitRemoveWorktreesWithProgress")
      .mockImplementation(async (worktrees) => worktrees);

    (cleanup as any).parse = vi.fn().mockResolvedValue({
      flags: { force: false },
    });

    await cleanup.run();

    expect(spinnerMocks.info).toHaveBeenCalledTimes(1);
    expect(mockConfirm).toHaveBeenCalledWith({
      message: "Are you sure you want to delete it?",
      default: false,
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("feature/safe"),
    );
    expect(
      logSpy.mock.calls.some((call) =>
        (call[0] ?? "").includes("feature/unsafe"),
      ),
    ).toBe(false);
    expect(mockRemove).toHaveBeenCalledWith([safeWorktree]);
  });

  it("does not remove worktrees when confirmation is declined", async () => {
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([safeWorktree]);
    const logSpy = vi.spyOn(cleanup, "log").mockImplementation(() => {});
    mockConfirm.mockResolvedValue(false);
    const mockRemove = vi
      .spyOn(git, "gitRemoveWorktreesWithProgress")
      .mockImplementation(async (worktrees) => worktrees);

    (cleanup as any).parse = vi.fn().mockResolvedValue({
      flags: { force: false },
    });

    await cleanup.run();

    expect(mockConfirm).toHaveBeenCalledWith({
      message: "Are you sure you want to delete it?",
      default: false,
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("feature/safe"),
    );
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it("uses plural confirmation text and lists all safe worktrees", async () => {
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([
      safeWorktree,
      safeWorktreeTwo,
      unsafeWorktree,
    ]);
    const logSpy = vi.spyOn(cleanup, "log").mockImplementation(() => {});
    mockConfirm.mockResolvedValue(true);
    const mockRemove = vi
      .spyOn(git, "gitRemoveWorktreesWithProgress")
      .mockImplementation(async (worktrees) => worktrees);

    (cleanup as any).parse = vi.fn().mockResolvedValue({
      flags: { force: false },
    });

    await cleanup.run();

    expect(spinnerMocks.info).toHaveBeenCalledWith(
      "Found 2 worktree branches that are marked safe to remove.",
    );
    expect(mockConfirm).toHaveBeenCalledWith({
      message: "Are you sure you want to delete them?",
      default: false,
    });
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("feature/safe"),
    );
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("feature/safe-two"),
    );
    expect(
      logSpy.mock.calls.some((call) =>
        (call[0] ?? "").includes("feature/unsafe"),
      ),
    ).toBe(false);
    expect(mockRemove).toHaveBeenCalledWith([safeWorktree, safeWorktreeTwo]);
  });

  it("skips confirmation and removes safe worktrees when --force is set", async () => {
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([
      safeWorktree,
      unsafeWorktree,
    ]);
    const mockRemove = vi
      .spyOn(git, "gitRemoveWorktreesWithProgress")
      .mockImplementation(async (worktrees) => worktrees);

    (cleanup as any).parse = vi.fn().mockResolvedValue({
      flags: { force: true },
    });

    await cleanup.run();

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(spinnerMocks.info).not.toHaveBeenCalled();
    expect(spinnerMocks.stop).toHaveBeenCalledTimes(1);
    expect(mockRemove).toHaveBeenCalledWith([safeWorktree]);
  });

  it("reports worktrees skipped for uncommitted changes and removes the rest", async () => {
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([
      safeWorktree,
      staleWorktreeWithChanges,
    ]);
    const logSpy = vi.spyOn(cleanup, "log").mockImplementation(() => {});
    mockConfirm.mockResolvedValue(true);
    const mockRemove = vi
      .spyOn(git, "gitRemoveWorktreesWithProgress")
      .mockImplementation(async (worktrees) => worktrees);

    (cleanup as any).parse = vi.fn().mockResolvedValue({
      flags: { force: false },
    });

    await cleanup.run();

    expect(logSpy).toHaveBeenCalledWith(
      "Skipped 1 worktree branch that has uncommitted changes:",
    );
    expect(logSpy).toHaveBeenCalledWith(
      "- feature/stale-dirty (Remote removed, 3 uncommitted changes)",
    );
    expect(mockRemove).toHaveBeenCalledWith([safeWorktree]);
  });

  it("reports skipped worktrees when --force is set", async () => {
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([
      safeWorktree,
      staleWorktreeWithChanges,
    ]);
    const logSpy = vi.spyOn(cleanup, "log").mockImplementation(() => {});
    const mockRemove = vi
      .spyOn(git, "gitRemoveWorktreesWithProgress")
      .mockImplementation(async (worktrees) => worktrees);

    (cleanup as any).parse = vi.fn().mockResolvedValue({
      flags: { force: true },
    });

    await cleanup.run();

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(spinnerMocks.stop).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      "Skipped 1 worktree branch that has uncommitted changes:",
    );
    expect(logSpy).toHaveBeenCalledWith(
      "- feature/stale-dirty (Remote removed, 3 uncommitted changes)",
    );
    expect(mockRemove).toHaveBeenCalledWith([safeWorktree]);
  });

  it("distinguishes everything-skipped from nothing-found", async () => {
    const secondStaleWorktree = {
      ...staleWorktreeWithChanges,
      path: "/path/to/project.worktrees/feature/stale-dirty-two",
      branchName: "feature/stale-dirty-two",
      uncommittedChanges: 1,
    };
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([
      staleWorktreeWithChanges,
      secondStaleWorktree,
    ]);
    const logSpy = vi.spyOn(cleanup, "log").mockImplementation(() => {});
    const mockRemove = vi
      .spyOn(git, "gitRemoveWorktreesWithProgress")
      .mockImplementation(async (worktrees) => worktrees);

    (cleanup as any).parse = vi.fn().mockResolvedValue({
      flags: { force: false },
    });

    await cleanup.run();

    expect(spinnerMocks.succeed).not.toHaveBeenCalled();
    expect(spinnerMocks.info).toHaveBeenCalledWith(
      "No stale worktree branches can be removed safely.",
    );
    expect(logSpy).toHaveBeenCalledWith(
      "Skipped 2 worktree branches that have uncommitted changes:",
    );
    expect(logSpy).toHaveBeenCalledWith(
      "- feature/stale-dirty (Remote removed, 3 uncommitted changes)",
    );
    expect(logSpy).toHaveBeenCalledWith(
      "- feature/stale-dirty-two (Remote removed, 1 uncommitted change)",
    );
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  // The join is what puts an agent on the entry in the first place, so a cleanup
  // that never asked for it cannot see the session it is meant to respect.
  it("asks for the session join by default", async () => {
    const listSpy = vi
      .spyOn(git, "gitGetWorktreeList")
      .mockResolvedValue([safeWorktree]);
    vi.spyOn(cleanup, "log").mockImplementation(() => {});
    mockConfirm.mockResolvedValue(false);

    (cleanup as any).parse = vi.fn().mockResolvedValue({
      flags: { force: false },
    });

    await cleanup.run();

    expect(listSpy).toHaveBeenCalledWith({ includeAgents: true });
  });

  it("excludes a worktree with a live agent session and names the session", async () => {
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([
      safeWorktree,
      agentWorktree,
    ]);
    const logSpy = vi.spyOn(cleanup, "log").mockImplementation(() => {});
    mockConfirm.mockResolvedValue(true);
    const mockRemove = vi
      .spyOn(git, "gitRemoveWorktreesWithProgress")
      .mockImplementation(async (worktrees) => worktrees);

    (cleanup as any).parse = vi.fn().mockResolvedValue({
      flags: { force: false },
    });

    await cleanup.run();

    expect(logSpy).toHaveBeenCalledWith(
      "Skipped 1 worktree branch with a live agent session:",
    );
    expect(logSpy).toHaveBeenCalledWith(
      "- feature/agent-live (Remote removed, Agent: feature-agent-1f)",
    );
    expect(mockRemove).toHaveBeenCalledWith([safeWorktree]);
  });

  it("removes a worktree whose agent session has finished", async () => {
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([
      finishedAgentWorktree,
    ]);
    const logSpy = vi.spyOn(cleanup, "log").mockImplementation(() => {});
    mockConfirm.mockResolvedValue(true);
    const mockRemove = vi
      .spyOn(git, "gitRemoveWorktreesWithProgress")
      .mockImplementation(async (worktrees) => worktrees);

    (cleanup as any).parse = vi.fn().mockResolvedValue({
      flags: { force: false },
    });

    await cleanup.run();

    expect(
      logSpy.mock.calls.some((call) => (call[0] ?? "").startsWith("Skipped ")),
    ).toBe(false);
    expect(mockRemove).toHaveBeenCalledWith([finishedAgentWorktree]);
  });

  // The override is "do not look": with no join asked for, the builder returns
  // entries carrying no agent at all, and the verdict is what it was before the
  // flag existed. Asserting the argument is the real check — the list here is
  // what the builder would then hand back.
  it("asks for no session join with --ignore-agents and removes anyway", async () => {
    const listSpy = vi
      .spyOn(git, "gitGetWorktreeList")
      .mockResolvedValue([
        { ...agentWorktree, agent: undefined, safeToRemove: true },
      ]);
    const logSpy = vi.spyOn(cleanup, "log").mockImplementation(() => {});
    const mockRemove = vi
      .spyOn(git, "gitRemoveWorktreesWithProgress")
      .mockImplementation(async (worktrees) => worktrees);

    (cleanup as any).parse = vi.fn().mockResolvedValue({
      flags: { force: true, "ignore-agents": true },
    });

    await cleanup.run();

    expect(listSpy).toHaveBeenCalledWith({ includeAgents: false });
    expect(
      logSpy.mock.calls.some((call) => (call[0] ?? "").startsWith("Skipped ")),
    ).toBe(false);
    expect(mockRemove).toHaveBeenCalledWith([
      { ...agentWorktree, agent: undefined, safeToRemove: true },
    ]);
  });

  // --force answers the confirmation prompt, not the safety verdict, so a live
  // session survives it. That distinction is the whole reason --ignore-agents
  // exists as a separate flag. See AGENT-MODE-PLAN §4.
  it("does not let --force remove a worktree with a live agent session", async () => {
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([
      safeWorktree,
      agentWorktree,
    ]);
    const logSpy = vi.spyOn(cleanup, "log").mockImplementation(() => {});
    const mockRemove = vi
      .spyOn(git, "gitRemoveWorktreesWithProgress")
      .mockImplementation(async (worktrees) => worktrees);

    (cleanup as any).parse = vi.fn().mockResolvedValue({
      flags: { force: true },
    });

    await cleanup.run();

    expect(mockConfirm).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      "Skipped 1 worktree branch with a live agent session:",
    );
    expect(mockRemove).toHaveBeenCalledWith([safeWorktree]);
  });

  // A worktree an agent is working in almost always holds uncommitted work too.
  // Reporting it under both headings would double-count it and read as two
  // worktrees; the agent heading is the one that claims it, and the change count
  // still appears in its details.
  it("reports a dirty worktree with a live session under the agent heading only", async () => {
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([
      safeWorktree,
      agentWorktreeWithChanges,
    ]);
    const logSpy = vi.spyOn(cleanup, "log").mockImplementation(() => {});
    mockConfirm.mockResolvedValue(true);
    vi.spyOn(git, "gitRemoveWorktreesWithProgress").mockImplementation(
      async (worktrees) => worktrees,
    );

    (cleanup as any).parse = vi.fn().mockResolvedValue({
      flags: { force: false },
    });

    await cleanup.run();

    expect(logSpy).toHaveBeenCalledWith(
      "Skipped 1 worktree branch with a live agent session:",
    );
    expect(logSpy).toHaveBeenCalledWith(
      "- feature/agent-dirty (Remote removed, 2 uncommitted changes, Agent: feature-dirty-2a)",
    );
    expect(
      logSpy.mock.calls.filter((call) =>
        (call[0] ?? "").includes("feature/agent-dirty"),
      ),
    ).toHaveLength(1);
    expect(
      logSpy.mock.calls.some((call) =>
        (call[0] ?? "").includes("uncommitted changes:"),
      ),
    ).toBe(false);
  });

  it("reports agent hold-backs when nothing at all can be removed", async () => {
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([
      agentWorktree,
      staleWorktreeWithChanges,
    ]);
    const logSpy = vi.spyOn(cleanup, "log").mockImplementation(() => {});
    const mockRemove = vi
      .spyOn(git, "gitRemoveWorktreesWithProgress")
      .mockImplementation(async (worktrees) => worktrees);

    (cleanup as any).parse = vi.fn().mockResolvedValue({
      flags: { force: false },
    });

    await cleanup.run();

    expect(spinnerMocks.succeed).not.toHaveBeenCalled();
    expect(spinnerMocks.info).toHaveBeenCalledWith(
      "No stale worktree branches can be removed safely.",
    );
    expect(logSpy).toHaveBeenCalledWith(
      "Skipped 1 worktree branch that has uncommitted changes:",
    );
    expect(logSpy).toHaveBeenCalledWith(
      "Skipped 1 worktree branch with a live agent session:",
    );
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockRemove).not.toHaveBeenCalled();
  });

  // A worktree whose directory is already gone is safe to remove whatever its
  // change count says, so it must not also be announced as held back. Both
  // reports are gated on the verdict for exactly this reason. See findings.md
  // F-003.
  it("claims a worktree whose directory is gone for at most one report", async () => {
    const ghostWorktree = {
      path: "/path/to/project.worktrees/feature/ghost",
      branchName: "feature/ghost",
      remote: "origin/feature/ghost",
      remoteExists: false,
      pathExists: false,
      uncommittedChanges: 3,
      safeToRemove: true,
    };
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([ghostWorktree]);
    const logSpy = vi.spyOn(cleanup, "log").mockImplementation(() => {});
    const mockRemove = vi
      .spyOn(git, "gitRemoveWorktreesWithProgress")
      .mockImplementation(async (worktrees) => worktrees);

    (cleanup as any).parse = vi.fn().mockResolvedValue({
      flags: { force: true },
    });

    await cleanup.run();

    expect(
      logSpy.mock.calls.some((call) => (call[0] ?? "").startsWith("Skipped ")),
    ).toBe(false);
    expect(mockRemove).toHaveBeenCalledWith([ghostWorktree]);
  });

  // Only worktrees cleanup would otherwise have swept are reported. An active
  // branch that happens to be dirty was never a candidate, so naming it here
  // would be noise. See CLEANUP-DATA-LOSS-PLAN §4.2.
  it("does not report an active worktree that merely holds uncommitted changes", async () => {
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([
      safeWorktree,
      unsafeWorktree,
    ]);
    const logSpy = vi.spyOn(cleanup, "log").mockImplementation(() => {});
    mockConfirm.mockResolvedValue(true);
    vi.spyOn(git, "gitRemoveWorktreesWithProgress").mockImplementation(
      async (worktrees) => worktrees,
    );

    (cleanup as any).parse = vi.fn().mockResolvedValue({
      flags: { force: false },
    });

    await cleanup.run();

    expect(
      logSpy.mock.calls.some((call) => (call[0] ?? "").startsWith("Skipped ")),
    ).toBe(false);
  });
});

/**
 * What `cleanup` does to the Herdr spaces of the worktrees it deletes.
 *
 * The held-back case is the one that matters most here: `cleanup` routinely
 * selects a set and removes a subset of it, so "close what was removed" and
 * "close what was found" come apart on every ordinary run — unlike `remove`,
 * where they usually coincide.
 */
describe("cleanup command — the herdr closer", () => {
  const gitRootPath = "/path/to/project";
  const safePath = `${gitRootPath}.worktrees/feature/safe`;
  const dirtyPath = `${gitRootPath}.worktrees/feature/stale-dirty`;

  const safe = {
    path: safePath,
    branchName: "feature/safe",
    remote: "origin/feature/safe",
    ahead: 0,
    behind: 0,
    remoteExists: false,
    pathExists: true,
    uncommittedChanges: 0,
    safeToRemove: true,
  };

  // Held back by isSafeToRemove, so it never enters the removal set — and its
  // space must survive.
  const dirty = {
    ...safe,
    path: dirtyPath,
    branchName: "feature/stale-dirty",
    uncommittedChanges: 3,
    safeToRemove: false,
  };

  let cleanup: Cleanup;
  let mockClose: ReturnType<typeof vi.spyOn>;
  let mockList: ReturnType<typeof vi.spyOn>;
  /** What happened, in the order it happened. D2 is an ordering claim. */
  let calls: string[];
  const mockConfirm = vi.mocked(confirm);

  function setConfig(values: Partial<Record<ConfigName, string>>) {
    vi.spyOn(git, "gitGetConfigValue").mockImplementation(
      async (name: ConfigName) => values[name] ?? "",
    );
  }

  function removalAnswers(entries: (typeof safe)[]) {
    vi.spyOn(git, "gitRemoveWorktreesWithProgress").mockImplementation(
      async () => {
        calls.push("remove");
        return entries;
      },
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    calls = [];
    cleanup = new Cleanup([], { runCommand: vi.fn() } as any);
    vi.spyOn(cleanup, "log").mockImplementation(() => {});
    vi.spyOn(git, "gitGetRootPath").mockResolvedValue(gitRootPath);
    vi.spyOn(git, "gitGetAbsoluteWorktreesPath").mockResolvedValue(
      `${gitRootPath}.worktrees`,
    );
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([safe, dirty]);
    removalAnswers([safe]);
    vi.spyOn(herdr, "isHerdrInstalled").mockResolvedValue(true);
    mockList = vi
      .spyOn(herdr, "listHerdrWorktrees")
      .mockImplementation(async () => {
        calls.push("list");
        return {
          sourceWorkspaceId: "w5",
          worktrees: [
            { path: gitRootPath, workspaceId: "w5" },
            { path: safePath, workspaceId: "wQ" },
            { path: dirtyPath, workspaceId: "wR" },
          ],
        };
      });
    mockClose = vi.spyOn(herdr, "closeHerdrWorkspace").mockResolvedValue();
    setConfig({ opener: "herdr" });
    mockConfirm.mockResolvedValue(true);
    (cleanup as any).parse = vi
      .fn()
      .mockResolvedValue({ flags: { force: false } });
  });

  it("closes the space of every worktree it removed", async () => {
    await cleanup.run();

    expect(mockClose).toHaveBeenCalledWith("wQ");
  });

  it("reads the listing before the removal, never after", async () => {
    // D2. The removal runs `git worktree prune`, which takes these entries out
    // of Herdr's listing — resolve afterwards and every space is orphaned with
    // nothing said about it.
    await cleanup.run();

    expect(calls).toEqual(["list", "remove"]);
  });

  it("leaves the space of a worktree held back for uncommitted changes open", async () => {
    // §8's manual check, as an assertion. Worth being precise about what holds
    // it: the held-back worktree never enters the removal set at all, because
    // `worktrees` is already filtered to safeToRemove — so this is the closer
    // inheriting isSafeToRemove's verdict and adding no opinion of its own
    // (§2), not the D4 "only what was removed" guard. The failing-removal case
    // below is what pins D4 here.
    await cleanup.run();

    expect(mockClose).not.toHaveBeenCalledWith("wR");
    expect(mockClose).toHaveBeenCalledTimes(1);
  });

  it("closes nothing when the confirmation is declined", async () => {
    mockConfirm.mockResolvedValue(false);

    await cleanup.run();

    expect(mockClose).not.toHaveBeenCalled();
  });

  it("spawns no lookup when the confirmation is declined", async () => {
    // The closer is resolved after the prompt, so a declined run costs nothing.
    mockConfirm.mockResolvedValue(false);

    await cleanup.run();

    expect(mockList).not.toHaveBeenCalled();
  });

  it("closes nothing when a removal failed and the helper did not return it", async () => {
    // D4, and what actually pins it here: the set was selected and removed, but
    // the helper got through none of it.
    removalAnswers([]);

    await cleanup.run();

    expect(mockClose).not.toHaveBeenCalled();
  });

  it("spawns no herdr process at all for a non-herdr opener", async () => {
    setConfig({ opener: "" });

    await cleanup.run();

    expect(mockList).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
    expect(mockRunCapturing).not.toHaveBeenCalled();
  });
});
