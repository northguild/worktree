/** biome-ignore-all lint/suspicious/noExplicitAny: Allow any in tests */
import fs from "node:fs";
import { checkbox, confirm } from "@inquirer/prompts";
import * as herdr from "../integrations/herdr.js";
import * as agent from "../lib/agent.js";
import * as config from "../lib/config.js";
import * as git from "../lib/git.js";
import { setNonInteractive } from "../lib/interaction.js";
import { MissingValueError } from "../lib/prompt.js";
import type { AgentSession, ConfigName } from "../lib/types.js";
import {
  captureOutput,
  loadConfig,
  mockRun,
  mockRunCapturing,
} from "../test-setup.js";
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
    vi.spyOn(config, "gitGetConfigValue").mockResolvedValue("");
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
        { code: "not_found" },
      );
      expect(git.gitRemoveWorktree).not.toHaveBeenCalled();
    });

    // Detached worktrees all share one label, so a path is the only argument
    // that reaches the second (#144).
    it("should find a detached worktree named by its path", async () => {
      const first = {
        ...safeWorktree,
        branchName: "(detached HEAD)",
        path: "/path/to/project.worktrees/d1",
      };
      const second = { ...first, path: "/path/to/project.worktrees/d2" };
      vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([first, second]);
      const mockRemove = vi
        .spyOn(git, "gitRemoveWorktree")
        .mockResolvedValue(second);
      const mockError = vi.spyOn(remove as any, "error");

      (remove as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: second.path },
        flags: { force: true },
      });

      await remove.run();

      expect(mockError).not.toHaveBeenCalled();
      expect(mockRemove).toHaveBeenCalledWith(second.path, { force: true });
    });

    // From inside a detached worktree `remove .` names the current one, which
    // is never listed, so it must be refused rather than reach a removal.
    it("should report a path that names no listed worktree as a path", async () => {
      vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([safeWorktree]);
      const mockError = vi
        .spyOn(remove as any, "error")
        .mockImplementation(() => {
          throw new Error('No worktree to remove at ".".');
        });

      (remove as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "." },
        flags: { force: true },
      });

      await expect(remove.run()).rejects.toThrow("No worktree to remove at");
      expect(mockError).toHaveBeenCalledWith('No worktree to remove at ".".', {
        code: "not_found",
      });
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

    it("should prompt for confirmation when only some of the selected worktrees are unsafe", async () => {
      vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([
        safeWorktree,
        unsafeWorktree,
      ]);
      mockCheckbox.mockResolvedValue([safeWorktree, unsafeWorktree]);
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
      expect(mockRemove).toHaveBeenCalledWith([safeWorktree, unsafeWorktree]);
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
      // A counted zero, so this stays a test about the uncommitted work it
      // names. After D1 an absent count would make it unsafe for a second
      // reason and the assertion would pass without proving anything.
      ahead: 0,
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

  describe("when non-interactive", () => {
    beforeEach(() => {
      setNonInteractive(true);
    });

    it("fails naming the branch and -f, without a picker, when no branch is given", async () => {
      vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([safeWorktree]);
      (remove as any).parse = vi.fn().mockResolvedValue({
        args: {},
        flags: { force: false },
      });

      await expect(remove.run()).rejects.toMatchObject({
        message: "no default for the branches to remove; pass <branchName> -f",
        oclif: { exit: 2 },
      });
      expect(mockCheckbox).not.toHaveBeenCalled();
      expect(mockConfirm).not.toHaveBeenCalled();
    });

    it("removes a named branch with -f without asking", async () => {
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
      expect(mockConfirm).not.toHaveBeenCalled();
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
    vi.spyOn(config, "gitGetConfigValue").mockImplementation(
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

    it("closes nothing when the removal was declined", async () => {
      // gitRemoveWorktree answers undefined for its two no-op paths, and a
      // space whose checkout is still on disk must not be closed (D4).
      removalAnswers(undefined);
      parseAs({ branchName: "feature/safe" });

      await remove.run();

      expect(mockClose).not.toHaveBeenCalled();
    });

    it("closes nothing when the removal failed", async () => {
      vi.spyOn(git, "gitRemoveWorktree").mockRejectedValue(
        new Error("Could not remove the worktree feature/safe: fatal: locked"),
      );
      parseAs({ branchName: "feature/safe" });

      await expect(remove.run()).rejects.toThrow("fatal: locked");

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

describe("remove command — --json", () => {
  const originalExitCode = process.exitCode;
  let output: ReturnType<typeof captureOutput>;

  const worktree = {
    path: "/path/to/project.worktrees/feature/safe",
    branchName: "feature/safe",
    remote: "",
    ahead: 0,
    remoteExists: false,
    pathExists: true,
    uncommittedChanges: 0,
    safeToRemove: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.exitCode = undefined;
    output = captureOutput();
    vi.spyOn(config, "gitGetConfigValue").mockResolvedValue("");
  });

  afterEach(() => {
    output.restore();
    process.exitCode = originalExitCode;
  });

  // Through `_run`, as oclif does: it prints the returned document and routes
  // a throw to `catch`.
  async function runJson(
    args: Record<string, unknown>,
    flags: Record<string, unknown> = {},
    closed: string[] = [],
  ) {
    const command = new Remove(["--json"], await loadConfig());
    (command as any).parse = vi.fn().mockResolvedValue({ args, flags });
    (command as any).parsed = true;
    vi.spyOn(command as any, "resolveSpaceCloser").mockResolvedValue(
      async () => closed,
    );
    await (command as any)._run();
  }

  it("prints one document with what was removed and the spaces closed", async () => {
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([worktree]);
    vi.spyOn(git, "gitRemoveWorktree").mockResolvedValue(worktree);

    await runJson({ branchName: "feature/safe" }, { force: true }, ["w5"]);

    expect(output.stdout().trim().split("\n")).toHaveLength(1);
    const document = output.document();
    expect(Object.keys(document).sort()).toEqual([
      "herdrSpacesClosed",
      "removed",
      "warnings",
    ]);
    expect(document).toEqual({
      removed: [{ branch: "feature/safe", path: worktree.path }],
      herdrSpacesClosed: ["w5"],
      warnings: [],
    });
    expect(process.exitCode).toBeUndefined();
  });

  it("fails as not_found for a branch that is not there", async () => {
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([worktree]);

    await runJson({ branchName: "feature/nope" }, { force: true });

    expect(output.document()).toEqual({
      error: {
        code: "not_found",
        message: 'Branch "feature/nope" not found.',
      },
    });
    expect(output.stderr()).toContain('Branch "feature/nope" not found.');
    expect(process.exitCode).toBe(2);
  });

  it("fails as not_found for a named branch when there are no worktrees at all", async () => {
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([]);

    await runJson({ branchName: "feature/nope" }, { force: true });

    expect(output.document()).toMatchObject({ error: { code: "not_found" } });
    expect(process.exitCode).toBe(2);
  });

  it("names the flag it needs, and removes nothing, without -f", async () => {
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([worktree]);
    const mockRemove = vi
      .spyOn(git, "gitRemoveWorktree")
      .mockRejectedValue(
        new MissingValueError("confirmation to remove feature/safe", "-f"),
      );

    await runJson({ branchName: "feature/safe" });

    expect(mockRemove).toHaveBeenCalledWith("feature/safe", {
      force: undefined,
    });
    expect(output.document()).toEqual({
      error: {
        code: "missing_value",
        message: "no default for confirmation to remove feature/safe; pass -f",
        details: { value: "confirmation to remove feature/safe", flag: "-f" },
      },
    });
    expect(process.exitCode).toBe(2);
  });

  it("needs <branchName>: with none it fails naming it, and prompts for nothing", async () => {
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([worktree]);

    await runJson({}, { force: true });

    expect(checkbox).not.toHaveBeenCalled();
    expect(output.document()).toEqual({
      error: {
        code: "missing_value",
        message: "no default for the branches to remove; pass <branchName> -f",
        details: {
          value: "the branches to remove",
          flag: "<branchName> -f",
        },
      },
    });
    expect(process.exitCode).toBe(2);
  });

  it("carries git's reason for a failed removal into the error document", async () => {
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([worktree]);
    vi.spyOn(git, "gitRemoveWorktree").mockRejectedValue(
      new Error(
        "Could not remove the worktree feature/safe: fatal: cannot remove a locked working tree",
      ),
    );

    await runJson({ branchName: "feature/safe" }, { force: true });

    expect(output.document()).toEqual({
      error: {
        code: "failed",
        message:
          "Could not remove the worktree feature/safe: fatal: cannot remove a locked working tree",
      },
    });
    expect(process.exitCode).toBe(1);
  });

  it("fails when the removal did not happen, rather than reporting an empty success", async () => {
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([worktree]);
    vi.spyOn(git, "gitRemoveWorktree").mockResolvedValue(undefined);

    await runJson({ branchName: "feature/safe" }, { force: true });

    expect(output.document()).toMatchObject({ error: { code: "failed" } });
    expect(process.exitCode).toBe(1);
  });

  it("reports an empty repository as an empty document", async () => {
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([]);

    await runJson({});

    expect(output.document()).toEqual({
      removed: [],
      herdrSpacesClosed: [],
      warnings: [],
    });
    expect(output.stdout()).not.toContain("No worktree branches found");
  });
});

describe("remove command — --help", () => {
  it("documents the --json shape and the exit codes", () => {
    const help = Remove.description ?? "";

    for (const key of ["removed", "herdrSpacesClosed", "warnings", "--force"]) {
      expect(help).toContain(key);
    }
    expect(help).toContain("0 success");
    expect(help).toContain("1 failure");
    expect(help).toContain("2 usage");
  });
});

/**
 * `remove` and a worktree an agent session is working in (#56, F-032).
 *
 * Driven through the real `gitGetWorktreeList` and `gitRemoveWorktree`, with
 * only the subprocess seam (`run`) and the session lookup stubbed, because the
 * claims are about how the two compose: one lookup per run, and the safety
 * verdict coming from `isSafeToRemove` rather than from a second rule here.
 *
 * Expected values come from the plan (D3, D4), cleanup's documented rule that a
 * session working in a worktree holds it back and one that is only idle does
 * not (#89), and `agentDetail`'s rendering of the `Agent:` detail.
 */
describe("remove command — agent sessions", () => {
  const originalExitCode = process.exitCode;
  const rootPath = "/repo/project";
  const busyPath = `${rootPath}.worktrees/feature/busy`;
  const idlePath = `${rootPath}.worktrees/feature/idle`;
  const prefix = "An agent session (busy-session) is working in this worktree.";
  const warning =
    "Removed feature/busy while an agent session (busy-session) was working in it.";

  // Working: a runtime `state` other than `done` blocks (agent.ts
  // isSessionBlocking). Idle: a runtime status of `idle` and nothing else.
  const busy: AgentSession = {
    name: "busy-session",
    cwd: busyPath,
    kind: "background",
    state: "running",
  };
  const idle: AgentSession = {
    name: "idle-session",
    cwd: idlePath,
    kind: "background",
    status: "idle",
  };

  let output: ReturnType<typeof captureOutput>;
  let sessionsSpy: ReturnType<typeof vi.spyOn>;
  let removedPaths: string[];

  // oclif's `warn` wraps at the terminal width and prefixes every line with ›.
  function unwrapped(text: string) {
    return text.replace(/\s*›\s*/g, " ").replace(/\s+/g, " ");
  }

  function porcelain(path: string, branch: string) {
    return `worktree ${path}\nHEAD abc1234abc1234abc1234abc1234abc1234abc1234\nbranch refs/heads/${branch}\n`;
  }

  // Both worktrees are clean and level with the base, so nothing but a session
  // can move either of them out of the safe group.
  function stubGit(sessions: AgentSession[]) {
    sessionsSpy = vi
      .spyOn(agent, "getAgentSessions")
      .mockResolvedValue(sessions);
    mockRun.mockImplementation(async (_file: string, args: string[] = []) => {
      const [first, second] = args;
      if (first === "branch" && second === "--show-current") {
        return "main";
      }
      if (first === "rev-parse") {
        return rootPath;
      }
      if (first === "worktree" && second === "list") {
        return [
          porcelain(busyPath, "feature/busy"),
          porcelain(idlePath, "feature/idle"),
        ].join("\n");
      }
      if (first === "symbolic-ref") {
        return "origin/main";
      }
      if (first === "rev-list") {
        return "0";
      }
      if (first === "worktree" && second === "remove") {
        removedPaths.push(args[2]);
      }
      return "";
    });
  }

  async function runRemove(
    args: Record<string, unknown>,
    flags: Record<string, unknown>,
    argv: string[] = [],
  ) {
    const command = new Remove(argv, await loadConfig());
    (command as any).parse = vi.fn().mockResolvedValue({ args, flags });
    (command as any).parsed = true;
    vi.spyOn(command as any, "resolveSpaceCloser").mockResolvedValue(
      async () => [],
    );
    // `_run` resolves the run as non-interactive (stdin is not a TTY here) and
    // would skip every prompt; only `--json` is meant to, so the human path
    // calls `run` directly.
    if (argv.includes("--json")) {
      await (command as any)._run();
    } else {
      await command.run();
    }
  }

  beforeEach(() => {
    // The blocks above leave their spies on `git` in place; this one runs the
    // real git.ts and must not inherit a stubbed list.
    vi.restoreAllMocks();
    vi.clearAllMocks();
    process.exitCode = undefined;
    removedPaths = [];
    output = captureOutput();
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    vi.mocked(confirm).mockResolvedValue(true);
  });

  afterEach(() => {
    output.restore();
    mockRun.mockReset();
    process.exitCode = originalExitCode;
  });

  describe("the picker", () => {
    it("lists a worktree a session is working in under Active branches, with its Agent detail, and an idle-only one under the safe group", async () => {
      stubGit([busy, idle]);
      vi.mocked(checkbox).mockResolvedValue([]);

      await runRemove({}, { force: false });

      const choices = vi.mocked(checkbox).mock.calls[0][0].choices as any[];
      expect(choices.map((choice) => choice.separator ?? choice.name)).toEqual([
        "─ Inactive branches (Safe to delete)",
        "feature/idle (Agent: idle-session [waiting])",
        "─ Active branches",
        "feature/busy (Agent: busy-session)",
      ]);
      expect(sessionsSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("a named branch", () => {
    it("opens the prompt with the agent sentence, then the prompt that applied before", async () => {
      stubGit([busy, idle]);

      await runRemove({ branchName: "feature/busy" }, { force: false });

      expect(vi.mocked(confirm)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(confirm).mock.calls[0][0].message).toBe(
        `${prefix} Are you sure you want to remove this worktree?`,
      );
      expect(removedPaths).toEqual([busyPath]);
    });

    it("prints today's prompt, unprefixed, for a worktree whose session is only idle", async () => {
      stubGit([busy, idle]);

      await runRemove({ branchName: "feature/idle" }, { force: false });

      expect(vi.mocked(confirm).mock.calls[0][0].message).toBe(
        "Are you sure you want to remove this worktree?",
      );
    });

    it("hands gitRemoveWorktree exactly today's options when no session blocks", async () => {
      stubGit([idle]);
      const mockRemove = vi.spyOn(git, "gitRemoveWorktree");

      await runRemove({ branchName: "feature/idle" }, { force: false });

      expect(mockRemove).toHaveBeenCalledWith("feature/idle", { force: false });
    });

    it("looks sessions up once whether or not it asks", async () => {
      stubGit([busy, idle]);

      await runRemove({ branchName: "feature/busy" }, { force: false });
      expect(sessionsSpy).toHaveBeenCalledTimes(1);

      sessionsSpy.mockClear();
      await runRemove({ branchName: "feature/busy" }, { force: true });
      expect(sessionsSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("--force", () => {
    it("asks nothing, removes the worktree, and says so in the document and on stderr", async () => {
      stubGit([busy, idle]);

      await runRemove({ branchName: "feature/busy" }, { force: true }, [
        "--json",
      ]);

      expect(vi.mocked(confirm)).not.toHaveBeenCalled();
      expect(removedPaths).toEqual([busyPath]);
      expect(output.document()).toEqual({
        removed: [{ branch: "feature/busy", path: busyPath }],
        herdrSpacesClosed: [],
        warnings: [warning],
      });
      expect(output.stderr()).toContain(warning);
    });

    it("prints the warning on stderr outside --json too", async () => {
      stubGit([busy, idle]);

      await runRemove({ branchName: "feature/busy" }, { force: true });

      expect(unwrapped(output.stderr())).toContain(warning);
    });

    it("says nothing about a session that is only idle", async () => {
      stubGit([busy, idle]);

      await runRemove({ branchName: "feature/idle" }, { force: true }, [
        "--json",
      ]);

      expect(output.document()).toMatchObject({ warnings: [] });
      expect(output.stderr()).not.toContain("agent session");
    });

    // `--json` never reaches the picker, so this is the human path: nothing is
    // asked, and the warning is still said.
    it("warns on the picker path too, for the worktree it removed", async () => {
      stubGit([busy, idle]);
      const worktrees = await git.gitGetWorktreeList({ includeAgents: true });
      vi.mocked(checkbox).mockResolvedValue(worktrees);
      sessionsSpy.mockClear();

      await runRemove({}, { force: true });

      expect(vi.mocked(confirm)).not.toHaveBeenCalled();
      expect(unwrapped(output.stderr())).toContain(warning);
      expect(output.stderr()).not.toContain("idle-session");
      expect(sessionsSpy).toHaveBeenCalledTimes(1);
    });
  });
});
