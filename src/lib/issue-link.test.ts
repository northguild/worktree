import { expectCommands } from "../test-setup.js";
import * as cli from "./cli.js";
import { gitGetBranchIssueLinks, gitSetBranchIssueLink } from "./issue-link.js";

// `git config -z` ends each entry with NUL and separates the key from the value
// with a newline (git-config(1), "-z"). A hand-built listing in that shape is the
// expected input, because it is the format the manual documents, not what the
// parser happens to accept.
function listing(...entries: [key: string, value: string][]) {
  return entries.map(([key, value]) => `${key}\n${value}\0`).join("");
}

describe("issue link record", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    expectCommands(
      "git config branch.feature/ENG-123-add-dark-mode.worktreeIssue linear:ENG-123",
    );
  });

  describe("gitSetBranchIssueLink", () => {
    it("writes one git config call, every part its own argv element", async () => {
      const runSpy = vi.spyOn(cli, "run").mockResolvedValueOnce("");

      await gitSetBranchIssueLink("feature/ENG-123-add-dark-mode", "ENG-123");

      // Variable name from plan §4.1 / D1; the value is provider-tagged (D2).
      expect(runSpy).toHaveBeenCalledTimes(1);
      expect(runSpy).toHaveBeenCalledWith("git", [
        "config",
        "branch.feature/ENG-123-add-dark-mode.worktreeIssue",
        "linear:ENG-123",
      ]);
    });

    it("refuses an identifier that fails the shape, and writes nothing", async () => {
      const runSpy = vi.spyOn(cli, "run").mockResolvedValueOnce("");

      await expect(
        gitSetBranchIssueLink("feat", "eng-1; touch /tmp/x"),
      ).rejects.toThrow("Invalid issue identifier.");

      expect(runSpy).not.toHaveBeenCalled();
    });
  });

  describe("gitGetBranchIssueLinks", () => {
    it("asks for the whole repository in one call, argv only", async () => {
      const runSpy = vi
        .spyOn(cli, "runCapturing")
        .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 1 });

      await gitGetBranchIssueLinks();

      expect(runSpy).toHaveBeenCalledTimes(1);
      expect(runSpy).toHaveBeenCalledWith(
        "git",
        [
          "config",
          "--local",
          "-z",
          "--get-regexp",
          "^branch\\..*\\.worktreeissue$",
        ],
        { trim: false },
      );
    });

    it("reads exit 1 (no matching key) as no links", async () => {
      vi.spyOn(cli, "runCapturing").mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 1,
      });

      expect(await gitGetBranchIssueLinks()).toEqual(new Map());
    });

    it("throws on any other failing exit rather than reading it as none", async () => {
      vi.spyOn(cli, "runCapturing").mockResolvedValueOnce({
        stdout: "",
        stderr: "fatal: not a git repository",
        exitCode: 128,
      });

      await expect(gitGetBranchIssueLinks()).rejects.toThrow(
        "fatal: not a git repository",
      );
    });

    it("keys by the branch, whose name may hold dots and slashes", async () => {
      vi.spyOn(cli, "runCapturing").mockResolvedValueOnce({
        stdout: listing(
          ["branch.feature/ENG-1-v1.2.worktreeissue", "linear:ENG-1"],
          ["branch.fix/a.b/c.worktreeissue", "linear:PLAT2-77"],
          ["branch.main.worktreeissue", "linear:X-9"],
        ),
        stderr: "",
        exitCode: 0,
      });

      // The branch is everything between the leading `branch.` and the trailing
      // `.worktreeissue` (plan §4.1); the value is the identifier after `linear:`.
      expect(await gitGetBranchIssueLinks()).toEqual(
        new Map([
          ["feature/ENG-1-v1.2", "ENG-1"],
          ["fix/a.b/c", "PLAT2-77"],
          ["main", "X-9"],
        ]),
      );
    });

    it("drops a value that is not linear:<identifier> (D9)", async () => {
      vi.spyOn(cli, "runCapturing").mockResolvedValueOnce({
        stdout: listing(
          ["branch.ok.worktreeissue", "linear:ENG-5"],
          ["branch.lowercase.worktreeissue", "linear:eng-5"],
          ["branch.nonumber.worktreeissue", "linear:ENG-"],
          ["branch.trailing.worktreeissue", "linear:ENG-5 extra"],
          ["branch.escape.worktreeissue", "linear:ENG-5\u001b[31m"],
          ["branch.jira.worktreeissue", "jira:DEV-1"],
          ["branch.bare.worktreeissue", "ENG-5"],
          ["branch.empty.worktreeissue", ""],
        ),
        stderr: "",
        exitCode: 0,
      });

      expect(await gitGetBranchIssueLinks()).toEqual(
        new Map([["ok", "ENG-5"]]),
      );
    });
  });
});
