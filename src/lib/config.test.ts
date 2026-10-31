import { expectCommands } from "../test-setup.js";
import * as cli from "./cli.js";
import { gitGetConfigValue, gitSetConfigValue } from "./config.js";

describe("git config", () => {
  // The value §7 case 3 stores by hand: a quote, a backtick and a semicolon,
  // every one of which the old `git config … "${value}"` form handed to a shell.
  const hostileValue = 'x"; touch /tmp/pwned; #`whoami`';

  beforeEach(() => {
    vi.clearAllMocks();
    expectCommands(
      "git config northguild.worktree.defaultSourceBranch",
      "git config northguild.worktree.codeEditor",
      "git config northguild.worktree.codeEditor code",
      `git config northguild.worktree.codeEditor "${hostileValue}"`,
    );
  });

  it("returns git config value", async () => {
    const runSpy = vi.spyOn(cli, "run").mockResolvedValueOnce("origin/main");

    const value = await gitGetConfigValue("defaultSourceBranch");

    expect(runSpy).toHaveBeenCalledWith("git", [
      "config",
      "northguild.worktree.defaultSourceBranch",
    ]);
    expect(value).toBe("origin/main");
  });

  it("returns empty string when git config lookup fails", async () => {
    const runSpy = vi.spyOn(cli, "run").mockRejectedValueOnce(new Error());

    const value = await gitGetConfigValue("defaultSourceBranch");

    expect(runSpy).toHaveBeenCalledWith("git", [
      "config",
      "northguild.worktree.defaultSourceBranch",
    ]);
    expect(value).toBe("");
  });

  it("sets git config value", async () => {
    const runSpy = vi.spyOn(cli, "run").mockResolvedValueOnce("");

    await gitSetConfigValue("codeEditor", "code");

    expect(runSpy).toHaveBeenCalledWith("git", [
      "config",
      "northguild.worktree.codeEditor",
      "code",
    ]);
  });

  // The point of the argv form: a value carrying shell metacharacters is one
  // element on the way out and the same string on the way back, with nothing in
  // between that could parse it.
  it("round-trips a value containing a quote, a backtick and a semicolon", async () => {
    const runSpy = vi
      .spyOn(cli, "run")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce(hostileValue);

    await gitSetConfigValue("codeEditor", hostileValue);
    const value = await gitGetConfigValue("codeEditor");

    expect(runSpy).toHaveBeenNthCalledWith(1, "git", [
      "config",
      "northguild.worktree.codeEditor",
      hostileValue,
    ]);
    // One argv element, not a shell string that happens to contain the value.
    expect(runSpy.mock.calls[0]?.[1]).toHaveLength(3);
    // The read is `git config <key>` with no value: a second argument would write.
    expect(runSpy).toHaveBeenNthCalledWith(2, "git", [
      "config",
      "northguild.worktree.codeEditor",
    ]);
    expect(value).toBe(hostileValue);
  });
});
