import { expectCommands } from "../test-setup.js";
import * as cli from "./cli.js";
import {
  getCurrentBranchName,
  gitGetAbsoluteWorktreesPath,
  gitGetCommitsAheadCount,
  gitGetCommitsBehindCount,
  gitGetConfigValue,
  gitGetLocalBranches,
  gitGetLocalBranchesTracking,
  gitGetRemoteBranches,
  gitGetRootPath,
  gitGetUncommittedChangesCount,
  gitSetConfigValue,
  isSafeToRemove,
} from "./git.js";
import type { WorktreeListEntry } from "./types.js";

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
    vi.spyOn(cli, "cmd").mockResolvedValueOnce(
      "* main\n+ feature/in-other-worktree\n  feature/test",
    );

    const branches = await gitGetLocalBranches();

    expect(branches).toEqual([
      "main",
      "feature/in-other-worktree",
      "feature/test",
    ]);
    expect(cli.cmd).toHaveBeenCalledWith("git --no-pager branch");
  });

  it("prunes and lists remote branches without symbolic refs", async () => {
    const cmdSpy = vi.spyOn(cli, "cmd");
    cmdSpy
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce(
        "  origin/HEAD -> origin/main\n  origin/main\n  origin/feature/test",
      );

    const branches = await gitGetRemoteBranches();

    expect(cmdSpy).toHaveBeenNthCalledWith(1, "git fetch --prune");
    expect(cmdSpy).toHaveBeenNthCalledWith(2, "git --no-pager branch -r");
    expect(branches).toEqual(["origin/main", "origin/feature/test"]);
  });
});

describe("git config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    expectCommands(
      "git config northguild.worktree.defaultSourceBranch",
      'git config northguild.worktree.codeEditor "code"',
    );
  });

  it("returns git config value", async () => {
    const cmdSpy = vi.spyOn(cli, "cmd").mockResolvedValueOnce("origin/main");

    const value = await gitGetConfigValue("defaultSourceBranch");

    expect(cmdSpy).toHaveBeenCalledWith(
      "git config northguild.worktree.defaultSourceBranch",
    );
    expect(value).toBe("origin/main");
  });

  it("returns empty string when git config lookup fails", async () => {
    const cmdSpy = vi.spyOn(cli, "cmd").mockRejectedValueOnce(new Error());

    const value = await gitGetConfigValue("defaultSourceBranch");

    expect(cmdSpy).toHaveBeenCalledWith(
      "git config northguild.worktree.defaultSourceBranch",
    );
    expect(value).toBe("");
  });

  it("sets git config value", async () => {
    const cmdSpy = vi.spyOn(cli, "cmd").mockResolvedValueOnce("");

    await gitSetConfigValue("codeEditor", "code");

    expect(cmdSpy).toHaveBeenCalledWith(
      'git config northguild.worktree.codeEditor "code"',
    );
  });
});

describe("git root path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    expectCommands(
      "git rev-parse  --show-toplevel",
      "git rev-parse --absolute-git-dir",
    );
  });

  it("returns top-level path when not in a worktree path", async () => {
    const cmdSpy = vi.spyOn(cli, "cmd").mockResolvedValueOnce("/repo/project");

    const path = await gitGetRootPath();

    expect(cmdSpy).toHaveBeenCalledWith("git rev-parse  --show-toplevel");
    expect(path).toBe("/repo/project");
  });

  it("resolves main repo root when current path is in .worktrees", async () => {
    const cmdSpy = vi.spyOn(cli, "cmd");
    cmdSpy
      .mockResolvedValueOnce("/repo/project.worktrees/feature-x")
      .mockResolvedValueOnce("/repo/project/.git/worktrees/feature-x");

    const path = await gitGetRootPath();

    expect(cmdSpy).toHaveBeenNthCalledWith(1, "git rev-parse  --show-toplevel");
    expect(cmdSpy).toHaveBeenNthCalledWith(
      2,
      "git rev-parse --absolute-git-dir",
    );
    expect(path).toBe("/repo/project");
  });

  it("throws a friendly error when git commands fail", async () => {
    vi.spyOn(cli, "cmd").mockRejectedValueOnce(new Error("not a repo"));

    await expect(gitGetRootPath()).rejects.toThrow(
      "Git: Unable find the root path. Are you in a git repository?",
    );
  });

  it("builds absolute worktrees path from repo root", async () => {
    vi.spyOn(cli, "cmd").mockResolvedValueOnce("/repo/project");

    const worktreesPath = await gitGetAbsoluteWorktreesPath();

    expect(worktreesPath).toBe("/repo/project.worktrees");
  });
});

describe("git status and tracking helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    expectCommands(
      "git branch --show-current",
      "cd /repo/project.worktrees/test && git rev-list --count @{u}..HEAD",
      "cd /repo/project.worktrees/test && git rev-list --count HEAD..@{u}",
      "cd /repo/project.worktrees/test && git status -s",
      "git for-each-ref --format='%(refname:short) <- %(upstream:short)' refs/heads",
    );
  });

  it("returns current branch name", async () => {
    const cmdSpy = vi.spyOn(cli, "cmd").mockResolvedValueOnce("feature/test");

    const branchName = await getCurrentBranchName();

    expect(cmdSpy).toHaveBeenCalledWith("git branch --show-current");
    expect(branchName).toBe("feature/test");
  });

  it("parses ahead commit count", async () => {
    const cmdSpy = vi.spyOn(cli, "cmd").mockResolvedValueOnce("3");

    const count = await gitGetCommitsAheadCount("/repo/project.worktrees/test");

    expect(cmdSpy).toHaveBeenCalledWith(
      "cd /repo/project.worktrees/test && git rev-list --count @{u}..HEAD",
    );
    expect(count).toBe(3);
  });

  it("returns undefined for empty ahead commit count", async () => {
    vi.spyOn(cli, "cmd").mockResolvedValueOnce("");

    const count = await gitGetCommitsAheadCount("/repo/project.worktrees/test");

    expect(count).toBeUndefined();
  });

  it("parses behind commit count", async () => {
    const cmdSpy = vi.spyOn(cli, "cmd").mockResolvedValueOnce("2");

    const count = await gitGetCommitsBehindCount(
      "/repo/project.worktrees/test",
    );

    expect(cmdSpy).toHaveBeenCalledWith(
      "cd /repo/project.worktrees/test && git rev-list --count HEAD..@{u}",
    );
    expect(count).toBe(2);
  });

  it("counts uncommitted changes from git status -s", async () => {
    vi.spyOn(cli, "cmd").mockResolvedValueOnce("M a.ts\nA b.ts\n?? c.ts");

    const count = await gitGetUncommittedChangesCount(
      "/repo/project.worktrees/test",
    );

    expect(count).toBe(3);
  });

  it("returns zero uncommitted changes for empty status", async () => {
    vi.spyOn(cli, "cmd").mockResolvedValueOnce("");

    const count = await gitGetUncommittedChangesCount(
      "/repo/project.worktrees/test",
    );

    expect(count).toBe(0);
  });

  it("parses local to remote tracking branch map", async () => {
    vi.spyOn(cli, "cmd").mockResolvedValueOnce(
      "main <- origin/main\nfeature/test <- origin/feature/test\nlocal-only <-",
    );

    const tracking = await gitGetLocalBranchesTracking();

    expect(tracking).toEqual([
      { local: "main", remote: "origin/main" },
      { local: "feature/test", remote: "origin/feature/test" },
      { local: "local-only", remote: "" },
    ]);
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

  // Characterization of the defect described in CLEANUP-DATA-LOSS-PLAN §1: the
  // deleted-remote branch returns before the uncommitted-changes test is ever
  // reached, so work in progress is classified safe to remove. Phase 2 of that
  // plan overturns this assertion.
  it("is safe when the remote was deleted, even holding uncommitted changes", () => {
    expect(
      isSafeToRemove(
        entry({
          remote: "origin/feature/test",
          remoteExists: false,
          uncommittedChanges: 3,
        }),
      ),
    ).toBe(true);
  });
});
