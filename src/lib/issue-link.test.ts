import * as linear from "../integrations/linear.js";
import { expectCommands, mockRun } from "../test-setup.js";
import * as cli from "./cli.js";
import {
  gatherIssueLinks,
  gitGetBranchIssueLinks,
  gitSetBranchIssueLink,
} from "./issue-link.js";

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

describe("gatherIssueLinks", () => {
  const KEY_COMMAND = "git config northguild.worktree.linear.apiKey";

  function records(...entries: [branch: string, identifier: string][]) {
    vi.spyOn(cli, "runCapturing").mockResolvedValue({
      stdout: listing(
        ...entries.map(
          ([branch, id]) =>
            [`branch.${branch}.worktreeissue`, `linear:${id}`] as [
              string,
              string,
            ],
        ),
      ),
      stderr: "",
      exitCode: 0,
    });
  }

  // The tests above never reach a remote, so the runner they pass must not run.
  const noGit = vi.fn().mockRejectedValue(new Error("unexpected git call"));
  const gather = (options: {
    lookup: boolean;
    onWarning: (message: string) => void;
    runGit?: (args: string[]) => Promise<string>;
  }) => gatherIssueLinks({ runGit: noGit, ...options });

  function apiKey(value: string) {
    mockRun.mockResolvedValue(value);
  }

  beforeEach(() => {
    // Spies on the lookup and the record read must not leak into the next test.
    vi.restoreAllMocks();
    mockRun.mockReset();
    expectCommands(KEY_COMMAND);
  });

  it("returns the records without a state when no lookup is asked for, and reads no key", async () => {
    records(["feature/a", "ENG-1"]);
    const states = vi.spyOn(linear, "fetchLinearIssueStates");
    const onWarning = vi.fn();

    const result = await gather({ lookup: false, onWarning });

    expect(result).toEqual(
      new Map([["feature/a", { provider: "linear", key: "ENG-1" }]]),
    );
    expect(states).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
    expect(onWarning).not.toHaveBeenCalled();
  });

  it("makes no request with records but no key, and says nothing (D8)", async () => {
    records(["feature/a", "ENG-1"]);
    apiKey("");
    const states = vi.spyOn(linear, "fetchLinearIssueStates");
    const onWarning = vi.fn();

    const result = await gather({ lookup: true, onWarning });

    expect(states).not.toHaveBeenCalled();
    expect(onWarning).not.toHaveBeenCalled();
    expect(result.get("feature/a")).toEqual({
      provider: "linear",
      key: "ENG-1",
    });
  });

  it("makes no request with a key but no records, and does not read the key", async () => {
    vi.spyOn(cli, "runCapturing").mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 1,
    });
    apiKey("lin_api_unused");
    const states = vi.spyOn(linear, "fetchLinearIssueStates");
    const onWarning = vi.fn();

    expect(await gather({ lookup: true, onWarning })).toEqual(new Map());
    expect(states).not.toHaveBeenCalled();
    expect(mockRun).not.toHaveBeenCalled();
    expect(onWarning).not.toHaveBeenCalled();
  });

  it("asks once for every recorded identifier and attaches the state types", async () => {
    records(
      ["feature/a", "ENG-1"],
      ["feature/b", "ENG-2"],
      ["feature/c", "ENG-3"],
    );
    apiKey("lin_api_key");
    const states = vi.spyOn(linear, "fetchLinearIssueStates").mockResolvedValue(
      // ENG-2: a state type outside the vocabulary comes back null (D9);
      // ENG-3 is not returned at all.
      new Map([
        ["ENG-1", "canceled"],
        ["ENG-2", null],
      ]),
    );
    const onWarning = vi.fn();

    const result = await gather({ lookup: true, onWarning });

    expect(states).toHaveBeenCalledTimes(1);
    expect(states).toHaveBeenCalledWith(["ENG-1", "ENG-2", "ENG-3"]);
    expect(result).toEqual(
      new Map([
        // Unconfirmed: the stubbed git answers nothing usable (D4).
        [
          "feature/a",
          {
            provider: "linear",
            key: "ENG-1",
            state: "canceled",
            remoteConfirmed: false,
          },
        ],
        ["feature/b", { provider: "linear", key: "ENG-2" }],
        ["feature/c", { provider: "linear", key: "ENG-3" }],
      ]),
    );
    expect(onWarning).not.toHaveBeenCalled();
  });

  it("asks once for two branches sharing an identifier", async () => {
    records(["feature/a", "ENG-1"], ["feature/b", "ENG-1"]);
    apiKey("lin_api_key");
    const states = vi
      .spyOn(linear, "fetchLinearIssueStates")
      .mockResolvedValue(new Map([["ENG-1", "completed"]]));

    await gather({ lookup: true, onWarning: vi.fn() });

    expect(states).toHaveBeenCalledWith(["ENG-1"]);
  });

  it("warns once for a failed lookup and leaves every state unknown", async () => {
    records(["feature/a", "ENG-1"], ["feature/b", "ENG-2"]);
    apiKey("lin_api_key");
    vi.spyOn(linear, "fetchLinearIssueStates").mockRejectedValue(
      new Error("Linear: the request did not answer within 15s."),
    );
    const onWarning = vi.fn();

    const result = await gather({ lookup: true, onWarning });

    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onWarning).toHaveBeenCalledWith(
      "Linear: the request did not answer within 15s. Canceled issues were not considered.",
    );
    expect([...result.values()].map((issue) => issue.state)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it("escapes control characters in a Linear error's own text (D7)", async () => {
    records(["feature/a", "ENG-1"]);
    apiKey("lin_api_key");
    vi.spyOn(linear, "fetchLinearIssueStates").mockRejectedValue(
      new Error("Linear: Failed to read issue states. \u001b[2Jgone\u0007"),
    );
    const onWarning = vi.fn();

    await gather({ lookup: true, onWarning });

    const [message] = onWarning.mock.calls[0] as [string];
    // No C0/C1 control character and no format character survives.
    expect(message).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    expect(message).toContain("\\x1b[2Jgone\\x07");
  });

  it("redacts a key a Linear error quotes, then escapes the rest (D7, secrets.md)", async () => {
    records(["feature/a", "ENG-1"]);
    apiKey("lin_api_key");
    const secret = "lin_api_AbCdEfGhIjKlMnOpQrStUvWx";
    vi.spyOn(linear, "fetchLinearIssueStates").mockRejectedValue(
      new Error(`Linear: rejected \u001b${secret}\u001b[2J`),
    );
    const onWarning = vi.fn();

    await gather({ lookup: true, onWarning });

    expect(onWarning).toHaveBeenCalledWith(
      "Linear: rejected \\x1b***\\x1b[2J Canceled issues were not considered.",
    );
  });

  it("reports a rejection that is not a Linear error with fixed text, never its message (D7)", async () => {
    records(["feature/a", "ENG-1"]);
    // Node's Headers.append quotes the offending value in its own message, so a
    // key with a line break in it reaches the rejection verbatim. Use the real
    // lookup so the message is Node's, not one written for this test.
    const secret = "lin_api_AbCdEfGhIjKlMnOpQrStUvWx";
    apiKey(`${secret}\nx`);
    const onWarning = vi.fn();

    const result = await gather({ lookup: true, onWarning });

    expect(onWarning).toHaveBeenCalledTimes(1);
    const [message] = onWarning.mock.calls[0] as [string];
    expect(message).not.toContain(secret);
    expect(message).not.toContain("lin_api_");
    expect(message).toBe(
      "Linear: could not read issue states. Canceled issues were not considered.",
    );
    expect(result.get("feature/a")?.state).toBeUndefined();
  });

  it("confirms the premise: the real rejection does carry the key in its message", async () => {
    apiKey("lin_api_AbCdEfGhIjKlMnOpQrStUvWx\nx");

    await expect(linear.fetchLinearIssueStates(["ENG-1"])).rejects.toThrow(
      "lin_api_AbCdEfGhIjKlMnOpQrStUvWx",
    );
  });

  it("treats a failed record read as no signal with one fixed warning, and never throws", async () => {
    vi.spyOn(cli, "runCapturing").mockResolvedValue({
      stdout: "",
      stderr: "fatal: unable to read config file '/x\u001b[31m'",
      exitCode: 128,
    });
    apiKey("lin_api_key");
    const states = vi.spyOn(linear, "fetchLinearIssueStates");
    const onWarning = vi.fn();

    const result = await gather({ lookup: true, onWarning });

    expect(result).toEqual(new Map());
    expect(states).not.toHaveBeenCalled();
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onWarning).toHaveBeenCalledWith(
      "Linear: could not read the recorded issue links. Canceled issues were not considered.",
    );
  });

  it("a failed record read never throws even when no lookup was asked for", async () => {
    vi.spyOn(cli, "runCapturing").mockResolvedValue({
      stdout: "",
      stderr: "boom",
      exitCode: 128,
    });
    const onWarning = vi.fn();

    await expect(gather({ lookup: false, onWarning })).resolves.toEqual(
      new Map(),
    );
    expect(onWarning).toHaveBeenCalledTimes(1);
  });

  // gitGetConfigValue answers "" when git itself fails, so a key read that
  // errors is the same as no key: silent (D8), and no request.
  it("does not throw out of the gather when the key read fails, and sends nothing", async () => {
    records(["feature/a", "ENG-1"]);
    mockRun.mockRejectedValue(new Error("lin_api_AbCdEfGhIjKlMnOpQrStUvWx"));
    const states = vi.spyOn(linear, "fetchLinearIssueStates");
    const onWarning = vi.fn();

    const result = await gather({ lookup: true, onWarning });

    expect(states).not.toHaveBeenCalled();
    expect(onWarning).not.toHaveBeenCalled();
    expect(result.get("feature/a")).toEqual({
      provider: "linear",
      key: "ENG-1",
    });
  });

  it("treats a failed load of the Linear module as a fixed warning, and never throws", async () => {
    records(["feature/a", "ENG-1"]);
    apiKey("lin_api_key");
    vi.doMock("../integrations/linear.js", () => {
      throw new Error("cannot load");
    });
    const onWarning = vi.fn();

    try {
      const result = await gather({ lookup: true, onWarning });

      expect(onWarning).toHaveBeenCalledTimes(1);
      expect(onWarning).toHaveBeenCalledWith(
        "Linear: could not read issue states. Canceled issues were not considered.",
      );
      expect(result.get("feature/a")).toEqual({
        provider: "linear",
        key: "ENG-1",
      });
    } finally {
      vi.doUnmock("../integrations/linear.js");
    }
  });

  it("does not load the Linear module when there is no record", async () => {
    vi.spyOn(cli, "runCapturing").mockResolvedValue({
      stdout: "",
      stderr: "",
      exitCode: 1,
    });
    apiKey("lin_api_key");
    vi.doMock("../integrations/linear.js", () => {
      throw new Error("cannot load");
    });
    const onWarning = vi.fn();

    try {
      await gather({ lookup: true, onWarning });
      expect(onWarning).not.toHaveBeenCalled();
    } finally {
      vi.doUnmock("../integrations/linear.js");
    }
  });

  describe("remote confirmation (D4)", () => {
    const SHA_A = "a".repeat(40);
    const SHA_B = "b".repeat(40);

    // What the two `for-each-ref` reads answer, in the formats the gather asks
    // for: one line per branch `<ref>\0<remotename>\0<remoteref>\0<tracking
    // ref>`, and one per remote-tracking ref `<ref>\0<object>`. Hand-built from
    // git-for-each-ref(1) field names, not from what the parser accepts.
    interface Upstream {
      branch: string;
      remote: string;
      merge: string;
      tracking: string;
      tip: string;
    }
    function repository(upstreams: Upstream[]) {
      mockRun.mockImplementation(async (_file: string, args: string[]) => {
        if (args[0] === "config") return "lin_api_key";
        if (args[0] === "for-each-ref" && args.at(-1) === "refs/heads") {
          return upstreams
            .map(
              (u) =>
                `refs/heads/${u.branch}\0${u.remote}\0${u.merge}\0${u.tracking}`,
            )
            .join("\n");
        }
        if (args[0] === "for-each-ref" && args.at(-1) === "refs/remotes") {
          return upstreams
            .filter((u) => u.tracking)
            .map((u) => `${u.tracking}\0${u.tip}`)
            .join("\n");
        }
        return "";
      });
    }
    function upstream(
      branch: string,
      remote: string,
      tip = SHA_A,
      overrides: Partial<Upstream> = {},
    ): Upstream {
      return {
        branch,
        remote,
        merge: `refs/heads/${branch}`,
        tracking: `refs/remotes/${remote}/${branch}`,
        tip,
        ...overrides,
      };
    }
    function heads(...entries: [branch: string, sha: string][]) {
      return entries.map(([b, sha]) => `${sha}\trefs/heads/${b}`).join("\n");
    }
    function canceled(...identifiers: string[]) {
      vi.spyOn(linear, "fetchLinearIssueStates").mockResolvedValue(
        new Map(identifiers.map((id) => [id, "canceled"])),
      );
    }
    const confirmed = (result: Map<string, { remoteConfirmed?: boolean }>) =>
      [...result].map(([branch, issue]) => [branch, issue.remoteConfirmed]);

    it("confirms a branch whose remote reports the tracking ref's tip, with one bounded ls-remote", async () => {
      records(["feature/a", "ENG-1"]);
      repository([upstream("feature/a", "origin")]);
      canceled("ENG-1");
      const runGit = vi
        .fn()
        .mockResolvedValue(heads(["feature/a", SHA_A], ["main", SHA_B]));
      const onWarning = vi.fn();

      const result = await gather({ lookup: true, onWarning, runGit });

      // `--end-of-options` keeps a remote named like an option an operand.
      expect(runGit).toHaveBeenCalledTimes(1);
      expect(runGit).toHaveBeenCalledWith([
        "ls-remote",
        "--heads",
        "--end-of-options",
        "origin",
      ]);
      expect(confirmed(result)).toEqual([["feature/a", true]]);
      expect(onWarning).not.toHaveBeenCalled();
    });

    // The upstream's own name differs from the local branch's, so the ref asked
    // for and the tracking ref read must both come from the upstream (N11).
    describe("when the upstream name differs from the local name", () => {
      const renamed = () =>
        upstream("feature/a", "fork", SHA_A, {
          merge: "refs/heads/other-name",
          tracking: "refs/remotes/fork/other-name",
        });

      it("compares the upstream's own ref with the tracking ref", async () => {
        records(["feature/a", "ENG-1"]);
        repository([renamed()]);
        canceled("ENG-1");
        // A decoy at the local name holds a different tip.
        const runGit = vi
          .fn()
          .mockResolvedValue(
            heads(["other-name", SHA_A], ["feature/a", SHA_B]),
          );

        const result = await gather({
          lookup: true,
          onWarning: vi.fn(),
          runGit,
        });

        expect(confirmed(result)).toEqual([["feature/a", true]]);
      });

      it("is unconfirmed when only some other head holds the tip", async () => {
        records(["feature/a", "ENG-1"]);
        repository([renamed()]);
        canceled("ENG-1");

        const result = await gather({
          lookup: true,
          onWarning: vi.fn(),
          runGit: vi
            .fn()
            .mockResolvedValue(
              heads(["other-name", SHA_B], ["unrelated", SHA_A]),
            ),
        });

        expect(confirmed(result)).toEqual([["feature/a", false]]);
      });
    });

    it("asks a remote once however many canceled branches share it", async () => {
      records(["feature/a", "ENG-1"], ["feature/b", "ENG-2"]);
      repository([
        upstream("feature/a", "origin"),
        upstream("feature/b", "origin", SHA_B),
      ]);
      canceled("ENG-1", "ENG-2");
      const runGit = vi
        .fn()
        .mockResolvedValue(heads(["feature/a", SHA_A], ["feature/b", SHA_B]));

      const result = await gather({ lookup: true, onWarning: vi.fn(), runGit });

      expect(runGit).toHaveBeenCalledTimes(1);
      expect(confirmed(result)).toEqual([
        ["feature/a", true],
        ["feature/b", true],
      ]);
    });

    it("asks only for branches whose state is canceled", async () => {
      records(["feature/a", "ENG-1"], ["feature/b", "ENG-2"]);
      repository([
        upstream("feature/a", "origin"),
        upstream("feature/b", "fork"),
      ]);
      vi.spyOn(linear, "fetchLinearIssueStates").mockResolvedValue(
        new Map([
          ["ENG-1", "canceled"],
          ["ENG-2", "started"],
        ]),
      );
      const runGit = vi.fn().mockResolvedValue(heads(["feature/a", SHA_A]));

      const result = await gather({ lookup: true, onWarning: vi.fn(), runGit });

      expect(runGit).toHaveBeenCalledTimes(1);
      expect(runGit.mock.calls[0]?.[0]).toContain("origin");
      expect(confirmed(result)).toEqual([
        ["feature/a", true],
        ["feature/b", undefined],
      ]);
    });

    it("asks nothing when no branch is canceled", async () => {
      records(["feature/a", "ENG-1"]);
      repository([upstream("feature/a", "origin")]);
      vi.spyOn(linear, "fetchLinearIssueStates").mockResolvedValue(
        new Map([["ENG-1", "completed"]]),
      );
      const runGit = vi.fn();

      await gather({ lookup: true, onWarning: vi.fn(), runGit });

      expect(runGit).not.toHaveBeenCalled();
      expect(
        mockRun.mock.calls.filter(([, args]) => args[0] === "for-each-ref"),
      ).toEqual([]);
    });

    it("asks nothing when the lookup failed", async () => {
      records(["feature/a", "ENG-1"]);
      repository([upstream("feature/a", "origin")]);
      vi.spyOn(linear, "fetchLinearIssueStates").mockRejectedValue(
        new Error("Linear: the request did not answer within 15s."),
      );
      const runGit = vi.fn();

      await gather({ lookup: true, onWarning: vi.fn(), runGit });

      expect(runGit).not.toHaveBeenCalled();
    });

    it.each([
      ["the remote no longer has the branch", heads(["main", SHA_B])],
      [
        "the remote is ahead of a stale tracking ref",
        heads(["feature/a", SHA_B]),
      ],
    ])("is unconfirmed when %s", async (_name, listing) => {
      records(["feature/a", "ENG-1"]);
      repository([upstream("feature/a", "fork", SHA_A)]);
      canceled("ENG-1");
      const onWarning = vi.fn();

      const result = await gather({
        lookup: true,
        onWarning,
        runGit: vi.fn().mockResolvedValue(listing),
      });

      expect(confirmed(result)).toEqual([["feature/a", false]]);
      // A clear answer is not a failure.
      expect(onWarning).not.toHaveBeenCalled();
    });

    it("is unconfirmed when the tracking ref is ahead of the remote", async () => {
      records(["feature/a", "ENG-1"]);
      repository([upstream("feature/a", "origin", SHA_B)]);
      canceled("ENG-1");

      const result = await gather({
        lookup: true,
        onWarning: vi.fn(),
        runGit: vi.fn().mockResolvedValue(heads(["feature/a", SHA_A])),
      });

      expect(confirmed(result)).toEqual([["feature/a", false]]);
    });

    it("is unconfirmed, without a call, for an upstream that is a local branch (.)", async () => {
      records(["feature/a", "ENG-1"]);
      repository([
        {
          branch: "feature/a",
          remote: ".",
          merge: "refs/heads/main",
          tracking: "refs/heads/main",
          tip: SHA_A,
        },
      ]);
      canceled("ENG-1");
      const runGit = vi.fn();

      const result = await gather({ lookup: true, onWarning: vi.fn(), runGit });

      expect(runGit).not.toHaveBeenCalled();
      expect(confirmed(result)).toEqual([["feature/a", false]]);
    });

    it("is unconfirmed, without a call, for a branch with no upstream", async () => {
      records(["feature/a", "ENG-1"]);
      repository([
        upstream("feature/a", "", SHA_A, { merge: "", tracking: "" }),
      ]);
      canceled("ENG-1");
      const runGit = vi.fn();

      const result = await gather({ lookup: true, onWarning: vi.fn(), runGit });

      expect(runGit).not.toHaveBeenCalled();
      expect(confirmed(result)).toEqual([["feature/a", false]]);
    });

    it("is unconfirmed for a branch git does not list at all", async () => {
      records(["feature/a", "ENG-1"]);
      repository([]);
      canceled("ENG-1");
      const runGit = vi.fn();

      const result = await gather({ lookup: true, onWarning: vi.fn(), runGit });

      expect(runGit).not.toHaveBeenCalled();
      expect(confirmed(result)).toEqual([["feature/a", false]]);
    });

    it("lets one remote fail without stopping another, with one fixed warning that quotes no credential", async () => {
      records(["feature/a", "ENG-1"], ["feature/b", "ENG-2"]);
      repository([
        upstream("feature/a", "fork"),
        upstream("feature/b", "origin"),
      ]);
      canceled("ENG-1", "ENG-2");
      const runGit = vi.fn(async (args: string[]) => {
        if (args.at(-1) === "fork") {
          throw new Error(
            "fatal: unable to access 'https://user:secret@host/r.git/': timed out",
          );
        }
        return heads(["feature/b", SHA_A]);
      });
      const onWarning = vi.fn();

      const result = await gather({ lookup: true, onWarning, runGit });

      expect(confirmed(result)).toEqual([
        ["feature/a", false],
        ["feature/b", true],
      ]);
      expect(onWarning).toHaveBeenCalledTimes(1);
      expect(onWarning).toHaveBeenCalledWith(
        "Git: could not ask a remote about a canceled issue's branch. Canceled issues were not considered.",
      );
      expect(onWarning.mock.calls[0]?.[0]).not.toContain("secret");
    });

    it("warns once when every remote fails", async () => {
      records(["feature/a", "ENG-1"], ["feature/b", "ENG-2"]);
      repository([
        upstream("feature/a", "fork"),
        upstream("feature/b", "origin"),
      ]);
      canceled("ENG-1", "ENG-2");
      const onWarning = vi.fn();

      await gather({
        lookup: true,
        onWarning,
        runGit: vi.fn().mockRejectedValue(new Error("boom")),
      });

      expect(onWarning).toHaveBeenCalledTimes(1);
    });

    it("treats a failed local read as unconfirmed with the same fixed warning", async () => {
      records(["feature/a", "ENG-1"]);
      mockRun.mockImplementation(async (_file: string, args: string[]) => {
        if (args[0] === "config") return "lin_api_key";
        throw new Error("fatal: https://user:secret@host broke");
      });
      canceled("ENG-1");
      const runGit = vi.fn();
      const onWarning = vi.fn();

      const result = await gather({ lookup: true, onWarning, runGit });

      expect(runGit).not.toHaveBeenCalled();
      expect(confirmed(result)).toEqual([["feature/a", false]]);
      expect(onWarning).toHaveBeenCalledTimes(1);
      expect(onWarning.mock.calls[0]?.[0]).not.toContain("secret");
    });

    it("passes a remote named like an option as an operand", async () => {
      records(["feature/a", "ENG-1"]);
      repository([upstream("feature/a", "-upload-pack=x")]);
      canceled("ENG-1");
      const runGit = vi.fn().mockResolvedValue("");

      await gather({ lookup: true, onWarning: vi.fn(), runGit });

      expect(runGit).toHaveBeenCalledWith([
        "ls-remote",
        "--heads",
        "--end-of-options",
        "-upload-pack=x",
      ]);
    });
  });
});
