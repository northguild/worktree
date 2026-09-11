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
  gitGetComparisonBase,
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
import type {
  AgentSession,
  WorktreeAgent,
  WorktreeListEntry,
} from "./types.js";

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

// D2's resolution order, one test per rung. The order is the decision: the
// config key answers "where do I branch from", which is not the same question,
// so it is only reached when the repository's own answer is missing.
describe("gitGetComparisonBase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    expectCommands(
      "git symbolic-ref --short refs/remotes/origin/HEAD",
      "git config northguild.worktree.defaultSourceBranch",
    );
  });

  it("resolves origin/HEAD, and does not reach the config key", async () => {
    const runSpy = vi.spyOn(cli, "run").mockResolvedValueOnce("origin/main");

    const base = await gitGetComparisonBase();

    expect(runSpy).toHaveBeenCalledWith("git", [
      "symbolic-ref",
      "--short",
      "refs/remotes/origin/HEAD",
    ]);
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(base).toBe("origin/main");
  });

  it("falls back to defaultSourceBranch when origin/HEAD is unset", async () => {
    const runSpy = vi
      .spyOn(cli, "run")
      .mockRejectedValueOnce(
        new Error("ref refs/remotes/origin/HEAD is not a symbolic ref"),
      )
      .mockResolvedValueOnce("origin/develop");

    const base = await gitGetComparisonBase();

    expect(runSpy).toHaveBeenNthCalledWith(2, "git", [
      "config",
      "northguild.worktree.defaultSourceBranch",
    ]);
    expect(base).toBe("origin/develop");
  });

  // symbolic-ref can exit 0 with nothing to say. An empty answer is no answer,
  // so it takes the same rung as a rejection rather than becoming the base.
  it("falls back when origin/HEAD resolves to an empty string", async () => {
    vi.spyOn(cli, "run")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("origin/develop");

    expect(await gitGetComparisonBase()).toBe("origin/develop");
  });

  // The third rung. "" is what D1 turns into "not safe" — it must never be
  // confused with a base that resolved and counted zero.
  it("returns an empty string when neither origin/HEAD nor the config resolves", async () => {
    vi.spyOn(cli, "run")
      .mockRejectedValueOnce(new Error("no origin"))
      .mockRejectedValueOnce(new Error("key unset"));

    expect(await gitGetComparisonBase()).toBe("");
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
      `git rev-list --count origin/main..HEAD (cwd: ${worktreePath})`,
      `git rev-list --count HEAD..origin/main (cwd: ${worktreePath})`,
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

  // The parameter Phase 2 needs: an explicit base, for a worktree where `@{u}`
  // does not resolve at all. Every existing caller passes nothing and keeps the
  // upstream form above.
  it("counts ahead against an explicit base", async () => {
    const runSpy = vi.spyOn(cli, "run").mockResolvedValueOnce("1");

    const count = await gitGetCommitsAheadCount(worktreePath, "origin/main");

    expect(runSpy).toHaveBeenCalledWith(
      "git",
      ["rev-list", "--count", "origin/main..HEAD"],
      { cwd: worktreePath },
    );
    expect(count).toBe(1);
  });

  it("counts behind against an explicit base", async () => {
    const runSpy = vi.spyOn(cli, "run").mockResolvedValueOnce("4");

    const count = await gitGetCommitsBehindCount(worktreePath, "origin/main");

    expect(runSpy).toHaveBeenCalledWith(
      "git",
      ["rev-list", "--count", "HEAD..origin/main"],
      { cwd: worktreePath },
    );
    expect(count).toBe(4);
  });

  // The empty base is gitGetComparisonBase()'s "nothing resolved". git answers
  // `rev-list --count ..HEAD` with 0 at exit 0, so the guard has to be here —
  // reaching git at all would fabricate the zero D1 rejects.
  //
  // `not.toHaveBeenCalled()` is the assertion that pins this, and it is not
  // redundant next to `toBeUndefined()`: the run mock has no default value, so
  // with the guard removed the call resolves undefined and the result is
  // undefined anyway. Remove the spy assertion and both tests pass whether or
  // not the defect is present.
  it("returns undefined for an empty ahead base, without calling git", async () => {
    const runSpy = vi.spyOn(cli, "run");

    const count = await gitGetCommitsAheadCount(worktreePath, "");

    expect(count).toBeUndefined();
    expect(runSpy).not.toHaveBeenCalled();
  });

  it("returns undefined for an empty behind base, without calling git", async () => {
    const runSpy = vi.spyOn(cli, "run");

    const count = await gitGetCommitsBehindCount(worktreePath, "");

    expect(count).toBeUndefined();
    expect(runSpy).not.toHaveBeenCalled();
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

  function liveAgent(overrides: Partial<WorktreeAgent> = {}): WorktreeAgent {
    return { name: "feature-test-1f", pid: 9187, live: true, ...overrides };
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

  // The ordering guard for the path branch, which every case above leaves free
  // to move because they all pair a missing path with a zero count. Hoisting the
  // uncommitted test above it would flip this one to `false`. See findings.md
  // F-002.
  it("is safe when the directory is gone even with uncommitted work", () => {
    expect(
      isSafeToRemove(entry({ pathExists: false, uncommittedChanges: 3 })),
    ).toBe(true);
  });

  it("is not safe when a live agent session is living in it", () => {
    expect(isSafeToRemove(entry({ agent: liveAgent() }))).toBe(false);
  });

  it("is safe again once the session living in it has finished", () => {
    expect(isSafeToRemove(entry({ agent: liveAgent({ live: false }) }))).toBe(
      true,
    );
  });

  // Fails safe: `live` is optional on WorktreeAgent, so an entry that records a
  // session without saying whether it finished blocks removal rather than being
  // waved through. See AGENT-MODE-PLAN §3 D6.
  it("is not safe when the session carries no liveness marker at all", () => {
    expect(
      isSafeToRemove(entry({ agent: { name: "one-1f", pid: 9187 } })),
    ).toBe(false);
  });

  // The same ordering guard for the agent branch: a directory that is already
  // gone holds nothing to lose, whoever the session listing still believes is
  // in it.
  it("is safe when the directory is gone even with a session recorded in it", () => {
    expect(
      isSafeToRemove(entry({ pathExists: false, agent: liveAgent() })),
    ).toBe(true);
  });

  // A live session outranks uncommitted work, which is the same judgement made
  // about a smaller loss — so the verdict does not change when both are present.
  it("is not safe when a live session and uncommitted work are both present", () => {
    expect(
      isSafeToRemove(entry({ agent: liveAgent(), uncommittedChanges: 3 })),
    ).toBe(false);
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
  // track no remote. That used to be what kept the ahead/behind pair out of
  // the sequence; it no longer is. `ahead` is counted for both of them now,
  // against the run's comparison base — which is itself one call, taken once
  // before the loop rather than per worktree. `behind` is still absent, and
  // that absence is D4 rather than an oversight. The session lookup is stubbed
  // rather than driven through run(), because agent.test.ts owns its parsing.
  function mockWorktreeListRun() {
    expectCommands(
      "git fetch --prune",
      "git --no-pager branch -r",
      'git for-each-ref "--format=%(refname:short) <- %(upstream:short)" refs/heads',
      "git branch --show-current",
      "git rev-parse --show-toplevel",
      "git worktree list",
      "git symbolic-ref --short refs/remotes/origin/HEAD",
      `git rev-list --count origin/main..HEAD (cwd: ${onePath})`,
      `git status -s (cwd: ${onePath})`,
      `git rev-list --count origin/main..HEAD (cwd: ${twoPath})`,
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
      .mockResolvedValueOnce("origin/main")
      .mockResolvedValueOnce("1")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("0")
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
      live: true,
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
      live: true,
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
      live: true,
      interactive: false,
      waiting: true,
    });
  });

  // The finished session still joins — `list` names it — but it carries the
  // marker cleanup reads, which is the whole reason liveness crosses this
  // boundary rather than staying inside agent.ts. See AGENT-MODE-PLAN §3 D6.
  it("marks a finished session as not live", async () => {
    vi.spyOn(agent, "getAgentSessions").mockResolvedValue([
      session({ kind: "background", state: "done" }),
    ]);

    const worktrees = await gitGetWorktreeList({ includeAgents: true });

    expect(worktrees[0].agent).toEqual({
      name: "feature-one-1f",
      pid: 9187,
      live: false,
      interactive: false,
      waiting: false,
    });
  });

  it("sets no agent when the runtime reports no sessions at all", async () => {
    vi.spyOn(agent, "getAgentSessions").mockResolvedValue([]);

    const worktrees = await gitGetWorktreeList({ includeAgents: true });

    expect(worktrees.map((wt) => wt.agent)).toEqual([undefined, undefined]);
  });
});

// What Phase 2 of UNPUSHED-COMMIT-GUARD-PLAN (issue #63) is for: the ahead
// count is taken for every worktree whose directory is there, not only for
// those with an upstream. A branch nobody ever pushed is precisely the case
// the old `remoteExists` guard skipped, and skipping it is what let such a
// worktree read as empty.
describe("gitGetWorktreeList ahead counting", () => {
  const rootPath = "/repo/project";
  const onePath = `${rootPath}.worktrees/feature/one`;

  // The six calls every run makes before the first worktree is looked at.
  function mockRunPreamble(tracking: string, remoteBranches = "") {
    mockRun
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce(remoteBranches)
      .mockResolvedValueOnce(tracking)
      .mockResolvedValueOnce("main")
      .mockResolvedValueOnce(rootPath)
      .mockResolvedValueOnce(`${onePath}  abc1234 [feature/one]`);
  }

  function expectPreamble() {
    expectCommands(
      "git fetch --prune",
      "git --no-pager branch -r",
      'git for-each-ref "--format=%(refname:short) <- %(upstream:short)" refs/heads',
      "git branch --show-current",
      "git rev-parse --show-toplevel",
      "git worktree list",
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
  });

  // The incident, inverted. This is the assertion the whole feature exists to
  // make true: a never-pushed branch carrying one commit reports ahead: 1.
  it("counts ahead against the comparison base for a never-pushed branch", async () => {
    expectPreamble();
    expectCommands(
      "git symbolic-ref --short refs/remotes/origin/HEAD",
      `git rev-list --count origin/main..HEAD (cwd: ${onePath})`,
      `git status -s (cwd: ${onePath})`,
    );
    mockRunPreamble("feature/one <-");
    mockRun
      .mockResolvedValueOnce("origin/main")
      .mockResolvedValueOnce("1")
      .mockResolvedValueOnce("");

    const [worktree] = await gitGetWorktreeList();

    expect(worktree.ahead).toBe(1);
    expect(worktree.aheadUnknownReason).toBeUndefined();
  });

  // R3: `behind` stays undefined for a worktree with no upstream, by design
  // and not by accident. Counting it against the default branch would be
  // non-zero for nearly every worktree, and it is a conjunct of a safety
  // clause — cleanup would stop removing anything at all. Pinned so the next
  // clause written against `behind` cannot inherit the original trap quietly.
  it("leaves behind undefined for a branch with no upstream", async () => {
    expectPreamble();
    expectCommands(
      "git symbolic-ref --short refs/remotes/origin/HEAD",
      `git rev-list --count origin/main..HEAD (cwd: ${onePath})`,
      `git status -s (cwd: ${onePath})`,
    );
    mockRunPreamble("feature/one <-");
    mockRun
      .mockResolvedValueOnce("origin/main")
      .mockResolvedValueOnce("2")
      .mockResolvedValueOnce("");

    const [worktree] = await gitGetWorktreeList();

    expect(worktree.behind).toBeUndefined();
    expect(worktree.ahead).toBe(2);
  });

  // The upstream arm is unchanged: where a branch tracks a remote that still
  // exists, both counts are taken against `@{u}` exactly as before.
  it("still counts both against the upstream where one exists", async () => {
    expectPreamble();
    expectCommands(
      "git symbolic-ref --short refs/remotes/origin/HEAD",
      `git rev-list --count @{u}..HEAD (cwd: ${onePath})`,
      `git rev-list --count HEAD..@{u} (cwd: ${onePath})`,
      `git status -s (cwd: ${onePath})`,
    );
    mockRunPreamble(
      "feature/one <- origin/feature/one",
      "  origin/feature/one",
    );
    mockRun
      .mockResolvedValueOnce("origin/main")
      .mockResolvedValueOnce("3")
      .mockResolvedValueOnce("4")
      .mockResolvedValueOnce("");

    const [worktree] = await gitGetWorktreeList();

    expect(worktree.ahead).toBe(3);
    expect(worktree.behind).toBe(4);
    expect(worktree.aheadUnknownReason).toBeUndefined();
  });

  // D5, first path: nothing resolved a base at all. The count is not taken —
  // git is never asked, because `rev-list --count ..HEAD` would answer 0 at
  // exit 0 — and the entry says why rather than looking like a clean worktree.
  it("reports why when no comparison base resolves, without asking git to count", async () => {
    expectPreamble();
    expectCommands(
      "git symbolic-ref --short refs/remotes/origin/HEAD",
      "git config northguild.worktree.defaultSourceBranch",
      `git status -s (cwd: ${onePath})`,
    );
    mockRunPreamble("feature/one <-");
    mockRun
      .mockRejectedValueOnce(new Error("no origin/HEAD"))
      .mockRejectedValueOnce(new Error("key unset"))
      .mockResolvedValueOnce("");

    const [worktree] = await gitGetWorktreeList();

    expect(worktree.ahead).toBeUndefined();
    expect(worktree.aheadUnknownReason).toContain("no comparison base");
    // The half of this test's name that the expectCommands harness cannot
    // carry: that list only warns on an undeclared call, so the assertion has
    // to be made here. Asking git at all is what produces the fabricated zero.
    const revListCalls = mockRun.mock.calls.filter(
      (call) => call[1]?.[0] === "rev-list",
    );
    expect(revListCalls).toHaveLength(0);
  });

  // D5, second path: a base resolved but names a ref git cannot find — a
  // defaultSourceBranch pointing at a deleted branch (R4). The rejection is
  // caught rather than failing the whole command, and the reason names the
  // base so the user can see which ref is wrong.
  it("reports the base by name when it will not resolve", async () => {
    expectPreamble();
    expectCommands(
      "git symbolic-ref --short refs/remotes/origin/HEAD",
      `git rev-list --count origin/gone..HEAD (cwd: ${onePath})`,
      `git status -s (cwd: ${onePath})`,
    );
    mockRunPreamble("feature/one <-");
    mockRun
      .mockResolvedValueOnce("origin/gone")
      .mockRejectedValueOnce(new Error("unknown revision origin/gone"))
      .mockResolvedValueOnce("");

    const [worktree] = await gitGetWorktreeList();

    expect(worktree.ahead).toBeUndefined();
    expect(worktree.aheadUnknownReason).toContain("origin/gone");
  });

  // The base is one call for the whole run, not one per worktree — the loop is
  // serial and this gather has four callers. See §4.1 and §5 R1.
  it("resolves the comparison base once for a run covering two worktrees", async () => {
    const twoPath = `${rootPath}.worktrees/feature/two`;
    expectPreamble();
    expectCommands(
      "git symbolic-ref --short refs/remotes/origin/HEAD",
      `git rev-list --count origin/main..HEAD (cwd: ${onePath})`,
      `git status -s (cwd: ${onePath})`,
      `git rev-list --count origin/main..HEAD (cwd: ${twoPath})`,
      `git status -s (cwd: ${twoPath})`,
    );
    mockRun
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce(`feature/one <-${EOL}feature/two <-`)
      .mockResolvedValueOnce("main")
      .mockResolvedValueOnce(rootPath)
      .mockResolvedValueOnce(
        [
          `${onePath}  abc1234 [feature/one]`,
          `${twoPath}  def5678 [feature/two]`,
        ].join(EOL),
      )
      .mockResolvedValueOnce("origin/main")
      .mockResolvedValueOnce("1")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("0")
      .mockResolvedValueOnce("");

    const worktrees = await gitGetWorktreeList();

    const symbolicRefCalls = mockRun.mock.calls.filter(
      (call) => call[1]?.[0] === "symbolic-ref",
    );
    expect(symbolicRefCalls).toHaveLength(1);
    expect(worktrees.map((wt) => wt.ahead)).toEqual([1, 0]);
  });
});
