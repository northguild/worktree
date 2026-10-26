import { input } from "@inquirer/prompts";
import * as cli from "../lib/cli.js";
import { setNonInteractive } from "../lib/interaction.js";
import { expectCommands } from "../test-setup.js";
import {
  assignGitHubIssue,
  fetchGitHubIssue,
  fetchGitHubLogin,
  type GitHubIssueApiResponse,
  type GitHubIssueTypeApiResponse,
  parseGitHubRepositoryFromRemote,
} from "./github.js";

vi.mock("@inquirer/prompts", () => ({ input: vi.fn() }));

type MockIssueOverrides = Partial<
  Omit<GitHubIssueApiResponse, "type" | "user">
> & {
  type?: GitHubIssueTypeApiResponse | null;
  user?: Partial<GitHubIssueApiResponse["user"]>;
};

function makeIssueApiResponse(
  overrides: MockIssueOverrides = {},
): GitHubIssueApiResponse {
  const {
    type: overrideType,
    user: overrideUser,
    ...restOverrides
  } = overrides;
  const number = overrides.number ?? 42;
  const defaultType: GitHubIssueTypeApiResponse = {
    id: 1,
    node_id: "IT_kwDOD8WxkM4AAAAA",
    name: "Feature",
    description: "A request, idea, or new functionality",
    color: "blue",
    created_at: "2026-02-28T11:23:18Z",
    updated_at: "2026-02-28T11:23:18Z",
    is_enabled: true,
  };
  const defaultUser = {
    login: "baldurpan",
    html_url: "https://github.com/baldurpan",
  };

  return {
    url: `https://api.github.com/repos/northguild/worktree/issues/${number}`,
    repository_url: "https://api.github.com/repos/northguild/worktree",
    labels_url: `https://api.github.com/repos/northguild/worktree/issues/${number}/labels{/name}`,
    comments_url: `https://api.github.com/repos/northguild/worktree/issues/${number}/comments`,
    events_url: `https://api.github.com/repos/northguild/worktree/issues/${number}/events`,
    id: 101,
    node_id: "I_kwDORiPVEM4AAAAA",
    number,
    title: "Support GitHub issue integration",
    body: "Add issue lookup",
    state: "open",
    state_reason: null,
    comments: 0,
    created_at: "2026-03-22T12:00:00Z",
    updated_at: "2026-03-22T12:00:00Z",
    closed_at: null,
    author_association: "CONTRIBUTOR",
    html_url: `https://github.com/northguild/worktree/issues/${number}`,
    assignees: [],
    ...restOverrides,
    type: overrideType === undefined ? defaultType : overrideType,
    user: {
      ...defaultUser,
      ...overrideUser,
    },
  };
}

function makeOkJsonResponse<T>(payload: T) {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue(payload),
  };
}

describe("GitHub integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    expectCommands(
      "git remote get-url origin",
      "git config northguild.worktree.github.token",
    );
  });

  it.each([
    {
      remoteUrl: "git@github.com:northguild/worktree.git",
      expected: { owner: "northguild", name: "worktree" },
    },
    {
      remoteUrl: "https://github.com/northguild/worktree.git",
      expected: { owner: "northguild", name: "worktree" },
    },
    {
      remoteUrl: "https://github.com/northguild/worktree",
      expected: { owner: "northguild", name: "worktree" },
    },
  ])("parses GitHub remote url $remoteUrl", ({ remoteUrl, expected }) => {
    expect(parseGitHubRepositoryFromRemote(remoteUrl)).toEqual(expected);
  });

  it("throws when the origin remote is not a GitHub repository", () => {
    expect(() =>
      parseGitHubRepositoryFromRemote("git@gitlab.com:northguild/worktree.git"),
    ).toThrow(
      'GitHub: Unable to determine the current repository from origin remote "git@gitlab.com:northguild/worktree.git".',
    );
  });

  it("fetches issue info from the current repository", async () => {
    const runSpy = vi
      .spyOn(cli, "run")
      .mockResolvedValueOnce("git@github.com:northguild/worktree.git")
      .mockResolvedValueOnce("");

    const fetchSpy = vi
      .fn()
      .mockResolvedValue(makeOkJsonResponse(makeIssueApiResponse()));
    vi.stubGlobal("fetch", fetchSpy);

    const issue = await fetchGitHubIssue(42);

    expect(runSpy).toHaveBeenCalledWith("git", ["remote", "get-url", "origin"]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.github.com/repos/northguild/worktree/issues/42",
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "@northguild/worktree",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        signal: expect.any(AbortSignal),
      },
    );
    expect(issue).toEqual({
      url: "https://api.github.com/repos/northguild/worktree/issues/42",
      repositoryUrl: "https://api.github.com/repos/northguild/worktree",
      labelsUrl:
        "https://api.github.com/repos/northguild/worktree/issues/42/labels{/name}",
      commentsUrl:
        "https://api.github.com/repos/northguild/worktree/issues/42/comments",
      eventsUrl:
        "https://api.github.com/repos/northguild/worktree/issues/42/events",
      id: 101,
      nodeId: "I_kwDORiPVEM4AAAAA",
      number: 42,
      title: "Support GitHub issue integration",
      body: "Add issue lookup",
      state: "open",
      stateReason: null,
      comments: 0,
      createdAt: "2026-03-22T12:00:00Z",
      updatedAt: "2026-03-22T12:00:00Z",
      closedAt: null,
      authorAssociation: "CONTRIBUTOR",
      htmlUrl: "https://github.com/northguild/worktree/issues/42",
      type: {
        id: 1,
        nodeId: "IT_kwDOD8WxkM4AAAAA",
        name: "Feature",
        description: "A request, idea, or new functionality",
        color: "blue",
        createdAt: "2026-02-28T11:23:18Z",
        updatedAt: "2026-02-28T11:23:18Z",
        isEnabled: true,
      },
      pullRequest: null,
      user: {
        login: "baldurpan",
        htmlUrl: "https://github.com/baldurpan",
      },
    });
  });

  it("reads the head branch of a pull request answered as an issue", async () => {
    vi.spyOn(cli, "run")
      .mockResolvedValueOnce("git@github.com:northguild/worktree.git")
      .mockResolvedValueOnce("ghp_test_token");
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(
        makeOkJsonResponse(
          makeIssueApiResponse({
            number: 105,
            pull_request: {
              url: "https://api.github.com/repos/northguild/worktree/pulls/105",
            },
          }),
        ),
      )
      .mockResolvedValueOnce(
        makeOkJsonResponse({
          head: {
            ref: "chore/update-ai-workflow",
            repo: { full_name: "northguild/worktree" },
          },
        }),
      );
    vi.stubGlobal("fetch", fetchSpy);

    const issue = await fetchGitHubIssue(105);

    expect(fetchSpy.mock.calls[1]?.[0]).toBe(
      "https://api.github.com/repos/northguild/worktree/pulls/105",
    );
    expect(issue.pullRequest).toEqual({
      headBranch: "chore/update-ai-workflow",
    });
  });

  it.each([
    [
      "from a fork",
      makeOkJsonResponse({
        head: { ref: "main", repo: { full_name: "someone/worktree" } },
      }),
    ],
    ["whose lookup fails", new Response("", { status: 404 })],
  ])("reports no head branch for a pull request %s", async (_case, pullResponse) => {
    vi.spyOn(cli, "run")
      .mockResolvedValueOnce("git@github.com:northguild/worktree.git")
      .mockResolvedValueOnce("ghp_test_token");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          makeOkJsonResponse(
            makeIssueApiResponse({
              number: 106,
              pull_request: {
                url: "https://api.github.com/repos/northguild/worktree/pulls/106",
              },
            }),
          ),
        )
        .mockResolvedValueOnce(pullResponse),
    );

    const issue = await fetchGitHubIssue(106);

    expect(issue.pullRequest).toEqual({ headBranch: null });
  });

  it("throws for invalid issue ids", async () => {
    const refusal = fetchGitHubIssue("abc");

    await expect(refusal).rejects.toThrow('GitHub: Invalid issue id "abc".');
    await expect(refusal).rejects.toMatchObject({
      code: "invalid_value",
      oclif: { exit: 2 },
    });
  });

  it("throws when the GitHub API responds with an error", async () => {
    // Use a pre-configured token so the repo-check step is skipped, and the
    // error comes directly from the issue fetch.
    vi.spyOn(cli, "run")
      .mockResolvedValueOnce("git@github.com:northguild/worktree.git")
      .mockResolvedValueOnce("ghp_test_token");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: vi.fn().mockResolvedValue('{"message":"Not Found"}'),
      }),
    );

    await expect(fetchGitHubIssue(999)).rejects.toThrow(
      new Error(
        'GitHub: Failed to fetch issue 999 from northguild/worktree. 404 Not Found - {"message":"Not Found"}',
      ),
    );
  });

  it("adds no hint to a 401 when no token was sent", async () => {
    vi.spyOn(cli, "run")
      .mockResolvedValueOnce("git@github.com:northguild/worktree.git")
      .mockResolvedValueOnce(""); // git config: no token
    const fetchSpy = vi.fn();
    fetchSpy.mockResolvedValueOnce({ ok: true }); // repository probe answers
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: vi.fn().mockResolvedValue('{"message":"Bad credentials"}'),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchGitHubIssue(13)).rejects.toThrow(
      new Error(
        'GitHub: Failed to fetch issue 13 from northguild/worktree. 401 Unauthorized - {"message":"Bad credentials"}',
      ),
    );
  });

  it("auto-resolves a token via gh CLI when the repo check fails without a token", async () => {
    const runSpy = vi.spyOn(cli, "run");
    runSpy.mockResolvedValueOnce("git@github.com:northguild/worktree.git"); // git remote get-url origin
    runSpy.mockResolvedValueOnce(""); // git config token (no token)
    runSpy.mockResolvedValueOnce("ghp_auto_token"); // gh auth token

    const fetchSpy = vi.fn();
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: vi.fn().mockResolvedValue(""),
    }); // repo check fails
    fetchSpy.mockResolvedValueOnce(
      makeOkJsonResponse(
        makeIssueApiResponse({
          id: 201,
          node_id: "I_kwDORiPVEM4BBBBB",
          number: 13,
          title: "Private issue",
          body: null,
          type: null,
        }),
      ),
    ); // issue fetch succeeds with token
    vi.stubGlobal("fetch", fetchSpy);

    // The token from `gh` is used for this run only: no `git config` write.
    expectCommands("gh auth token");

    const issue = await fetchGitHubIssue(13);

    expect(issue.number).toBe(13);
    expect(runSpy).toHaveBeenCalledWith("gh", ["auth", "token"], {
      timeout: 10_000,
    });
    expect(runSpy).not.toHaveBeenCalledWith("git", [
      "config",
      "northguild.worktree.github.token",
      "ghp_auto_token",
    ]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.github.com/repos/northguild/worktree/issues/13",
      {
        headers: expect.objectContaining({
          Authorization: "Bearer ghp_auto_token",
        }),
        signal: expect.any(AbortSignal),
      },
    );
  });

  it("stores a token the person typed at the prompt", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const runSpy = vi.spyOn(cli, "run");
    runSpy.mockResolvedValueOnce("git@github.com:northguild/worktree.git");
    runSpy.mockResolvedValueOnce("");
    runSpy.mockRejectedValueOnce(new Error("not logged in")); // gh auth token
    runSpy.mockResolvedValueOnce(""); // gitSetConfigValue (saving token)
    vi.mocked(input).mockResolvedValueOnce("ghp_typed_token");
    const fetchSpy = vi.fn();
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: vi.fn().mockResolvedValue(""),
    });
    fetchSpy.mockResolvedValueOnce(
      makeOkJsonResponse(makeIssueApiResponse({ number: 13, type: null })),
    );
    vi.stubGlobal("fetch", fetchSpy);
    expectCommands(
      "gh auth token",
      "git config northguild.worktree.github.token ghp_typed_token",
    );

    await fetchGitHubIssue(13);

    expect(runSpy).toHaveBeenCalledWith("git", [
      "config",
      "northguild.worktree.github.token",
      "ghp_typed_token",
    ]);
  });

  it("says the stored token was refused, naming both remedies, on a 401 fetching an issue", async () => {
    vi.spyOn(cli, "run")
      .mockResolvedValueOnce("git@github.com:northguild/worktree.git")
      .mockResolvedValueOnce("ghp_stale_token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: vi.fn().mockResolvedValue('{"message":"Bad credentials"}'),
      }),
    );

    const error = await fetchGitHubIssue(13).catch((e: Error) => e);

    expect(error).toBeInstanceOf(Error);
    const { message } = error as Error;
    expect(message).toContain(
      'GitHub: Failed to fetch issue 13 from northguild/worktree. 401 Unauthorized - {"message":"Bad credentials"}',
    );
    expect(message).toContain("The stored github.token was refused.");
    expect(message).toContain("`worktree config github.token <token>`");
    expect(message).toContain(
      "`git config --unset northguild.worktree.github.token`",
    );
    expect(message).not.toContain("GitHub refused the token");
    expect(message).not.toContain("ghp_stale_token");
  });

  it("keeps the gh hint on a 401 for a token that came from gh", async () => {
    const runSpy = vi.spyOn(cli, "run");
    runSpy.mockResolvedValueOnce("git@github.com:northguild/worktree.git");
    runSpy.mockResolvedValueOnce(""); // git config: no token
    runSpy.mockResolvedValueOnce("ghp_gh_token"); // gh auth token
    const fetchSpy = vi.fn();
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: vi.fn().mockResolvedValue(""),
    }); // repo check fails
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: vi.fn().mockResolvedValue('{"message":"Bad credentials"}'),
    });
    vi.stubGlobal("fetch", fetchSpy);
    expectCommands("gh auth token");

    const error = await fetchGitHubIssue(13).catch((e: Error) => e);

    const { message } = error as Error;
    expect(message).toContain("GitHub refused the token");
    expect(message).toContain("`gh auth login`");
    expect(message).toContain("`worktree config github.token <token>`");
    expect(message).not.toContain("stored github.token");
    expect(message).not.toContain("ghp_gh_token");
  });

  it("fails naming where to put a token, and prints nothing, when non-interactive", async () => {
    setNonInteractive(true);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const runSpy = vi.spyOn(cli, "run");
    runSpy.mockResolvedValueOnce("git@github.com:northguild/worktree.git");
    runSpy.mockResolvedValueOnce("");
    runSpy.mockRejectedValueOnce(new Error("not logged in")); // gh auth token
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: vi.fn().mockResolvedValue(""),
      }),
    );
    expectCommands("gh auth token");

    await expect(fetchGitHubIssue(13)).rejects.toMatchObject({
      message:
        "no default for a GitHub token; pass `worktree config github.token <token>` or run `gh auth login`",
      oclif: { exit: 2 },
    });
    expect(input).not.toHaveBeenCalled();
    expect(logSpy).not.toHaveBeenCalled();
  });

  function makeUserResponse(login = "baldurpan") {
    return {
      login,
      html_url: `https://github.com/${login}`,
    };
  }

  it("resolves the authenticated login from a configured token", async () => {
    // fetchGitHubLogin needs a token and nothing else — it never reads the
    // origin remote, so the config lookup is the only run() call it makes.
    vi.spyOn(cli, "run").mockResolvedValueOnce("ghp_test_token");

    const fetchSpy = vi
      .fn()
      .mockResolvedValue(makeOkJsonResponse(makeUserResponse()));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchGitHubLogin()).resolves.toBe("baldurpan");
    expect(fetchSpy).toHaveBeenCalledWith("https://api.github.com/user", {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "@northguild/worktree",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: "Bearer ghp_test_token",
      },
      signal: expect.any(AbortSignal),
    });
  });

  it("throws when the authenticated user cannot be resolved", async () => {
    vi.spyOn(cli, "run").mockResolvedValueOnce("ghp_test_token");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: vi.fn().mockResolvedValue('{"message":"Bad credentials"}'),
      }),
    );

    const error = await fetchGitHubLogin().catch((e: Error) => e);

    expect((error as Error).message).toContain(
      'GitHub: Failed to resolve the authenticated user. 401 Unauthorized - {"message":"Bad credentials"}',
    );
    expect((error as Error).message).toContain(
      "The stored github.token was refused.",
    );
    expect((error as Error).message).toContain(
      "`worktree config github.token <token>`",
    );
    expect((error as Error).message).toContain(
      "`git config --unset northguild.worktree.github.token`",
    );
    expect((error as Error).message).not.toContain("GitHub refused the token");
    expect((error as Error).message).not.toContain("ghp_test_token");
  });

  it("assigns the authenticated user to the issue", async () => {
    vi.spyOn(cli, "run")
      .mockResolvedValueOnce("git@github.com:northguild/worktree.git")
      .mockResolvedValueOnce("ghp_test_token");

    const fetchSpy = vi.fn();
    fetchSpy.mockResolvedValueOnce(makeOkJsonResponse(makeUserResponse()));
    fetchSpy.mockResolvedValueOnce(
      makeOkJsonResponse(
        makeIssueApiResponse({ assignees: [makeUserResponse()] }),
      ),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(assignGitHubIssue(42)).resolves.toEqual({
      login: "baldurpan",
      assigned: true,
    });

    expect(fetchSpy).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/repos/northguild/worktree/issues/42/assignees",
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "@northguild/worktree",
          "X-GitHub-Api-Version": "2022-11-28",
          Authorization: "Bearer ghp_test_token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ assignees: ["baldurpan"] }),
        signal: expect.any(AbortSignal),
      },
    );
  });

  // The silent no-op shape: GitHub documents that an assignee change made
  // without push access is ignored rather than refused, so a 201 proves nothing
  // on its own.
  it.each([
    { label: "no assignees at all", assignees: [] },
    {
      label: "only somebody else",
      assignees: [makeUserResponse("someone-else")],
    },
  ])("reports the issue as not assigned when the response carries $label", async ({
    assignees,
  }) => {
    vi.spyOn(cli, "run")
      .mockResolvedValueOnce("git@github.com:northguild/worktree.git")
      .mockResolvedValueOnce("ghp_test_token");

    const fetchSpy = vi.fn();
    fetchSpy.mockResolvedValueOnce(makeOkJsonResponse(makeUserResponse()));
    fetchSpy.mockResolvedValueOnce(
      makeOkJsonResponse(makeIssueApiResponse({ assignees })),
    );
    vi.stubGlobal("fetch", fetchSpy);

    await expect(assignGitHubIssue(42)).resolves.toEqual({
      login: "baldurpan",
      assigned: false,
    });
  });

  it("throws when the assignment request is refused", async () => {
    vi.spyOn(cli, "run")
      .mockResolvedValueOnce("git@github.com:northguild/worktree.git")
      .mockResolvedValueOnce("ghp_test_token");

    const fetchSpy = vi.fn();
    fetchSpy.mockResolvedValueOnce(makeOkJsonResponse(makeUserResponse()));
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: vi.fn().mockResolvedValue('{"message":"Resource not accessible"}'),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(assignGitHubIssue(42)).rejects.toThrow(
      new Error(
        'GitHub: Failed to assign issue 42 in northguild/worktree. 403 Forbidden - {"message":"Resource not accessible"}',
      ),
    );
  });

  it("gives the stored-token hint when /user answers 401 during an assignment", async () => {
    vi.spyOn(cli, "run")
      .mockResolvedValueOnce("git@github.com:northguild/worktree.git")
      .mockResolvedValueOnce("ghp_test_token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: vi.fn().mockResolvedValue('{"message":"Bad credentials"}'),
      }),
    );

    const error = await assignGitHubIssue(42).catch((e: Error) => e);

    const { message } = error as Error;
    expect(message).toContain("The stored github.token was refused.");
    expect(message).toContain(
      "`git config --unset northguild.worktree.github.token`",
    );
    expect(message).not.toContain("GitHub refused the token");
    expect(message).not.toContain("ghp_test_token");
  });

  it("gives the gh hint when /user answers 401 for a gh token during an assignment", async () => {
    const runSpy = vi.spyOn(cli, "run");
    runSpy.mockResolvedValueOnce("git@github.com:northguild/worktree.git");
    runSpy.mockResolvedValueOnce(""); // git config: no token
    runSpy.mockResolvedValueOnce("ghp_gh_token"); // gh auth token
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: vi.fn().mockResolvedValue('{"message":"Bad credentials"}'),
      }),
    );
    expectCommands("gh auth token");

    const error = await assignGitHubIssue(42).catch((e: Error) => e);

    const { message } = error as Error;
    expect(message).toContain("GitHub refused the token");
    expect(message).toContain("`gh auth login`");
    expect(message).not.toContain("stored github.token");
    expect(message).not.toContain("ghp_gh_token");
  });

  it("says the token was refused when the assignment request answers 401", async () => {
    vi.spyOn(cli, "run")
      .mockResolvedValueOnce("git@github.com:northguild/worktree.git")
      .mockResolvedValueOnce("ghp_test_token");

    const fetchSpy = vi.fn();
    fetchSpy.mockResolvedValueOnce(makeOkJsonResponse(makeUserResponse()));
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: vi.fn().mockResolvedValue('{"message":"Bad credentials"}'),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const error = await assignGitHubIssue(42).catch((e: Error) => e);

    expect((error as Error).message).toContain(
      "GitHub: Failed to assign issue 42 in northguild/worktree. 401 Unauthorized",
    );
    expect((error as Error).message).toContain(
      "The stored github.token was refused.",
    );
    expect((error as Error).message).toContain(
      "`git config --unset northguild.worktree.github.token`",
    );
    expect((error as Error).message).not.toContain("ghp_test_token");
  });

  it("throws for an invalid issue id without reaching the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const refusal = assignGitHubIssue("abc");

    await expect(refusal).rejects.toThrow('GitHub: Invalid issue id "abc".');
    await expect(refusal).rejects.toMatchObject({
      code: "invalid_value",
      oclif: { exit: 2 },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // AbortSignal.timeout runs on Node's own timers, which fake timers do not
  // reach, so the signal is swapped for one that has already expired.
  it("rejects a GitHub request that never answers, naming the call and not the token", async () => {
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(
      AbortSignal.abort(new DOMException("timed out", "TimeoutError")),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(init.signal?.reason),
            );
            if (init.signal?.aborted) {
              reject(init.signal.reason);
            }
          }),
      ),
    );

    const failure = fetchGitHubLogin("ghp_secret_token");

    await expect(failure).rejects.toThrow(
      "GitHub: /user did not answer within 15s.",
    );
    await expect(failure).rejects.not.toThrow(/ghp_secret_token/);
    expect(AbortSignal.timeout).toHaveBeenCalledWith(15_000);
  });
});
