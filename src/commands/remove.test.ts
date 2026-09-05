/** biome-ignore-all lint/suspicious/noExplicitAny: Allow any in tests */
import { checkbox, confirm } from "@inquirer/prompts";
import * as git from "../lib/git.js";
import Remove from "./remove.js";

vi.mock("@inquirer/prompts", () => ({
  checkbox: vi.fn(),
  confirm: vi.fn(),
  Separator: class Separator {
    constructor(public separator: string) {}
  },
}));

vi.mock("ora", () => ({
  default: vi.fn().mockReturnValue({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
  }),
}));

describe("remove command", () => {
  let remove: Remove;
  const mockCheckbox = vi.mocked(checkbox);
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

  beforeEach(() => {
    vi.clearAllMocks();
    const mockConfig = {
      runCommand: vi.fn().mockResolvedValue(undefined),
    } as any;
    remove = new Remove([], mockConfig);
  });

  describe("when no worktrees exist", () => {
    it("should log a message and return without prompting", async () => {
      vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([]);
      const logSpy = vi.spyOn(remove, "log").mockImplementation(() => {});

      (remove as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { force: false },
      });

      await remove.run();

      expect(logSpy).toHaveBeenCalledWith("No worktree branches found.");
      expect(mockCheckbox).not.toHaveBeenCalled();
    });
  });

  describe("when branchName arg is provided", () => {
    it("should remove the worktree directly without prompting", async () => {
      vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([safeWorktree]);
      const mockRemove = vi
        .spyOn(git, "gitRemoveWorktree")
        .mockResolvedValue(undefined);

      (remove as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feature/safe" },
        flags: { force: false },
      });

      await remove.run();

      expect(mockRemove).toHaveBeenCalledWith("feature/safe", { force: false });
      expect(mockCheckbox).not.toHaveBeenCalled();
    });

    it("should error when the branch is not found", async () => {
      vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([safeWorktree]);
      const mockError = vi
        .spyOn(remove as any, "error")
        .mockImplementation(() => {
          throw new Error('Branch "feature/nonexistent" not found.');
        });

      (remove as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feature/nonexistent" },
        flags: { force: false },
      });

      await expect(remove.run()).rejects.toThrow(
        'Branch "feature/nonexistent" not found.',
      );
      expect(mockError).toHaveBeenCalledWith(
        'Branch "feature/nonexistent" not found.',
      );
      expect(git.gitRemoveWorktree).not.toHaveBeenCalled();
    });

    it("should pass the force flag through to gitRemoveWorktree", async () => {
      vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([unsafeWorktree]);
      const mockRemove = vi
        .spyOn(git, "gitRemoveWorktree")
        .mockResolvedValue(undefined);

      (remove as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feature/unsafe" },
        flags: { force: true },
      });

      await remove.run();

      expect(mockRemove).toHaveBeenCalledWith("feature/unsafe", {
        force: true,
      });
    });
  });

  describe("interactive mode (no branchName arg)", () => {
    it("should return early without removing when nothing is selected", async () => {
      vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([safeWorktree]);
      mockCheckbox.mockResolvedValue([]);
      const mockRemove = vi
        .spyOn(git, "gitRemoveWorktreesWithProgress")
        .mockResolvedValue(undefined);

      (remove as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { force: false },
      });

      await remove.run();

      expect(mockCheckbox).toHaveBeenCalled();
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it("should remove selected safe worktrees without a confirmation prompt", async () => {
      vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([safeWorktree]);
      mockCheckbox.mockResolvedValue([safeWorktree]);
      const mockRemove = vi
        .spyOn(git, "gitRemoveWorktreesWithProgress")
        .mockResolvedValue(undefined);

      (remove as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { force: false },
      });

      await remove.run();

      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockRemove).toHaveBeenCalledWith([safeWorktree]);
    });

    it("should prompt for confirmation when an unsafe worktree is selected", async () => {
      vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([unsafeWorktree]);
      mockCheckbox.mockResolvedValue([unsafeWorktree]);
      mockConfirm.mockResolvedValue(true);
      const mockRemove = vi
        .spyOn(git, "gitRemoveWorktreesWithProgress")
        .mockResolvedValue(undefined);

      (remove as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { force: false },
      });

      await remove.run();

      expect(mockConfirm).toHaveBeenCalledWith({
        message:
          "Some selected branches are not safe to delete. Are you sure you want to continue?",
        default: false,
      });
      expect(mockRemove).toHaveBeenCalledWith([unsafeWorktree]);
    });

    it("should not remove when user declines the unsafe confirmation", async () => {
      vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([unsafeWorktree]);
      mockCheckbox.mockResolvedValue([unsafeWorktree]);
      mockConfirm.mockResolvedValue(false);
      const mockRemove = vi
        .spyOn(git, "gitRemoveWorktreesWithProgress")
        .mockResolvedValue(undefined);

      (remove as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { force: false },
      });

      await remove.run();

      expect(mockConfirm).toHaveBeenCalled();
      expect(mockRemove).not.toHaveBeenCalled();
    });

    it("should skip confirmation and remove unsafe worktrees when --force is set", async () => {
      vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([unsafeWorktree]);
      mockCheckbox.mockResolvedValue([unsafeWorktree]);
      const mockRemove = vi
        .spyOn(git, "gitRemoveWorktreesWithProgress")
        .mockResolvedValue(undefined);

      (remove as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { force: true },
      });

      await remove.run();

      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockRemove).toHaveBeenCalledWith([unsafeWorktree]);
    });

    it("should remove multiple selected worktrees in sequence", async () => {
      const secondSafeWorktree = {
        ...safeWorktree,
        branchName: "feature/safe2",
        path: "/path/to/project.worktrees/feature/safe2",
      };
      vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([
        safeWorktree,
        secondSafeWorktree,
      ]);
      mockCheckbox.mockResolvedValue([safeWorktree, secondSafeWorktree]);
      const mockRemove = vi
        .spyOn(git, "gitRemoveWorktreesWithProgress")
        .mockResolvedValue(undefined);

      (remove as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { force: false },
      });

      await remove.run();

      expect(mockRemove).toHaveBeenCalledTimes(1);
      expect(mockRemove).toHaveBeenCalledWith([
        safeWorktree,
        secondSafeWorktree,
      ]);
    });
  });

  describe("getWorktreeChoices", () => {
    it("should include separators when there are both safe and unsafe worktrees", async () => {
      vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([
        safeWorktree,
        unsafeWorktree,
      ]);
      mockCheckbox.mockResolvedValue([]);

      (remove as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { force: false },
      });

      await remove.run();

      const choices = mockCheckbox.mock.calls[0][0].choices;
      expect(choices.length).toBeGreaterThan(2);
    });

    it("should not include separators when all worktrees are safe", async () => {
      vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([safeWorktree]);
      mockCheckbox.mockResolvedValue([]);

      (remove as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { force: false },
      });

      await remove.run();

      const choices = mockCheckbox.mock.calls[0][0].choices;
      expect(choices).toHaveLength(1);
    });

    it("should not include separators when all worktrees are unsafe", async () => {
      vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([unsafeWorktree]);
      mockCheckbox.mockResolvedValue([]);

      (remove as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { force: false },
      });

      await remove.run();

      const choices = mockCheckbox.mock.calls[0][0].choices;
      expect(choices).toHaveLength(1);
    });
  });

  // Regression coverage for CLEANUP-DATA-LOSS-PLAN §4.3, which claims this
  // command needed no change of its own once isSafeToRemove stopped calling a
  // deleted-remote worktree safe while work sits in it. These cases pin that
  // claim so a later edit to either side cannot quietly undo it.
  describe("a worktree whose remote was deleted while work is uncommitted", () => {
    const mergedWithWorkEntry = {
      path: "/path/to/project.worktrees/feature/merged-with-work",
      branchName: "feature/merged-with-work",
      remote: "origin/feature/merged-with-work",
      remoteExists: false,
      pathExists: true,
      uncommittedChanges: 3,
    };
    // Taken from the real predicate rather than hand-set. Every other fixture
    // in this file supplies its own verdict, so it would keep passing even if
    // the classification regressed.
    const mergedWithWork = {
      ...mergedWithWorkEntry,
      safeToRemove: git.isSafeToRemove(mergedWithWorkEntry),
    };

    beforeEach(() => {
      (remove as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { force: false },
      });
    });

    it("should be classified as not safe to remove", () => {
      expect(mergedWithWork.safeToRemove).toBe(false);
    });

    it("should be grouped under Active branches, not Safe to delete", async () => {
      vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([
        safeWorktree,
        mergedWithWork,
      ]);
      mockCheckbox.mockResolvedValue([]);

      await remove.run();

      const choices = mockCheckbox.mock.calls[0][0].choices as any[];
      const activeGroupStart = choices.findIndex((choice) =>
        String(choice.separator ?? "").includes("Active branches"),
      );
      const index = choices.findIndex(
        (choice) => choice.value?.branchName === "feature/merged-with-work",
      );

      expect(activeGroupStart).toBeGreaterThan(-1);
      expect(index).toBeGreaterThan(activeGroupStart);
    });

    it("should prompt for confirmation when it is selected", async () => {
      vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([mergedWithWork]);
      mockCheckbox.mockResolvedValue([mergedWithWork]);
      mockConfirm.mockResolvedValue(true);
      const mockRemove = vi
        .spyOn(git, "gitRemoveWorktreesWithProgress")
        .mockResolvedValue(undefined);

      await remove.run();

      expect(mockConfirm).toHaveBeenCalledWith({
        message:
          "Some selected branches are not safe to delete. Are you sure you want to continue?",
        default: false,
      });
      expect(mockRemove).toHaveBeenCalledWith([mergedWithWork]);
    });

    it("should not remove it when the confirmation is declined", async () => {
      vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([mergedWithWork]);
      mockCheckbox.mockResolvedValue([mergedWithWork]);
      mockConfirm.mockResolvedValue(false);
      const mockRemove = vi
        .spyOn(git, "gitRemoveWorktreesWithProgress")
        .mockResolvedValue(undefined);

      await remove.run();

      expect(mockConfirm).toHaveBeenCalled();
      expect(mockRemove).not.toHaveBeenCalled();
    });
  });
});
