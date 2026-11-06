/** biome-ignore-all lint/suspicious/noExplicitAny: Allow any in tests */
import { confirm, input, select } from "@inquirer/prompts";
import * as agent from "../lib/agent.js";
import * as git from "../lib/git.js";
import { setNonInteractive } from "../lib/interaction.js";
import { MissingValueError } from "../lib/prompt.js";
import type { AgentSession, WorktreeListBaseEntry } from "../lib/types.js";
import { captureOutput, loadConfig, mockRun } from "../test-setup.js";
import Rename from "./rename.js";

vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  input: vi.fn(),
  select: vi.fn(),
  checkbox: vi.fn(),
  Separator: class Separator {},
}));

vi.mock("ora", () => ({
  default: vi.fn().mockReturnValue({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
  }),
}));

const ROOT = "/path/to/project";
const WORKTREES = `${ROOT}.worktrees`;

describe("rename command", () => {
  const featureX: WorktreeListBaseEntry = {
    path: `${WORKTREES}/feature/x`,
    branchName: "feature/x",
    pathExists: true,
    isCurrent: false,
  };
  const other: WorktreeListBaseEntry = {
    path: `${WORKTREES}/other`,
    branchName: "other",
    pathExists: true,
    isCurrent: false,
  };

  let rename: Rename;
  let renameSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  function givenWorktrees(...worktrees: WorktreeListBaseEntry[]) {
    vi.spyOn(git, "gitGetWorktrees").mockResolvedValue(worktrees);
  }

  function givenArgs(
    args: { branchName?: string; newName?: string },
    flags: { force?: boolean } = {},
  ) {
    (rename as any).parse = vi
      .fn()
      .mockResolvedValue({ args, flags: { force: false, ...flags } });
  }

  function lines(): string[] {
    return logSpy.mock.calls.map((call: unknown[]) => String(call[0]));
  }

  beforeEach(async () => {
    rename = new Rename([], await loadConfig());
    vi.spyOn(git, "gitGetRootPath").mockResolvedValue(ROOT);
    vi.spyOn(git, "gitGetLocalBranches").mockResolvedValue([
      "main",
      "feature/x",
      "other",
    ]);
    vi.spyOn(agent, "getAgentSessions").mockResolvedValue([]);
    renameSpy = vi
      .spyOn(git, "gitRenameWorktree")
      .mockImplementation(async (plan) => ({
        from: { branch: plan.fromBranch, path: plan.fromPath },
        to: { branch: plan.toBranch, path: plan.toPath },
        upstream: null,
      }));
    logSpy = vi.spyOn(rename, "log").mockImplementation(() => {});
    vi.spyOn(process, "cwd").mockReturnValue("/somewhere/else");
  });

  afterEach(() => {
    // The one subprocess these cases leave to the global mock is the plan's
    // `git check-ref-format --branch <name>`; its argv is asserted in git.test.ts,
    // so it is dropped here rather than declared once per case.
    mockRun.mockClear();
    vi.restoreAllMocks();
  });

  describe("two arguments", () => {
    it("renames the worktree named by branch, resolved from the root", async () => {
      givenWorktrees(featureX, other);
      givenArgs({ branchName: "feature/x", newName: "bugfix/y" });

      const doc = await rename.run();

      // The directory rule is D2 (<root>.worktrees/<new>); the root is passed
      // on as resolved before the move (D8).
      expect(renameSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          fromBranch: "feature/x",
          toBranch: "bugfix/y",
          fromPath: `${WORKTREES}/feature/x`,
          toPath: `${WORKTREES}/bugfix/y`,
        }),
        ROOT,
      );
      expect(doc).toEqual({
        from: { branch: "feature/x", path: `${WORKTREES}/feature/x` },
        to: { branch: "bugfix/y", path: `${WORKTREES}/bugfix/y` },
        upstream: null,
        warnings: [],
      });
    });

    it("finds the worktree by path the way remove does", async () => {
      givenWorktrees(featureX, other);
      givenArgs({ branchName: featureX.path, newName: "bugfix/y" });

      const doc = await rename.run();

      expect(doc?.from.branch).toBe("feature/x");
    });

    it("lists the worktrees without fetching (D9)", async () => {
      const listing = vi
        .spyOn(git, "gitGetWorktrees")
        .mockResolvedValue([featureX]);
      const fetching = vi.spyOn(git, "gitFetch");
      givenArgs({ branchName: "feature/x", newName: "bugfix/y" });

      await rename.run();

      expect(listing).toHaveBeenCalledWith({ includeCurrent: true });
      expect(fetching).not.toHaveBeenCalled();
    });

    it("exits 2 with not_found when no worktree has that branch", async () => {
      givenWorktrees(featureX);
      givenArgs({ branchName: "nope", newName: "bugfix/y" });

      await expect(rename.run()).rejects.toMatchObject({
        message: `No worktree for "nope" under ${WORKTREES}/.`,
        code: "not_found",
        oclif: { exit: 2 },
      });
      expect(renameSpy).not.toHaveBeenCalled();
    });

    it("exits 2 with not_found when no worktree is at that path", async () => {
      givenWorktrees(featureX);
      givenArgs({ branchName: "/nowhere/at/all", newName: "bugfix/y" });

      await expect(rename.run()).rejects.toMatchObject({
        message: `No worktree for "/nowhere/at/all" under ${WORKTREES}/.`,
        code: "not_found",
      });
    });

    it("refuses a name another branch has, with invalid_value, before moving", async () => {
      givenWorktrees(featureX, other);
      givenArgs({ branchName: "feature/x", newName: "other" });

      await expect(rename.run()).rejects.toMatchObject({
        message: 'A branch named "other" already exists.',
        code: "invalid_value",
        oclif: { exit: 2 },
      });
      expect(renameSpy).not.toHaveBeenCalled();
    });

    it("refuses a name the branch validator refuses", async () => {
      givenWorktrees(featureX);
      givenArgs({ branchName: "feature/x", newName: "a b" });

      await expect(rename.run()).rejects.toMatchObject({
        message: "Branch name cannot contain spaces",
        code: "invalid_value",
      });
    });
  });

  describe("one argument", () => {
    it("renames the worktree the command runs in", async () => {
      givenWorktrees({ ...featureX, isCurrent: true }, other);
      givenArgs({ branchName: "bugfix/y" });

      const doc = await rename.run();

      expect(doc?.from.branch).toBe("feature/x");
      expect(doc?.to.branch).toBe("bugfix/y");
    });

    it("exits 2 with missing_value outside a linked worktree", async () => {
      givenWorktrees(featureX, other);
      givenArgs({ branchName: "bugfix/y" });
      setNonInteractive(true);

      const error = await rename.run().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(MissingValueError);
      expect((error as Error).message).toBe(
        "no default for the worktree to rename; pass <branchName> <newName>",
      );
      expect((error as any).oclif.exit).toBe(2);
      expect(renameSpy).not.toHaveBeenCalled();
    });
  });

  describe("no arguments", () => {
    it("non-interactively inside a worktree asks for the new name", async () => {
      givenWorktrees({ ...featureX, isCurrent: true });
      givenArgs({});
      setNonInteractive(true);

      const error = await rename.run().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(MissingValueError);
      expect((error as Error).message).toBe(
        "no default for the new branch name; pass <newName>",
      );
    });

    it("non-interactively outside a worktree asks for the worktree", async () => {
      givenWorktrees(featureX);
      givenArgs({});
      setNonInteractive(true);

      const error = await rename.run().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(MissingValueError);
      expect((error as Error).message).toBe(
        "no default for the worktree to rename; pass <branchName> <newName>",
      );
    });

    it("in a terminal picks a worktree, then asks for the new name", async () => {
      givenWorktrees(featureX, other);
      givenArgs({});
      vi.mocked(select).mockResolvedValue(other);
      vi.mocked(input).mockResolvedValue("renamed");

      const doc = await rename.run();

      expect(select).toHaveBeenCalledOnce();
      const question = vi.mocked(input).mock.calls[0]?.[0];
      // The prompt carries the same validator `branch` uses.
      expect(await question?.validate?.("a b")).toBe(
        "Branch name cannot contain spaces",
      );
      expect(await question?.validate?.("ok-name")).toBe(true);
      expect(doc?.from.branch).toBe("other");
      expect(doc?.to.branch).toBe("renamed");
    });

    it("in a terminal inside a worktree still asks which, then the name", async () => {
      givenWorktrees({ ...featureX, isCurrent: true }, other);
      givenArgs({});
      vi.mocked(select).mockResolvedValue(other);
      vi.mocked(input).mockResolvedValue("renamed");

      await rename.run();

      expect(select).toHaveBeenCalledOnce();
    });
  });

  describe("a live agent session (D7)", () => {
    const session: AgentSession = {
      name: "claude-1",
      cwd: featureX.path,
      state: "working",
    };

    beforeEach(() => {
      givenWorktrees(featureX);
      vi.spyOn(agent, "getAgentSessions").mockResolvedValue([session]);
      givenArgs({ branchName: "feature/x", newName: "bugfix/y" });
    });

    it("exits 2 with missing_value naming -f when non-interactive", async () => {
      setNonInteractive(true);

      const error = await rename.run().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(MissingValueError);
      expect((error as Error).message).toBe(
        "no default for confirmation to rename feature/x while an agent session (claude-1) is working in it; pass -f",
      );
      expect(renameSpy).not.toHaveBeenCalled();
    });

    it("asks in a terminal, defaulting to no, and renames on yes", async () => {
      vi.mocked(confirm).mockResolvedValue(true);

      await rename.run();

      expect(vi.mocked(confirm).mock.calls[0]?.[0]).toMatchObject({
        default: false,
      });
      expect(renameSpy).toHaveBeenCalledOnce();
    });

    it("leaves everything as it was on no", async () => {
      vi.mocked(confirm).mockResolvedValue(false);

      const doc = await rename.run();

      expect(renameSpy).not.toHaveBeenCalled();
      expect(doc).toBeUndefined();
    });

    it("-f skips the question, interactive or not", async () => {
      givenArgs(
        { branchName: "feature/x", newName: "bugfix/y" },
        { force: true },
      );
      setNonInteractive(true);

      await rename.run();

      expect(confirm).not.toHaveBeenCalled();
      expect(renameSpy).toHaveBeenCalledOnce();
    });

    it("does not stop for a session that is only idle", async () => {
      vi.spyOn(agent, "getAgentSessions").mockResolvedValue([
        { name: "claude-1", cwd: featureX.path, status: "idle" },
      ]);
      setNonInteractive(true);

      await rename.run();

      expect(renameSpy).toHaveBeenCalledOnce();
    });
  });

  describe("output", () => {
    it("prints the result line, with no push hint when there is no upstream", async () => {
      givenWorktrees(featureX);
      givenArgs({ branchName: "feature/x", newName: "bugfix/y" });

      await rename.run();

      expect(lines()).toEqual([
        `✔ Renamed feature/x to bugfix/y; the worktree is at ${WORKTREES}/bugfix/y`,
      ]);
    });

    // D5 / §4.3 step 4: git's own refusal text names `HEAD:<old remote branch>`.
    it("says how to push when the branch tracks an upstream", async () => {
      givenWorktrees(featureX);
      givenArgs({ branchName: "feature/x", newName: "bugfix/y" });
      renameSpy.mockResolvedValue({
        from: { branch: "feature/x", path: featureX.path },
        to: { branch: "bugfix/y", path: `${WORKTREES}/bugfix/y` },
        upstream: "origin/feature/x",
      });

      const doc = await rename.run();

      expect(lines()).toEqual([
        `✔ Renamed feature/x to bugfix/y; the worktree is at ${WORKTREES}/bugfix/y`,
        "It still tracks origin/feature/x: `git push origin HEAD:feature/x` updates it, `git push -u origin bugfix/y` publishes the new name.",
      ]);
      expect(doc?.upstream).toBe("origin/feature/x");
    });

    it("ends with a cd hint when it ran inside the renamed worktree (D8)", async () => {
      givenWorktrees({ ...featureX, isCurrent: true });
      vi.spyOn(process, "cwd").mockReturnValue(`${featureX.path}/src`);
      givenArgs({ branchName: "bugfix/y" });

      await rename.run();

      expect(lines().at(-1)).toBe(`cd ${WORKTREES}/bugfix/y`);
    });

    it("gives no cd hint when it ran from elsewhere", async () => {
      givenWorktrees(featureX);
      givenArgs({ branchName: "feature/x", newName: "bugfix/y" });

      await rename.run();

      expect(lines().some((line) => line.startsWith("cd "))).toBe(false);
    });
  });

  describe("--json", () => {
    it("asks for no confirmation of a plain rename (D11) and prints one document", async () => {
      givenWorktrees(featureX);
      givenArgs({ branchName: "feature/x", newName: "bugfix/y" });
      vi.spyOn(rename, "jsonEnabled").mockReturnValue(true);
      setNonInteractive(true);
      const output = captureOutput();
      try {
        const doc = await rename.run();
        expect(doc).toMatchObject({
          from: { branch: "feature/x" },
          to: { branch: "bugfix/y" },
          upstream: null,
          warnings: [],
        });
      } finally {
        output.restore();
      }

      expect(confirm).not.toHaveBeenCalled();
    });
  });
});
