/** biome-ignore-all lint/suspicious/noExplicitAny: Allow any in tests */
import { select } from "@inquirer/prompts";
import * as herdr from "../integrations/herdr.js";
import { copyEnvFilesFromRootPath } from "../lib/env.js";
import * as git from "../lib/git.js";
import { setNonInteractive } from "../lib/interaction.js";
import { MissingValueError } from "../lib/prompt.js";
import Checkout from "./checkout.js";

vi.mock("@inquirer/prompts", () => ({
  select: vi.fn(),
}));

vi.mock("../lib/env.js", () => ({
  copyEnvFilesFromRootPath: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("ora", () => ({
  default: vi.fn().mockReturnValue({
    start: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
  }),
}));

describe("checkout command", () => {
  let checkout: Checkout;
  let mockOpenWorktreePath: ReturnType<typeof vi.spyOn>;
  let mockDispatchAgent: ReturnType<typeof vi.spyOn>;
  const mockSelect = vi.mocked(select);
  const mockCopyEnvFiles = vi.mocked(copyEnvFilesFromRootPath);

  beforeEach(() => {
    vi.clearAllMocks();
    const mockConfig = {
      runCommand: vi.fn().mockResolvedValue(undefined),
    } as any;
    checkout = new Checkout([], mockConfig);
    mockOpenWorktreePath = vi
      .spyOn(checkout as any, "openWorktreePath")
      .mockResolvedValue(undefined);
    mockDispatchAgent = vi
      .spyOn(checkout as any, "dispatchAgent")
      .mockResolvedValue(undefined);
  });

  it("creates a worktree from a provided non-origin branch name", async () => {
    vi.spyOn(git, "gitGetRemoteBranches").mockResolvedValue([
      "origin/main",
      "origin/feature/test",
    ]);
    vi.spyOn(git, "gitGetLocalBranches").mockResolvedValue(["main"]);
    const mockCreateWorktree = vi
      .spyOn(git, "gitCreateWorktree")
      .mockResolvedValue("/path/to/worktree");

    (checkout as any).parse = vi.fn().mockResolvedValue({
      args: { branchName: "feature/test" },
      flags: {},
    });

    await checkout.run();

    expect(mockCreateWorktree).toHaveBeenCalledWith(
      "feature/test",
      "origin/feature/test",
      { isCheckout: true },
    );
    expect(mockCopyEnvFiles).toHaveBeenCalledWith("/path/to/worktree");
    expect(mockOpenWorktreePath).toHaveBeenCalledWith("/path/to/worktree", {
      brief: undefined,
    });
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("creates a worktree from a provided origin-prefixed branch name", async () => {
    vi.spyOn(git, "gitGetRemoteBranches").mockResolvedValue([
      "origin/main",
      "origin/feature/test",
    ]);
    vi.spyOn(git, "gitGetLocalBranches").mockResolvedValue(["main"]);
    const mockCreateWorktree = vi
      .spyOn(git, "gitCreateWorktree")
      .mockResolvedValue("/path/to/worktree");

    (checkout as any).parse = vi.fn().mockResolvedValue({
      args: { branchName: "origin/feature/test" },
      flags: {},
    });

    await checkout.run();

    expect(mockCreateWorktree).toHaveBeenCalledWith(
      "feature/test",
      "origin/feature/test",
      { isCheckout: true },
    );
    expect(mockSelect).not.toHaveBeenCalled();
  });

  it("prompts to select a remote branch when no branch argument is provided", async () => {
    vi.spyOn(git, "gitGetRemoteBranches").mockResolvedValue([
      "origin/main",
      "origin/feature/test",
    ]);
    vi.spyOn(git, "gitGetLocalBranches").mockResolvedValue(["main"]);
    mockSelect.mockResolvedValue("origin/feature/test");
    const mockCreateWorktree = vi
      .spyOn(git, "gitCreateWorktree")
      .mockResolvedValue("/path/to/worktree");

    (checkout as any).parse = vi.fn().mockResolvedValue({
      args: {},
      flags: {},
    });

    await checkout.run();

    expect(mockSelect).toHaveBeenCalledWith({
      message: "Select a remote branch to checkout",
      choices: [
        { name: "origin/main", value: "origin/main" },
        { name: "origin/feature/test", value: "origin/feature/test" },
      ],
    });
    expect(mockCreateWorktree).toHaveBeenCalledWith(
      "feature/test",
      "origin/feature/test",
      { isCheckout: true },
    );
  });

  it("errors when the requested remote branch is not found", async () => {
    vi.spyOn(git, "gitGetRemoteBranches").mockResolvedValue(["origin/main"]);
    vi.spyOn(git, "gitGetLocalBranches").mockResolvedValue(["main"]);
    const mockError = vi.spyOn(checkout, "error").mockImplementation(() => {
      throw new Error('Remote branch "origin/feature/missing" not found');
    });

    (checkout as any).parse = vi.fn().mockResolvedValue({
      args: { branchName: "feature/missing" },
      flags: {},
    });

    await expect(checkout.run()).rejects.toThrow(
      'Remote branch "origin/feature/missing" not found',
    );
    expect(mockError).toHaveBeenCalledWith(
      'Remote branch "origin/feature/missing" not found',
    );
    expect(git.gitCreateWorktree).not.toHaveBeenCalled();
  });

  it("errors when a local branch with same name already exists", async () => {
    vi.spyOn(git, "gitGetRemoteBranches").mockResolvedValue([
      "origin/main",
      "origin/feature/test",
    ]);
    vi.spyOn(git, "gitGetLocalBranches").mockResolvedValue([
      "main",
      "feature/test",
    ]);
    const mockError = vi.spyOn(checkout, "error").mockImplementation(() => {
      throw new Error('Local branch "feature/test" already exists');
    });

    (checkout as any).parse = vi.fn().mockResolvedValue({
      args: { branchName: "feature/test" },
      flags: {},
    });

    await expect(checkout.run()).rejects.toThrow(
      'Local branch "feature/test" already exists',
    );
    expect(mockError).toHaveBeenCalledWith(
      'Local branch "feature/test" already exists',
    );
    expect(git.gitCreateWorktree).not.toHaveBeenCalled();
  });

  describe("--agent flag", () => {
    beforeEach(() => {
      vi.spyOn(git, "gitGetRemoteBranches").mockResolvedValue([
        "origin/main",
        "origin/feature/test",
      ]);
      vi.spyOn(git, "gitGetLocalBranches").mockResolvedValue(["main"]);
      vi.spyOn(git, "gitCreateWorktree").mockResolvedValue("/path/to/worktree");
      vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("");
    });

    it("fails a brief with no agent kind before creating a worktree (#75)", async () => {
      vi.spyOn(herdr, "isHerdrInstalled").mockResolvedValue(true);
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((key: string) =>
        Promise.resolve(key === "opener" ? "herdr" : ""),
      );
      (checkout as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feature/test" },
        flags: { agent: "review this branch" },
      });

      await expect(checkout.run()).rejects.toBeInstanceOf(MissingValueError);

      expect(git.gitCreateWorktree).not.toHaveBeenCalled();
      expect(mockCopyEnvFiles).not.toHaveBeenCalled();
    });

    it("hands the prompt to the opener as the brief, after the env files", async () => {
      (checkout as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feature/test" },
        flags: { agent: "review this branch" },
      });

      await checkout.run();

      expect(mockOpenWorktreePath).toHaveBeenCalledWith("/path/to/worktree", {
        brief: "review this branch",
      });
      // The worktree has to be complete before the agent sees it.
      expect(mockCopyEnvFiles.mock.invocationCallOrder[0]).toBeLessThan(
        mockOpenWorktreePath.mock.invocationCallOrder[0],
      );
      // The opener decides Herdr or detached, so checkout never dispatches.
      expect(mockDispatchAgent).not.toHaveBeenCalled();
    });

    it("rejects an empty prompt before creating a worktree", async () => {
      (checkout as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feature/test" },
        flags: { agent: "" },
      });

      await expect(checkout.run()).rejects.toThrow(/empty/);

      expect(git.gitCreateWorktree).not.toHaveBeenCalled();
    });

    it("passes no brief when the flag is absent", async () => {
      (checkout as any).parse = vi.fn().mockResolvedValue({
        args: { branchName: "feature/test" },
        flags: {},
      });

      await checkout.run();

      expect(mockDispatchAgent).not.toHaveBeenCalled();
      expect(mockOpenWorktreePath).toHaveBeenCalledWith("/path/to/worktree", {
        brief: undefined,
      });
    });
  });

  it("fails naming the branch argument, without a picker, when non-interactive", async () => {
    setNonInteractive(true);
    vi.spyOn(git, "gitGetRemoteBranches").mockResolvedValue(["origin/main"]);
    vi.spyOn(git, "gitGetLocalBranches").mockResolvedValue(["main"]);
    const mockCreateWorktree = vi.spyOn(git, "gitCreateWorktree");
    (checkout as any).parse = vi
      .fn()
      .mockResolvedValue({ args: {}, flags: {} });

    await expect(checkout.run()).rejects.toMatchObject({
      message: "no default for the branch to check out; pass <branchName>",
      oclif: { exit: 2 },
    });
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockCreateWorktree).not.toHaveBeenCalled();
  });
});
