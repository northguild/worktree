import * as cli from "../lib/cli.js";
import * as config from "../lib/config.js";
import * as git from "../lib/git.js";
import * as projectConfig from "../lib/project-config.js";
import { resetProjectConfigCache } from "../lib/project-config.js";
import * as prompt from "../lib/prompt.js";
import { expectCommands } from "../test-setup.js";
import {
  assignJiraIssue,
  fetchJiraIssue,
  getJiraBranchNameFromIssue,
  getJiraBranchNaming,
  getJiraIssueFields,
  startJiraIssue,
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
  // getBranchTypeRules reads the file through its own binding, which the spy
  // above does not reach.
  vi.spyOn(projectConfig, "getBranchTypeRules").mockResolvedValue(undefined);
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
    vi.spyOn(config, "gitGetConfigValue").mockImplementation((name: string) =>
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
    vi.spyOn(config, "gitGetConfigValue").mockImplementation((name: string) =>
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
    vi.spyOn(config, "gitGetConfigValue").mockImplementation((name: string) =>
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

  describe("branchName template", () => {
    function stubIssue(file: string) {
      stubProjectFile(file);
      vi.spyOn(config, "gitGetConfigValue").mockImplementation((name: string) =>
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
    }

    it("the default template gives today's name", async () => {
      stubIssue(`${PROJECT_FILE}branchName: "{prefix}{id}-{slug}"\n`);

      expect(await getJiraBranchNameFromIssue("dev-123")).toBe(
        "chore/DEV-123-tidy-up",
      );
    });

    it("a different template reorders the key, the prefix and the slug", async () => {
      stubIssue(`${PROJECT_FILE}branchName: "{id}/{prefix}{slug}"\n`);

      expect(await getJiraBranchNameFromIssue("dev-123")).toBe(
        "DEV-123/chore/tidy-up",
      );
    });
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
      vi.spyOn(config, "gitGetConfigValue").mockImplementation((name: string) =>
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
      vi.spyOn(config, "gitGetConfigValue").mockImplementation((name: string) =>
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
      vi.spyOn(config, "gitGetConfigValue").mockImplementation((name: string) =>
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
      vi.spyOn(config, "gitGetConfigValue").mockImplementation((name: string) =>
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
      vi.spyOn(config, "gitGetConfigValue").mockImplementation((name: string) =>
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
      vi.spyOn(config, "gitGetConfigValue").mockImplementation((name: string) =>
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
      vi.spyOn(config, "gitGetConfigValue").mockImplementation((name: string) =>
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

  // The fetch signal also bounds the body: headers in time and a body that
  // stalls past 15s rejects response.json() with the signal's TimeoutError.
  it("reports a body that stalls past the timeout as a timeout", async () => {
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
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi
          .fn()
          .mockRejectedValue(new DOMException("timed out", "TimeoutError")),
      }),
    );

    await expect(fetchJiraIssue("dev-123")).rejects.toThrow(
      "Jira: /rest/api/3/issue/DEV-123 did not answer within 15s.",
    );
  });

  it("leaves a body that fails to parse as a parse failure, not a timeout", async () => {
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
      vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockRejectedValue(new SyntaxError("Unexpected token <")),
      }),
    );

    const failure = fetchJiraIssue("dev-123");

    await expect(failure).rejects.toThrow("Unexpected token <");
    await expect(failure).rejects.not.toThrow(/did not answer within/);
  });

  it("reports an error body that stalls past the timeout as a timeout", async () => {
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
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Server Error",
        text: vi
          .fn()
          .mockRejectedValue(new DOMException("timed out", "TimeoutError")),
      }),
    );

    await expect(fetchJiraIssue("dev-123")).rejects.toThrow(
      "Jira: /rest/api/3/issue/DEV-123 did not answer within 15s.",
    );
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

    it("reports an assignee read whose body stalls past the timeout as a timeout", async () => {
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
        vi.fn(async (url: string) => ({
          ok: true,
          status: 200,
          json: async () => {
            if (url.endsWith("/myself")) {
              return me;
            }
            throw new DOMException("timed out", "TimeoutError");
          },
        })),
      );

      await expect(assignJiraIssue("DEV-123")).rejects.toThrow(
        "Jira: /rest/api/3/issue/DEV-123?fields=assignee did not answer within 15s.",
      );
    });

    it("reports a refused PUT whose error body stalls past the timeout as a timeout", async () => {
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
        vi.fn(async (url: string, init: RequestInit) =>
          init.method === "PUT"
            ? {
                ok: false,
                status: 500,
                statusText: "Server Error",
                text: async () => {
                  throw new DOMException("timed out", "TimeoutError");
                },
              }
            : {
                ok: true,
                status: 200,
                json: async () =>
                  url.endsWith("/myself")
                    ? me
                    : makeJiraIssue({ fields: { assignee: null } }),
              },
        ),
      );

      await expect(assignJiraIssue("DEV-123")).rejects.toThrow(
        "Jira: /rest/api/3/issue/DEV-123/assignee did not answer within 15s.",
      );
    });
  });

  // #125 Phase 1. Fixtures are shaped from Jira's published OpenAPI document
  // (read via Context7, /openapi/dac-static_atlassian_cloud_jira_platform_swagger-v3_v3_json):
  // GET issue?fields=status gives fields.status {id, name, statusCategory.key};
  // GET /transitions gives transitions[] {id, name, isAvailable, to{id, name,
  // statusCategory.key}}; POST /transitions answers 204. Category keys are
  // Jira's convention: To Do = new, In Progress = indeterminate, Done = done.
  describe("startJiraIssue", () => {
    const authorization = `Basic ${Buffer.from("test@example.com:api-token").toString("base64")}`;
    const category = {
      new: { id: 2, key: "new", name: "To Do", colorName: "blue-gray" },
      indeterminate: {
        id: 4,
        key: "indeterminate",
        name: "In Progress",
        colorName: "yellow",
      },
      done: { id: 3, key: "done", name: "Done", colorName: "green" },
    };

    function status(
      id: string,
      name: string,
      key: keyof typeof category,
    ): Record<string, unknown> {
      return { id, name, statusCategory: category[key] };
    }

    function transition(
      id: string,
      name: string,
      to: Record<string, unknown>,
      extra: Record<string, unknown> = {},
    ) {
      return {
        id,
        name,
        to,
        hasScreen: false,
        isGlobal: false,
        isAvailable: true,
        ...extra,
      };
    }

    const todo = status("10000", "To Do", "new");
    const inProgress = status("10001", "In Progress", "indeterminate");
    const inReview = status("10002", "In Review", "indeterminate");
    const done = status("10003", "Done", "done");

    function stubJira({
      current = todo as unknown,
      issueBody,
      transitions = [transition("21", "Start progress", inProgress)] as unknown,
      issueStatus = 200,
      transitionsStatus = 200,
      postStatus = 204,
      postBody = "",
    }: {
      current?: unknown;
      issueBody?: unknown;
      transitions?: unknown;
      issueStatus?: number;
      transitionsStatus?: number;
      postStatus?: number;
      postBody?: string;
    } = {}) {
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
        const respond = (code: number, body: unknown) => ({
          ok: code >= 200 && code < 300,
          status: code,
          statusText: `status ${code}`,
          json: async () => body,
          text: async () => (typeof body === "string" ? body : ""),
        });

        if (init.method === "POST") {
          return respond(postStatus, postBody);
        }
        if (url.includes("/transitions")) {
          return respond(transitionsStatus, { transitions });
        }
        return respond(
          issueStatus,
          issueBody ?? {
            id: "10",
            key: "DEV-123",
            fields: { status: current },
          },
        );
      });
      vi.stubGlobal("fetch", fetchSpy);

      return fetchSpy;
    }

    function posts(fetchSpy: ReturnType<typeof stubJira>) {
      return fetchSpy.mock.calls.filter(([, init]) => init.method === "POST");
    }

    it("moves a To Do issue through the in-progress transition with a POST of its id", async () => {
      const fetchSpy = stubJira();

      const result = await startJiraIssue("dev-123");

      expect(result).toEqual({
        outcome: "started",
        from: "To Do",
        to: "In Progress",
      });
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://example.atlassian.net/rest/api/3/issue/DEV-123?fields=status",
        expect.objectContaining({ method: "GET" }),
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://example.atlassian.net/rest/api/3/issue/DEV-123/transitions",
        expect.objectContaining({ method: "GET" }),
      );
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://example.atlassian.net/rest/api/3/issue/DEV-123/transitions",
        {
          method: "POST",
          headers: {
            Authorization: authorization,
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ transition: { id: "21" } }),
          signal: expect.any(AbortSignal),
        },
      );
      expect(fetchSpy).toHaveBeenCalledTimes(3);
    });

    it("treats a transition that omits isAvailable as available", async () => {
      const fetchSpy = stubJira({
        transitions: [
          {
            id: "21",
            name: "Start progress",
            to: inProgress,
            hasScreen: false,
            isGlobal: false,
          },
        ],
      });

      const result = await startJiraIssue("DEV-123");

      expect(result).toEqual({
        outcome: "started",
        from: "To Do",
        to: "In Progress",
      });
      expect(posts(fetchSpy)).toHaveLength(1);
    });

    it("does not filter out a transition that has a screen", async () => {
      const fetchSpy = stubJira({
        transitions: [
          transition("21", "Start progress", inProgress, { hasScreen: true }),
        ],
      });

      const result = await startJiraIssue("DEV-123");

      expect(result).toEqual({
        outcome: "started",
        from: "To Do",
        to: "In Progress",
      });
      expect(posts(fetchSpy)).toHaveLength(1);
    });

    it("reports an issue already in progress after one request and no write", async () => {
      const fetchSpy = stubJira({ current: inProgress });

      const result = await startJiraIssue("DEV-123");

      expect(result).toEqual({
        outcome: "already-started",
        status: "In Progress",
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("leaves a Done issue alone after one request and no write", async () => {
      const fetchSpy = stubJira({ current: done });

      const result = await startJiraIssue("DEV-123");

      expect(result).toEqual({
        outcome: "left-alone",
        status: "Done",
        category: "done",
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("leaves an issue with an unrecognised category key alone", async () => {
      const fetchSpy = stubJira({
        current: {
          id: "10009",
          name: "Limbo",
          statusCategory: { id: 1, key: "undefined", name: "No Category" },
        },
      });

      const result = await startJiraIssue("DEV-123");

      expect(result).toEqual({
        outcome: "left-alone",
        status: "Limbo",
        category: "undefined",
      });
      expect(posts(fetchSpy)).toHaveLength(0);
    });

    it("ignores a transition that is not available", async () => {
      const fetchSpy = stubJira({
        transitions: [
          transition("21", "Start progress", inProgress, {
            isAvailable: false,
          }),
          transition("22", "Review", inReview),
        ],
      });

      const result = await startJiraIssue("DEV-123");

      expect(result).toEqual({
        outcome: "started",
        from: "To Do",
        to: "In Review",
      });
      expect(JSON.parse(posts(fetchSpy)[0][1].body as string)).toEqual({
        transition: { id: "22" },
      });
    });

    it("ignores a transition that leads back to the current status", async () => {
      // The current status id appears as an in-progress target: a loop.
      const loop = status("10000", "To Do", "indeterminate");
      const fetchSpy = stubJira({
        transitions: [transition("23", "Restart", loop)],
      });

      const result = await startJiraIssue("DEV-123");

      expect(result).toEqual({
        outcome: "no-in-progress-transition",
        status: "To Do",
      });
      expect(posts(fetchSpy)).toHaveLength(0);
    });

    it("takes the first of several transitions that lead to one target status", async () => {
      const fetchSpy = stubJira({
        transitions: [
          transition("21", "Start progress", inProgress),
          transition("31", "Pick up", inProgress, { isGlobal: true }),
        ],
      });

      const result = await startJiraIssue("DEV-123");

      expect(result).toEqual({
        outcome: "started",
        from: "To Do",
        to: "In Progress",
      });
      expect(JSON.parse(posts(fetchSpy)[0][1].body as string)).toEqual({
        transition: { id: "21" },
      });
    });

    it("refuses to choose between transitions that lead to different statuses", async () => {
      const fetchSpy = stubJira({
        transitions: [
          transition("21", "Start progress", inProgress),
          transition("22", "Send to review", inReview),
        ],
      });

      const result = await startJiraIssue("DEV-123");

      expect(result).toEqual({
        outcome: "ambiguous",
        status: "To Do",
        targets: ["In Progress", "In Review"],
      });
      expect(posts(fetchSpy)).toHaveLength(0);
    });

    it("reports no in-progress transition when the workflow offers only other categories", async () => {
      const fetchSpy = stubJira({
        transitions: [transition("41", "Close", done)],
      });

      const result = await startJiraIssue("DEV-123");

      expect(result).toEqual({
        outcome: "no-in-progress-transition",
        status: "To Do",
      });
      expect(posts(fetchSpy)).toHaveLength(0);
    });

    it("reports no in-progress transition for an empty list, which Jira also returns without Transition Issues", async () => {
      const fetchSpy = stubJira({ transitions: [] });

      const result = await startJiraIssue("DEV-123");

      expect(result).toEqual({
        outcome: "no-in-progress-transition",
        status: "To Do",
      });
      expect(posts(fetchSpy)).toHaveLength(0);
    });

    it("refuses an invalid key before any request", async () => {
      const fetchSpy = vi.fn();
      vi.stubGlobal("fetch", fetchSpy);

      const refusal = startJiraIssue("../transitions");

      await expect(refusal).rejects.toThrow(
        'Jira: Invalid issue id "../transitions".',
      );
      await expect(refusal).rejects.toMatchObject({ code: "invalid_value" });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects an issue answer with no status category", async () => {
      stubJira({ current: { id: "10000", name: "To Do" } });

      await expect(startJiraIssue("DEV-123")).rejects.toThrow(
        "Jira: Unexpected response for DEV-123.",
      );
    });

    it("rejects a transitions answer that is not an array", async () => {
      stubJira({ transitions: "nope" });

      await expect(startJiraIssue("DEV-123")).rejects.toThrow(
        "Jira: Unexpected response for DEV-123.",
      );
    });

    it("reuses the authentication text for a 401 on the status read", async () => {
      stubJira({ issueStatus: 401 });

      await expect(startJiraIssue("DEV-123")).rejects.toThrow(
        "Jira: Authentication failed. Please verify jira.email and jira.apiToken in your config.",
      );
    });

    it("reuses the authentication text for a 401 on the write", async () => {
      stubJira({ postStatus: 401 });

      await expect(startJiraIssue("DEV-123")).rejects.toThrow(
        "Jira: Authentication failed. Please verify jira.email and jira.apiToken in your config.",
      );
    });

    it("says the issue was not found for a 404 on the status read", async () => {
      stubJira({ issueStatus: 404 });

      await expect(startJiraIssue("DEV-123")).rejects.toThrow(
        "Jira: Issue DEV-123 was not found.",
      );
    });

    it("says the issue was not found for a 404 on the write", async () => {
      stubJira({ postStatus: 404 });

      await expect(startJiraIssue("DEV-123")).rejects.toThrow(
        "Jira: Issue DEV-123 was not found.",
      );
    });

    it("names the transition and a possibly required field for a 400 on the write, never the token", async () => {
      stubJira({ postStatus: 400, postBody: "Field 'resolution' is required" });

      const failure = startJiraIssue("DEV-123");

      await expect(failure).rejects.toThrow(
        "Jira: Could not move DEV-123 with the \"Start progress\" transition; it may need a field set in Jira. 400 status 400 - Field 'resolution' is required",
      );
      await expect(failure).rejects.not.toThrow(authorization);
      await expect(failure).rejects.not.toThrow(/api-token/);
    });

    it("asks for a retry on a 409 on the write", async () => {
      stubJira({ postStatus: 409, postBody: "conflict" });

      await expect(startJiraIssue("DEV-123")).rejects.toThrow(
        "Jira: DEV-123 was changed while it was being moved. Try again. 409 status 409 - conflict",
      );
    });

    it("carries status and text for any other failure on the write", async () => {
      stubJira({ postStatus: 500, postBody: "boom" });

      await expect(startJiraIssue("DEV-123")).rejects.toThrow(
        "Jira: Failed to move issue DEV-123. 500 status 500 - boom",
      );
    });

    it("carries status and text for a failure reading the transitions", async () => {
      stubJira({ transitionsStatus: 500 });

      await expect(startJiraIssue("DEV-123")).rejects.toThrow(
        "Jira: Failed to move issue DEV-123. 500 status 500",
      );
    });

    it("times out a POST that never answers, naming the path and not the token", async () => {
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
          if (init.method === "POST") {
            throw new DOMException("timed out", "TimeoutError");
          }
          return {
            ok: true,
            status: 200,
            json: async () =>
              url.includes("/transitions")
                ? { transitions: [transition("21", "Start", inProgress)] }
                : { fields: { status: todo } },
          };
        }),
      );

      const failure = startJiraIssue("DEV-123");

      await expect(failure).rejects.toThrow(
        "Jira: /rest/api/3/issue/DEV-123/transitions did not answer within 15s.",
      );
      await expect(failure).rejects.not.toThrow(/api-token/);
    });
  });
});

// Phase 5 (#181): what `branch --dry-run` shows. Expected values come from the
// plan's example file (§4) and D9/D13: the request asks for display names on a
// dry run even with no rules, and the match names the rule by its position.
describe("getJiraBranchNaming", () => {
  const EXAMPLE_FILE = `branchPrefix:
  feature: feat/
  bugfix: fix/
  chore: chore/
jira:
  host: https://acme.atlassian.net
  branchType:
    - when: { customfield_10359: { id: "10301" } }   # Work Category = Maintenance
      type: chore
    - when: { issuetype: { id: "10008" } }           # Issue Type = Bug
      type: bugfix
`;
  const NO_RULES = `branchPrefix:
  feature: feat/
  bugfix: fix/
  chore: chore/
jira:
  host: https://acme.atlassian.net
`;

  function stubJira(file: string, issue: unknown) {
    resetProjectConfigCache();
    stubProjectFile(file);
    vi.spyOn(config, "gitGetConfigValue").mockImplementation((name: string) =>
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

  const issue = {
    id: "10001",
    key: "DEV-7",
    names: {
      customfield_10359: "Work Category",
      issuetype: "Issue Type",
      summary: "Summary",
    },
    fields: {
      summary: "Fix login bug",
      customfield_10359: { value: "Maintenance", id: "10301" },
      issuetype: { id: "10008", name: "Bug" },
    },
  };

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("asks for display names on a dry run even when no rules are set (D9)", async () => {
    const fetchSpy = stubJira(NO_RULES, issue);

    const naming = await getJiraBranchNaming("dev-7", { dryRun: true });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://acme.atlassian.net/rest/api/3/issue/DEV-7?expand=names",
      expect.anything(),
    );
    expect(naming.match).toEqual({ source: "built-in" });
    expect(naming.fields).toContainEqual({
      id: "customfield_10359",
      name: "Work Category",
      values: [{ id: "10301", name: "Maintenance" }],
    });
  });

  it("names the rule that matched by its position", async () => {
    stubJira(EXAMPLE_FILE, issue);

    const naming = await getJiraBranchNaming("dev-7", { dryRun: true });

    expect(naming.branchName).toBe("chore/DEV-7-fix-login-bug");
    expect(naming.kind).toBe("chore");
    expect(naming.match).toEqual({
      source: "rule",
      position: 1,
      rule: {
        when: { customfield_10359: { id: "10301" } },
        type: "chore",
      },
    });
  });

  it("says no rule matched when rules exist and none did", async () => {
    stubJira(EXAMPLE_FILE, {
      ...issue,
      fields: {
        summary: "Fix login bug",
        issuetype: { id: "10007", name: "Story" },
      },
    });

    const naming = await getJiraBranchNaming("dev-7", { dryRun: true });

    expect(naming.match).toEqual({ source: "none" });
    expect(naming.kind).toBeUndefined();
    expect(naming.branchName).toBe("DEV-7-fix-login-bug");
  });
});

// The shared top-level `branchType` list (#128, D1, D6). Expected names come
// from the plan's Phase 1 "Done when" and the built-in mapping above (a Bug is
// `fix/`, a Story is `feat/`); the issue type id 10008 is the #181 example's.
describe("the shared branchType list for Jira", () => {
  const PREFIXES = `branchPrefix:
  feature: feat/
  bugfix: fix/
  chore: chore/
jira:
  host: https://acme.atlassian.net
`;
  const SHARED = `branchType:
  - when: { issuetype: { id: "10008" } }
    type: chore
`;
  const OWN = `  branchType:
    - when: { issuetype: { id: "10008" } }
      type: feature
`;

  const issueOfType = (id: string, name: string) => ({
    id: "10001",
    key: "DEV-7",
    names: { issuetype: "Issue Type" },
    fields: { summary: "Fix login bug", issuetype: { id, name } },
  });
  const bug = issueOfType("10008", "Bug");
  const story = issueOfType("10001", "Story");

  function stubJira(file: string, issue: unknown) {
    resetProjectConfigCache();
    stubProjectFile(file);
    vi.spyOn(config, "gitGetConfigValue").mockImplementation((name: string) =>
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

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("neither list: today's built-in mapping, and no names requested", async () => {
    const fetchSpy = stubJira(PREFIXES, bug);

    const naming = await getJiraBranchNaming("dev-7");

    expect(naming.branchName).toBe("fix/DEV-7-fix-login-bug");
    expect(naming.match).toEqual({ source: "built-in" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://acme.atlassian.net/rest/api/3/issue/DEV-7",
      expect.anything(),
    );
  });

  it("shared list only: it decides, and field names are requested (D6)", async () => {
    const fetchSpy = stubJira(PREFIXES + SHARED, bug);

    const naming = await getJiraBranchNaming("dev-7");

    expect(naming.branchName).toBe("chore/DEV-7-fix-login-bug");
    expect(naming.match).toMatchObject({ source: "rule", position: 1 });
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://acme.atlassian.net/rest/api/3/issue/DEV-7?expand=names",
      expect.anything(),
    );
  });

  it("shared list only: it replaces the built-in mapping, with no fall-through on no match", async () => {
    stubJira(PREFIXES + SHARED, story);

    const naming = await getJiraBranchNaming("dev-7");

    expect(naming.branchName).toBe("DEV-7-fix-login-bug");
    expect(naming.match).toEqual({ source: "none" });
  });

  const PORTABLE = `branchType:
  - when: { Type: Bug }
    type: bugfix
  - when: { Labels: bug }
    type: bugfix
`;

  // Plan Phase 2 "Done when": the portable list gives fix/ on a Jira Bug.
  it("the portable Type rule gives fix/ on a Bug, with no warning", async () => {
    stubJira(PREFIXES + PORTABLE, bug);
    const warnings: string[] = [];

    const naming = await getJiraBranchNaming("dev-7", {
      onWarning: (w) => warnings.push(w),
    });

    expect(naming.branchName).toBe("fix/DEV-7-fix-login-bug");
    expect(naming.match).toMatchObject({ source: "rule", position: 1 });
    expect(warnings).toEqual([]);
  });

  it("the portable Labels rule matches Jira's own labels field", async () => {
    stubJira(PREFIXES + PORTABLE, {
      ...story,
      names: { issuetype: "Issue Type", labels: "Labels" },
      fields: { ...story.fields, labels: ["bug"] },
    });

    const naming = await getJiraBranchNaming("dev-7");

    expect(naming.branchName).toBe("fix/DEV-7-fix-login-bug");
    expect(naming.match).toMatchObject({ position: 2 });
  });

  it("a jira.branchType on issuetype keeps matching, and the alias is listed beside it in the dry run", async () => {
    stubJira(
      `${PREFIXES}  branchType:\n    - when: { "Issue Type": Bug }\n      type: chore\n`,
      bug,
    );

    const naming = await getJiraBranchNaming("dev-7", { dryRun: true });

    expect(naming.kind).toBe("chore");
    expect(naming.fields.map((field) => field.id)).toEqual([
      "summary",
      "issuetype",
      "Type",
    ]);
    expect(naming.fields.at(-1)?.values).toEqual([
      { id: "10008", name: "Bug" },
    ]);
  });

  // D4 / plan §5: a real custom field called "Type" is never shadowed.
  it("does not shadow a custom field already named Type, and does not throw ambiguity", async () => {
    stubJira(
      PREFIXES +
        "branchType:\n  - when: { Type: Epic }\n    type: feature\n  - when: { Type: Bug }\n    type: bugfix\n",
      {
        ...bug,
        names: { issuetype: "Issue Type", customfield_9: "Type" },
        fields: { ...bug.fields, customfield_9: { value: "Epic" } },
      },
    );

    const naming = await getJiraBranchNaming("dev-7");

    expect(naming.kind).toBe("feature");
    expect(naming.fields.filter((field) => field.name === "Type")).toHaveLength(
      1,
    );
  });

  // N1 / D5: the shared list's rule 1 names an absent field and must not warn
  // before rule 2 matches.
  it("a shared rule naming an absent field does not warn", async () => {
    stubJira(
      `${PREFIXES}branchType:\n  - when: { Sprint: "1" }\n    type: chore\n  - when: { Type: Bug }\n    type: bugfix\n`,
      bug,
    );
    const warnings: string[] = [];

    const naming = await getJiraBranchNaming("dev-7", {
      onWarning: (w) => warnings.push(w),
    });

    expect(naming.match).toMatchObject({ position: 2 });
    expect(warnings).toEqual([]);
  });

  // Finding 2: a dry run is where rules are checked, so a misspelt field in the
  // shared list warns there, and only there.
  it("a shared rule naming an absent field warns on a dry run", async () => {
    stubJira(
      `${PREFIXES}branchType:\n  - when: { Sprint: "1" }\n    type: chore\n  - when: { Type: Bug }\n    type: bugfix\n`,
      bug,
    );
    const warnings: string[] = [];

    await getJiraBranchNaming("dev-7", {
      onWarning: (w) => warnings.push(w),
      dryRun: true,
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Rule 1 of branchType names");
  });

  // N2: the `labels` id is stable, its display name is localized.
  it("the portable Labels matches on a localized Jira, where labels is named Etiketten", async () => {
    stubJira(PREFIXES + PORTABLE, {
      ...story,
      names: { issuetype: "Vorgangstyp", labels: "Etiketten" },
      fields: { ...story.fields, labels: ["bug"] },
    });

    expect((await getJiraBranchNaming("dev-7")).match).toMatchObject({
      position: 2,
    });
  });

  it("adds no Labels alias when the field is already named Labels", () => {
    const fields = getJiraIssueFields({
      ...story,
      names: { issuetype: "Issue Type", labels: "Labels" },
      fields: { ...story.fields, labels: ["bug"] },
    } as never);

    expect(fields.filter((field) => field.name === "Labels")).toHaveLength(1);
  });

  it("does not shadow a custom field already named Labels", () => {
    const fields = getJiraIssueFields({
      ...story,
      names: { labels: "Etiketten", customfield_9: "Labels" },
      fields: { labels: ["bug"], customfield_9: { value: "x" } },
    } as never);

    expect(fields.filter((field) => field.name === "Labels")).toEqual([
      { id: "customfield_9", name: "Labels", values: [{ name: "x" }] },
    ]);
  });

  it("does not add Type when a field already has that id", () => {
    const fields = getJiraIssueFields({
      ...bug,
      fields: { ...bug.fields, Type: "x" },
    } as never);

    expect(fields.filter((field) => field.id === "Type")).toHaveLength(1);
  });

  it("adds no Type when the issue has no issuetype", () => {
    const fields = getJiraIssueFields({
      id: "1",
      key: "DEV-7",
      fields: { summary: "x" },
    } as never);

    expect(fields.map((field) => field.id)).toEqual(["summary"]);
  });

  it("both lists: the provider's wins", async () => {
    stubJira(PREFIXES + OWN + SHARED, bug);

    expect((await getJiraBranchNaming("dev-7")).branchName).toBe(
      "feat/DEV-7-fix-login-bug",
    );
  });
});
