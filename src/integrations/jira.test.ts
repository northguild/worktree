import * as cli from "../lib/cli.js";
import * as git from "../lib/git.js";
import * as projectConfig from "../lib/project-config.js";
import { resetProjectConfigCache } from "../lib/project-config.js";
import * as prompt from "../lib/prompt.js";
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

// A project file on origin/main, and no working copy of it to disagree with.
function stubProjectFile(content: string) {
  vi.spyOn(git, "gitResolveOriginHead").mockResolvedValue("origin/main");
  vi.spyOn(git, "gitReadBlobAtRef").mockResolvedValue({
    status: "found",
    content,
  });
  vi.spyOn(git, "gitGetTopLevelPath").mockResolvedValue("/nonexistent");
}

// The plan's example file (§4): its prefixes and host decide the values below.
const PROJECT_FILE = `branchPrefix:
  feature: feat/
  bugfix: fix/
  chore: chore/
jira:
  host: https://acme.atlassian.net
`;

// Tests that script `git config` through cli.run in a fixed order have no
// project file; the rules lookup must not consume one of those answers.
function stubNoProjectFile() {
  vi.spyOn(projectConfig, "loadProjectConfig").mockResolvedValue({
    status: "none",
    reason: "no-ref",
    warnings: [],
  });
}

describe("Jira integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProjectConfigCache();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    // The project-file cases spy on git.js; the rest read through cli.run.
    vi.restoreAllMocks();
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

  // D17: a host from the file is trusted like merged code. It is used with no
  // prompt, and the credentials go to it.
  it("sends credentials to the host the project file supplies, without asking", async () => {
    stubProjectFile(PROJECT_FILE);
    vi.spyOn(git, "gitGetConfigValue").mockImplementation((name: string) =>
      Promise.resolve(
        { "jira.email": "test@example.com", "jira.apiToken": "api-token" }[
          name
        ] ?? "",
      ),
    );
    const prompted = vi.spyOn(prompt, "askConfirm");
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(makeJiraIssue()),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await fetchJiraIssue("dev-123");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://acme.atlassian.net/rest/api/3/issue/DEV-123",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: `Basic ${Buffer.from("test@example.com:api-token").toString("base64")}`,
        }),
      }),
    );
    expect(prompted).not.toHaveBeenCalled();
  });

  it("prefers a personal jira.host over the project file's", async () => {
    stubProjectFile(PROJECT_FILE);
    vi.spyOn(git, "gitGetConfigValue").mockImplementation((name: string) =>
      Promise.resolve(
        {
          "jira.host": "mine.atlassian.net",
          "jira.email": "test@example.com",
          "jira.apiToken": "api-token",
        }[name] ?? "",
      ),
    );
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue(makeJiraIssue()),
    });
    vi.stubGlobal("fetch", fetchSpy);

    await fetchJiraIssue("dev-123");

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://mine.atlassian.net/rest/api/3/issue/DEV-123",
      expect.anything(),
    );
  });

  it("takes the branch prefix from the project file when git config has none", async () => {
    stubProjectFile(PROJECT_FILE);
    vi.spyOn(git, "gitGetConfigValue").mockImplementation((name: string) =>
      Promise.resolve(
        {
          "jira.email": "test@example.com",
          "jira.apiToken": "api-token",
        }[name] ?? "",
      ),
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(
          makeJiraIssue({
            key: "DEV-42",
            fields: {
              summary: "Fix login bug",
              issuetype: { id: "10008", name: "Bug" },
            },
          }),
        ),
      }),
    );

    expect(await getJiraBranchNameFromIssue("dev-42")).toBe(
      "fix/DEV-42-fix-login-bug",
    );
  });

  describe("branch-type rules (jira.branchType)", () => {
    // The #181 example file (plan §4): its rules and comments decide the kinds.
    const RULES_FILE = `branchPrefix:
  feature: feat/
  bugfix: fix/
  chore: chore/
jira:
  host: https://acme.atlassian.net
  branchType:
    - when: { customfield_10359: { id: "10301" } }   # Work Category = Maintenance
      type: chore
    - when: { customfield_10359: { id: "10302" } }   # Work Category = Bug
      type: bugfix
    - when: { issuetype: { id: "10008" } }           # Issue Type = Bug
      type: bugfix
    - otherwise: feature
`;

    // Shapes from Atlassian's Jira Cloud REST v3 issue documentation, from
    // memory (not re-read this run; see the phase report): a single select is
    // {self, value, id}; issuetype is {id, name, ...}; expand=names adds a
    // top-level `names` map of field id -> display name.
    function ruleIssue(
      fields: Record<string, unknown>,
      names: Record<string, string> = {
        customfield_10359: "Work Category",
        issuetype: "Issue Type",
      },
    ) {
      return {
        id: "10001",
        key: "DEV-7",
        names,
        fields: { summary: "Fix login bug", ...fields },
      };
    }

    function select(id: string, value: string) {
      return {
        self: `https://acme.atlassian.net/rest/api/3/customFieldOption/${id}`,
        value,
        id,
      };
    }

    function stubJira(issue: unknown) {
      stubProjectFile(RULES_FILE);
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((name: string) =>
        Promise.resolve(
          { "jira.email": "test@example.com", "jira.apiToken": "api-token" }[
            name
          ] ?? "",
        ),
      );
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(issue),
      });
      vi.stubGlobal("fetch", fetchSpy);
      return fetchSpy;
    }

    it("asks for field names only when the project file sets jira.branchType", async () => {
      const fetchSpy = stubJira(ruleIssue({}));

      await getJiraBranchNameFromIssue("dev-7");

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://acme.atlassian.net/rest/api/3/issue/DEV-7?expand=names",
        expect.anything(),
      );
    });

    it("sends the request it always sent, with no expand, when no rules are set", async () => {
      stubProjectFile(PROJECT_FILE);
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((name: string) =>
        Promise.resolve(
          { "jira.email": "test@example.com", "jira.apiToken": "api-token" }[
            name
          ] ?? "",
        ),
      );
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(makeJiraIssue()),
      });
      vi.stubGlobal("fetch", fetchSpy);

      await getJiraBranchNameFromIssue("dev-123");

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://acme.atlassian.net/rest/api/3/issue/DEV-123",
        expect.anything(),
      );
    });

    it("keeps the built-in mapping when no rules are set, whatever fields say", async () => {
      stubProjectFile(PROJECT_FILE);
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((name: string) =>
        Promise.resolve(
          { "jira.email": "test@example.com", "jira.apiToken": "api-token" }[
            name
          ] ?? "",
        ),
      );
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue(
            makeJiraIssue({
              fields: {
                summary: "Tidy up",
                issuetype: { id: "10009", name: "Task" },
              },
            }),
          ),
        }),
      );

      expect(await getJiraBranchNameFromIssue("dev-123")).toBe(
        "chore/DEV-123-tidy-up",
      );
    });

    it("gives chore for Work Category = Maintenance (id 10301), the first rule", async () => {
      stubJira(
        ruleIssue({
          customfield_10359: select("10301", "Maintenance"),
          issuetype: { id: "10008", name: "Bug" },
        }),
      );

      expect(await getJiraBranchNameFromIssue("dev-7")).toBe(
        "chore/DEV-7-fix-login-bug",
      );
    });

    it("gives bugfix for Work Category = Bug (id 10302)", async () => {
      stubJira(
        ruleIssue({
          customfield_10359: select("10302", "Bug"),
          issuetype: { id: "10007", name: "Story" },
        }),
      );

      expect(await getJiraBranchNameFromIssue("dev-7")).toBe(
        "fix/DEV-7-fix-login-bug",
      );
    });

    it("gives bugfix for Issue Type id 10008 when the category is empty", async () => {
      stubJira(
        ruleIssue({
          customfield_10359: null,
          issuetype: { id: "10008", name: "Bug" },
        }),
      );

      expect(await getJiraBranchNameFromIssue("dev-7")).toBe(
        "fix/DEV-7-fix-login-bug",
      );
    });

    it("gives feature through otherwise when nothing else matches", async () => {
      stubJira(
        ruleIssue({
          customfield_10359: select("10399", "Something else"),
          issuetype: { id: "10007", name: "Story" },
        }),
      );

      expect(await getJiraBranchNameFromIssue("dev-7")).toBe(
        "feat/DEV-7-fix-login-bug",
      );
    });

    it("matches a field by its display name from expand=names, in any case", async () => {
      stubProjectFile(`branchPrefix:
  chore: chore/
jira:
  host: acme.atlassian.net
  branchType:
    - when: { work category: maintenance }
      type: chore
`);
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((name: string) =>
        Promise.resolve(
          { "jira.email": "test@example.com", "jira.apiToken": "api-token" }[
            name
          ] ?? "",
        ),
      );
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue(
            ruleIssue({
              customfield_10359: select("10301", "Maintenance"),
            }),
          ),
        }),
      );

      expect(await getJiraBranchNameFromIssue("dev-7")).toBe(
        "chore/DEV-7-fix-login-bug",
      );
    });

    it("matches multi-select options, components and labels on any element", async () => {
      stubProjectFile(`branchPrefix:
  chore: chore/
  bugfix: fix/
jira:
  host: acme.atlassian.net
  branchType:
    - when: { customfield_20000: Docs }
      type: chore
    - when: { components: payments }
      type: bugfix
    - when: { labels: [hotfix] }
      type: bugfix
`);
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((name: string) =>
        Promise.resolve(
          { "jira.email": "test@example.com", "jira.apiToken": "api-token" }[
            name
          ] ?? "",
        ),
      );
      const respond = (fields: Record<string, unknown>) =>
        vi.stubGlobal(
          "fetch",
          vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue(ruleIssue(fields, {})),
          }),
        );

      respond({
        customfield_20000: [select("1", "Api"), select("2", "Docs")],
      });
      expect(await getJiraBranchNameFromIssue("dev-7")).toBe(
        "chore/DEV-7-fix-login-bug",
      );

      respond({
        customfield_20000: [],
        components: [{ id: "10", name: "Payments" }],
      });
      expect(await getJiraBranchNameFromIssue("dev-7")).toBe(
        "fix/DEV-7-fix-login-bug",
      );

      respond({ components: [], labels: ["backend", "hotfix"] });
      expect(await getJiraBranchNameFromIssue("dev-7")).toBe(
        "fix/DEV-7-fix-login-bug",
      );
    });

    it("hands a warning to the caller for a field the issue does not have, and the rule does not match", async () => {
      stubProjectFile(`branchPrefix:
  feature: feat/
jira:
  host: acme.atlassian.net
  branchType:
    - when: { Work Categroy: Maintenance }
      type: chore
    - otherwise: feature
`);
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((name: string) =>
        Promise.resolve(
          { "jira.email": "test@example.com", "jira.apiToken": "api-token" }[
            name
          ] ?? "",
        ),
      );
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue(ruleIssue({})),
        }),
      );
      const warnings: string[] = [];

      const name = await getJiraBranchNameFromIssue("dev-7", (warning) =>
        warnings.push(warning),
      );

      expect(name).toBe("feat/DEV-7-fix-login-bug");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("Work Categroy");
      expect(warnings[0]).toContain("Rule 1");
    });

    it("gives no prefix when no rule matches and there is no otherwise", async () => {
      stubProjectFile(`branchPrefix:
  feature: feat/
jira:
  host: acme.atlassian.net
  branchType:
    - when: { issuetype: Bug }
      type: bugfix
`);
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((name: string) =>
        Promise.resolve(
          { "jira.email": "test@example.com", "jira.apiToken": "api-token" }[
            name
          ] ?? "",
        ),
      );
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: vi
            .fn()
            .mockResolvedValue(
              ruleIssue({ issuetype: { id: "10007", name: "Story" } }),
            ),
        }),
      );

      expect(await getJiraBranchNameFromIssue("dev-7")).toBe(
        "DEV-7-fix-login-bug",
      );
    });
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
    stubNoProjectFile();
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
    stubNoProjectFile();
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
    stubNoProjectFile();
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

    it("names Assign Issues for a 403 on the write", async () => {
      stubJira({ assignee: null, putStatus: 403 });

      const failure = assignJiraIssue("DEV-123");

      await expect(failure).rejects.toThrow(
        "Jira: Your account lacks the Assign Issues permission on the project of DEV-123.",
      );
      await expect(failure).rejects.not.toThrow(/Browse Projects/);
    });

    it("names Browse Projects for a 403 on the read of the issue, and writes nothing", async () => {
      const fetchSpy = stubJira({ assignee: null, issueStatus: 403 });

      const failure = assignJiraIssue("DEV-123");

      await expect(failure).rejects.toThrow(
        "Jira: Your account lacks the Browse Projects permission on the project of DEV-123.",
      );
      await expect(failure).rejects.not.toThrow(/Assign Issues/);
      expect(putCalls(fetchSpy)).toHaveLength(0);
    });

    it("names no project permission for a 403 on the read of the caller", async () => {
      stubJira({ assignee: null, myselfStatus: 403 });

      const failure = assignJiraIssue("DEV-123");

      await expect(failure).rejects.toThrow(
        "Jira: Failed to assign issue DEV-123. 403 status 403",
      );
      await expect(failure).rejects.not.toThrow(/permission/);
    });

    it("does not call a 400 on a read an assignee rejection", async () => {
      stubJira({ assignee: null, issueStatus: 400 });

      const failure = assignJiraIssue("DEV-123");

      await expect(failure).rejects.toThrow(
        "Jira: Failed to assign issue DEV-123. 400 status 400",
      );
      await expect(failure).rejects.not.toThrow(/not accepted as assignee/);
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
