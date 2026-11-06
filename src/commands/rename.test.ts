/** biome-ignore-all lint/suspicious/noExplicitAny: Allow any in tests */
import { confirm, input, select } from "@inquirer/prompts";
import ora from "ora";
import * as herdr from "../integrations/herdr.js";
import * as rex from "../integrations/rex.js";
import * as agent from "../lib/agent.js";
import * as config from "../lib/config.js";
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
    // No opener configured: the space lookup is a no-op unless a case sets one.
    vi.spyOn(config, "gitGetConfigValue").mockResolvedValue("");
    vi.spyOn(git, "gitGetAbsoluteWorktreesPath").mockResolvedValue(WORKTREES);
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
        herdrSpacesRenamed: [],
        rexSessionsRenamed: [],
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

  // #272 D12 and D4. Expected labels follow `toSpaceLabel`'s rule (the path
  // under <root>.worktrees/ is the label) and the Herdr argv is the one the
  // probe on 0.9.0 observed; neither is read back out of the command.
  describe("the Herdr space (D12)", () => {
    let listSpy: ReturnType<typeof vi.spyOn>;
    let relabelSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.spyOn(config, "gitGetConfigValue").mockImplementation(
        async (name: string) => (name === "opener" ? "herdr" : ""),
      );
      vi.spyOn(herdr, "isHerdrInstalled").mockResolvedValue(true);
      listSpy = vi.spyOn(herdr, "listHerdrWorktrees").mockResolvedValue({
        sourceWorkspaceId: "w5",
        worktrees: [
          { path: ROOT, workspaceId: "w5" },
          { path: featureX.path, workspaceId: "wX" },
        ],
      });
      relabelSpy = vi.spyOn(herdr, "renameHerdrWorkspace").mockResolvedValue();
      givenWorktrees(featureX, other);
      givenArgs({ branchName: "feature/x", newName: "bugfix/y" });
    });

    it("looks the space up before the move and relabels it after, to the new label", async () => {
      const doc = await rename.run();

      expect(listSpy).toHaveBeenCalledWith({ gitRootPath: ROOT });
      expect(relabelSpy).toHaveBeenCalledWith("wX", "bugfix/y");
      const [lookedUp] = listSpy.mock.invocationCallOrder;
      const [moved] = renameSpy.mock.invocationCallOrder;
      const [relabelled] = relabelSpy.mock.invocationCallOrder;
      expect(lookedUp).toBeLessThan(moved as number);
      expect(moved).toBeLessThan(relabelled as number);
      expect(doc).toMatchObject({
        herdrSpacesRenamed: ["wX"],
        rexSessionsRenamed: [],
      });
    });

    // §4.3 step 4 orders the rename line, the push hint, then `cd` last; the
    // space line follows the rename it reports and precedes `cd`.
    it("prints the rename line, the push hint, the space line, then cd last", async () => {
      renameSpy.mockImplementation(async (plan: git.WorktreeRenamePlan) => ({
        from: { branch: plan.fromBranch, path: plan.fromPath },
        to: { branch: plan.toBranch, path: plan.toPath },
        upstream: "origin/feature/x",
      }));
      vi.spyOn(process, "cwd").mockReturnValue(featureX.path);
      const succeed = vi.mocked(ora)("probe").succeed as unknown as {
        mock: { invocationCallOrder: number[] };
      };
      succeed.mock.invocationCallOrder.length = 0;
      logSpy.mockClear();

      await rename.run();

      const [renamedLine, hint, cd] = logSpy.mock.invocationCallOrder;
      const spaceLine = succeed.mock.invocationCallOrder[0] as number;
      expect(lines()[0]).toMatch(/^✔ Renamed feature\/x to bugfix\/y;/);
      expect(lines()[1]).toMatch(/^It still tracks/);
      expect(lines().at(-1)).toBe(`cd ${WORKTREES}/bugfix/y`);
      expect(renamedLine).toBeLessThan(hint as number);
      expect(hint).toBeLessThan(spaceLine);
      expect(spaceLine).toBeLessThan(cd as number);
    });

    it("does not relabel when the rename fails", async () => {
      renameSpy.mockRejectedValue(new Error("Could not rename feature/x"));

      await expect(rename.run()).rejects.toThrow("Could not rename");

      expect(relabelSpy).not.toHaveBeenCalled();
    });

    it("does not look anything up when the user declines the live-agent question", async () => {
      vi.spyOn(agent, "getAgentSessions").mockResolvedValue([
        {
          name: "claude",
          pid: 1,
          cwd: featureX.path,
        } as unknown as AgentSession,
      ]);
      vi.spyOn(agent, "findSessionForPath").mockReturnValue({
        name: "claude",
      } as unknown as AgentSession);
      vi.spyOn(agent, "isSessionLive").mockReturnValue(true);
      vi.spyOn(agent, "isSessionBlocking").mockReturnValue(true);
      vi.mocked(confirm).mockResolvedValue(false);

      await rename.run();

      expect(listSpy).not.toHaveBeenCalled();
      expect(relabelSpy).not.toHaveBeenCalled();
    });

    it("warns, still exits 0 and still returns the document when the relabel fails", async () => {
      relabelSpy.mockRejectedValue(
        new herdr.HerdrError("workspace_not_found", "workspace wX not found"),
      );
      process.exitCode = undefined;

      const doc = await rename.run();

      expect(doc?.herdrSpacesRenamed).toEqual([]);
      expect(doc?.warnings).toEqual([
        "Herdr: workspace wX not found (workspace_not_found)",
      ]);
      expect(doc?.to.branch).toBe("bugfix/y");
      expect(process.exitCode).toBeUndefined();
    });

    it("warns, still renames and exits 0 when the lookup fails", async () => {
      listSpy.mockRejectedValue(new Error("Herdr: did not answer"));
      process.exitCode = undefined;

      const doc = await rename.run();

      expect(renameSpy).toHaveBeenCalled();
      expect(relabelSpy).not.toHaveBeenCalled();
      expect(doc?.warnings).toEqual(["Herdr: did not answer"]);
      expect(process.exitCode).toBeUndefined();
    });

    it("leaves a worktree with no open space alone", async () => {
      givenWorktrees(featureX, other);
      givenArgs({ branchName: "other", newName: "renamed" });

      const doc = await rename.run();

      expect(relabelSpy).not.toHaveBeenCalled();
      expect(doc?.herdrSpacesRenamed).toEqual([]);
      expect(doc?.warnings).toEqual([]);
    });

    it("asks no tool at all when the opener is not herdr or rex", async () => {
      vi.spyOn(config, "gitGetConfigValue").mockResolvedValue("editor");

      await rename.run();

      expect(listSpy).not.toHaveBeenCalled();
      expect(relabelSpy).not.toHaveBeenCalled();
    });
  });

  describe("the Rex session (D12)", () => {
    it("reports the relabelled session under rexSessionsRenamed", async () => {
      vi.spyOn(config, "gitGetConfigValue").mockImplementation(
        async (name: string) => (name === "opener" ? "rex" : ""),
      );
      vi.spyOn(rex, "isRexInstalled").mockResolvedValue(true);
      vi.spyOn(rex, "findRexSessions").mockResolvedValue(
        new Map([[featureX.path, "session:X"]]),
      );
      const relabelSpy = vi.spyOn(rex, "renameRexSession").mockResolvedValue();
      const herdrList = vi.spyOn(herdr, "listHerdrWorktrees");
      givenWorktrees(featureX, other);
      givenArgs({ branchName: "feature/x", newName: "bugfix/y" });

      const doc = await rename.run();

      expect(relabelSpy).toHaveBeenCalledWith("session:X", "bugfix/y");
      expect(herdrList).not.toHaveBeenCalled();
      expect(doc).toMatchObject({
        herdrSpacesRenamed: [],
        rexSessionsRenamed: ["session:X"],
      });
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
