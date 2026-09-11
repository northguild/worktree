/** biome-ignore-all lint/suspicious/noExplicitAny: Allow any in tests */
import { checkbox, confirm } from "@inquirer/prompts";
import * as herdr from "../integrations/herdr.js";
import * as git from "../lib/git.js";
import type { ConfigName } from "../lib/types.js";
import { mockRunCapturing } from "../test-setup.js";
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
    // No opener configured: every test in this block routes to `closeNothing`
    // and spawns no Herdr process. Spied rather than left to the global run()
    // mock so the gate is explicit, and so the undeclared `git config` call
    // does not warn on every test here.
    vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("");
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
        .mockImplementation(async (worktrees) => worktrees);

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
        .mockImplementation(async (worktrees) => worktrees);

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
        .mockImplementation(async (worktrees) => worktrees);

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
        .mockImplementation(async (worktrees) => worktrees);

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
        .mockImplementation(async (worktrees) => worktrees);

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
        .mockImplementation(async (worktrees) => worktrees);

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
        .mockImplementation(async (worktrees) => worktrees);

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
        .mockImplementation(async (worktrees) => worktrees);

      await remove.run();

      expect(mockConfirm).toHaveBeenCalled();
      expect(mockRemove).not.toHaveBeenCalled();
    });
  });
});

/**
 * What `remove` does to the Herdr space of a worktree it deletes.
 *
 * Driven through the real seam rather than a stubbed `resolveSpaceCloser`: the
 * thing worth proving is that the command closes spaces, not that it called a
 * method that might. So the integration is spied at its two exports and the
 * command is run end to end.
 */
describe("remove command — the herdr closer", () => {
  const gitRootPath = "/path/to/project";
  const safePath = `${gitRootPath}.worktrees/feature/safe`;
  const otherPath = `${gitRootPath}.worktrees/feature/other`;

  const safeWorktree = {
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

  const otherWorktree = {
    ...safeWorktree,
    path: otherPath,
    branchName: "feature/other",
  };

  let remove: Remove;
  let mockClose: ReturnType<typeof vi.spyOn>;
  let mockList: ReturnType<typeof vi.spyOn>;
  /** What happened, in the order it happened. D2 is an ordering claim. */
  let calls: string[];

  function setConfig(values: Partial<Record<ConfigName, string>>) {
    vi.spyOn(git, "gitGetConfigValue").mockImplementation(
      async (name: ConfigName) => values[name] ?? "",
    );
  }

  function parseAs(args: object, flags: object = { force: false }) {
    (remove as any).parse = vi.fn().mockResolvedValue({ args, flags });
  }

  /** The single-branch helper, answering with what it removed. */
  function removalAnswers(entry: typeof safeWorktree | undefined) {
    vi.spyOn(git, "gitRemoveWorktree").mockImplementation(async () => {
      calls.push("remove");
      return entry;
    });
  }

  /** The set helper, answering with the entries it got through. */
  function setRemovalAnswers(entries: (typeof safeWorktree)[]) {
    vi.spyOn(git, "gitRemoveWorktreesWithProgress").mockImplementation(
      async () => {
        calls.push("remove");
        return entries;
      },
    );
  }

  function selects(worktrees: unknown[]) {
    vi.mocked(checkbox).mockResolvedValue(worktrees as never);
  }

  beforeEach(() => {
    vi.clearAllMocks();
    calls = [];
    remove = new Remove([], { runCommand: vi.fn() } as any);
    vi.spyOn(remove, "log").mockImplementation(() => {});
    vi.spyOn(git, "gitGetRootPath").mockResolvedValue(gitRootPath);
    vi.spyOn(git, "gitGetAbsoluteWorktreesPath").mockResolvedValue(
      `${gitRootPath}.worktrees`,
    );
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([
      safeWorktree,
      otherWorktree,
    ]);
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
            { path: otherPath, workspaceId: "wR" },
          ],
        };
      });
    mockClose = vi.spyOn(herdr, "closeHerdrWorkspace").mockResolvedValue();
    // Reset per test rather than left from the last one: vi.clearAllMocks
    // clears calls, not implementations, and vitest.config.ts sets no
    // restoreMocks — so a checkbox answer would otherwise outlive its test.
    selects([]);
    setConfig({ opener: "herdr" });
  });

  describe("one branch by name", () => {
    it("closes the space of the branch it removed", async () => {
      removalAnswers(safeWorktree);
      parseAs({ branchName: "feature/safe" });

      await remove.run();

      expect(mockClose).toHaveBeenCalledWith("wQ");
      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it("reads the listing before the removal, never after", async () => {
      // D2, and the single most load-bearing ordering in the feature: the
      // removal runs `git worktree prune`, which takes the entry out of Herdr's
      // listing too. Resolve afterwards and the map comes back empty — every
      // space orphaned, with nothing said about it.
      removalAnswers(safeWorktree);
      parseAs({ branchName: "feature/safe" });

      await remove.run();

      expect(calls).toEqual(["list", "remove"]);
    });

    it("closes nothing when the removal was declined or failed", async () => {
      // gitRemoveWorktree answers undefined for all three of its no-op paths,
      // and a space whose checkout is still on disk must not be closed (D4).
      removalAnswers(undefined);
      parseAs({ branchName: "feature/safe" });

      await remove.run();

      expect(mockClose).not.toHaveBeenCalled();
    });

    it("spawns no lookup at all when the branch was not found", async () => {
      // this.error throws before the closer is reached, so a run that removes
      // nothing costs no Herdr subprocess.
      parseAs({ branchName: "feature/missing" });

      await expect(remove.run()).rejects.toThrow();

      expect(mockList).not.toHaveBeenCalled();
      expect(mockClose).not.toHaveBeenCalled();
    });
  });

  describe("a selected set", () => {
    it("closes the space of the worktree it removed", async () => {
      setRemovalAnswers([safeWorktree]);
      selects([safeWorktree]);
      parseAs({});

      await remove.run();

      expect(mockClose).toHaveBeenCalledWith("wQ");
      expect(mockClose).toHaveBeenCalledTimes(1);
    });

    it("closes only the entries the helper got through, not everything selected", async () => {
      // The strict-subset case, and the one that carries "and no others": two
      // selected, one removed. Closing the space of a worktree still on disk is
      // worse than the orphan this feature prevents (D4).
      setRemovalAnswers([safeWorktree]);
      selects([safeWorktree, otherWorktree]);
      parseAs({});

      await remove.run();

      expect(mockClose).toHaveBeenCalledTimes(1);
      expect(mockClose).toHaveBeenCalledWith("wQ");
      expect(mockClose).not.toHaveBeenCalledWith("wR");
    });

    it("reads the listing before the removal, never after", async () => {
      setRemovalAnswers([safeWorktree]);
      selects([safeWorktree]);
      parseAs({});

      await remove.run();

      expect(calls).toEqual(["list", "remove"]);
    });

    it("spawns no lookup when nothing was selected", async () => {
      // The closer is resolved after the last prompt, so a run that removes
      // nothing costs no Herdr subprocess.
      selects([]);
      parseAs({});

      await remove.run();

      expect(mockList).not.toHaveBeenCalled();
    });

    it("spawns no lookup when the unsafe-selection confirmation is declined", async () => {
      selects([{ ...safeWorktree, safeToRemove: false }]);
      vi.mocked(confirm).mockResolvedValue(false);
      parseAs({});

      await remove.run();

      expect(mockList).not.toHaveBeenCalled();
      expect(mockClose).not.toHaveBeenCalled();
    });
  });

  it("spawns no herdr process at all for a non-herdr opener", async () => {
    // §2 — someone who never asked for Herdr pays nothing for this feature.
    setConfig({ opener: "" });
    removalAnswers(safeWorktree);
    parseAs({ branchName: "feature/safe" });

    await remove.run();

    expect(mockList).not.toHaveBeenCalled();
    expect(mockClose).not.toHaveBeenCalled();
    expect(mockRunCapturing).not.toHaveBeenCalled();
  });
});
