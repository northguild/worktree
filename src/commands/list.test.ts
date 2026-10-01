/** biome-ignore-all lint/suspicious/noExplicitAny: Allow any in tests */
import ora from "ora";
import * as git from "../lib/git.js";
import { isNonInteractive } from "../lib/interaction.js";
import type { WorktreeListEntry } from "../lib/types.js";
import * as utils from "../lib/utils.js";
import { captureOutput, loadConfig } from "../test-setup.js";
import List from "./list.js";

const spinnerMocks = vi.hoisted(() => {
  const stop = vi.fn();
  const start = vi.fn().mockReturnValue({ stop });
  const oraFactory = vi.fn().mockReturnValue({ start });

  return {
    stop,
    start,
    oraFactory,
  };
});

vi.mock("ora", () => ({
  default: spinnerMocks.oraFactory,
}));

describe("list command", () => {
  let list: List;

  beforeEach(() => {
    vi.clearAllMocks();
    const mockConfig = {
      runCommand: vi.fn().mockResolvedValue(undefined),
    } as any;
    list = new List([], mockConfig);

    (list as any).parse = vi.fn().mockResolvedValue({
      args: {},
      flags: { agents: false },
    });
  });

  function withFlags(flags: Record<string, unknown>) {
    (list as any).parse = vi.fn().mockResolvedValue({ args: {}, flags });
  }

  it("logs each worktree list item", async () => {
    const worktrees: WorktreeListEntry[] = [
      {
        path: "/tmp/project.worktrees/feature/one",
        branchName: "feature/one",
        remote: "origin/feature/one",
      },
      {
        path: "/tmp/project.worktrees/feature/two",
        branchName: "feature/two",
        remote: "origin/feature/two",
      },
    ];

    const mockGetWorktreeList = vi
      .spyOn(git, "gitGetWorktreeList")
      .mockResolvedValue(worktrees);
    const mockListName = vi
      .spyOn(utils, "worktreeListEntryToListName")
      .mockReturnValueOnce("feature/one")
      .mockReturnValueOnce("feature/two (Ahead: 1)");
    const logSpy = vi.spyOn(list, "log").mockImplementation(() => {});

    await list.run();

    expect((list as any).parse).toHaveBeenCalledWith(List);
    expect(mockGetWorktreeList).toHaveBeenCalledWith({
      includeCurrent: true,
      includeAgents: false,
    });
    expect(ora).toHaveBeenCalledWith("Gathering worktree list");
    expect(spinnerMocks.start).toHaveBeenCalledTimes(1);
    expect(spinnerMocks.stop).toHaveBeenCalledTimes(1);
    expect(mockListName).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenNthCalledWith(1, "- feature/one");
    expect(logSpy).toHaveBeenNthCalledWith(2, "- feature/two (Ahead: 1)");
  });

  it("does not log entries when no worktrees are returned", async () => {
    vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([]);
    const mockListName = vi.spyOn(utils, "worktreeListEntryToListName");
    const logSpy = vi.spyOn(list, "log").mockImplementation(() => {});

    await list.run();

    expect(spinnerMocks.start).toHaveBeenCalledTimes(1);
    expect(spinnerMocks.stop).toHaveBeenCalledTimes(1);
    expect(mockListName).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  // Without the flag the session lookup must not happen at all: `list` pays for
  // no agent runtime today and must not start. See AGENT-MODE-PLAN §5 R4.
  it("asks for no session lookup and renders no agent details by default", async () => {
    const worktrees: WorktreeListEntry[] = [
      {
        path: "/tmp/project.worktrees/feature/one",
        branchName: "feature/one",
        remote: "origin/feature/one",
        agent: { name: "feature-one-1f", pid: 9187 },
      },
    ];

    const mockGetWorktreeList = vi
      .spyOn(git, "gitGetWorktreeList")
      .mockResolvedValue(worktrees);
    const mockListName = vi
      .spyOn(utils, "worktreeListEntryToListName")
      .mockReturnValue("feature/one");
    vi.spyOn(list, "log").mockImplementation(() => {});

    await list.run();

    expect(mockGetWorktreeList).toHaveBeenCalledWith({
      includeCurrent: true,
      includeAgents: false,
    });
    expect(mockListName).toHaveBeenCalledWith(worktrees[0], "gray", {
      agents: false,
    });
  });

  it("performs the session lookup and renders agent details with --agents", async () => {
    withFlags({ agents: true });

    const worktrees: WorktreeListEntry[] = [
      {
        path: "/tmp/project.worktrees/feature/one",
        branchName: "feature/one",
        remote: "origin/feature/one",
        agent: { name: "feature-one-1f", pid: 9187 },
      },
    ];

    const mockGetWorktreeList = vi
      .spyOn(git, "gitGetWorktreeList")
      .mockResolvedValue(worktrees);
    const mockListName = vi
      .spyOn(utils, "worktreeListEntryToListName")
      .mockReturnValue("feature/one (Agent: feature-one-1f)");
    const logSpy = vi.spyOn(list, "log").mockImplementation(() => {});

    await list.run();

    expect(mockGetWorktreeList).toHaveBeenCalledWith({
      includeCurrent: true,
      includeAgents: true,
    });
    expect(mockListName).toHaveBeenCalledWith(worktrees[0], "gray", {
      agents: true,
    });
    expect(logSpy).toHaveBeenCalledWith(
      "- feature/one (Agent: feature-one-1f)",
    );
  });

  describe("--json", () => {
    let output: ReturnType<typeof captureOutput>;

    beforeEach(() => {
      output = captureOutput();
    });

    afterEach(() => {
      output.restore();
    });

    // Through `_run`, as oclif does, so the returned document is what gets
    // printed and the mode is resolved by `init`.
    async function runJson(flags: Record<string, unknown>) {
      const command = new List(["--json"], await loadConfig());
      (command as any).parse = vi.fn().mockResolvedValue({ args: {}, flags });
      (command as any).parsed = true;
      await (command as any)._run();
    }

    const entryKeys = [
      "ahead",
      "behind",
      "branch",
      "current",
      "mergedInto",
      "path",
      "pathExists",
      "remote",
      "remoteExists",
      "safeToRemove",
      "uncommittedChanges",
    ];

    it("prints one document, with the contract's keys and no human lines", async () => {
      vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([
        {
          path: "/tmp/project.worktrees/feature/one",
          branchName: "feature/one",
          remote: "origin/feature/one",
          remoteExists: true,
          ahead: 2,
          behind: 1,
          pathExists: true,
          isCurrent: false,
          uncommittedChanges: 3,
          safeToRemove: false,
        },
      ]);

      await runJson({ agents: false });

      expect(output.stdout().trim().split("\n")).toHaveLength(1);
      const document = output.document() as {
        worktrees: Record<string, unknown>[];
      };
      expect(Object.keys(document)).toEqual(["worktrees"]);
      expect(Object.keys(document.worktrees[0]).sort()).toEqual(entryKeys);
      expect(document.worktrees[0]).toEqual({
        branch: "feature/one",
        path: "/tmp/project.worktrees/feature/one",
        current: false,
        pathExists: true,
        remote: "origin/feature/one",
        remoteExists: true,
        ahead: 2,
        behind: 1,
        mergedInto: null,
        uncommittedChanges: 3,
        safeToRemove: false,
      });
    });

    it("reports a count that was never taken as null, not 0 and not absent", async () => {
      vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([
        {
          path: "/tmp/project.worktrees/feature/one",
          branchName: "feature/one",
          remote: "",
          remoteExists: false,
          pathExists: false,
          // What gitGetWorktreeList really fills in for a missing directory.
          uncommittedChanges: 0,
          aheadUnknownReason: "the directory is gone",
          safeToRemove: false,
        },
      ]);

      await runJson({ agents: false });

      const [entry] = (
        output.document() as { worktrees: Record<string, unknown>[] }
      ).worktrees;
      for (const key of ["ahead", "behind", "mergedInto", "remote"]) {
        expect(entry).toHaveProperty(key, null);
      }
      expect(entry).toHaveProperty("uncommittedChanges", null);
      expect(entry).toMatchObject({ pathExists: false, current: false });
    });

    it("keeps a zero count a zero", async () => {
      vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([
        {
          path: "/tmp/p.worktrees/a",
          branchName: "a",
          remote: "origin/a",
          ahead: 0,
          behind: 0,
          uncommittedChanges: 0,
          safeToRemove: true,
        },
      ]);

      await runJson({ agents: false });

      expect(
        (output.document() as { worktrees: unknown[] }).worktrees[0],
      ).toMatchObject({ ahead: 0, behind: 0, uncommittedChanges: 0 });
    });

    it("has an agent key only with --agents, null or the session", async () => {
      const worktrees: WorktreeListEntry[] = [
        {
          path: "/tmp/p.worktrees/a",
          branchName: "a",
          remote: "",
          agent: {
            name: "demo-a",
            sessionId: "s-1",
            herdrAgent: "wt-a",
            live: true,
            interactive: true,
          },
        },
        { path: "/tmp/p.worktrees/b", branchName: "b", remote: "" },
      ];
      vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue(worktrees);

      await runJson({ agents: true });

      const { worktrees: entries } = output.document() as {
        worktrees: Record<string, unknown>[];
      };
      expect(entries[0].agent).toEqual({
        name: "demo-a",
        sessionId: "s-1",
        herdrAgent: "wt-a",
        live: true,
        interactive: true,
        waiting: null,
      });
      expect(entries[1]).toHaveProperty("agent", null);

      output.restore();
      output = captureOutput();
      await runJson({ agents: false });
      const without = output.document() as {
        worktrees: Record<string, unknown>[];
      };
      expect(without.worktrees[0]).not.toHaveProperty("agent");
    });

    it("is non-interactive, so the spinner never animates and prints go to stderr", async () => {
      vi.spyOn(git, "gitGetWorktreeList").mockResolvedValue([]);

      await runJson({ agents: false });

      expect(isNonInteractive()).toBe(true);
      // The progress seam turns animation off for a non-interactive run; ora
      // then prints plain lines to stderr, never stdout.
      expect(spinnerMocks.oraFactory.mock.results[0].value).toMatchObject({
        isEnabled: false,
      });
      expect(output.document()).toEqual({ worktrees: [] });
    });

    it("answers a failure as an error document with a non-zero exit", async () => {
      const originalExitCode = process.exitCode;
      vi.spyOn(git, "gitGetWorktreeList").mockRejectedValue(
        new Error("Git: git fetch --prune did not answer within 60s."),
      );

      try {
        await runJson({ agents: false });

        expect(output.document()).toEqual({
          error: {
            code: "timeout",
            message: "Git: git fetch --prune did not answer within 60s.",
          },
        });
        expect(output.stderr()).toContain("did not answer within 60s");
        expect(process.exitCode).toBe(1);
      } finally {
        process.exitCode = originalExitCode;
      }
    });
  });
});

describe("list command — --help", () => {
  it("documents the --json shape and the exit codes", () => {
    const help = List.description ?? "";

    for (const key of [
      "worktrees",
      "safeToRemove",
      "uncommittedChanges",
      "sessionId",
      "herdrAgent",
    ]) {
      expect(help).toContain(key);
    }
    expect(help).toContain("0 success");
    expect(help).toContain("1 failure");
    expect(help).toContain("2 usage");
  });
});
