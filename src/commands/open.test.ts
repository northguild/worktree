/** biome-ignore-all lint/suspicious/noExplicitAny: Allow any in tests */
import { select } from "@inquirer/prompts";
import ora from "ora";
import * as git from "../lib/git.js";
import { setNonInteractive } from "../lib/interaction.js";
import type { WorktreeListBaseEntry } from "../lib/types.js";
import OpenCmd from "./open.js";

vi.mock("@inquirer/prompts", () => ({
  select: vi.fn(),
}));

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

describe("open command", () => {
  let open: OpenCmd;
  let mockOpenWorktreePath: ReturnType<typeof vi.spyOn>;
  const mockSelect = vi.mocked(select);

  const worktrees: WorktreeListBaseEntry[] = [
    {
      path: "/tmp/project.worktrees/feature/one",
      branchName: "feature/one",
      pathExists: true,
    },
    {
      path: "/tmp/project.worktrees/feature/two",
      branchName: "feature/two",
      pathExists: true,
    },
    {
      path: "/tmp/project.worktrees/missing",
      branchName: "feature/missing",
      pathExists: false,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    const mockConfig = {
      runCommand: vi.fn().mockResolvedValue(undefined),
    } as any;
    open = new OpenCmd([], mockConfig);
    mockOpenWorktreePath = vi
      .spyOn(open as any, "openWorktreePath")
      .mockResolvedValue(undefined);
  });

  it("opens a provided branch when it exists", async () => {
    vi.spyOn(git, "gitGetWorktrees").mockResolvedValue(worktrees);
    (open as any).parse = vi.fn().mockResolvedValue({
      args: { branchName: "feature/two" },
      flags: {},
    });

    await open.run();

    expect((open as any).parse).toHaveBeenCalledWith(OpenCmd);
    expect(git.gitGetWorktrees).toHaveBeenCalledTimes(1);
    expect(ora).toHaveBeenCalledWith("Gathering worktree list");
    expect(spinnerMocks.start).toHaveBeenCalledTimes(1);
    expect(spinnerMocks.stop).toHaveBeenCalledTimes(1);
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockOpenWorktreePath).toHaveBeenCalledWith(
      "/tmp/project.worktrees/feature/two",
    );
  });

  it("prompts to select a branch when no branch argument is provided", async () => {
    vi.spyOn(git, "gitGetWorktrees").mockResolvedValue(worktrees);
    mockSelect.mockResolvedValue(worktrees[0] as WorktreeListBaseEntry);
    (open as any).parse = vi.fn().mockResolvedValue({
      args: {},
      flags: {},
    });

    await open.run();

    expect(mockSelect).toHaveBeenCalledWith({
      message: "Select a branch to open",
      choices: [
        { name: "feature/one", value: worktrees[0] },
        { name: "feature/two", value: worktrees[1] },
      ],
    });
    expect(mockOpenWorktreePath).toHaveBeenCalledWith(
      "/tmp/project.worktrees/feature/one",
    );
  });

  it("errors when a provided branch does not exist", async () => {
    vi.spyOn(git, "gitGetWorktrees").mockResolvedValue(worktrees);
    const mockError = vi.spyOn(open, "error").mockImplementation(() => {
      throw new Error('Worktree "feature/unknown" doesn\'t exist');
    });

    (open as any).parse = vi.fn().mockResolvedValue({
      args: { branchName: "feature/unknown" },
      flags: {},
    });

    await expect(open.run()).rejects.toThrow(
      'Worktree "feature/unknown" doesn\'t exist',
    );
    expect(mockError).toHaveBeenCalledWith(
      'Worktree "feature/unknown" doesn\'t exist',
    );
    expect(mockOpenWorktreePath).not.toHaveBeenCalled();
  });

  it("returns without opening when selection is cancelled", async () => {
    vi.spyOn(git, "gitGetWorktrees").mockResolvedValue(worktrees);
    mockSelect.mockResolvedValue(undefined as never);

    (open as any).parse = vi.fn().mockResolvedValue({
      args: {},
      flags: {},
    });

    await open.run();

    expect(mockOpenWorktreePath).not.toHaveBeenCalled();
  });

  it("fails naming the branch argument, without a picker, when non-interactive", async () => {
    setNonInteractive(true);
    vi.spyOn(git, "gitGetWorktrees").mockResolvedValue(worktrees);
    (open as any).parse = vi.fn().mockResolvedValue({ args: {}, flags: {} });

    await expect(open.run()).rejects.toMatchObject({
      message: "no default for the branch to open; pass <branchName>",
      oclif: { exit: 2 },
    });
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockOpenWorktreePath).not.toHaveBeenCalled();
  });
});
