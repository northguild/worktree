import { input } from "@inquirer/prompts";
import * as cli from "../lib/cli.js";
import * as config from "../lib/config.js";
import * as git from "../lib/git.js";
import { setNonInteractive } from "../lib/interaction.js";
import * as projectConfig from "../lib/project-config.js";
import { resetProjectConfigCache } from "../lib/project-config.js";
import { InvalidValueError, MissingValueError } from "../lib/prompt.js";
import { expectCommands } from "../test-setup.js";
import {
  assignGitHubIssue,
  fetchGitHubIssue,
  fetchGitHubLogin,
  type GitHubIssue,
  type GitHubIssueApiResponse,
  type GitHubIssueTypeApiResponse,
  getGitHubBranchNameFromIssue,
  getGitHubBranchNaming,
  githubApiBaseUrl,
  parseGitHubIssueReference,
  parseGitHubRemote,
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
    labels: [],
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

// What `git remote get-url upstream` does in a clone with no such remote.
const NO_UPSTREAM_REMOTE = new Error("error: No such remote 'upstream'");

const ORIGIN_REPOSITORY = {
  owner: "northguild",
  name: "worktree",
  source: "origin",
};

describe("GitHub integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    expectCommands(
      "git remote get-url upstream",
      "git remote get-url origin",
      "git config northguild.worktree.github.token",
    );
    // The project file and git config are not what these tests are about; the
    // fork tests below override the key.
    vi.spyOn(projectConfig, "getTeamConfigValue").mockResolvedValue("");
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

  // Forms and sources are the plan's §8 table: git-clone "GIT URLS"
  // (https://git-scm.com/docs/git-clone#_git_urls), GitHub's "Using SSH over
  // the HTTPS port" (ssh.github.com is github.com), RFC 4343 (host names are
  // case insensitive). Port ignored is D6.
  it.each([
    "ssh://git@ssh.github.com:443/acme/widgets.git",
    "ssh://git@github.com/acme/widgets.git",
    "git@GitHub.com:acme/widgets",
    "https://user@github.com/acme/widgets.git",
    "git://github.com/acme/widgets.git",
    "  https://GITHUB.com/acme/widgets/\n",
  ])("reads %j as github.com acme/widgets", (remoteUrl) => {
    expect(parseGitHubRemote(remoteUrl)).toEqual({
      host: "github.com",
      owner: "acme",
      name: "widgets",
    });
  });

  it.each([
    "git@ghe.example.com:acme/widgets.git",
    "https://ghe.example.com:8443/acme/widgets",
    "ssh://git@ghe.example.com:2222/acme/widgets.git",
    "git@Ghe.Example.com:/acme/widgets",
  ])("reads %j as host ghe.example.com", (remoteUrl) => {
    expect(parseGitHubRemote(remoteUrl)).toEqual({
      host: "ghe.example.com",
      owner: "acme",
      name: "widgets",
    });
  });

  it.each([
    // The old regex read these as github.com; the host must match exactly.
    "https://notgithub.com/acme/widgets",
    "https://github.com.evil.test/acme/widgets",
    "https://evilgithub.com/acme/widgets",
  ])("does not read %j as a github.com remote", (remoteUrl) => {
    expect(parseGitHubRemote(remoteUrl)?.host).not.toBe("github.com");
  });

  it("keeps the host of a non-GitHub remote, leaving the decision to the caller", () => {
    expect(parseGitHubRemote("git@gitlab.com:acme/widgets.git")).toEqual({
      host: "gitlab.com",
      owner: "acme",
      name: "widgets",
    });
  });

  // Owner and name follow isValidGitHubRepository, so `..` (a path segment) and
  // `a--b` (consecutive dashes in an owner) are not GitHub remotes.
  it.each([
    "https://github.com/../widgets",
    "https://github.com/acme/..",
    "git@github.com:a--b/widgets.git",
    "git@github.com:acme/widgets.git.git",
    "https://github.com/acme/widgets/extra",
    "https://github.com/acme",
    "https://github.com//widgets",
    "git@github.com:acme",
    "/home/me/acme/widgets",
    "ftp://github.com/acme/widgets",
    "",
  ])("finds no repository in %j", (remoteUrl) => {
    expect(parseGitHubRemote(remoteUrl)).toBeUndefined();
  });

  it.each([
    "https://notgithub.com/acme/widgets",
    "git@ghe.example.com:acme/widgets.git",
    "https://github.com/../widgets",
  ])("keeps the github.com-only parser throwing for %j", (remoteUrl) => {
    expect(() => parseGitHubRepositoryFromRemote(remoteUrl)).toThrow(
      `GitHub: Unable to determine the current repository from origin remote "${remoteUrl}".`,
    );
  });

  it("returns owner and name only from the github.com-only parser", () => {
    expect(
      parseGitHubRepositoryFromRemote("ssh://git@ssh.github.com:443/a/b.git"),
    ).toEqual({ owner: "a", name: "b" });
  });

  // §8: github.com is https://api.github.com (GitHub REST "Getting started");
  // GHES is https://<host>/api/v3 (GHES REST quickstart); a *.ghe.com host is
  // https://api.<host> (data residency docs). The scheme is always https (D5).
  it.each([
    ["github.com", "https://api.github.com"],
    ["GitHub.com", "https://api.github.com"],
    ["ghe.example.com", "https://ghe.example.com/api/v3"],
    ["octocorp.ghe.com", "https://api.octocorp.ghe.com"],
    ["OctoCorp.GHE.com", "https://api.octocorp.ghe.com"],
  ])("gives the API base for %s", (host, expected) => {
    expect(githubApiBaseUrl(host)).toBe(expected);
  });

  it("gives an https base for a host whose remote was http", () => {
    const remote = parseGitHubRemote("http://ghe.example.com/acme/widgets");
    expect(remote && githubApiBaseUrl(remote.host)).toBe(
      "https://ghe.example.com/api/v3",
    );
  });

  it("fetches issue info from the current repository", async () => {
    const runSpy = vi
      .spyOn(cli, "run")
      .mockRejectedValueOnce(NO_UPSTREAM_REMOTE)
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
      labels: [],
      repository: ORIGIN_REPOSITORY,
      user: {
        login: "baldurpan",
        htmlUrl: "https://github.com/baldurpan",
      },
    });
  });

  // GitHub's REST issue: labels are objects with an id and a name (docs.github.com,
  // "Get an issue"); the client keeps those two.
  it("maps the issue's labels to their id and name", async () => {
    vi.spyOn(cli, "run")
      .mockRejectedValueOnce(NO_UPSTREAM_REMOTE)
      .mockResolvedValueOnce("git@github.com:northguild/worktree.git")
      .mockResolvedValueOnce("");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeOkJsonResponse(
          makeIssueApiResponse({
            labels: [
              {
                id: 208045946,
                node_id: "MDU6TGFiZWwyMDgwNDU5NDY=",
                url: "https://api.github.com/repos/northguild/worktree/labels/bug",
                name: "bug",
                color: "f29513",
                default: true,
                description: "Something isn't working",
              },
              "plain",
            ],
          }),
        ),
      ),
    );

    const issue = await fetchGitHubIssue(42);

    expect(issue.labels).toEqual([
      { id: 208045946, name: "bug" },
      { name: "plain" },
    ]);
  });

  it("reads the head branch of a pull request answered as an issue", async () => {
    vi.spyOn(cli, "run")
      .mockRejectedValueOnce(NO_UPSTREAM_REMOTE)
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
      .mockRejectedValueOnce(NO_UPSTREAM_REMOTE)
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
      .mockRejectedValueOnce(NO_UPSTREAM_REMOTE)
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
      .mockRejectedValueOnce(NO_UPSTREAM_REMOTE)
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
    runSpy.mockRejectedValueOnce(NO_UPSTREAM_REMOTE);
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
    expect(runSpy).toHaveBeenCalledWith(
      "gh",
      ["auth", "token", "--hostname", "github.com"],
      {
        timeout: 10_000,
      },
    );
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
    runSpy.mockRejectedValueOnce(NO_UPSTREAM_REMOTE);
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
      .mockRejectedValueOnce(NO_UPSTREAM_REMOTE)
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

    const error = await fetchGitHubIssue(13).catch((e: unknown) => e as Error);

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

  // A typed token is saved before it is sent, so when GitHub refuses it the
  // copy in git config is what will win next run: the stored hint, not `gh`.
  it("gives the stored hint on a 401 for a token typed at the prompt", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const runSpy = vi.spyOn(cli, "run");
    runSpy.mockRejectedValueOnce(NO_UPSTREAM_REMOTE);
    runSpy.mockResolvedValueOnce("git@github.com:northguild/worktree.git");
    runSpy.mockResolvedValueOnce(""); // git config: no token
    runSpy.mockRejectedValueOnce(new Error("not logged in")); // gh auth token
    runSpy.mockResolvedValueOnce(""); // gitSetConfigValue (saving token)
    vi.mocked(input).mockResolvedValueOnce("ghp_typed_token");
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
    expectCommands(
      "gh auth token",
      "git config northguild.worktree.github.token ghp_typed_token",
    );

    const error = await fetchGitHubIssue(13).catch((e: unknown) => e as Error);

    const { message } = error as Error;
    expect(message).toContain("The stored github.token was refused.");
    expect(message).toContain(
      "`git config --unset northguild.worktree.github.token`",
    );
    expect(message).not.toContain("GitHub refused the token");
    expect(message).not.toContain("ghp_typed_token");
  });

  it("keeps the gh hint on a 401 for a token that came from gh", async () => {
    const runSpy = vi.spyOn(cli, "run");
    runSpy.mockRejectedValueOnce(NO_UPSTREAM_REMOTE);
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

    const error = await fetchGitHubIssue(13).catch((e: unknown) => e as Error);

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
    runSpy.mockRejectedValueOnce(NO_UPSTREAM_REMOTE);
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
    const runSpy = vi.spyOn(cli, "run").mockResolvedValueOnce("ghp_test_token");

    const fetchSpy = vi
      .fn()
      .mockResolvedValue(makeOkJsonResponse(makeUserResponse()));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchGitHubLogin()).resolves.toBe("baldurpan");
    // The configured token is read from git config and `gh auth token` is never
    // run (GitHub issue integration guide: an existing github.token first). The
    // count alone is not enough: `commandExists` is mocked true, so a `gh` first
    // lookup would also make one `run` call and consume the queued value.
    expect(runSpy).toHaveBeenCalledWith("git", [
      "config",
      "northguild.worktree.github.token",
    ]);
    expect(runSpy).not.toHaveBeenCalledWith(
      "gh",
      ["auth", "token", "--hostname", "github.com"],
      expect.anything(),
    );
    expect(runSpy).toHaveBeenCalledTimes(1);
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

    const error = await fetchGitHubLogin().catch((e: unknown) => e as Error);

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
      .mockRejectedValueOnce(NO_UPSTREAM_REMOTE)
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
      repository: ORIGIN_REPOSITORY,
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
  // on its own. NOT recorded from GitHub: case (b), an owner without push
  // access, had not been run as of 2026-10-26 (#61), so these bodies are
  // written from the documentation and not from an observed response.
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
      .mockRejectedValueOnce(NO_UPSTREAM_REMOTE)
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
      repository: ORIGIN_REPOSITORY,
    });
  });

  // Recorded 2026-10-26 (#61, case (a)): a fine-grained token with Issues set
  // to read-only, owned by an account with push access, POSTing to the
  // assignees endpoint. The status code and message are as GitHub returned
  // them; the run was over HTTP/2, which carries no reason phrase, so
  // statusText is the standard one for 403. The second line is the sentence the
  // branch, configuration and GitHub guide docs carry; change them together.
  it("throws naming the permission when the assignment request is refused", async () => {
    vi.spyOn(cli, "run")
      .mockRejectedValueOnce(NO_UPSTREAM_REMOTE)
      .mockResolvedValueOnce("git@github.com:northguild/worktree.git")
      .mockResolvedValueOnce("ghp_test_token");

    const fetchSpy = vi.fn();
    fetchSpy.mockResolvedValueOnce(makeOkJsonResponse(makeUserResponse()));
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: vi
        .fn()
        .mockResolvedValue(
          '{"message":"Resource not accessible by personal access token"}',
        ),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(assignGitHubIssue(42)).rejects.toThrow(
      new Error(
        'GitHub: Failed to assign issue 42 in northguild/worktree. 403 Forbidden - {"message":"Resource not accessible by personal access token"}\nAssigning needs a token whose account has push access to the repository; a fine-grained token also needs the Issues (or Pull requests) permission set to Read and write.',
      ),
    );
  });

  it("gives the stored-token hint when /user answers 401 during an assignment", async () => {
    vi.spyOn(cli, "run")
      .mockRejectedValueOnce(NO_UPSTREAM_REMOTE)
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

    const error = await assignGitHubIssue(42).catch((e: unknown) => e as Error);

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
    runSpy.mockRejectedValueOnce(NO_UPSTREAM_REMOTE);
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

    const error = await assignGitHubIssue(42).catch((e: unknown) => e as Error);

    const { message } = error as Error;
    expect(message).toContain("GitHub refused the token");
    expect(message).toContain("`gh auth login`");
    expect(message).not.toContain("stored github.token");
    expect(message).not.toContain("ghp_gh_token");
  });

  it("gives the stored hint when /user answers 401 for a token typed during an assignment", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const runSpy = vi.spyOn(cli, "run");
    runSpy.mockRejectedValueOnce(NO_UPSTREAM_REMOTE);
    runSpy.mockResolvedValueOnce("git@github.com:northguild/worktree.git");
    runSpy.mockResolvedValueOnce(""); // git config: no token
    runSpy.mockRejectedValueOnce(new Error("not logged in")); // gh auth token
    runSpy.mockResolvedValueOnce(""); // gitSetConfigValue (saving token)
    vi.mocked(input).mockResolvedValueOnce("ghp_typed_token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: vi.fn().mockResolvedValue('{"message":"Bad credentials"}'),
      }),
    );
    expectCommands(
      "gh auth token",
      "git config northguild.worktree.github.token ghp_typed_token",
    );

    const error = await assignGitHubIssue(42).catch((e: unknown) => e as Error);

    const { message } = error as Error;
    expect(message).toContain("The stored github.token was refused.");
    expect(message).toContain(
      "`git config --unset northguild.worktree.github.token`",
    );
    expect(message).not.toContain("GitHub refused the token");
    expect(message).not.toContain("ghp_typed_token");
  });

  it("says the token was refused when the assignment request answers 401", async () => {
    vi.spyOn(cli, "run")
      .mockRejectedValueOnce(NO_UPSTREAM_REMOTE)
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

    const error = await assignGitHubIssue(42).catch((e: unknown) => e as Error);

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

  // The fetch signal also bounds the body: headers in time and a body that
  // stalls past 15s rejects response.json() with the signal's TimeoutError.
  it("reports an issue body that stalls past the timeout as a timeout", async () => {
    vi.spyOn(cli, "run")
      .mockRejectedValueOnce(NO_UPSTREAM_REMOTE)
      .mockResolvedValueOnce("git@github.com:northguild/worktree.git")
      .mockResolvedValueOnce("");
    const stalled = makeOkJsonResponse(null);
    stalled.json.mockRejectedValue(
      new DOMException("timed out", "TimeoutError"),
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(stalled));

    await expect(fetchGitHubIssue(42)).rejects.toThrow(
      "GitHub: /repos/northguild/worktree/issues/42 did not answer within 15s.",
    );
  });

  it("reports a user body that stalls past the timeout as a timeout", async () => {
    const stalled = makeOkJsonResponse(null);
    stalled.json.mockRejectedValue(
      new DOMException("timed out", "TimeoutError"),
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(stalled));

    await expect(
      fetchGitHubLogin({ token: "ghp_secret_token", source: "gh" }),
    ).rejects.toThrow("GitHub: /user did not answer within 15s.");
  });

  it("reports an assign answer whose body stalls past the timeout as a timeout", async () => {
    vi.spyOn(cli, "run")
      .mockRejectedValueOnce(NO_UPSTREAM_REMOTE)
      .mockResolvedValueOnce("git@github.com:northguild/worktree.git")
      .mockResolvedValueOnce("ghp_test_token");
    const stalled = makeOkJsonResponse(null);
    stalled.json.mockRejectedValue(
      new DOMException("timed out", "TimeoutError"),
    );
    const fetchSpy = vi.fn();
    fetchSpy.mockResolvedValueOnce(makeOkJsonResponse(makeUserResponse()));
    fetchSpy.mockResolvedValueOnce(stalled);
    vi.stubGlobal("fetch", fetchSpy);

    await expect(assignGitHubIssue(42)).rejects.toThrow(
      "GitHub: /repos/northguild/worktree/issues/42/assignees did not answer within 15s.",
    );
  });

  it("leaves a body that fails to parse as a parse failure, not a timeout", async () => {
    const malformed = makeOkJsonResponse(null);
    malformed.json.mockRejectedValue(new SyntaxError("Unexpected token <"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(malformed));

    const failure = fetchGitHubLogin({
      token: "ghp_secret_token",
      source: "gh",
    });

    await expect(failure).rejects.toThrow("Unexpected token <");
    await expect(failure).rejects.not.toThrow(/did not answer within/);
  });

  it("reports an error body that stalls past the timeout as a timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Server Error",
        text: vi
          .fn()
          .mockRejectedValue(new DOMException("timed out", "TimeoutError")),
      }),
    );

    await expect(
      fetchGitHubLogin({ token: "ghp_secret_token", source: "gh" }),
    ).rejects.toThrow("GitHub: /user did not answer within 15s.");
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

    const failure = fetchGitHubLogin({
      token: "ghp_secret_token",
      source: "gh",
    });

    await expect(failure).rejects.toThrow(
      "GitHub: /user did not answer within 15s.",
    );
    await expect(failure).rejects.not.toThrow(/ghp_secret_token/);
    expect(AbortSignal.timeout).toHaveBeenCalledWith(15_000);
  });
});

// Which repository is read is decided by D1's order: the github.repository key,
// then an `upstream` remote that is a GitHub URL, then `origin`. Every expected
// repository below is that order applied to the remotes the test sets up.
describe("the repository --github reads in a fork", () => {
  const FORK = "git@github.com:me/worktree.git";
  const UPSTREAM = "git@github.com:northguild/worktree.git";
  const TOKEN = "ghp_test_token";

  // `run` answers by argv, so a test names the remotes it has and the order of
  // the calls is asserted separately, not baked into a queue.
  function stubRemotes(remotes: { origin?: string; upstream?: string }) {
    return vi.spyOn(cli, "run").mockImplementation(async (_file, args) => {
      const [subcommand, action, remote] = args ?? [];
      if (subcommand === "remote" && action === "get-url") {
        const url = remotes[remote as "origin" | "upstream"];
        if (url === undefined) {
          throw new Error(`error: No such remote '${remote}'`);
        }
        return url;
      }
      if (args?.at(-1) === "northguild.worktree.github.token") {
        return TOKEN;
      }
      throw new Error(`unexpected git call: ${args?.join(" ")}`);
    });
  }

  function remoteCalls(runSpy: ReturnType<typeof stubRemotes>) {
    return runSpy.mock.calls
      .map(([, args]) => args?.join(" "))
      .filter((call) => call?.startsWith("remote get-url"));
  }

  const user = { login: "baldurpan", html_url: "https://github.com/baldurpan" };

  function stubFetch(...responses: unknown[]) {
    const fetchSpy = vi.fn();
    for (const response of responses) {
      fetchSpy.mockResolvedValueOnce(makeOkJsonResponse(response));
    }
    vi.stubGlobal("fetch", fetchSpy);
    return fetchSpy;
  }

  function pullRequestIssue(number: number) {
    return makeIssueApiResponse({
      number,
      pull_request: {
        url: `https://api.github.com/repos/northguild/worktree/pulls/${number}`,
      },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    expectCommands(
      "git remote get-url upstream",
      "git remote get-url origin",
      "git config northguild.worktree.github.token",
    );
    vi.spyOn(projectConfig, "getTeamConfigValue").mockResolvedValue("");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(a) reads origin when there is no upstream and no key, probing upstream first and changing no text", async () => {
    const runSpy = stubRemotes({ origin: UPSTREAM });
    const fetchSpy = stubFetch(makeIssueApiResponse());

    const issue = await fetchGitHubIssue(42);

    expect(remoteCalls(runSpy)).toEqual([
      "remote get-url upstream",
      "remote get-url origin",
    ]);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      "https://api.github.com/repos/northguild/worktree/issues/42",
    );
    expect(issue.repository).toEqual({
      owner: "northguild",
      name: "worktree",
      source: "origin",
    });
  });

  it("(a) fails with today's text, naming no source, when origin is the repository read", async () => {
    stubRemotes({ origin: UPSTREAM });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 404 })),
    );

    await expect(fetchGitHubIssue(42)).rejects.toThrow(
      /^GitHub: Failed to fetch issue 42 from northguild\/worktree\. 404/,
    );
  });

  it("(a) keeps today's error for a non-GitHub origin when there is no upstream", async () => {
    stubRemotes({ origin: "git@gitlab.com:northguild/worktree.git" });

    await expect(fetchGitHubIssue(42)).rejects.toThrow(
      'GitHub: Unable to read the origin remote for the current repository. GitHub: Unable to determine the current repository from origin remote "git@gitlab.com:northguild/worktree.git".',
    );
  });

  it("(b) reads an upstream GitHub remote in preference to origin", async () => {
    const runSpy = stubRemotes({ origin: FORK, upstream: UPSTREAM });
    const fetchSpy = stubFetch(makeIssueApiResponse());

    const issue = await fetchGitHubIssue(42);

    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      "https://api.github.com/repos/northguild/worktree/issues/42",
    );
    expect(issue.repository?.source).toBe("upstream");
    expect(remoteCalls(runSpy)).toEqual(["remote get-url upstream"]);
  });

  it("(b) names the repository and where it came from when the read fails", async () => {
    stubRemotes({ origin: FORK, upstream: UPSTREAM });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("{}", { status: 404 })),
    );

    await expect(fetchGitHubIssue(42)).rejects.toThrow(
      /^GitHub: Failed to fetch issue 42 from northguild\/worktree \(upstream\)\. 404/,
    );
  });

  it("(c) reads the configured github.repository in preference to upstream, without probing a remote", async () => {
    vi.spyOn(projectConfig, "getTeamConfigValue").mockImplementation(
      async (name) => (name === "github.repository" ? "acme/widgets" : ""),
    );
    const runSpy = stubRemotes({ origin: FORK, upstream: UPSTREAM });
    const fetchSpy = stubFetch(makeIssueApiResponse());

    const issue = await fetchGitHubIssue(42);

    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      "https://api.github.com/repos/acme/widgets/issues/42",
    );
    expect(issue.repository).toEqual({
      owner: "acme",
      name: "widgets",
      source: "github.repository",
    });
    expect(remoteCalls(runSpy)).toEqual([]);
  });

  it("(d) skips an upstream that is not a GitHub URL and reads origin", async () => {
    stubRemotes({
      origin: FORK,
      upstream: "git@gitlab.com:northguild/worktree.git",
    });
    const fetchSpy = stubFetch(makeIssueApiResponse());

    const issue = await fetchGitHubIssue(42);

    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      "https://api.github.com/repos/me/worktree/issues/42",
    );
    expect(issue.repository?.source).toBe("origin");
  });

  it.each([
    ["the upstream remote", {}, "northguild", "worktree", "upstream"],
    [
      "the github.repository key",
      { key: "acme/widgets" },
      "acme",
      "widgets",
      "github.repository",
    ],
    ["origin", { noUpstream: true }, "me", "worktree", "origin"],
  ])("(e) assigns in the repository the read used: %s", async (_case, setup, owner, name, source) => {
    const options = setup as { key?: string; noUpstream?: boolean };
    if (options.key) {
      vi.spyOn(projectConfig, "getTeamConfigValue").mockImplementation(
        async (key) => (key === "github.repository" ? (options.key ?? "") : ""),
      );
    }
    stubRemotes({
      origin: FORK,
      ...(options.noUpstream ? {} : { upstream: UPSTREAM }),
    });
    const fetchSpy = stubFetch(
      user,
      makeIssueApiResponse({ assignees: [user] }),
    );

    const result = await assignGitHubIssue(42);

    expect(fetchSpy.mock.calls[1]?.[0]).toBe(
      `https://api.github.com/repos/${owner}/${name}/issues/42/assignees`,
    );
    expect(result.repository).toEqual({ owner, name, source });
  });

  it("(e) names the repository and its source when the assignment is refused", async () => {
    stubRemotes({ origin: FORK, upstream: UPSTREAM });
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce(makeOkJsonResponse(user))
      .mockResolvedValueOnce(new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", fetchSpy);

    await expect(assignGitHubIssue(42)).rejects.toThrow(
      "GitHub: Failed to assign issue 42 in northguild/worktree (upstream).",
    );
  });

  describe("(f) a pull request's head branch is suggested only when it is on origin", () => {
    it("gives no head branch when the head is on upstream and origin is the fork", async () => {
      stubRemotes({ origin: FORK, upstream: UPSTREAM });
      stubFetch(pullRequestIssue(7), {
        head: { ref: "feature/x", repo: { full_name: "northguild/worktree" } },
      });

      const issue = await fetchGitHubIssue(7);

      expect(issue.pullRequest).toEqual({ headBranch: null });
    });

    it("gives the head branch when the head is on origin, though the read was upstream", async () => {
      stubRemotes({ origin: FORK, upstream: UPSTREAM });
      stubFetch(pullRequestIssue(7), {
        head: { ref: "feature/x", repo: { full_name: "me/worktree" } },
      });

      const issue = await fetchGitHubIssue(7);

      expect(issue.pullRequest).toEqual({ headBranch: "feature/x" });
    });

    it("reads origin only for a pull request", async () => {
      const runSpy = stubRemotes({ origin: FORK, upstream: UPSTREAM });
      stubFetch(makeIssueApiResponse());

      await fetchGitHubIssue(42);

      expect(remoteCalls(runSpy)).toEqual(["remote get-url upstream"]);
    });

    it("gives the head branch when the head is on origin and origin was read", async () => {
      stubRemotes({ origin: UPSTREAM });
      stubFetch(pullRequestIssue(7), {
        head: { ref: "feature/x", repo: { full_name: "northguild/worktree" } },
      });

      const issue = await fetchGitHubIssue(7);

      expect(issue.pullRequest).toEqual({ headBranch: "feature/x" });
    });
  });

  it.each([
    "https://github.com/acme/widgets",
    "acme/widgets/extra",
    "acme/..",
    "acme/widgets.git",
  ])("(g) refuses the malformed key %j, naming github.repository, before any request", async (value) => {
    vi.spyOn(projectConfig, "getTeamConfigValue").mockImplementation(
      async (name) => (name === "github.repository" ? value : ""),
    );
    const runSpy = stubRemotes({ origin: FORK, upstream: UPSTREAM });
    const fetchSpy = stubFetch();

    const failure = await fetchGitHubIssue(42).catch((e: unknown) => e);

    expect(failure).toBeInstanceOf(InvalidValueError);
    expect((failure as Error).message).toContain("github.repository");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(remoteCalls(runSpy)).toEqual([]);
    await expect(assignGitHubIssue(42)).rejects.toBeInstanceOf(
      InvalidValueError,
    );
  });
});

// D8-D10, D12. Expected kinds come from the plan's example file (section 4):
// `Type: Bug` is a bugfix, `Labels: [chore, maintenance]` a chore, its prefixes
// feat/ fix/ chore/. Built-in kinds without rules are #128's account of today:
// Feature, Bug and Task types, and no prefix for anything else (D10, #118).
describe("getGitHubBranchNameFromIssue", () => {
  const PREFIXES = `branchPrefix:
  feature: feat/
  bugfix: fix/
  chore: chore/
`;
  const EXAMPLE_RULES = `github:
  branchType:
    - when: { Type: Bug }
      type: bugfix
    - when: { Labels: [chore, maintenance] }
      type: chore
`;

  function issue(
    overrides: {
      type?: string | null;
      labels?: { id?: number; name: string }[];
    } = {},
  ) {
    return {
      number: 42,
      title: "Fix login bug",
      type:
        overrides.type === null || overrides.type === undefined
          ? null
          : { id: 9, name: overrides.type },
      labels: overrides.labels ?? [],
    } as unknown as GitHubIssue;
  }

  function projectFile(content: string) {
    vi.spyOn(git, "gitResolveOriginHead").mockResolvedValue("origin/main");
    vi.spyOn(git, "gitReadBlobAtRef").mockResolvedValue({
      status: "found",
      content,
    });
    vi.spyOn(git, "gitGetTopLevelPath").mockResolvedValue("/nonexistent");
    vi.spyOn(config, "gitGetConfigValue").mockResolvedValue("");
  }

  beforeEach(() => {
    resetProjectConfigCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("without github.branchType", () => {
    it.each([
      ["Feature", "feat/42-fix-login-bug"],
      ["Bug", "fix/42-fix-login-bug"],
      ["Task", "chore/42-fix-login-bug"],
    ])("a %s issue gets its built-in prefix", async (type, expected) => {
      projectFile(PREFIXES);

      expect(await getGitHubBranchNameFromIssue(issue({ type }))).toBe(
        expected,
      );
    });

    it("an issue with no type gets no prefix, whatever its labels say (#118)", async () => {
      projectFile(PREFIXES);

      expect(
        await getGitHubBranchNameFromIssue(
          issue({ labels: [{ id: 1, name: "bug" }] }),
        ),
      ).toBe("42-fix-login-bug");
    });
  });

  describe("with github.branchType", () => {
    it("Type: Bug gives the bugfix prefix, matching the name case-insensitively", async () => {
      projectFile(PREFIXES + EXAMPLE_RULES);

      expect(await getGitHubBranchNameFromIssue(issue({ type: "bug" }))).toBe(
        "fix/42-fix-login-bug",
      );
    });

    it("a label in the list gives the chore prefix", async () => {
      projectFile(PREFIXES + EXAMPLE_RULES);

      expect(
        await getGitHubBranchNameFromIssue(
          issue({ labels: [{ id: 1, name: "Maintenance" }] }),
        ),
      ).toBe("chore/42-fix-login-bug");
    });

    it("the first matching rule wins", async () => {
      projectFile(PREFIXES + EXAMPLE_RULES);

      expect(
        await getGitHubBranchNameFromIssue(
          issue({ type: "Bug", labels: [{ id: 1, name: "chore" }] }),
        ),
      ).toBe("fix/42-fix-login-bug");
    });

    it("the rules replace the built-in mapping: a Feature type no rule names gets no prefix", async () => {
      projectFile(PREFIXES + EXAMPLE_RULES);

      expect(
        await getGitHubBranchNameFromIssue(issue({ type: "Feature" })),
      ).toBe("42-fix-login-bug");
    });

    it("no type and no matching rule gets no prefix (#118)", async () => {
      projectFile(PREFIXES + EXAMPLE_RULES);

      expect(await getGitHubBranchNameFromIssue(issue())).toBe(
        "42-fix-login-bug",
      );
    });

    it("otherwise: feature opts an unmatched issue in to a prefix (#118)", async () => {
      projectFile(`${PREFIXES + EXAMPLE_RULES}    - otherwise: feature\n`);

      expect(await getGitHubBranchNameFromIssue(issue())).toBe(
        "feat/42-fix-login-bug",
      );
    });

    it("matches a label by id", async () => {
      projectFile(`${PREFIXES}github:
  branchType:
    - when: { Labels: { id: 208045946 } }
      type: bugfix
`);

      expect(
        await getGitHubBranchNameFromIssue(
          issue({ labels: [{ id: 208045946, name: "anything" }] }),
        ),
      ).toBe("fix/42-fix-login-bug");
    });

    it("an issue with no type does not match a Type rule, and does not warn", async () => {
      projectFile(PREFIXES + EXAMPLE_RULES);
      const warnings: string[] = [];

      await getGitHubBranchNameFromIssue(issue(), (w) => warnings.push(w));

      expect(warnings).toEqual([]);
    });

    it("warns, naming the rule and the field, when a rule names a field GitHub does not have (D11)", async () => {
      projectFile(`${PREFIXES}github:
  branchType:
    - when: { Priority: High }
      type: bugfix
`);
      const warnings: string[] = [];

      const name = await getGitHubBranchNameFromIssue(issue(), (w) =>
        warnings.push(w),
      );

      expect(name).toBe("42-fix-login-bug");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("Rule 1 of github.branchType");
      expect(warnings[0]).toContain('"Priority"');
    });
  });

  describe("branchName", () => {
    it("the default template gives the names above", async () => {
      projectFile(`${PREFIXES}branchName: "{prefix}{id}-{slug}"\n`);

      expect(await getGitHubBranchNameFromIssue(issue({ type: "Bug" }))).toBe(
        "fix/42-fix-login-bug",
      );
    });

    it("a different template reorders the parts", async () => {
      projectFile(`${PREFIXES}branchName: "{prefix}{slug}-{id}"\n`);

      expect(await getGitHubBranchNameFromIssue(issue({ type: "Bug" }))).toBe(
        "fix/fix-login-bug-42",
      );
    });
  });
});

// Phase 5 (#181): what `branch --dry-run` shows for a GitHub issue. The fields
// are `Type` and `Labels` (D9, docs.github.com *Get an issue*).
describe("getGitHubBranchNaming", () => {
  const FILE = `branchPrefix:
  feature: feat/
  bugfix: fix/
  chore: chore/
github:
  branchType:
    - when: { Type: Bug }
      type: bugfix
    - when: { Labels: [chore, maintenance] }
      type: chore
`;
  const NO_RULES = FILE.split("github:")[0];
  const labelled = {
    number: 42,
    title: "Fix login bug",
    type: null,
    labels: [{ id: 5, name: "Maintenance" }],
  } as unknown as GitHubIssue;

  function projectFile(content: string) {
    resetProjectConfigCache();
    vi.spyOn(git, "gitResolveOriginHead").mockResolvedValue("origin/main");
    vi.spyOn(git, "gitReadBlobAtRef").mockResolvedValue({
      status: "found",
      content,
    });
    vi.spyOn(git, "gitGetTopLevelPath").mockResolvedValue("/nonexistent");
    vi.spyOn(config, "gitGetConfigValue").mockResolvedValue("");
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("names the second rule when the label matches it", async () => {
    projectFile(FILE);

    const naming = await getGitHubBranchNaming(labelled);

    expect(naming.branchName).toBe("chore/42-fix-login-bug");
    expect(naming.match).toMatchObject({ source: "rule", position: 2 });
    expect(naming.fields).toContainEqual({
      id: "Labels",
      name: "Labels",
      values: [{ id: "5", name: "Maintenance" }],
    });
  });

  it("reports the built-in mapping when the file has no github rules", async () => {
    projectFile(NO_RULES);

    const naming = await getGitHubBranchNaming({
      ...labelled,
      type: { id: 9, name: "Bug" },
    } as unknown as GitHubIssue);

    expect(naming.match).toEqual({ source: "built-in" });
    expect(naming.kind).toBe("bugfix");
  });

  it("reports no rule when rules exist and none matched", async () => {
    projectFile(FILE);

    const naming = await getGitHubBranchNaming({
      ...labelled,
      labels: [],
    } as unknown as GitHubIssue);

    expect(naming.match).toEqual({ source: "none" });
    expect(naming.branchName).toBe("42-fix-login-bug");
  });
});

// The shared top-level `branchType` list (#128, D1): the provider's own list,
// else the shared one, else the built-in mapping. The expected names come from
// the plan's Phase 1 "Done when" and from the built-in mapping the existing
// tests above pin (Bug type is `fix/`, no type is no prefix).
describe("the shared branchType list for GitHub", () => {
  const PREFIXES = `branchPrefix:
  feature: feat/
  bugfix: fix/
  chore: chore/
`;
  const SHARED = `branchType:
  - when: { Labels: chore }
    type: chore
`;
  const OWN = `github:
  branchType:
    - when: { Labels: chore }
      type: feature
`;

  function issue(
    overrides: { type?: string; labels?: string[] } = {},
  ): GitHubIssue {
    return {
      number: 42,
      title: "Fix login bug",
      type: overrides.type ? { id: 9, name: overrides.type } : null,
      labels: (overrides.labels ?? []).map((name, id) => ({ id, name })),
    } as unknown as GitHubIssue;
  }

  function projectFile(content: string, personal: Record<string, string> = {}) {
    resetProjectConfigCache();
    vi.spyOn(git, "gitResolveOriginHead").mockResolvedValue("origin/main");
    vi.spyOn(git, "gitReadBlobAtRef").mockResolvedValue({
      status: "found",
      content,
    });
    vi.spyOn(git, "gitGetTopLevelPath").mockResolvedValue("/nonexistent");
    vi.spyOn(config, "gitGetConfigValue").mockImplementation((name: string) =>
      Promise.resolve(personal[name] ?? ""),
    );
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("neither list: today's built-in mapping", async () => {
    projectFile(PREFIXES);

    expect(
      (await getGitHubBranchNaming(issue({ type: "Bug", labels: ["chore"] })))
        .branchName,
    ).toBe("fix/42-fix-login-bug");
  });

  it("shared list only: it decides, and ends in otherwise: feature for an untyped issue (#118)", async () => {
    projectFile(`${PREFIXES + SHARED}  - otherwise: feature\n`);

    const naming = await getGitHubBranchNaming(issue());

    expect(naming.branchName).toBe("feat/42-fix-login-bug");
    expect(naming.match).toMatchObject({ source: "rule", position: 2 });
    expect(
      (await getGitHubBranchNaming(issue({ labels: ["chore"] }))).kind,
    ).toBe("chore");
  });

  it("shared list only: it replaces the built-in mapping, with no fall-through on no match", async () => {
    projectFile(PREFIXES + SHARED);

    const naming = await getGitHubBranchNaming(issue({ type: "Bug" }));

    expect(naming.branchName).toBe("42-fix-login-bug");
    expect(naming.match).toEqual({ source: "none" });
  });

  it("both lists: the provider's wins", async () => {
    projectFile(PREFIXES + OWN + SHARED);

    expect(
      (await getGitHubBranchNaming(issue({ labels: ["chore"] }))).branchName,
    ).toBe("feat/42-fix-login-bug");
  });

  // D5: only a provider's own list warns about an absent field.
  it("warns by the name of the provider's list, and not at all for the shared one", async () => {
    const rule = "  - when: { Priority: High }\n    type: bugfix\n";
    const warnings: string[] = [];

    projectFile(`${PREFIXES}github:\n  branchType:\n${rule}`);
    await getGitHubBranchNaming(issue(), (w) => warnings.push(w));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Rule 1 of github.branchType names");

    warnings.length = 0;
    projectFile(`${PREFIXES}branchType:\n${rule}`);
    await getGitHubBranchNaming(issue(), (w) => warnings.push(w));
    expect(warnings).toEqual([]);
  });

  // Finding 2: a dry run is where rules are checked, so a misspelt field in the
  // shared list warns there, and only there.
  it("a shared rule naming an absent field warns on a dry run and not on a real run", async () => {
    projectFile(
      `${PREFIXES}branchType:\n  - when: { Lables: bug }\n    type: bugfix\n`,
    );
    const real: string[] = [];
    const dry: string[] = [];

    await getGitHubBranchNaming(issue(), (w) => real.push(w));
    await getGitHubBranchNaming(issue(), (w) => dry.push(w), true);

    expect(real).toEqual([]);
    expect(dry).toHaveLength(1);
    expect(dry[0]).toContain("Rule 1 of branchType names");
  });

  // Plan Phase 2 "Done when": one portable list, `fix/` on a bug-typed issue.
  it("the portable Type rule gives fix/ on a bug-typed issue, with no warning", async () => {
    projectFile(
      `${PREFIXES}branchType:\n  - when: { Type: Bug }\n    type: bugfix\n`,
    );
    const warnings: string[] = [];

    const naming = await getGitHubBranchNaming(issue({ type: "Bug" }), (w) =>
      warnings.push(w),
    );

    expect(naming.branchName).toBe("fix/42-fix-login-bug");
    expect(warnings).toEqual([]);
  });

  // getBranchPrefix(kind) runs after the kind is decided, so a personal
  // `northguild.worktree.branchPrefix.*` still wins over the file's prefix.
  it("a personal branchPrefix still decides the prefix text for the shared list's kind", async () => {
    projectFile(PREFIXES + SHARED, { "branchPrefix.chore": "mine/" });

    expect(
      (await getGitHubBranchNaming(issue({ labels: ["chore"] }))).branchName,
    ).toBe("mine/42-fix-login-bug");
  });
});

describe("parseGitHubIssueReference", () => {
  // Expected values come from GitHub's documented URL forms, never from the
  // parser: an issue is `/{owner}/{repo}/issues/{number}` (the `html_url` of
  // the REST "Get an issue" and the one README.md's --json example shows) and
  // a pull request is `/{owner}/{repo}/pull/{number}`.
  it("reads the number and repository from an issue URL", () => {
    expect(
      parseGitHubIssueReference("https://github.com/acme/demo/issues/42"),
    ).toEqual({ number: "42", repository: { owner: "acme", name: "demo" } });
  });

  it("reads a pull request URL so the existing pull request refusal can fire", () => {
    expect(
      parseGitHubIssueReference("https://github.com/acme/demo/pull/7"),
    ).toEqual({ number: "7", repository: { owner: "acme", name: "demo" } });
  });

  it("accepts www.github.com and http", () => {
    expect(
      parseGitHubIssueReference("http://www.github.com/acme/demo/issues/42"),
    ).toEqual({ number: "42", repository: { owner: "acme", name: "demo" } });
  });

  // RFC 3986: a query and a fragment are not part of the path, so neither
  // names a different issue; a trailing slash is the same path.
  it.each([
    "https://github.com/acme/demo/issues/42/",
    "https://github.com/acme/demo/issues/42#issuecomment-1",
    "https://github.com/acme/demo/issues/42?x=1",
    "https://github.com/acme/demo/issues/42/?x=1#issuecomment-1",
  ])("ignores the slash, query and fragment of %s", (url) => {
    expect(parseGitHubIssueReference(url)).toEqual({
      number: "42",
      repository: { owner: "acme", name: "demo" },
    });
  });

  // A pasted value often brings a space or newline with it; a typed number
  // already tolerates that through its own trim.
  it.each([
    " https://github.com/acme/demo/issues/42",
    "https://github.com/acme/demo/issues/42 ",
    "\thttps://github.com/acme/demo/issues/42\n",
  ])("reads %j despite the surrounding whitespace", (url) => {
    expect(parseGitHubIssueReference(url)).toEqual({
      number: "42",
      repository: { owner: "acme", name: "demo" },
    });
  });

  it.each([
    "42",
    "#42",
    " 42 ",
    "abc",
    "",
    "git@github.com:acme/demo",
  ])("hands %j back untouched as the number", (value) => {
    expect(parseGitHubIssueReference(value)).toEqual({ number: value });
  });

  it.each([
    ["https://github.com/acme/demo", "https://github.com/acme/demo"],
    [
      "https://github.com/acme/demo/commits/main?token=s3cret#frag",
      "https://github.com/acme/demo/commits/main",
    ],
    [
      "https://github.com/acme/demo/issues/abc",
      "https://github.com/acme/demo/issues/abc",
    ],
    [
      "https://gitlab.com/acme/demo/issues/42",
      "https://gitlab.com/acme/demo/issues/42",
    ],
    [
      "https://user:s3cret@github.com/acme/demo/issues/42?token=abc#frag",
      "https://github.com/acme/demo/issues/42",
    ],
  ])("refuses %s, quoting %s and naming the shape", (value, quoted) => {
    let error: unknown;
    try {
      parseGitHubIssueReference(value);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(InvalidValueError);
    const message = (error as Error).message;
    expect(message).toContain(
      "https://github.com/<owner>/<repo>/issues/<number>",
    );
    expect(message).toContain(`"${quoted}"`);
    expect(message).not.toMatch(/s3cret|token|abc#|frag|user:/);
  });

  // #120 D11, D6: a pasted URL's host must be the configured one. The shape is
  // GHES's documented issue URL, `https://<host>/<owner>/<repo>/issues/<n>`
  // (the same as github.com's with the host swapped); DNS names compare
  // case-insensitively (RFC 4343).
  describe("on a GitHub Enterprise host (#120 D11)", () => {
    const GHE = "ghe.example.com";
    const repository = { owner: "acme", name: "widgets" };

    it.each([
      "https://ghe.example.com/acme/widgets/issues/42",
      "https://GHE.Example.com/acme/widgets/issues/42",
      "http://ghe.example.com/acme/widgets/pull/42/?x=1#issuecomment-1",
    ])("reads %s when the host is ghe.example.com", (url) => {
      expect(parseGitHubIssueReference(url, GHE)).toEqual({
        number: "42",
        repository,
      });
    });

    it("refuses the same URL when the host is github.com", () => {
      expect(() =>
        parseGitHubIssueReference(
          "https://ghe.example.com/acme/widgets/issues/42",
        ),
      ).toThrow(InvalidValueError);
    });

    it.each([
      "https://github.com/acme/widgets/issues/42",
      "https://www.github.com/acme/widgets/issues/42",
      "https://other.example.com/acme/widgets/issues/42",
      "https://www.ghe.example.com/acme/widgets/issues/42",
      "https://ghe.example.com.evil.test/acme/widgets/issues/42",
    ])("refuses %s when the host is ghe.example.com", (url) => {
      expect(() => parseGitHubIssueReference(url, GHE)).toThrow(
        InvalidValueError,
      );
    });

    it("names the configured host's shape, without query, fragment or user info", () => {
      let error: unknown;
      try {
        parseGitHubIssueReference(
          "https://user:s3cret@github.com/acme/widgets/issues/42?token=abc#frag",
          GHE,
        );
      } catch (caught) {
        error = caught;
      }
      const message = (error as Error).message;
      expect(message).toContain(
        "https://ghe.example.com/<owner>/<repo>/issues/<number>",
      );
      expect(message).toContain('"https://github.com/acme/widgets/issues/42"');
      expect(message).not.toMatch(/s3cret|token|abc|frag|user:/);
    });

    it("hands a bare number back untouched", () => {
      expect(parseGitHubIssueReference("42", GHE)).toEqual({ number: "42" });
    });
  });
});

// #120: `--github` and `--assign` on a configured GitHub Enterprise host. Every
// expected URL, argv and host below comes from the plan's section 8 table and
// the documents it cites, not from the code: GHES is `https://<host>/api/v3`
// (GHES REST quickstart), a `*.ghe.com` host is `https://api.<host>` (data
// residency docs), gh is asked `auth token --hostname <host>` (gh manual), and
// the error texts are D9's.
describe("GitHub Enterprise hosts (#120)", () => {
  const GHE_ORIGIN = "git@ghe.example.com:acme/widgets.git";
  const STORED_PAT = "ghp_githubcomstoredpat0000000000000000";
  const GHE_TOKEN = "gho_enterprisetoken000000000000000000";
  const user = {
    login: "baldurpan",
    html_url: "https://ghe.example.com/baldurpan",
  };

  interface Setup {
    host?: string;
    repository?: string;
    origin?: string;
    upstream?: string;
    /** What `gh auth token` answers; undefined means gh is not logged in. */
    gh?: string;
    /** The github.com token in git config. */
    stored?: string;
  }

  function setup({
    host = "ghe.example.com",
    repository,
    origin,
    upstream,
    gh,
    stored,
  }: Setup = {}) {
    vi.spyOn(projectConfig, "getTeamConfigValue").mockImplementation(
      async (name) =>
        name === "github.host"
          ? host
          : name === "github.repository"
            ? (repository ?? "")
            : "",
    );
    expectCommands(
      "git remote get-url upstream",
      "git remote get-url origin",
      "git config northguild.worktree.github.token",
      `gh auth token --hostname ${host.toLowerCase()}`,
    );
    return vi.spyOn(cli, "run").mockImplementation(async (file, args) => {
      if (file === "gh") {
        if (gh === undefined) {
          throw new Error("not logged in");
        }
        return gh;
      }
      const [subcommand, action, remote] = args ?? [];
      if (subcommand === "remote" && action === "get-url") {
        const url = { origin, upstream }[remote as "origin" | "upstream"];
        if (url === undefined) {
          throw new Error(`error: No such remote '${remote}'`);
        }
        return url;
      }
      if (args?.at(-1) === "northguild.worktree.github.token") {
        return stored ?? "";
      }
      throw new Error(`unexpected call: ${file} ${args?.join(" ")}`);
    });
  }

  const notFound = () => new Response("{}", { status: 404 });

  function stubFetchSequence(...responses: unknown[]) {
    const fetchSpy = vi.fn();
    for (const response of responses) {
      fetchSpy.mockResolvedValueOnce(
        response instanceof Response ? response : makeOkJsonResponse(response),
      );
    }
    vi.stubGlobal("fetch", fetchSpy);
    return fetchSpy;
  }

  const requestedUrls = (fetchSpy: ReturnType<typeof vi.fn>) =>
    fetchSpy.mock.calls.map(([url]) => url);

  const requestHeaders = (fetchSpy: ReturnType<typeof vi.fn>) =>
    fetchSpy.mock.calls.map(
      ([, init]) => (init as RequestInit).headers as Record<string, string>,
    );

  const storedTokenReads = (runSpy: ReturnType<typeof setup>) =>
    runSpy.mock.calls.filter(([, args]) =>
      args?.includes("northguild.worktree.github.token"),
    );

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("routing", () => {
    it("reads from https://<host>/api/v3, and the user lookup and assignees POST go to the same base", async () => {
      setup({ origin: GHE_ORIGIN, gh: GHE_TOKEN });
      const fetchSpy = stubFetchSequence(
        notFound(), // the unauthenticated probe
        makeIssueApiResponse(),
      );

      const issue = await fetchGitHubIssue(42);

      expect(requestedUrls(fetchSpy)).toEqual([
        "https://ghe.example.com/api/v3/repos/acme/widgets",
        "https://ghe.example.com/api/v3/repos/acme/widgets/issues/42",
      ]);
      expect(issue.repository).toEqual({
        owner: "acme",
        name: "widgets",
        source: "origin",
        host: "ghe.example.com",
      });

      const assignFetch = stubFetchSequence(
        user,
        makeIssueApiResponse({ assignees: [user] }),
      );
      await assignGitHubIssue(42);

      expect(requestedUrls(assignFetch)).toEqual([
        "https://ghe.example.com/api/v3/user",
        "https://ghe.example.com/api/v3/repos/acme/widgets/issues/42/assignees",
      ]);
      expect(assignFetch.mock.calls[1]?.[1]).toMatchObject({ method: "POST" });
    });

    it("sends requests for an x.ghe.com host to https://api.x.ghe.com", async () => {
      setup({
        host: "x.ghe.com",
        origin: "git@x.ghe.com:acme/widgets.git",
        gh: GHE_TOKEN,
      });
      const fetchSpy = stubFetchSequence(notFound(), makeIssueApiResponse());

      await fetchGitHubIssue(42);

      expect(requestedUrls(fetchSpy)).toEqual([
        "https://api.x.ghe.com/repos/acme/widgets",
        "https://api.x.ghe.com/repos/acme/widgets/issues/42",
      ]);

      const assignFetch = stubFetchSequence(
        user,
        makeIssueApiResponse({ assignees: [user] }),
      );
      await assignGitHubIssue(42);
      expect(requestedUrls(assignFetch)[0]).toBe("https://api.x.ghe.com/user");
    });

    it("still requests https when the remote is http", async () => {
      setup({
        origin: "http://ghe.example.com/acme/widgets.git",
        gh: GHE_TOKEN,
      });
      const fetchSpy = stubFetchSequence(notFound(), makeIssueApiResponse());

      await fetchGitHubIssue(42);

      expect(requestedUrls(fetchSpy)).toEqual([
        "https://ghe.example.com/api/v3/repos/acme/widgets",
        "https://ghe.example.com/api/v3/repos/acme/widgets/issues/42",
      ]);
    });

    it("compares the configured host without regard to case", async () => {
      setup({ host: "GHE.Example.COM", origin: GHE_ORIGIN, gh: GHE_TOKEN });
      const fetchSpy = stubFetchSequence(notFound(), makeIssueApiResponse());

      await fetchGitHubIssue(42);

      expect(requestedUrls(fetchSpy)[1]).toBe(
        "https://ghe.example.com/api/v3/repos/acme/widgets/issues/42",
      );
    });

    it("treats github.host github.com as the default: the same shape and base as unset", async () => {
      setup({
        host: "github.com",
        origin: "git@github.com:acme/widgets.git",
        stored: STORED_PAT,
      });
      const fetchSpy = stubFetchSequence(makeIssueApiResponse());

      const issue = await fetchGitHubIssue(42);

      expect(requestedUrls(fetchSpy)).toEqual([
        "https://api.github.com/repos/acme/widgets/issues/42",
      ]);
      expect(issue.repository).toEqual({
        owner: "acme",
        name: "widgets",
        source: "origin",
      });
    });

    it("keeps fetch's default redirect handling (D10)", async () => {
      setup({ origin: GHE_ORIGIN, gh: GHE_TOKEN });
      const fetchSpy = stubFetchSequence(notFound(), makeIssueApiResponse());

      await fetchGitHubIssue(42);

      for (const [, init] of fetchSpy.mock.calls) {
        expect(init).not.toHaveProperty("redirect");
      }
    });

    it("looks up a pull request's head branch on the same host and against origin", async () => {
      setup({ origin: GHE_ORIGIN, gh: GHE_TOKEN });
      const fetchSpy = stubFetchSequence(
        notFound(),
        makeIssueApiResponse({
          number: 7,
          pull_request: { url: "https://ghe.example.com/api/v3/pulls/7" },
        }),
        { head: { ref: "feature/x", repo: { full_name: "acme/widgets" } } },
      );

      const issue = await fetchGitHubIssue(7);

      expect(requestedUrls(fetchSpy)[2]).toBe(
        "https://ghe.example.com/api/v3/repos/acme/widgets/pulls/7",
      );
      expect(issue.pullRequest).toEqual({ headBranch: "feature/x" });
    });
  });

  describe("which remote counts (D2)", () => {
    it("skips an upstream on github.com and reads origin on the Enterprise host", async () => {
      setup({
        origin: GHE_ORIGIN,
        upstream: "git@github.com:northguild/worktree.git",
        gh: GHE_TOKEN,
      });
      const fetchSpy = stubFetchSequence(notFound(), makeIssueApiResponse());

      const issue = await fetchGitHubIssue(42);

      expect(issue.repository?.source).toBe("origin");
      expect(requestedUrls(fetchSpy)[1]).toBe(
        "https://ghe.example.com/api/v3/repos/acme/widgets/issues/42",
      );
    });

    it("reads an upstream that is on the Enterprise host", async () => {
      setup({
        origin: "git@ghe.example.com:me/widgets.git",
        upstream: "git@ghe.example.com:acme/widgets.git",
        gh: GHE_TOKEN,
      });
      const fetchSpy = stubFetchSequence(notFound(), makeIssueApiResponse());

      const issue = await fetchGitHubIssue(42);

      expect(issue.repository?.source).toBe("upstream");
      expect(requestedUrls(fetchSpy)[1]).toBe(
        "https://ghe.example.com/api/v3/repos/acme/widgets/issues/42",
      );
    });

    it("reads github.repository on the Enterprise host when origin is on it", async () => {
      setup({
        repository: "acme/upstream-repo",
        origin: "git@ghe.example.com:me/fork.git",
        gh: GHE_TOKEN,
      });
      const fetchSpy = stubFetchSequence(notFound(), makeIssueApiResponse());

      const issue = await fetchGitHubIssue(42);

      expect(issue.repository).toEqual({
        owner: "acme",
        name: "upstream-repo",
        source: "github.repository",
        host: "ghe.example.com",
      });
      expect(requestedUrls(fetchSpy)[1]).toBe(
        "https://ghe.example.com/api/v3/repos/acme/upstream-repo/issues/42",
      );
    });

    it.each([
      ["a github.com origin", "git@github.com:me/fork.git"],
      ["a GitLab origin", "git@gitlab.com:me/fork.git"],
      ["a lookalike host", "git@notghe.example.com:me/fork.git"],
    ])("with github.repository set and %s, fails naming both hosts and github.host, before any request", async (_case, origin) => {
      setup({ repository: "acme/widgets", origin, gh: GHE_TOKEN });
      const fetchSpy = stubFetchSequence();

      for (const call of [
        () => fetchGitHubIssue(42),
        () => assignGitHubIssue(42),
      ]) {
        const failure = await call().catch((e: unknown) => e as Error);

        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toContain("ghe.example.com");
        expect((failure as Error).message).toContain(origin);
        expect((failure as Error).message).toContain("github.host");
      }
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("fails the same way for an origin on another host without github.repository", async () => {
      setup({ origin: "git@gitlab.com:me/fork.git", gh: GHE_TOKEN });
      const fetchSpy = stubFetchSequence();

      await expect(fetchGitHubIssue(42)).rejects.toThrow(
        /github\.host is ghe\.example\.com, but the origin remote "git@gitlab\.com:me\/fork\.git" is not on that host/,
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("with the key unset, a non-GitHub origin keeps today's sentence and gains the github.host hint", async () => {
      setup({ host: "", origin: "git@ghe.example.com:acme/widgets.git" });
      const fetchSpy = stubFetchSequence();

      const failure = await fetchGitHubIssue(42).catch((e: unknown) => e);

      expect((failure as Error).message).toContain(
        'GitHub: Unable to determine the current repository from origin remote "git@ghe.example.com:acme/widgets.git".',
      );
      expect((failure as Error).message).toContain(
        "worktree config github.host <host>",
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it.each([
      "https://evil.example.com",
      "api.github.com",
      "ghe.example.com:8443",
      "ghe.example.com/",
    ])("re-checks github.host %j where it is used: invalid_value, no remote read, no request", async (host) => {
      const runSpy = setup({ host, origin: GHE_ORIGIN, gh: GHE_TOKEN });
      const fetchSpy = stubFetchSequence();

      for (const call of [
        () => fetchGitHubIssue(42),
        () => assignGitHubIssue(42),
      ]) {
        const failure = await call().catch((e: unknown) => e);
        expect(failure).toBeInstanceOf(InvalidValueError);
        expect((failure as Error).message).toContain("github.host");
      }
      expect(runSpy).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("tokens are bound to hosts (D3)", () => {
    it("asks gh for the configured host by name and sends gh's token, never the stored one", async () => {
      const runSpy = setup({
        origin: GHE_ORIGIN,
        gh: GHE_TOKEN,
        stored: STORED_PAT,
      });
      const fetchSpy = stubFetchSequence(notFound(), makeIssueApiResponse());

      await fetchGitHubIssue(42);

      expect(runSpy).toHaveBeenCalledWith(
        "gh",
        ["auth", "token", "--hostname", "ghe.example.com"],
        { timeout: 10_000 },
      );
      expect(runSpy).not.toHaveBeenCalledWith(
        "gh",
        ["auth", "token", "--hostname", "github.com"],
        expect.anything(),
      );
      expect(requestHeaders(fetchSpy)[1]?.Authorization).toBe(
        `Bearer ${GHE_TOKEN}`,
      );
      expect(JSON.stringify(fetchSpy.mock.calls)).not.toContain(STORED_PAT);
      expect(storedTokenReads(runSpy)).toEqual([]);
    });

    it("sends the same gh token for an assignment, and never reads the stored one", async () => {
      const runSpy = setup({
        origin: GHE_ORIGIN,
        gh: GHE_TOKEN,
        stored: STORED_PAT,
      });
      const fetchSpy = stubFetchSequence(
        user,
        makeIssueApiResponse({ assignees: [user] }),
      );

      await assignGitHubIssue(42);

      expect(requestHeaders(fetchSpy).map((h) => h.Authorization)).toEqual([
        `Bearer ${GHE_TOKEN}`,
        `Bearer ${GHE_TOKEN}`,
      ]);
      expect(JSON.stringify(fetchSpy.mock.calls)).not.toContain(STORED_PAT);
      expect(storedTokenReads(runSpy)).toEqual([]);
    });

    it("sends no Authorization to a public repository on the host, and not the stored token either", async () => {
      setup({ origin: GHE_ORIGIN, gh: GHE_TOKEN, stored: STORED_PAT });
      const fetchSpy = stubFetchSequence({}, makeIssueApiResponse());

      await fetchGitHubIssue(42);

      for (const headers of requestHeaders(fetchSpy)) {
        expect(headers).not.toHaveProperty("Authorization");
      }
    });

    it.each([
      ["interactive", false, "read"],
      ["non-interactive", true, "read"],
      ["interactive", false, "assign"],
      ["non-interactive", true, "assign"],
    ])("with no gh token, a %s %s ends in MissingValueError naming gh auth login --hostname, with no prompt", async (_mode, nonInteractive, action) => {
      setup({ origin: GHE_ORIGIN, stored: STORED_PAT });
      setNonInteractive(nonInteractive);
      const fetchSpy = stubFetchSequence(notFound());
      vi.mocked(input).mockClear();

      const failure = await (action === "read"
        ? fetchGitHubIssue(42)
        : assignGitHubIssue(42)
      ).catch((e: unknown) => e);

      expect(failure).toBeInstanceOf(MissingValueError);
      expect((failure as MissingValueError).flag).toBe(
        "`gh auth login --hostname ghe.example.com`",
      );
      expect((failure as MissingValueError).oclif).toEqual({ exit: 2 });
      expect(input).not.toHaveBeenCalled();
      expect(JSON.stringify(fetchSpy.mock.calls)).not.toContain(STORED_PAT);
    });

    it("on a 401, tells an Enterprise gh token's owner to run gh auth login --hostname", async () => {
      setup({ origin: GHE_ORIGIN, gh: GHE_TOKEN });
      stubFetchSequence(
        notFound(),
        new Response("{}", { status: 401, statusText: "Unauthorized" }),
      );

      const failure = (await fetchGitHubIssue(42).catch(
        (e: unknown) => e,
      )) as Error;

      expect(failure.message).toContain("401 Unauthorized");
      expect(failure.message).toContain(
        "`gh auth login --hostname ghe.example.com`",
      );
      expect(failure.message).not.toContain("worktree config github.token");
      expect(failure.message).not.toContain(GHE_TOKEN);
    });
  });

  describe("messages (D8, D9)", () => {
    it.each([
      ["origin", { origin: GHE_ORIGIN }, "ghe.example.com/acme/widgets"],
      [
        "upstream",
        { origin: "git@ghe.example.com:me/widgets.git", upstream: GHE_ORIGIN },
        "ghe.example.com/acme/widgets (upstream)",
      ],
      [
        "github.repository",
        { origin: GHE_ORIGIN, repository: "acme/widgets" },
        "ghe.example.com/acme/widgets (github.repository)",
      ],
    ])("names a failed read of the %s repository with its host first", async (_source, options, expected) => {
      setup({ ...options, gh: GHE_TOKEN });
      stubFetchSequence(notFound(), new Response("{}", { status: 404 }));

      await expect(fetchGitHubIssue(42)).rejects.toThrow(
        `GitHub: Failed to fetch issue 42 from ${expected}. 404`,
      );
    });

    it("names the host on a failed assignment", async () => {
      setup({ origin: GHE_ORIGIN, gh: GHE_TOKEN });
      stubFetchSequence(user, new Response("{}", { status: 404 }));

      await expect(assignGitHubIssue(42)).rejects.toThrow(
        "GitHub: Failed to assign issue 42 in ghe.example.com/acme/widgets.",
      );
    });

    it("reports a non-timeout network failure as could not reach <host>, with the cause", async () => {
      setup({ origin: GHE_ORIGIN, gh: GHE_TOKEN });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(
          new TypeError("fetch failed", {
            cause: new Error("unable to verify the first certificate"),
          }),
        ),
      );

      await expect(fetchGitHubIssue(42)).rejects.toThrow(
        "GitHub: could not reach ghe.example.com. unable to verify the first certificate",
      );
    });

    it("reports a network failure with no cause by its own message", async () => {
      setup({ origin: GHE_ORIGIN, gh: GHE_TOKEN });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new TypeError("fetch failed")),
      );

      await expect(fetchGitHubIssue(42)).rejects.toThrow(
        "GitHub: could not reach ghe.example.com. fetch failed",
      );
    });

    it("still reports a timeout as a timeout", async () => {
      setup({ origin: GHE_ORIGIN, gh: GHE_TOKEN });
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockRejectedValue(new DOMException("timed out", "TimeoutError")),
      );

      await expect(fetchGitHubIssue(42)).rejects.toThrow(
        "did not answer within 15s",
      );
    });

    it("names github.com in could not reach, on the default host too", async () => {
      setup({
        host: "",
        origin: "git@github.com:acme/widgets.git",
        stored: STORED_PAT,
      });
      vi.stubGlobal(
        "fetch",
        vi.fn().mockRejectedValue(new TypeError("fetch failed")),
      );

      await expect(fetchGitHubIssue(42)).rejects.toThrow(
        "GitHub: could not reach github.com.",
      );
    });

    // redactSecrets' shapes (redact.ts): user info in a URL, and ghp_/github_pat_
    // tokens. A remote with credentials must not reach a new message.
    it.each([
      ["an origin on another host", "ghe.example.com"],
      ["a non-GitHub origin with the key unset", ""],
    ])("never echoes credentials from %s", async (_case, host) => {
      const secret = "ghp_remotecredential000000000000000000";
      setup({
        host,
        origin: `https://user:${secret}@gitlab.com/me/fork.git`,
        gh: GHE_TOKEN,
      });
      stubFetchSequence();

      const failure = (await fetchGitHubIssue(42).catch(
        (e: unknown) => e,
      )) as Error;

      expect(failure.message).toContain("gitlab.com/me/fork.git");
      expect(failure.message).not.toContain(secret);
      expect(failure.message).not.toMatch(/ghp_[A-Za-z0-9]{20,}/);
    });
  });
});
