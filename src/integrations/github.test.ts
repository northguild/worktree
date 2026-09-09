import * as cli from "../lib/cli.js";
import { expectCommands } from "../test-setup.js";
import {
  assignGitHubIssue,
  fetchGitHubIssue,
  fetchGitHubLogin,
  type GitHubIssueApiResponse,
  type GitHubIssueTypeApiResponse,
  parseGitHubRepositoryFromRemote,
} from "./github.js";

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
      user: {
        login: "baldurpan",
        htmlUrl: "https://github.com/baldurpan",
      },
    });
  });

  it("throws for invalid issue ids", async () => {
    await expect(fetchGitHubIssue("abc")).rejects.toThrow(
      'GitHub: Invalid issue id "abc".',
    );
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
      'GitHub: Failed to fetch issue 999 from northguild/worktree. 404 Not Found - {"message":"Not Found"}',
    );
  });

  it("auto-resolves a token via gh CLI when the repo check fails without a token", async () => {
    const runSpy = vi.spyOn(cli, "run");
    runSpy.mockResolvedValueOnce("git@github.com:northguild/worktree.git"); // git remote get-url origin
    runSpy.mockResolvedValueOnce(""); // git config token (no token)
    runSpy.mockResolvedValueOnce("ghp_auto_token"); // gh auth token
    runSpy.mockResolvedValueOnce(""); // gitSetConfigValue (saving token)

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

    expectCommands(
      "gh auth token",
      "git config northguild.worktree.github.token ghp_auto_token",
    );

    const issue = await fetchGitHubIssue(13);

    expect(issue.number).toBe(13);
    expect(runSpy).toHaveBeenCalledWith("gh", ["auth", "token"]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://api.github.com/repos/northguild/worktree/issues/13",
      {
        headers: expect.objectContaining({
          Authorization: "Bearer ghp_auto_token",
        }),
      },
    );
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

    await expect(fetchGitHubLogin()).rejects.toThrow(
      'GitHub: Failed to resolve the authenticated user. 401 Unauthorized - {"message":"Bad credentials"}',
    );
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
      'GitHub: Failed to assign issue 42 in northguild/worktree. 403 Forbidden - {"message":"Resource not accessible"}',
    );
  });

  it("throws for an invalid issue id without reaching the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    await expect(assignGitHubIssue("abc")).rejects.toThrow(
      'GitHub: Invalid issue id "abc".',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
