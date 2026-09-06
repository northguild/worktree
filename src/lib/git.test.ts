import fs from "node:fs";
import { EOL } from "node:os";
import { expectCommands, mockRun } from "../test-setup.js";
import * as agent from "./agent.js";
import * as cli from "./cli.js";
import {
  getCurrentBranchName,
  gitCreateWorktree,
  gitGetAbsoluteWorktreesPath,
  gitGetCommitsAheadCount,
  gitGetCommitsBehindCount,
  gitGetConfigValue,
  gitGetLocalBranches,
  gitGetLocalBranchesTracking,
  gitGetRemoteBranches,
  gitGetRootPath,
  gitGetUncommittedChangesCount,
  gitGetWorktreeList,
  gitNukeWorktreeCmd,
  gitSetConfigValue,
  isSafeToRemove,
} from "./git.js";
import type { AgentSession, WorktreeListEntry } from "./types.js";

// gitCreateWorktree is the only function under test here that draws a spinner.
// Mock it so the suite neither writes to the terminal nor depends on a TTY.
const spinnerMocks = vi.hoisted(() => {
  const succeed = vi.fn();
  const fail = vi.fn();
  const start = vi.fn().mockReturnValue({ succeed, fail });
  const oraFactory = vi.fn().mockReturnValue({ start });

  return { succeed, fail, start, oraFactory };
});

vi.mock("ora", () => ({
  default: spinnerMocks.oraFactory,
}));

describe("git branch parsing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    expectCommands(
      "git --no-pager branch",
      "git fetch --prune",
      "git --no-pager branch -r",
    );
  });

  it("parses local branches and strips git branch markers", async () => {
    const runSpy = vi
      .spyOn(cli, "run")
      .mockResolvedValueOnce(
        "* main\n+ feature/in-other-worktree\n  feature/test",
      );

    const branches = await gitGetLocalBranches();

    expect(branches).toEqual([
      "main",
      "feature/in-other-worktree",
      "feature/test",
    ]);
    expect(runSpy).toHaveBeenCalledWith("git", ["--no-pager", "branch"]);
  });

  it("prunes and lists remote branches without symbolic refs", async () => {
    const runSpy = vi.spyOn(cli, "run");
    runSpy
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce(
        "  origin/HEAD -> origin/main\n  origin/main\n  origin/feature/test",
      );

    const branches = await gitGetRemoteBranches();

    expect(runSpy).toHaveBeenNthCalledWith(1, "git", ["fetch", "--prune"]);
    expect(runSpy).toHaveBeenNthCalledWith(2, "git", [
      "--no-pager",
      "branch",
      "-r",
    ]);
    expect(branches).toEqual(["origin/main", "origin/feature/test"]);
  });
});

describe("git config", () => {
  // The value §7 case 3 stores by hand: a quote, a backtick and a semicolon,
  // every one of which the old `git config … "${value}"` form handed to a shell.
  const hostileValue = 'x"; touch /tmp/pwned; #`whoami`';

  beforeEach(() => {
    vi.clearAllMocks();
    expectCommands(
      "git config northguild.worktree.defaultSourceBranch",
      "git config northguild.worktree.codeEditor",
      "git config northguild.worktree.codeEditor code",
      `git config northguild.worktree.codeEditor "${hostileValue}"`,
    );
  });

  it("returns git config value", async () => {
    const runSpy = vi.spyOn(cli, "run").mockResolvedValueOnce("origin/main");

    const value = await gitGetConfigValue("defaultSourceBranch");

    expect(runSpy).toHaveBeenCalledWith("git", [
      "config",
      "northguild.worktree.defaultSourceBranch",
    ]);
    expect(value).toBe("origin/main");
  });

  it("returns empty string when git config lookup fails", async () => {
    const runSpy = vi.spyOn(cli, "run").mockRejectedValueOnce(new Error());

    const value = await gitGetConfigValue("defaultSourceBranch");

    expect(runSpy).toHaveBeenCalledWith("git", [
      "config",
      "northguild.worktree.defaultSourceBranch",
    ]);
    expect(value).toBe("");
  });

  it("sets git config value", async () => {
    const runSpy = vi.spyOn(cli, "run").mockResolvedValueOnce("");

    await gitSetConfigValue("codeEditor", "code");

    expect(runSpy).toHaveBeenCalledWith("git", [
      "config",
      "northguild.worktree.codeEditor",
      "code",
    ]);
  });

  // The point of the argv form: a value carrying shell metacharacters is one
  // element on the way out and the same string on the way back, with nothing in
  // between that could parse it.
  it("round-trips a value containing a quote, a backtick and a semicolon", async () => {
    const runSpy = vi
      .spyOn(cli, "run")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce(hostileValue);

    await gitSetConfigValue("codeEditor", hostileValue);
    const value = await gitGetConfigValue("codeEditor");

    expect(runSpy).toHaveBeenNthCalledWith(1, "git", [
      "config",
      "northguild.worktree.codeEditor",
      hostileValue,
    ]);
    // One argv element, not a shell string that happens to contain the value.
    expect(runSpy.mock.calls[0]?.[1]).toHaveLength(3);
    expect(value).toBe(hostileValue);
  });
});

describe("git root path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    expectCommands(
      "git rev-parse --show-toplevel",
      "git rev-parse --absolute-git-dir",
    );
  });

  it("returns top-level path when not in a worktree path", async () => {
    const runSpy = vi.spyOn(cli, "run").mockResolvedValueOnce("/repo/project");

    const path = await gitGetRootPath();

    expect(runSpy).toHaveBeenCalledWith("git", [
      "rev-parse",
      "--show-toplevel",
    ]);
    expect(path).toBe("/repo/project");
  });

  it("resolves main repo root when current path is in .worktrees", async () => {
    const runSpy = vi.spyOn(cli, "run");
    runSpy
      .mockResolvedValueOnce("/repo/project.worktrees/feature-x")
      .mockResolvedValueOnce("/repo/project/.git/worktrees/feature-x");

    const path = await gitGetRootPath();

    expect(runSpy).toHaveBeenNthCalledWith(1, "git", [
      "rev-parse",
      "--show-toplevel",
    ]);
    expect(runSpy).toHaveBeenNthCalledWith(2, "git", [
      "rev-parse",
      "--absolute-git-dir",
    ]);
    expect(path).toBe("/repo/project");
  });

  it("throws a friendly error when git commands fail", async () => {
    vi.spyOn(cli, "run").mockRejectedValueOnce(new Error("not a repo"));

    await expect(gitGetRootPath()).rejects.toThrow(
      "Git: Unable find the root path. Are you in a git repository?",
    );
  });

  it("builds absolute worktrees path from repo root", async () => {
    vi.spyOn(cli, "run").mockResolvedValueOnce("/repo/project");

    const worktreesPath = await gitGetAbsoluteWorktreesPath();

    expect(worktreesPath).toBe("/repo/project.worktrees");
  });
});

describe("git status and tracking helpers", () => {
  const worktreePath = "/repo/project.worktrees/test";
  // A path a shell would split on the space, which is the failure the argv form
  // exists to fix.
  const spacedWorktreePath = "/repo/my project.worktrees/test";

  beforeEach(() => {
    vi.clearAllMocks();
    expectCommands(
      "git branch --show-current",
      `git rev-list --count @{u}..HEAD (cwd: ${worktreePath})`,
      `git rev-list --count HEAD..@{u} (cwd: ${worktreePath})`,
      `git status -s (cwd: ${worktreePath})`,
      `git status -s (cwd: ${spacedWorktreePath})`,
      'git for-each-ref "--format=%(refname:short) <- %(upstream:short)" refs/heads',
    );
  });

  it("returns current branch name", async () => {
    const runSpy = vi.spyOn(cli, "run").mockResolvedValueOnce("feature/test");

    const branchName = await getCurrentBranchName();

    expect(runSpy).toHaveBeenCalledWith("git", ["branch", "--show-current"]);
    expect(branchName).toBe("feature/test");
  });

  it("parses ahead commit count", async () => {
    const runSpy = vi.spyOn(cli, "run").mockResolvedValueOnce("3");

    const count = await gitGetCommitsAheadCount(worktreePath);

    expect(runSpy).toHaveBeenCalledWith(
      "git",
      ["rev-list", "--count", "@{u}..HEAD"],
      { cwd: worktreePath },
    );
    expect(count).toBe(3);
  });

  it("returns undefined for empty ahead commit count", async () => {
    vi.spyOn(cli, "run").mockResolvedValueOnce("");

    const count = await gitGetCommitsAheadCount(worktreePath);

    expect(count).toBeUndefined();
  });

  it("parses behind commit count", async () => {
    const runSpy = vi.spyOn(cli, "run").mockResolvedValueOnce("2");

    const count = await gitGetCommitsBehindCount(worktreePath);

    expect(runSpy).toHaveBeenCalledWith(
      "git",
      ["rev-list", "--count", "HEAD..@{u}"],
      { cwd: worktreePath },
    );
    expect(count).toBe(2);
  });

  it("counts uncommitted changes from git status -s", async () => {
    const runSpy = vi
      .spyOn(cli, "run")
      .mockResolvedValueOnce("M a.ts\nA b.ts\n?? c.ts");

    const count = await gitGetUncommittedChangesCount(worktreePath);

    expect(runSpy).toHaveBeenCalledWith("git", ["status", "-s"], {
      cwd: worktreePath,
    });
    expect(count).toBe(3);
  });

  it("returns zero uncommitted changes for empty status", async () => {
    vi.spyOn(cli, "run").mockResolvedValueOnce("");

    const count = await gitGetUncommittedChangesCount(worktreePath);

    expect(count).toBe(0);
  });

  it("passes a branch path containing a space through as one cwd", async () => {
    const runSpy = vi.spyOn(cli, "run").mockResolvedValueOnce("M a.ts");

    const count = await gitGetUncommittedChangesCount(spacedWorktreePath);

    expect(runSpy).toHaveBeenCalledWith("git", ["status", "-s"], {
      cwd: spacedWorktreePath,
    });
    expect(count).toBe(1);
  });

  it("parses local to remote tracking branch map", async () => {
    const runSpy = vi
      .spyOn(cli, "run")
      .mockResolvedValueOnce(
        "main <- origin/main\nfeature/test <- origin/feature/test\nlocal-only <-",
      );

    const tracking = await gitGetLocalBranchesTracking();

    // The format string is one argv element, spaces and all — the single quotes
    // the shell form carried are gone rather than being passed on to git.
    expect(runSpy).toHaveBeenCalledWith("git", [
      "for-each-ref",
      "--format=%(refname:short) <- %(upstream:short)",
      "refs/heads",
    ]);

    expect(tracking).toEqual([
      { local: "main", remote: "origin/main" },
      { local: "feature/test", remote: "origin/feature/test" },
      { local: "local-only", remote: "" },
    ]);
  });
});

describe("gitCreateWorktree", () => {
  const gitRootPath = "/repo/project";
  // A root a shell would split on the space, which is the failure the argv form
  // exists to fix.
  const spacedGitRootPath = "/repo/my project";
  const branchName = "feature/test";
  const sourceBranch = "origin/main";
  // Relative on purpose: `git worktree add` resolves it against the cwd, so the
  // recorded link survives the project being moved on disk (plan R1).
  const relativeWorktreePath = "../project.worktrees/feature/test";

  beforeEach(() => {
    vi.clearAllMocks();
    expectCommands(
      "git rev-parse --show-toplevel",
      `git fetch (cwd: ${gitRootPath})`,
      `git fetch (cwd: ${spacedGitRootPath})`,
      `git worktree add --no-track -b ${branchName} ${relativeWorktreePath} ${sourceBranch} (cwd: ${gitRootPath})`,
      `git worktree add --track -b ${branchName} ${relativeWorktreePath} ${sourceBranch} (cwd: ${gitRootPath})`,
      `git worktree add --no-track -b ${branchName} "../my project.worktrees/feature/test" ${sourceBranch} (cwd: ${spacedGitRootPath})`,
    );
  });

  it("fetches then adds an untracked worktree, both at the git root", async () => {
    const runSpy = vi.spyOn(cli, "run").mockResolvedValue("");
    // Call 1 is gitGetRootPath's own lookup, which runs without a cwd; the fetch
    // and the add follow it.
    runSpy.mockResolvedValueOnce(gitRootPath);

    const worktreePath = await gitCreateWorktree(branchName, sourceBranch);

    expect(runSpy).toHaveBeenCalledTimes(3);
    expect(runSpy).toHaveBeenNthCalledWith(1, "git", [
      "rev-parse",
      "--show-toplevel",
    ]);
    expect(runSpy).toHaveBeenNthCalledWith(2, "git", ["fetch"], {
      cwd: gitRootPath,
    });
    expect(runSpy).toHaveBeenNthCalledWith(
      3,
      "git",
      [
        "worktree",
        "add",
        "--no-track",
        "-b",
        branchName,
        relativeWorktreePath,
        sourceBranch,
      ],
      { cwd: gitRootPath },
    );
    expect(worktreePath).toBe("/repo/project.worktrees/feature/test");
    expect(spinnerMocks.succeed).toHaveBeenCalled();
  });

  it("adds a tracking worktree when checking out a remote branch", async () => {
    const runSpy = vi.spyOn(cli, "run").mockResolvedValue("");
    runSpy.mockResolvedValueOnce(gitRootPath);

    await gitCreateWorktree(branchName, sourceBranch, { isCheckout: true });

    expect(runSpy).toHaveBeenCalledTimes(3);
    expect(runSpy).toHaveBeenNthCalledWith(
      3,
      "git",
      [
        "worktree",
        "add",
        "--track",
        "-b",
        branchName,
        relativeWorktreePath,
        sourceBranch,
      ],
      { cwd: gitRootPath },
    );
  });

  it("keeps a git root containing a space in one cwd and one argv entry", async () => {
    const runSpy = vi.spyOn(cli, "run").mockResolvedValue("");
    runSpy.mockResolvedValueOnce(spacedGitRootPath);

    const worktreePath = await gitCreateWorktree(branchName, sourceBranch);

    expect(runSpy).toHaveBeenCalledTimes(3);
    expect(runSpy).toHaveBeenNthCalledWith(2, "git", ["fetch"], {
      cwd: spacedGitRootPath,
    });
    expect(runSpy).toHaveBeenNthCalledWith(
      3,
      "git",
      [
        "worktree",
        "add",
        "--no-track",
        "-b",
        branchName,
        "../my project.worktrees/feature/test",
        sourceBranch,
      ],
      { cwd: spacedGitRootPath },
    );
    expect(worktreePath).toBe("/repo/my project.worktrees/feature/test");
  });

  // The sequential awaits stand in for the `&&` chain, so a failing fetch has to
  // stop the sequence rather than let the add run anyway.
  it("does not add the worktree when the fetch fails", async () => {
    const runSpy = vi
      .spyOn(cli, "run")
      .mockResolvedValueOnce(gitRootPath)
      .mockRejectedValueOnce(new Error("Command failed: git fetch"));

    await expect(gitCreateWorktree(branchName, sourceBranch)).rejects.toThrow(
      "Command failed: git fetch",
    );

    // The root lookup and the fetch, and nothing after them.
    expect(runSpy).toHaveBeenCalledTimes(2);
    expect(spinnerMocks.fail).toHaveBeenCalledWith("Command failed: git fetch");
    expect(spinnerMocks.succeed).not.toHaveBeenCalled();
  });
});

describe("gitNukeWorktreeCmd", () => {
  const branchName = "feature/test";

  beforeEach(() => {
    vi.clearAllMocks();
    expectCommands(
      `git worktree remove ${branchName}`,
      `git worktree remove ${branchName} --force`,
      "git worktree prune",
      `git branch -D ${branchName}`,
    );
  });

  it("removes, prunes and deletes the branch in that order", async () => {
    const runSpy = vi.spyOn(cli, "run").mockResolvedValue("");

    await gitNukeWorktreeCmd(branchName);

    expect(runSpy).toHaveBeenCalledTimes(3);
    expect(runSpy).toHaveBeenNthCalledWith(1, "git", [
      "worktree",
      "remove",
      branchName,
    ]);
    expect(runSpy).toHaveBeenNthCalledWith(2, "git", ["worktree", "prune"]);
    expect(runSpy).toHaveBeenNthCalledWith(3, "git", [
      "branch",
      "-D",
      branchName,
    ]);
  });

  it("appends --force to the remove when forced", async () => {
    const runSpy = vi.spyOn(cli, "run").mockResolvedValue("");

    await gitNukeWorktreeCmd(branchName, { force: true });

    expect(runSpy).toHaveBeenCalledTimes(3);
    expect(runSpy).toHaveBeenNthCalledWith(1, "git", [
      "worktree",
      "remove",
      branchName,
      "--force",
    ]);
  });

  // The sequential awaits stand in for the `&&` chain, so a failing remove has
  // to stop the sequence rather than prune and delete the branch anyway.
  it("does not prune or delete the branch when the remove fails", async () => {
    const runSpy = vi
      .spyOn(cli, "run")
      .mockRejectedValueOnce(new Error("Command failed: git worktree remove"));

    await expect(gitNukeWorktreeCmd(branchName)).rejects.toThrow(
      "Command failed: git worktree remove",
    );

    expect(runSpy).toHaveBeenCalledTimes(1);
  });

  it("does not delete the branch when the prune fails", async () => {
    const runSpy = vi
      .spyOn(cli, "run")
      .mockResolvedValueOnce("")
      .mockRejectedValueOnce(new Error("Command failed: git worktree prune"));

    await expect(gitNukeWorktreeCmd(branchName)).rejects.toThrow(
      "Command failed: git worktree prune",
    );

    expect(runSpy).toHaveBeenCalledTimes(2);
  });
});

describe("isSafeToRemove", () => {
  function entry(
    overrides: Partial<WorktreeListEntry> = {},
  ): WorktreeListEntry {
    return {
      path: "/repo/project.worktrees/test",
      branchName: "feature/test",
      pathExists: true,
      remote: "",
      uncommittedChanges: 0,
      ...overrides,
    };
  }

  it("is safe when the worktree directory no longer exists", () => {
    expect(isSafeToRemove(entry({ pathExists: false }))).toBe(true);
  });

  it("is safe when the tracked remote branch was deleted", () => {
    expect(
      isSafeToRemove(
        entry({ remote: "origin/feature/test", remoteExists: false }),
      ),
    ).toBe(true);
  });

  it("is safe with no remote and nothing pending", () => {
    expect(isSafeToRemove(entry())).toBe(true);
  });

  it("is not safe when no branch matches", () => {
    expect(
      isSafeToRemove(
        entry({
          remote: "origin/feature/test",
          remoteExists: true,
          ahead: 2,
        }),
      ),
    ).toBe(false);
  });

  it("is not safe when the remote was deleted but work is uncommitted", () => {
    expect(
      isSafeToRemove(
        entry({
          remote: "origin/feature/test",
          remoteExists: false,
          uncommittedChanges: 3,
        }),
      ),
    ).toBe(false);
  });

  it("is still safe when the remote was deleted and nothing is uncommitted", () => {
    expect(
      isSafeToRemove(
        entry({
          remote: "origin/feature/test",
          remoteExists: false,
          uncommittedChanges: 0,
        }),
      ),
    ).toBe(true);
  });

  // An unknown count must not read as "has changes" — the field is optional, so
  // the hoisted test is a truthiness check rather than a comparison against 0.
  it("is still safe when the remote was deleted and the count is unknown", () => {
    expect(
      isSafeToRemove(
        entry({
          remote: "origin/feature/test",
          remoteExists: false,
          uncommittedChanges: undefined,
        }),
      ),
    ).toBe(true);
  });

  it("is safe with no remote and an unknown uncommitted count", () => {
    expect(isSafeToRemove(entry({ uncommittedChanges: undefined }))).toBe(true);
  });
});

describe("gitGetWorktreeList agent join", () => {
  const rootPath = "/repo/project";
  const onePath = `${rootPath}.worktrees/feature/one`;
  const twoPath = `${rootPath}.worktrees/feature/two`;

  function session(overrides: Partial<AgentSession> = {}): AgentSession {
    return { name: "feature-one-1f", pid: 9187, cwd: onePath, ...overrides };
  }

  // Every git call gitGetWorktreeList makes, in order, for two worktrees that
  // track no remote — which is what keeps the ahead/behind pair out of the
  // sequence. The session lookup itself is stubbed rather than driven through
  // run(), because agent.test.ts already owns its parsing.
  function mockWorktreeListRun() {
    expectCommands(
      "git fetch --prune",
      "git --no-pager branch -r",
      'git for-each-ref "--format=%(refname:short) <- %(upstream:short)" refs/heads',
      "git branch --show-current",
      "git rev-parse --show-toplevel",
      "git worktree list",
      `git status -s (cwd: ${onePath})`,
      `git status -s (cwd: ${twoPath})`,
    );

    mockRun
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("main")
      .mockResolvedValueOnce(rootPath)
      .mockResolvedValueOnce(
        [
          `${onePath}  abc1234 [feature/one]`,
          `${twoPath}  def5678 [feature/two]`,
        ].join(EOL),
      )
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("");
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    mockWorktreeListRun();
  });

  it("performs no session lookup and sets no agent by default", async () => {
    const sessionsSpy = vi.spyOn(agent, "getAgentSessions");

    const worktrees = await gitGetWorktreeList();

    expect(sessionsSpy).not.toHaveBeenCalled();
    expect(worktrees.map((wt) => wt.agent)).toEqual([undefined, undefined]);
  });

  // The R4 guard: one invocation for the whole run, not one per worktree.
  it("looks sessions up once for the whole run and joins them by cwd", async () => {
    const sessionsSpy = vi
      .spyOn(agent, "getAgentSessions")
      .mockResolvedValue([session()]);

    const worktrees = await gitGetWorktreeList({ includeAgents: true });

    expect(sessionsSpy).toHaveBeenCalledTimes(1);
    expect(worktrees[0].agent).toEqual({
      name: "feature-one-1f",
      pid: 9187,
      interactive: false,
      waiting: false,
    });
    expect(worktrees[1].agent).toBeUndefined();
  });

  it("carries the interactive marker without exposing the raw session shape", async () => {
    vi.spyOn(agent, "getAgentSessions").mockResolvedValue([
      session({ kind: "interactive" }),
    ]);

    const worktrees = await gitGetWorktreeList({ includeAgents: true });

    expect(worktrees[0].agent).toEqual({
      name: "feature-one-1f",
      pid: 9187,
      interactive: true,
      waiting: false,
    });
  });

  it("carries the waiting marker for a background session that is not progressing", async () => {
    vi.spyOn(agent, "getAgentSessions").mockResolvedValue([
      session({ kind: "background", state: "blocked" }),
    ]);

    const worktrees = await gitGetWorktreeList({ includeAgents: true });

    expect(worktrees[0].agent).toEqual({
      name: "feature-one-1f",
      pid: 9187,
      interactive: false,
      waiting: true,
    });
  });

  it("sets no agent when the runtime reports no sessions at all", async () => {
    vi.spyOn(agent, "getAgentSessions").mockResolvedValue([]);

    const worktrees = await gitGetWorktreeList({ includeAgents: true });

    expect(worktrees.map((wt) => wt.agent)).toEqual([undefined, undefined]);
  });
});
