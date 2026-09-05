/** biome-ignore-all lint/suspicious/noExplicitAny: Allow any in tests */
import { confirm } from "@inquirer/prompts";
import ora from "ora";
import * as git from "../lib/git.js";
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

  beforeEach(() => {
    vi.clearAllMocks();
    const mockConfig = {
      runCommand: vi.fn().mockResolvedValue(undefined),
    } as any;
    cleanup = new Cleanup([], mockConfig);
  });

  it("returns early with success message when no stale worktrees exist", async () => {
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([unsafeWorktree]);
    const mockRemove = vi
      .spyOn(git, "gitRemoveWorktreesWithProgress")
      .mockResolvedValue(undefined);

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
      .mockResolvedValue(undefined);

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
      .mockResolvedValue(undefined);

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
      .mockResolvedValue(undefined);

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
      .mockResolvedValue(undefined);

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
      .mockResolvedValue(undefined);

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
      .mockResolvedValue(undefined);

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
      .mockResolvedValue(undefined);

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
    vi.spyOn(git, "gitRemoveWorktreesWithProgress").mockResolvedValue(
      undefined,
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
