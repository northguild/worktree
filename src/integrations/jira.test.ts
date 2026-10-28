import * as cli from "../lib/cli.js";
import { expectCommands } from "../test-setup.js";
import {
  assignJiraIssue,
  fetchJiraIssue,
  getJiraBranchNameFromIssue,
  validateJiraCredentials,
} from "./jira.js";

function makeJiraIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: "10001",
    key: "DEV-123",
    fields: {
      summary: "Add dark mode",
      issuetype: {
        id: "10007",
        name: "Story",
      },
    },
    ...overrides,
  };
}

describe("Jira integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("throws for invalid issue ids", async () => {
    const refusal = fetchJiraIssue("invalid");

    await expect(refusal).rejects.toThrow('Jira: Invalid issue id "invalid".');
    await expect(refusal).rejects.toMatchObject({
      code: "invalid_value",
      oclif: { exit: 2 },
    });
  });

  it("fetches issue info using jira.host, jira.email and jira.apiToken", async () => {
    expectCommands(
      "git config northguild.worktree.jira.host",
      "git config northguild.worktree.jira.email",
      "git config northguild.worktree.jira.apiToken",
    );

    const runSpy = vi.spyOn(cli, "run");
    runSpy
      .mockResolvedValueOnce("https://example.atlassian.net/")
      .mockResolvedValueOnce("test@example.com")
      .mockResolvedValueOnce("api-token");

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(makeJiraIssue()),
    });
    vi.stubGlobal("fetch", fetchSpy);

    const issue = await fetchJiraIssue("dev-123");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://example.atlassian.net/rest/api/3/issue/DEV-123",
      {
        method: "GET",
        headers: {
          Authorization: `Basic ${Buffer.from("test@example.com:api-token").toString("base64")}`,
          Accept: "application/json",
        },
        signal: expect.any(AbortSignal),
      },
    );
    expect(issue.key).toBe("DEV-123");
  });

  it("throws a helpful error when jira.host is missing", async () => {
    expectCommands(
      "git config northguild.worktree.jira.host",
      "git config northguild.worktree.jira.email",
      "git config northguild.worktree.jira.apiToken",
    );

    vi.spyOn(cli, "run")
      .mockResolvedValueOnce("")
      .mockResolvedValueOnce("test@example.com")
      .mockResolvedValueOnce("api-token");

    await expect(fetchJiraIssue("DEV-123")).rejects.toThrow(
      'Jira: Missing config value "jira.host". Run "worktree config" to configure Jira integration.',
    );
  });

  it("throws when jira authentication fails", async () => {
    expectCommands(
      "git config northguild.worktree.jira.host",
      "git config northguild.worktree.jira.email",
      "git config northguild.worktree.jira.apiToken",
    );

    vi.spyOn(cli, "run")
      .mockResolvedValueOnce("example.atlassian.net")
      .mockResolvedValueOnce("test@example.com")
      .mockResolvedValueOnce("api-token");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        headers: {
          get: vi.fn().mockReturnValue("AUTHENTICATED_FAILED"),
        },
      }),
    );

    await expect(fetchJiraIssue("DEV-123")).rejects.toThrow(
      "Jira: Authentication failed. Please verify jira.email and jira.apiToken in your config.",
    );
  });

  it("builds branch names from Jira issue type and configured prefix", async () => {
    expectCommands(
      "git config northguild.worktree.jira.host",
      "git config northguild.worktree.jira.email",
      "git config northguild.worktree.jira.apiToken",
      "git config northguild.worktree.branchPrefix.bugfix",
    );

    vi.spyOn(cli, "run")
      .mockResolvedValueOnce("example.atlassian.net")
      .mockResolvedValueOnce("test@example.com")
      .mockResolvedValueOnce("api-token")
      .mockResolvedValueOnce("fix/");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(
          makeJiraIssue({
            key: "DEV-42",
            fields: {
              summary: "Fix login bug",
              issuetype: {
                id: "10008",
                name: "Bug",
              },
            },
          }),
        ),
      }),
    );

    const branchName = await getJiraBranchNameFromIssue("dev-42");

    expect(branchName).toBe("fix/DEV-42-fix-login-bug");
  });

  it("cuts a long summary to a whole-word slug of at most 48 characters", async () => {
    expectCommands(
      "git config northguild.worktree.jira.host",
      "git config northguild.worktree.jira.email",
      "git config northguild.worktree.jira.apiToken",
      "git config northguild.worktree.branchPrefix.bugfix",
    );
    vi.spyOn(cli, "run")
      .mockResolvedValueOnce("example.atlassian.net")
      .mockResolvedValueOnce("test@example.com")
      .mockResolvedValueOnce("api-token")
      .mockResolvedValueOnce("fix/");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(
          makeJiraIssue({
            key: "DEV-43",
            fields: {
              summary:
                "Login redirect loops forever when the session cookie expires during a multi step checkout flow",
              issuetype: { id: "10008", name: "Bug" },
            },
          }),
        ),
      }),
    );

    const branchName = await getJiraBranchNameFromIssue("dev-43");

    expect(branchName).toBe(
      "fix/DEV-43-login-redirect-loops-forever-when-the-session",
    );
  });

  it('falls back to "issue" when the summary leaves no slug', async () => {
    expectCommands(
      "git config northguild.worktree.jira.host",
      "git config northguild.worktree.jira.email",
      "git config northguild.worktree.jira.apiToken",
      "git config northguild.worktree.branchPrefix.bugfix",
    );
    vi.spyOn(cli, "run")
      .mockResolvedValueOnce("example.atlassian.net")
      .mockResolvedValueOnce("test@example.com")
      .mockResolvedValueOnce("api-token")
      .mockResolvedValueOnce("fix/");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(
          makeJiraIssue({
            key: "DEV-44",
            fields: {
              summary: "!!!",
              issuetype: { id: "10008", name: "Bug" },
            },
          }),
        ),
      }),
    );

    const branchName = await getJiraBranchNameFromIssue("dev-44");

    expect(branchName).toBe("fix/DEV-44-issue");
  });

  it("validates Jira credentials against jira.host", async () => {
    expectCommands(
      "git config northguild.worktree.jira.host",
      "git config northguild.worktree.jira.email",
      "git config northguild.worktree.jira.apiToken",
    );

    vi.spyOn(cli, "run")
      .mockResolvedValueOnce("example.atlassian.net")
      .mockResolvedValueOnce("test@example.com")
      .mockResolvedValueOnce("api-token");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
      }),
    );

    const isValid = await validateJiraCredentials();

    expect(isValid).toBe(true);
  });

  it("rejects a Jira request that never answers, naming the call and not the token", async () => {
    expectCommands(
      "git config northguild.worktree.jira.host",
      "git config northguild.worktree.jira.email",
      "git config northguild.worktree.jira.apiToken",
    );
    vi.spyOn(cli, "run")
      .mockResolvedValueOnce("https://example.atlassian.net/")
      .mockResolvedValueOnce("test@example.com")
      .mockResolvedValueOnce("api-token");
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(
      AbortSignal.abort(new DOMException("timed out", "TimeoutError")),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            if (init.signal?.aborted) {
              reject(init.signal.reason);
            }
          }),
      ),
    );

    const failure = fetchJiraIssue("dev-123");

    await expect(failure).rejects.toThrow(
      "Jira: /rest/api/3/issue/DEV-123 did not answer within 15s.",
    );
    await expect(failure).rejects.not.toThrow(/api-token/);
    expect(AbortSignal.timeout).toHaveBeenCalledWith(15_000);
  });

  describe("assignJiraIssue", () => {
    const authorization = `Basic ${Buffer.from("test@example.com:api-token").toString("base64")}`;
    const me = { accountId: "acc-me", displayName: "Me Myself" };

    function stubJira({
      assignee,
      omitAssignee = false,
      putStatus = 204,
      putBody = "",
      myselfStatus = 200,
      myself = me,
      issueStatus = 200,
    }: {
      assignee?: { accountId: string; displayName: string } | null;
      omitAssignee?: boolean;
      putStatus?: number;
      putBody?: string;
      myselfStatus?: number;
      myself?: { accountId?: string; displayName: string };
      issueStatus?: number;
    }) {
      expectCommands(
        "git config northguild.worktree.jira.host",
        "git config northguild.worktree.jira.email",
        "git config northguild.worktree.jira.apiToken",
      );
      vi.spyOn(cli, "run")
        .mockResolvedValueOnce("https://example.atlassian.net/")
        .mockResolvedValueOnce("test@example.com")
        .mockResolvedValueOnce("api-token");

      const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
        const respond = (status: number, body: unknown) => ({
          ok: status >= 200 && status < 300,
          status,
          statusText: `status ${status}`,
          json: async () => body,
          text: async () => (typeof body === "string" ? body : ""),
        });

        if (init.method === "PUT") {
          return respond(putStatus, putBody);
        }
        if (url.endsWith("/rest/api/3/myself")) {
          return respond(myselfStatus, myself);
        }
        return respond(
          issueStatus,
          makeJiraIssue({
            fields: omitAssignee ? {} : { assignee: assignee ?? null },
          }),
        );
      });
      vi.stubGlobal("fetch", fetchSpy);

      return fetchSpy;
    }

    function putCalls(fetchSpy: ReturnType<typeof stubJira>) {
      return fetchSpy.mock.calls.filter(([, init]) => init.method === "PUT");
    }

    it("assigns an unassigned issue to the caller with a PUT of the accountId", async () => {
      const fetchSpy = stubJira({ assignee: null });

      const result = await assignJiraIssue("dev-123");

      expect(result).toEqual({ outcome: "assigned", displayName: "Me Myself" });
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://example.atlassian.net/rest/api/3/issue/DEV-123/assignee",
        {
          method: "PUT",
          headers: {
            Authorization: authorization,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ accountId: "acc-me" }),
          signal: expect.any(AbortSignal),
        },
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://example.atlassian.net/rest/api/3/myself",
        expect.objectContaining({ method: "GET" }),
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://example.atlassian.net/rest/api/3/issue/DEV-123?fields=assignee",
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("treats an issue with no assignee key as unassigned and assigns it", async () => {
      const fetchSpy = stubJira({ omitAssignee: true });

      const result = await assignJiraIssue("DEV-123");

      expect(result.outcome).toBe("assigned");
      expect(putCalls(fetchSpy)).toHaveLength(1);
    });

    it("makes no write when the issue is already the caller's", async () => {
      const fetchSpy = stubJira({ assignee: me });

      const result = await assignJiraIssue("DEV-123");

      expect(result).toEqual({
        outcome: "already-yours",
        displayName: "Me Myself",
      });
      expect(putCalls(fetchSpy)).toHaveLength(0);
    });

    it("leaves an issue held by someone else alone and names the holder", async () => {
      const fetchSpy = stubJira({
        assignee: { accountId: "acc-other", displayName: "Colleague C" },
      });

      const result = await assignJiraIssue("DEV-123");

      expect(result).toEqual({
        outcome: "held-by-other",
        displayName: "Me Myself",
        heldBy: "Colleague C",
      });
      expect(putCalls(fetchSpy)).toHaveLength(0);
    });

    it("decides by accountId, not by a shared display name", async () => {
      const fetchSpy = stubJira({
        assignee: { accountId: "acc-other", displayName: "Me Myself" },
      });

      const result = await assignJiraIssue("DEV-123");

      expect(result).toEqual({
        outcome: "held-by-other",
        displayName: "Me Myself",
        heldBy: "Me Myself",
      });
      expect(putCalls(fetchSpy)).toHaveLength(0);
    });

    it("refuses to write when Jira does not say who the caller is", async () => {
      const fetchSpy = stubJira({
        assignee: null,
        myself: { displayName: "Me Myself" },
      });

      await expect(assignJiraIssue("DEV-123")).rejects.toThrow(
        "Jira: Could not determine the account for jira.email.",
      );
      expect(putCalls(fetchSpy)).toHaveLength(0);
    });

    it("refuses an invalid key before any request", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      const refusal = assignJiraIssue("../myself");

      await expect(refusal).rejects.toThrow(
        'Jira: Invalid issue id "../myself".',
      );
      await expect(refusal).rejects.toMatchObject({ code: "invalid_value" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("explains a 400 as Jira not accepting the account, never the token", async () => {
      stubJira({ assignee: null, putStatus: 400, putBody: "bad user" });

      const failure = assignJiraIssue("DEV-123");

      await expect(failure).rejects.toThrow(
        "Jira: The account was not accepted as assignee for DEV-123. 400 status 400 - bad user",
      );
      await expect(failure).rejects.not.toThrow(authorization);
    });

    it("reuses the authentication text for a 401", async () => {
      stubJira({ assignee: null, putStatus: 401 });

      await expect(assignJiraIssue("DEV-123")).rejects.toThrow(
        "Jira: Authentication failed. Please verify jira.email and jira.apiToken in your config.",
      );
    });

    it("names Browse Projects and Assign Issues for a 403", async () => {
      stubJira({ assignee: null, putStatus: 403 });

      const failure = assignJiraIssue("DEV-123");

      await expect(failure).rejects.toThrow(/Browse Projects/);
      await expect(failure).rejects.toThrow(/Assign Issues/);
      await expect(failure).rejects.toThrow(/DEV-123/);
    });

    it("names the issue for a 404", async () => {
      stubJira({ assignee: null, putStatus: 404 });

      await expect(assignJiraIssue("DEV-123")).rejects.toThrow(
        "Jira: Issue DEV-123 was not found.",
      );
    });

    it("carries status and response text for any other failure, never the token", async () => {
      stubJira({ assignee: null, putStatus: 500, putBody: "boom" });

      const failure = assignJiraIssue("DEV-123");

      await expect(failure).rejects.toThrow(/500 status 500 - boom/);
      await expect(failure).rejects.not.toThrow(/api-token/);
      await expect(failure).rejects.not.toThrow(/Basic /);
    });

    it("names the issue when the read of it is a 404, and writes nothing", async () => {
      const fetchSpy = stubJira({ assignee: null, issueStatus: 404 });

      await expect(assignJiraIssue("DEV-123")).rejects.toThrow(
        "Jira: Issue DEV-123 was not found.",
      );
      expect(putCalls(fetchSpy)).toHaveLength(0);
    });

    it("reports a failed read of the caller as the same mapped failure", async () => {
      const fetchSpy = stubJira({ assignee: null, myselfStatus: 401 });

      await expect(assignJiraIssue("DEV-123")).rejects.toThrow(
        /Authentication failed/,
      );
      expect(putCalls(fetchSpy)).toHaveLength(0);
    });

    it("times out a PUT that never answers, naming the path and not the token", async () => {
      expectCommands(
        "git config northguild.worktree.jira.host",
        "git config northguild.worktree.jira.email",
        "git config northguild.worktree.jira.apiToken",
      );
      vi.spyOn(cli, "run")
        .mockResolvedValueOnce("https://example.atlassian.net/")
        .mockResolvedValueOnce("test@example.com")
        .mockResolvedValueOnce("api-token");
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init: RequestInit) => {
          if (init.method === "PUT") {
            throw new DOMException("timed out", "TimeoutError");
          }
          return {
            ok: true,
            status: 200,
            json: async () =>
              url.endsWith("/myself")
                ? me
                : makeJiraIssue({ fields: { assignee: null } }),
          };
        }),
      );

      const failure = assignJiraIssue("DEV-123");

      await expect(failure).rejects.toThrow(
        "Jira: /rest/api/3/issue/DEV-123/assignee did not answer within 15s.",
      );
      await expect(failure).rejects.not.toThrow(/api-token/);
    });
  });
});
