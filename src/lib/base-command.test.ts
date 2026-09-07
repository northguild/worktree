/** biome-ignore-all lint/suspicious/noExplicitAny: Allow any in tests */
import { BaseCommand } from "./base-command.js";
import * as cli from "./cli.js";
import * as git from "./git.js";

const spinnerMocks = vi.hoisted(() => {
  const succeed = vi.fn();
  const fail = vi.fn();
  const start = vi.fn().mockReturnValue({ succeed, fail });
  const oraFactory = vi.fn().mockReturnValue({ start });

  return {
    succeed,
    fail,
    start,
    oraFactory,
  };
});

vi.mock("ora", () => ({
  default: spinnerMocks.oraFactory,
}));

class TestCommand extends BaseCommand {
  async run() {}
}

describe("openWorktreePath", () => {
  const worktreePath = "/tmp/a b/c";
  let command: TestCommand;
  let mockLog: ReturnType<typeof vi.spyOn>;
  const mockRunCommand = vi.mocked(cli.runCommand);

  function openWorktreePath(path: string): Promise<void> {
    return (command as any).openWorktreePath(path);
  }

  beforeEach(() => {
    const mockConfig = {
      runCommand: vi.fn().mockResolvedValue(undefined),
    } as any;
    command = new TestCommand([], mockConfig);
    mockLog = vi.spyOn(command, "log").mockImplementation(() => {});
  });

  it("passes a path containing a space as a single argument", async () => {
    vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("code");

    await openWorktreePath(worktreePath);

    expect(mockRunCommand).toHaveBeenCalledWith("code", ["/tmp/a b/c"]);
  });

  it("keeps a multi-word editor value working as executable plus arguments", async () => {
    vi.spyOn(git, "gitGetConfigValue").mockResolvedValue(
      "herdr worktree open --focus --path",
    );

    await openWorktreePath(worktreePath);

    expect(mockRunCommand).toHaveBeenCalledWith("herdr", [
      "worktree",
      "open",
      "--focus",
      "--path",
      worktreePath,
    ]);
  });

  it("logs the path and launches nothing when no editor is configured", async () => {
    vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("");

    await openWorktreePath(worktreePath);

    expect(mockRunCommand).not.toHaveBeenCalled();
    expect(mockLog).toHaveBeenCalledWith(
      `✔ Worktree created in ${worktreePath}`,
    );
  });

  it("succeeds the spinner when the editor exits zero", async () => {
    vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("code");

    await openWorktreePath(worktreePath);

    expect(spinnerMocks.oraFactory).toHaveBeenCalledWith("Opening in code");
    await vi.waitFor(() => expect(spinnerMocks.succeed).toHaveBeenCalled());
    expect(spinnerMocks.fail).not.toHaveBeenCalled();
  });

  it("fails the spinner with stderr when the editor exits non-zero", async () => {
    vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("code");
    mockRunCommand.mockResolvedValue({
      stdout: "",
      stderr: "code: command failed",
      exitCode: 1,
    });

    await openWorktreePath(worktreePath);

    await vi.waitFor(() =>
      expect(spinnerMocks.fail).toHaveBeenCalledWith("code: command failed"),
    );
    expect(spinnerMocks.succeed).not.toHaveBeenCalled();
  });

  it("fails the spinner when the editor cannot be spawned", async () => {
    vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("code");
    mockRunCommand.mockRejectedValue(new Error("spawn code ENOENT"));

    await openWorktreePath(worktreePath);

    await vi.waitFor(() =>
      expect(spinnerMocks.fail).toHaveBeenCalledWith("spawn code ENOENT"),
    );
    expect(spinnerMocks.succeed).not.toHaveBeenCalled();
  });
});
