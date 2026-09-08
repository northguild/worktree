/** biome-ignore-all lint/suspicious/noExplicitAny: Allow any in tests */
import ora from "ora";
import * as git from "../lib/git.js";
import type { WorktreeListEntry } from "../lib/types.js";
import * as utils from "../lib/utils.js";
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
});
