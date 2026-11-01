import * as cli from "../lib/cli.js";
import * as config from "../lib/config.js";
import * as git from "../lib/git.js";
import { resetProjectConfigCache } from "../lib/project-config.js";
import { expectCommands } from "../test-setup.js";
import {
  fetchLinearIssue,
  getLinearBranchNameFromIssue,
  getLinearBranchNaming,
  getLinearBranchType,
  listAssignedLinearIssues,
  resolveLinearApiKey,
  startLinearIssue,
  validateLinearCredentials,
} from "./linear.js";

const API_KEY = "lin_api_test0123456789";

// The shape Linear's GraphQL API answers with: `{ data: { issue: ... } }`
// (https://linear.app/developers/graphql, "Get issue by ID").
function issuePayload(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      issue: {
        identifier: "ENG-123",
        title: "Add dark mode",
        url: "https://linear.app/acme/issue/ENG-123/add-dark-mode",
        labels: { nodes: [{ name: "Feature" }] },
        ...overrides,
      },
    },
  };
}

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: "",
    json: vi.fn().mockResolvedValue(body),
  };
}

function stubFetch(response: unknown) {
  const fetchSpy = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function stubKey(value = API_KEY) {
  expectCommands("git config northguild.worktree.linear.apiKey");
  vi.spyOn(cli, "run").mockResolvedValueOnce(value);
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

describe("Linear integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProjectConfigCache();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    // The project-file cases spy on git.js; the rest read through cli.run.
    vi.restoreAllMocks();
  });

  describe("resolveLinearApiKey", () => {
    it("reads linear.apiKey from git config", async () => {
      stubKey();

      await expect(resolveLinearApiKey()).resolves.toBe(API_KEY);
    });

    it("tells the user to run worktree config when the key is missing", async () => {
      stubKey("");

      await expect(resolveLinearApiKey()).rejects.toThrow(
        'Linear: Missing config value "linear.apiKey". Run "worktree config" to configure Linear integration.',
      );
    });
  });

  describe("fetchLinearIssue", () => {
    // These cases script `git config` through cli.run in a fixed order; the
    // rules lookup reads no project file and so consumes none of those answers.
    beforeEach(() => {
      stubProjectFile("");
      vi.spyOn(git, "gitReadBlobAtRef").mockResolvedValue({
        status: "absent-path",
      });
    });

    // D5: same shape as a Jira key; refusal is invalid_value, exit 2.
    it.each([
      "invalid",
      "123-ENG",
      "ENG-",
      "ENG-1a",
      "",
    ])("refuses the identifier %j before any call", async (id) => {
      const fetchSpy = stubFetch(respond(200, issuePayload()));
      const refusal = fetchLinearIssue(id);

      await expect(refusal).rejects.toThrow(
        `Linear: Invalid issue id "${id}".`,
      );
      await expect(refusal).rejects.toMatchObject({
        code: "invalid_value",
        oclif: { exit: 2 },
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("fails with the config hint when linear.apiKey is missing", async () => {
      stubKey("");
      const fetchSpy = stubFetch(respond(200, issuePayload()));

      await expect(fetchLinearIssue("ENG-123")).rejects.toThrow(
        'Linear: Missing config value "linear.apiKey"',
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    // D3/D4: POST to the one endpoint, the bare key in Authorization (no
    // Bearer), the id passed as a variable and never interpolated.
    it("posts the query to the Linear endpoint with the bare key and the id as a variable", async () => {
      stubKey();
      const fetchSpy = stubFetch(respond(200, issuePayload()));

      const issue = await fetchLinearIssue("eng-123");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.linear.app/graphql");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({
        "Content-Type": "application/json",
        Authorization: API_KEY,
      });
      expect(init.signal).toBeInstanceOf(AbortSignal);
      const body = JSON.parse(init.body as string);
      expect(body.variables).toEqual({ id: "ENG-123" });
      expect(body.query).toContain("$id: String!");
      expect(body.query).not.toContain("ENG-123");
      expect(issue).toEqual({
        identifier: "ENG-123",
        title: "Add dark mode",
        url: "https://linear.app/acme/issue/ENG-123/add-dark-mode",
        labels: ["Feature"],
      });
    });

    // Issue content is the branch name's input and nothing else.
    it("never asks for the description or the comments", async () => {
      stubKey();
      const fetchSpy = stubFetch(respond(200, issuePayload()));

      await fetchLinearIssue("ENG-123");

      const body = JSON.parse(
        (fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string,
      );
      expect(body.query).not.toMatch(/description|comments/i);
    });

    it("returns a null url when the API sends none", async () => {
      stubKey();
      stubFetch(respond(200, issuePayload({ url: null })));

      await expect(fetchLinearIssue("ENG-123")).resolves.toMatchObject({
        url: null,
      });
    });

    it("rejects a request that never answers, naming the call and not the key", async () => {
      stubKey();
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

      const failure = fetchLinearIssue("ENG-123");

      // TIMEOUT_MESSAGE in base-command.ts is /did not (?:answer|finish) within \d+s/
      await expect(failure).rejects.toThrow(
        "Linear: the request did not answer within 15s.",
      );
      await expect(failure).rejects.not.toThrow(/lin_api_/);
      expect(AbortSignal.timeout).toHaveBeenCalledWith(15_000);
    });

    it.each([
      401, 403,
    ])("reports an authentication failure on HTTP %i", async (status) => {
      stubKey();
      stubFetch(respond(status, {}));

      await expect(fetchLinearIssue("ENG-123")).rejects.toThrow(
        "Linear: Authentication failed. Please verify linear.apiKey in your config.",
      );
    });

    // Risk §5: Linear can answer 200 (or a 4xx with a body) with an errors
    // array for bad auth; the code is in errors[].extensions.code.
    it.each([
      200, 400,
    ])("reports an authentication failure from a GraphQL AUTHENTICATION_ERROR on HTTP %i", async (status) => {
      stubKey();
      stubFetch(
        respond(status, {
          errors: [
            {
              message: "Authentication required, not authenticated",
              extensions: {
                type: "authentication error",
                code: "AUTHENTICATION_ERROR",
              },
            },
          ],
        }),
      );

      await expect(fetchLinearIssue("ENG-123")).rejects.toThrow(
        "Linear: Authentication failed. Please verify linear.apiKey in your config.",
      );
    });

    it("reports not found with Linear's message when errors come without an issue", async () => {
      stubKey();
      stubFetch(
        respond(200, {
          data: null,
          errors: [{ message: "Entity not found: Issue" }],
        }),
      );

      await expect(fetchLinearIssue("ENG-999")).rejects.toThrow(
        "Linear: Unable to find issue ENG-999. Entity not found: Issue",
      );
    });

    it("reports not found when the issue is null and there are no errors", async () => {
      stubKey();
      stubFetch(respond(200, { data: { issue: null } }));

      await expect(fetchLinearIssue("ENG-999")).rejects.toThrow(
        "Linear: Unable to find issue ENG-999.",
      );
    });

    it("says so on HTTP 429", async () => {
      stubKey();
      stubFetch(respond(429, {}));

      await expect(fetchLinearIssue("ENG-123")).rejects.toThrow(
        "Linear: Rate limited. Linear limits requests per API key; wait a moment and try again.",
      );
    });

    // https://linear.app/developers/rate-limiting: HTTP 400, code RATELIMITED.
    it("says so on a GraphQL RATELIMITED error answered with HTTP 400", async () => {
      stubKey();
      stubFetch(
        respond(400, {
          errors: [
            {
              message: "Rate limit exceeded",
              extensions: { code: "RATELIMITED" },
            },
          ],
        }),
      );

      await expect(fetchLinearIssue("ENG-123")).rejects.toThrow(
        "Linear: Rate limited. Linear limits requests per API key; wait a moment and try again.",
      );
    });

    it("reports the status on any other non-2xx answer", async () => {
      stubKey();
      const answer = respond(500, "<html>");
      answer.statusText = "Internal Server Error";
      stubFetch(answer);

      await expect(fetchLinearIssue("ENG-123")).rejects.toThrow(
        "Linear: Failed to fetch issue ENG-123. 500 Internal Server Error",
      );
    });

    it("reports a body that is not JSON", async () => {
      stubKey();
      const answer = respond(200, null);
      answer.json.mockRejectedValue(new SyntaxError("Unexpected token <"));
      stubFetch(answer);

      await expect(fetchLinearIssue("ENG-123")).rejects.toThrow(
        "Linear: Unexpected response for issue ENG-123.",
      );
    });

    it.each([
      ["a body that is not an object", "oops"],
      ["an issue without a title", issuePayload({ title: undefined })],
      ["labels that are not a list", issuePayload({ labels: "bug" })],
    ])("reports %s", async (_name, body) => {
      stubKey();
      stubFetch(respond(200, body));

      await expect(fetchLinearIssue("ENG-123")).rejects.toThrow(
        "Linear: Unexpected response for issue ENG-123.",
      );
    });

    it("never puts the key in an error message", async () => {
      stubKey();
      stubFetch(respond(401, {}));

      await expect(fetchLinearIssue("ENG-123")).rejects.not.toThrow(/lin_api_/);
    });
  });

  // D7, chosen in the plan: bug -> bugfix; chore|maintenance -> chore; else feature.
  describe("getLinearBranchType", () => {
    it.each([
      [["Bug"], "bugfix"],
      [["bug"], "bugfix"],
      [["BUG"], "bugfix"],
      [["Chore"], "chore"],
      [["MAINTENANCE"], "chore"],
      [["maintenance"], "chore"],
      [["Feature"], "feature"],
      [["Improvement"], "feature"],
      [[], "feature"],
      [["Bug", "Chore"], "bugfix"],
      [["chore", "maintenance", "Bug"], "bugfix"],
      [["Improvement", "Chore"], "chore"],
      [["Feature", "Improvement"], "feature"],
    ] as const)("maps labels %j to %s", (labels, expected) => {
      expect(getLinearBranchType([...labels])).toBe(expected);
    });
  });

  // D6: prefix + IDENTIFIER + "-" + slugified title (cut to 48 at a word
  // boundary), "issue" when it empties.
  describe("getLinearBranchNameFromIssue", () => {
    // The scripted `git config` answers below are prefixes; the rules and
    // template lookup finds no project file and so consumes none of them.
    beforeEach(() => {
      stubProjectFile("");
      vi.spyOn(git, "gitReadBlobAtRef").mockResolvedValue({
        status: "absent-path",
      });
    });

    it("builds the name from the label prefix, the identifier and the title", async () => {
      expectCommands("git config northguild.worktree.branchPrefix.bugfix");
      vi.spyOn(cli, "run").mockResolvedValueOnce("fix/");

      const name = await getLinearBranchNameFromIssue({
        identifier: "ENG-42",
        title: "Fix login bug",
        url: null,
        labels: ["Bug"],
      });

      expect(name).toBe("fix/ENG-42-fix-login-bug");
    });

    // Plan §4's example file: bugfix: fix/ decides the expected prefix.
    it("takes the prefix from the project file when git config has none", async () => {
      stubProjectFile("branchPrefix:\n  bugfix: fix/\n");
      vi.spyOn(config, "gitGetConfigValue").mockResolvedValue("");

      const name = await getLinearBranchNameFromIssue({
        identifier: "ENG-42",
        title: "Fix login bug",
        url: null,
        labels: ["Bug"],
      });

      expect(name).toBe("fix/ENG-42-fix-login-bug");
    });

    it("prefers the personal prefix over the project file's", async () => {
      stubProjectFile("branchPrefix:\n  bugfix: fix/\n");
      vi.spyOn(config, "gitGetConfigValue").mockResolvedValue("bug/");

      const name = await getLinearBranchNameFromIssue({
        identifier: "ENG-42",
        title: "Fix login bug",
        url: null,
        labels: ["Bug"],
      });

      expect(name).toBe("bug/ENG-42-fix-login-bug");
    });

    it("uses branchPrefix.feature when no label matches", async () => {
      expectCommands("git config northguild.worktree.branchPrefix.feature");
      vi.spyOn(cli, "run").mockResolvedValueOnce("feature/");

      const name = await getLinearBranchNameFromIssue({
        identifier: "ENG-7",
        title: "Add dark mode",
        url: null,
        labels: [],
      });

      expect(name).toBe("feature/ENG-7-add-dark-mode");
    });

    it("uses branchPrefix.chore for a maintenance label", async () => {
      expectCommands("git config northguild.worktree.branchPrefix.chore");
      vi.spyOn(cli, "run").mockResolvedValueOnce("chore/");

      const name = await getLinearBranchNameFromIssue({
        identifier: "ENG-8",
        title: "Bump deps",
        url: null,
        labels: ["Maintenance"],
      });

      expect(name).toBe("chore/ENG-8-bump-deps");
    });

    it("cuts a long title to a whole-word slug of at most 48 characters", async () => {
      expectCommands("git config northguild.worktree.branchPrefix.feature");
      vi.spyOn(cli, "run").mockResolvedValueOnce("feature/");

      const name = await getLinearBranchNameFromIssue({
        identifier: "ENG-10",
        title:
          "Login redirect loops forever when the session cookie expires during a multi step checkout flow",
        url: null,
        labels: [],
      });

      expect(name).toBe(
        "feature/ENG-10-login-redirect-loops-forever-when-the-session",
      );
    });

    it('falls back to "issue" when the title leaves no slug', async () => {
      expectCommands("git config northguild.worktree.branchPrefix.feature");
      vi.spyOn(cli, "run").mockResolvedValueOnce("feature/");

      const name = await getLinearBranchNameFromIssue({
        identifier: "ENG-9",
        title: "!!!",
        url: null,
        labels: [],
      });

      expect(name).toBe("feature/ENG-9-issue");
    });
  });

  describe("branch-type rules (linear.branchType)", () => {
    const PREFIXES = `branchPrefix:
  feature: feat/
  bugfix: fix/
  chore: chore/
`;
    // The query as it was before rules existed (git show a9f8852:src/integrations/linear.ts).
    const QUERY_WITHOUT_LABEL_IDS = `query Issue($id: String!) {
  issue(id: $id) {
    identifier
    title
    url
    labels {
      nodes {
        name
      }
    }
  }
}`;

    function withRules(rules: string) {
      stubProjectFile(`${PREFIXES}linear:\n  branchType:\n${rules}`);
      vi.spyOn(config, "gitGetConfigValue").mockImplementation((name: string) =>
        Promise.resolve(name === "linear.apiKey" ? API_KEY : ""),
      );
    }

    const LABEL_RULES = `    - when: { Labels: bug }
      type: bugfix
    - when: { Labels: { id: "lbl-chore" } }
      type: chore
`;

    function linearIssue(labels: { id: string; name: string }[]) {
      return {
        identifier: "ENG-42",
        title: "Fix login bug",
        url: null,
        labels: labels.map((label) => label.name),
        labelNodes: labels,
      };
    }

    it("sends the query it always sent when no rules are set", async () => {
      stubProjectFile(PREFIXES);
      vi.spyOn(config, "gitGetConfigValue").mockImplementation((name: string) =>
        Promise.resolve(name === "linear.apiKey" ? API_KEY : ""),
      );
      const fetchSpy = stubFetch(respond(200, issuePayload()));

      const issue = await fetchLinearIssue("eng-123");

      const body = JSON.parse(
        (fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string,
      );
      expect(body.query).toBe(QUERY_WITHOUT_LABEL_IDS);
      expect(issue).toEqual({
        identifier: "ENG-123",
        title: "Add dark mode",
        url: "https://linear.app/acme/issue/ENG-123/add-dark-mode",
        labels: ["Feature"],
      });
    });

    it("asks for each label's id only when rules are set, and keeps them", async () => {
      withRules(LABEL_RULES);
      const fetchSpy = stubFetch(
        respond(
          200,
          issuePayload({
            labels: { nodes: [{ id: "lbl-chore", name: "Housekeeping" }] },
          }),
        ),
      );

      const issue = await fetchLinearIssue("eng-123");

      const body = JSON.parse(
        (fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string,
      );
      expect(body.query).toContain("nodes {\n        id\n        name");
      expect(issue.labelNodes).toEqual([
        { id: "lbl-chore", name: "Housekeeping" },
      ]);
      expect(issue.labels).toEqual(["Housekeeping"]);
    });

    // D9/D13: a dry run exists to show ids, so it asks for them with no rules.
    it("asks for each label's id on a dry run even with no rules", async () => {
      stubProjectFile(PREFIXES);
      vi.spyOn(config, "gitGetConfigValue").mockImplementation((name: string) =>
        Promise.resolve(name === "linear.apiKey" ? API_KEY : ""),
      );
      const fetchSpy = stubFetch(
        respond(
          200,
          issuePayload({
            labels: { nodes: [{ id: "lbl-1", name: "Feature" }] },
          }),
        ),
      );

      const issue = await fetchLinearIssue("eng-123", { labelIds: true });

      const body = JSON.parse(
        (fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string,
      );
      expect(body.query).toContain("nodes {\n        id\n        name");
      expect(issue.labelNodes).toEqual([{ id: "lbl-1", name: "Feature" }]);
    });

    it("refuses an answer whose label has no id when the id was asked for", async () => {
      withRules(LABEL_RULES);
      stubFetch(respond(200, issuePayload()));

      await expect(fetchLinearIssue("eng-123")).rejects.toThrow(
        "Linear: Unexpected response for issue ENG-123.",
      );
    });

    it("a label name in a rule gives its kind, and the rules replace the built-in mapping", async () => {
      withRules(`    - when: { Labels: Urgent }
      type: bugfix
`);

      // "Bug" is bugfix in the built-in mapping; here no rule names it.
      expect(
        await getLinearBranchNameFromIssue(
          linearIssue([{ id: "x", name: "Bug" }]),
        ),
      ).toBe("ENG-42-fix-login-bug");
      expect(
        await getLinearBranchNameFromIssue(
          linearIssue([{ id: "y", name: "urgent" }]),
        ),
      ).toBe("fix/ENG-42-fix-login-bug");
    });

    it("a label id in a rule gives its kind, whatever the label is called", async () => {
      withRules(LABEL_RULES);

      expect(
        await getLinearBranchNameFromIssue(
          linearIssue([{ id: "lbl-chore", name: "Housekeeping" }]),
        ),
      ).toBe("chore/ENG-42-fix-login-bug");
    });

    it("no match and no otherwise gets no prefix; otherwise: feature opts in", async () => {
      withRules(LABEL_RULES);
      const none = linearIssue([{ id: "z", name: "Improvement" }]);
      expect(await getLinearBranchNameFromIssue(none)).toBe(
        "ENG-42-fix-login-bug",
      );

      resetProjectConfigCache();
      withRules(`${LABEL_RULES}    - otherwise: feature\n`);
      expect(await getLinearBranchNameFromIssue(none)).toBe(
        "feat/ENG-42-fix-login-bug",
      );
    });

    it("warns, naming the rule and the field, for a field Linear does not have (D11)", async () => {
      withRules(`    - when: { Team: Core }
      type: bugfix
`);
      const warnings: string[] = [];

      await getLinearBranchNameFromIssue(linearIssue([]), (w) =>
        warnings.push(w),
      );

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("Rule 1 of linear.branchType");
      expect(warnings[0]).toContain('"Team"');
    });

    it("applies the branchName template", async () => {
      stubProjectFile(`${PREFIXES}branchName: "{prefix}{slug}-{id}"\n`);
      vi.spyOn(config, "gitGetConfigValue").mockResolvedValue("");

      expect(
        await getLinearBranchNameFromIssue({
          identifier: "ENG-42",
          title: "Fix login bug",
          url: null,
          labels: ["Bug"],
        }),
      ).toBe("fix/fix-login-bug-ENG-42");
    });

    it("the default template reproduces today's name", async () => {
      stubProjectFile(`${PREFIXES}branchName: "{prefix}{id}-{slug}"\n`);
      vi.spyOn(config, "gitGetConfigValue").mockResolvedValue("");

      expect(
        await getLinearBranchNameFromIssue({
          identifier: "ENG-42",
          title: "Fix login bug",
          url: null,
          labels: ["Bug"],
        }),
      ).toBe("fix/ENG-42-fix-login-bug");
    });
  });

  describe("validateLinearCredentials", () => {
    it("is true when the viewer query succeeds", async () => {
      stubKey();
      const fetchSpy = stubFetch(
        respond(200, { data: { viewer: { id: "user-1" } } }),
      );

      await expect(validateLinearCredentials()).resolves.toBe(true);
      const body = JSON.parse(
        (fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string,
      );
      expect(body.query).toContain("viewer");
    });

    it("is false on an HTTP 401", async () => {
      stubKey();
      stubFetch(respond(401, {}));

      await expect(validateLinearCredentials()).resolves.toBe(false);
    });

    it("is false on a GraphQL error answered with HTTP 200", async () => {
      stubKey();
      stubFetch(
        respond(200, { errors: [{ message: "Authentication required" }] }),
      );

      await expect(validateLinearCredentials()).resolves.toBe(false);
    });

    it("is false when the key is missing", async () => {
      stubKey("");

      await expect(validateLinearCredentials()).resolves.toBe(false);
    });
  });
});

// Phase 5 (#181): Linear's rule field is `Labels`, with ids (D9).
describe("getLinearBranchNaming", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("names the rule that matched a label by id, and lists the label with its id", async () => {
    resetProjectConfigCache();
    stubProjectFile(`branchPrefix:
  chore: chore/
linear:
  branchType:
    - when: { Labels: { id: "lbl-chore" } }
      type: chore
`);
    vi.spyOn(config, "gitGetConfigValue").mockResolvedValue("");

    const naming = await getLinearBranchNaming({
      identifier: "ENG-42",
      title: "Tidy",
      url: null,
      labels: ["Housekeeping"],
      labelNodes: [{ id: "lbl-chore", name: "Housekeeping" }],
    });

    expect(naming.branchName).toBe("chore/ENG-42-tidy");
    expect(naming.match).toMatchObject({ source: "rule", position: 1 });
    expect(naming.fields).toEqual([
      {
        id: "Labels",
        name: "Labels",
        values: [{ id: "lbl-chore", name: "Housekeeping" }],
      },
    ]);
  });
});

// Linear's schema: Issue.state, Issue.team, Team.states(filter:) and
// IssuePayload (https://linear.app/developers/graphql).
function stateNode(id: string, name: string, position: number) {
  return { id, name, position };
}

function startReadPayload(
  state: { id: string; name: string; type: string },
  nodes: unknown[] = [stateNode("s-1", "In Progress", 1)],
) {
  return {
    data: {
      issue: {
        identifier: "ENG-123",
        state,
        team: { states: { nodes } },
      },
    },
  };
}

function writePayload(
  success: boolean,
  state: { id: string; name: string; type: string },
) {
  return { data: { issueUpdate: { success, issue: { state } } } };
}

const TODO = { id: "t-1", name: "Todo", type: "unstarted" };
const BACKLOG = { id: "b-1", name: "Backlog", type: "backlog" };

function stubFetchSequence(...responses: unknown[]) {
  const fetchSpy = vi.fn();
  for (const response of responses) {
    fetchSpy.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

describe("startLinearIssue", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProjectConfigCache();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const requestBody = (fetchSpy: ReturnType<typeof vi.fn>, call: number) =>
    JSON.parse(fetchSpy.mock.calls[call][1].body);

  it("sends a read and a write with the bare key and variables only", async () => {
    stubKey();
    const fetchSpy = stubFetchSequence(
      respond(200, startReadPayload(TODO)),
      respond(
        200,
        writePayload(true, { id: "s-1", name: "In Progress", type: "started" }),
      ),
    );

    await startLinearIssue("eng-123");

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const call of fetchSpy.mock.calls) {
      expect(call[0]).toBe("https://api.linear.app/graphql");
      expect(call[1].method).toBe("POST");
      expect(call[1].headers.Authorization).toBe(API_KEY);
    }
    const read = requestBody(fetchSpy, 0);
    expect(read.variables).toEqual({ id: "ENG-123" });
    expect(read.query).not.toContain("ENG-123");
    expect(read.query).toContain("state { id name type }");
    expect(read.query).toContain("nodes { id name position }");
    expect(read.query).toContain('states(filter: { type: { eq: "started" } })');
    const write = requestBody(fetchSpy, 1);
    expect(write.variables).toEqual({ id: "ENG-123", stateId: "s-1" });
    expect(write.query).not.toContain("ENG-123");
    expect(write.query).toContain(
      "issueUpdate(id: $id, input: { stateId: $stateId })",
    );
    expect(write.query).toContain("success");
    expect(write.query).toContain("issue { state { id name type } }");
  });

  it.each([
    ["backlog", BACKLOG],
    ["unstarted", TODO],
  ])("moves a %s issue to the lowest-position started state", async (_name, from) => {
    stubKey();
    const fetchSpy = stubFetchSequence(
      respond(
        200,
        startReadPayload(from, [
          stateNode("s-3", "Third", 30),
          stateNode("s-1", "First", 10),
          stateNode("s-2", "Second", 20),
        ]),
      ),
      respond(
        200,
        writePayload(true, { id: "s-1", name: "First", type: "started" }),
      ),
    );

    await expect(startLinearIssue("ENG-123")).resolves.toEqual({
      outcome: "started",
      from: from.name,
      to: "First",
    });
    expect(requestBody(fetchSpy, 1).variables.stateId).toBe("s-1");
  });

  it("takes the first node on a position tie", async () => {
    stubKey();
    const fetchSpy = stubFetchSequence(
      respond(
        200,
        startReadPayload(TODO, [
          stateNode("s-a", "A", 5),
          stateNode("s-b", "B", 5),
        ]),
      ),
      respond(
        200,
        writePayload(true, { id: "s-a", name: "A", type: "started" }),
      ),
    );

    await startLinearIssue("ENG-123");

    expect(requestBody(fetchSpy, 1).variables.stateId).toBe("s-a");
  });

  it("reports an issue already started and sends no mutation", async () => {
    stubKey();
    const fetchSpy = stubFetchSequence(
      respond(
        200,
        startReadPayload({ id: "r-1", name: "In Review", type: "started" }),
      ),
    );

    await expect(startLinearIssue("ENG-123")).resolves.toEqual({
      outcome: "already-started",
      state: "In Review",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    "triage",
    "completed",
    "canceled",
    "duplicate",
  ])("leaves a %s issue alone and sends no mutation", async (type) => {
    stubKey();
    const fetchSpy = stubFetchSequence(
      respond(200, startReadPayload({ id: "x-1", name: "Some state", type })),
    );

    await expect(startLinearIssue("ENG-123")).resolves.toEqual({
      outcome: "left-alone",
      state: "Some state",
      type,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("reports a team with no started state and sends no mutation", async () => {
    stubKey();
    const fetchSpy = stubFetchSequence(
      respond(200, startReadPayload(TODO, [])),
    );

    await expect(startLinearIssue("ENG-123")).resolves.toEqual({
      outcome: "no-started-state",
      state: "Todo",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  describe("failures", () => {
    const started = { id: "s-1", name: "In Progress", type: "started" };

    async function failure(...responses: unknown[]) {
      stubKey();
      stubFetchSequence(...responses);
      const error = await startLinearIssue("ENG-123").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Error);
      const { message } = error as Error;
      expect(message).toMatch(/^Linear:/);
      expect(message).not.toContain(API_KEY);
      return message;
    }

    it("refuses an invalid id before any request", async () => {
      const fetchSpy = stubFetchSequence();

      await expect(startLinearIssue("not an id")).rejects.toThrow(
        'Linear: Invalid issue id "not an id".',
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("fails on success false", async () => {
      const message = await failure(
        respond(200, startReadPayload(TODO)),
        respond(200, writePayload(false, started)),
      );

      expect(message).toContain("did not confirm");
    });

    it("fails when the returned state is not the chosen one", async () => {
      const message = await failure(
        respond(200, startReadPayload(TODO)),
        respond(
          200,
          writePayload(true, { id: "other", name: "Other", type: "started" }),
        ),
      );

      expect(message).toContain("did not confirm");
    });

    it("fails on GraphQL errors on the read", async () => {
      const message = await failure(
        respond(200, { data: null, errors: [{ message: "Entity not found" }] }),
      );

      expect(message).toBe(
        "Linear: Unable to find issue ENG-123. Entity not found",
      );
    });

    it("fails on GraphQL errors on the write, with the permission hint", async () => {
      const message = await failure(
        respond(200, startReadPayload(TODO)),
        respond(200, { data: null, errors: [{ message: "forbidden" }] }),
      );

      expect(message).toContain("forbidden");
      expect(message).toContain("Write permission");
      expect(message).toContain("access to the issue's team");
    });

    it("carries Linear's message and the hint on a non-2xx write", async () => {
      const message = await failure(
        respond(200, startReadPayload(TODO)),
        respond(400, { errors: [{ message: "Not allowed" }] }),
      );

      expect(message).toContain("Not allowed");
      expect(message).toContain("Write permission");
    });

    it("keeps the HTTP status on a non-2xx write with no body, without the hint", async () => {
      const message = await failure(
        respond(200, startReadPayload(TODO)),
        respond(500, {}),
      );

      expect(message).toBe("Linear: Failed to move issue ENG-123. 500.");
    });

    it("keeps the HTTP status on a non-2xx read with no body", async () => {
      const message = await failure(respond(502, {}));

      expect(message).toBe("Linear: Failed to fetch issue ENG-123. 502.");
    });

    it("separates Linear's text from the hint with a full stop", async () => {
      const message = await failure(
        respond(200, startReadPayload(TODO)),
        respond(200, { data: null, errors: [{ message: "forbidden" }] }),
      );

      expect(message).toBe(
        "Linear: Failed to move issue ENG-123. forbidden. Moving an issue needs a key with the Write permission and access to the issue's team.",
      );
    });

    it("reuses the authentication message on HTTP 401", async () => {
      const message = await failure(respond(401, {}));

      expect(message).toBe(
        "Linear: Authentication failed. Please verify linear.apiKey in your config.",
      );
    });

    it("reuses the authentication message on AUTHENTICATION_ERROR", async () => {
      const message = await failure(
        respond(200, startReadPayload(TODO)),
        respond(200, {
          errors: [{ extensions: { code: "AUTHENTICATION_ERROR" } }],
        }),
      );

      expect(message).toBe(
        "Linear: Authentication failed. Please verify linear.apiKey in your config. Moving an issue needs a key with the Write permission and access to the issue's team.",
      );
    });

    it.each([
      401, 403,
    ])("follows the authentication message with the permission hint on an HTTP %i write", async (status) => {
      const message = await failure(
        respond(200, startReadPayload(TODO)),
        respond(status, {}),
      );

      expect(message).toBe(
        "Linear: Authentication failed. Please verify linear.apiKey in your config. Moving an issue needs a key with the Write permission and access to the issue's team.",
      );
    });

    it("reuses the rate-limit message on HTTP 429", async () => {
      const message = await failure(respond(429, {}));

      expect(message).toContain("Rate limited");
    });

    it("reuses the rate-limit message on RATELIMITED", async () => {
      const message = await failure(
        respond(200, startReadPayload(TODO)),
        respond(400, { errors: [{ extensions: { code: "RATELIMITED" } }] }),
      );

      expect(message).toContain("Rate limited");
    });

    it("names Linear when the mutation times out", async () => {
      stubKey();
      const timeout = Object.assign(new Error("aborted"), {
        name: "TimeoutError",
      });
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(respond(200, startReadPayload(TODO)))
        .mockRejectedValueOnce(timeout);
      vi.stubGlobal("fetch", fetchSpy);

      const error = await startLinearIssue("ENG-123").catch((e: unknown) => e);

      expect((error as Error).message).toBe(
        "Linear: the request did not answer within 15s.",
      );
    });

    // The fetch signal also bounds the body: headers in time and a body that
    // stalls past 15s rejects response.json() with the signal's TimeoutError.
    it("reports a body that stalls past the timeout as a timeout", async () => {
      stubKey();
      const answer = respond(200, null);
      answer.json.mockRejectedValue(
        new DOMException("timed out", "TimeoutError"),
      );
      stubFetch(answer);

      await expect(fetchLinearIssue("ENG-123")).rejects.toThrow(
        "Linear: the request did not answer within 15s.",
      );
    });

    it("fails on a malformed body", async () => {
      const message = await failure(
        respond(200, { data: { issue: { identifier: "ENG-123" } } }),
      );

      expect(message).toBe("Linear: Unexpected response for issue ENG-123.");
    });

    it("fails on a started node without a numeric position", async () => {
      const message = await failure(
        respond(
          200,
          startReadPayload(TODO, [{ id: "s-1", name: "X", position: "1" }]),
        ),
      );

      expect(message).toContain("Unexpected response");
    });
  });
});

// The shared top-level `branchType` list (#128, D1). Expected names come from
// the plan's Phase 1 "Done when" and the built-in mapping above (a `Bug` label
// is `fix/`, a Linear issue with no matching label is `feat/`).
describe("the shared branchType list for Linear", () => {
  const PREFIXES = `branchPrefix:
  feature: feat/
  bugfix: fix/
  chore: chore/
`;
  const SHARED = `branchType:
  - when: { Labels: chore }
    type: chore
`;
  const OWN = `linear:
  branchType:
    - when: { Labels: chore }
      type: feature
`;

  const linearIssue = (labels: string[]) => ({
    identifier: "ENG-42",
    title: "Tidy",
    url: null,
    labels,
  });

  function projectFile(content: string) {
    resetProjectConfigCache();
    stubProjectFile(content);
    vi.spyOn(config, "gitGetConfigValue").mockImplementation((name: string) =>
      Promise.resolve(name === "linear.apiKey" ? API_KEY : ""),
    );
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("neither list: today's built-in mapping", async () => {
    projectFile(PREFIXES);

    expect(
      (await getLinearBranchNaming(linearIssue(["Bug", "chore"]))).branchName,
    ).toBe("fix/ENG-42-tidy");
  });

  it("shared list only: a rule-matched issue gets its rule's prefix", async () => {
    projectFile(PREFIXES + SHARED);

    const naming = await getLinearBranchNaming(linearIssue(["chore"]));

    expect(naming.branchName).toBe("chore/ENG-42-tidy");
    expect(naming.match).toMatchObject({ source: "rule", position: 1 });
  });

  it("shared list only: it replaces the built-in mapping, with no fall-through on no match", async () => {
    projectFile(PREFIXES + SHARED);

    const naming = await getLinearBranchNaming(linearIssue(["Bug"]));

    expect(naming.branchName).toBe("ENG-42-tidy");
    expect(naming.match).toEqual({ source: "none" });
  });

  it("both lists: the provider's wins", async () => {
    projectFile(PREFIXES + OWN + SHARED);

    expect(
      (await getLinearBranchNaming(linearIssue(["chore"]))).branchName,
    ).toBe("feat/ENG-42-tidy");
  });

  const PORTABLE = `branchType:
  - when: { Type: Bug }
    type: bugfix
  - when: { Labels: bug }
    type: bugfix
`;

  // Plan Phase 2 "Done when": the portable list gives fix/ on a `bug` label.
  it("the portable list gives fix/ on a bug-labelled issue, and a Type rule is silent here", async () => {
    projectFile(PREFIXES + PORTABLE);
    const warnings: string[] = [];

    const naming = await getLinearBranchNaming(linearIssue(["bug"]), (w) =>
      warnings.push(w),
    );

    expect(naming.branchName).toBe("fix/ENG-42-tidy");
    expect(naming.match).toMatchObject({ source: "rule", position: 2 });
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

    await getLinearBranchNaming(linearIssue(["bug"]), (w) => real.push(w));
    await getLinearBranchNaming(linearIssue(["bug"]), (w) => dry.push(w), true);

    expect(real).toEqual([]);
    expect(dry).toHaveLength(1);
    expect(dry[0]).toContain("Rule 1 of branchType names");
  });

  // D5: Linear has no Type, so a provider list naming it is still a mistake.
  it("a linear.branchType naming Type still warns", async () => {
    projectFile(
      `${PREFIXES}linear:\n  branchType:\n    - when: { Type: Bug }\n      type: bugfix\n`,
    );
    const warnings: string[] = [];

    await getLinearBranchNaming(linearIssue(["bug"]), (w) => warnings.push(w));

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Rule 1 of linear.branchType");
  });

  it("asks for each label's id when only the shared list is set", async () => {
    projectFile(PREFIXES + SHARED);
    const fetchSpy = stubFetch(
      respond(
        200,
        issuePayload({
          labels: { nodes: [{ id: "lbl-chore", name: "Housekeeping" }] },
        }),
      ),
    );

    await fetchLinearIssue("eng-123");

    const body = JSON.parse(
      (fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string,
    );
    expect(body.query).toContain("nodes {\n        id\n        name");
  });
});

// Linear's schema: User.assignedIssues returns an IssueConnection, whose
// `nodes` are issues and whose `pageInfo.hasNextPage` is a Boolean
// (https://studio.apollographql.com/public/Linear-API/variant/current/schema/reference/objects/IssueConnection).
const ASSIGNED_NODE = {
  identifier: "ENG-1",
  title: "Fix login",
  state: { name: "In Progress", type: "started" },
};

function assignedPayload(nodes: unknown[], hasNextPage = false) {
  return {
    data: {
      viewer: { assignedIssues: { nodes, pageInfo: { hasNextPage } } },
    },
  };
}

describe("listAssignedLinearIssues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProjectConfigCache();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const UNEXPECTED = "Linear: Unexpected response fetching your issues.";

  it("maps a two-node answer to the returned shape", async () => {
    stubKey();
    stubFetch(
      respond(
        200,
        assignedPayload([
          ASSIGNED_NODE,
          {
            identifier: "ENG-2",
            title: "Add search",
            state: { name: "Todo", type: "unstarted" },
            extra: "ignored",
          },
        ]),
      ),
    );

    await expect(listAssignedLinearIssues()).resolves.toEqual({
      issues: [
        {
          identifier: "ENG-1",
          title: "Fix login",
          state: { name: "In Progress", type: "started" },
        },
        {
          identifier: "ENG-2",
          title: "Add search",
          state: { name: "Todo", type: "unstarted" },
        },
      ],
      hasMore: false,
    });
  });

  it.each([true, false])("reports hasNextPage %s as hasMore", async (more) => {
    stubKey();
    stubFetch(respond(200, assignedPayload([ASSIGNED_NODE], more)));

    const { hasMore } = await listAssignedLinearIssues();

    expect(hasMore).toBe(more);
  });

  it("returns an empty list for empty nodes", async () => {
    stubKey();
    stubFetch(respond(200, assignedPayload([])));

    await expect(listAssignedLinearIssues()).resolves.toEqual({
      issues: [],
      hasMore: false,
    });
  });

  it.each([
    ["identifier", { ...ASSIGNED_NODE, identifier: undefined }],
    ["title", { ...ASSIGNED_NODE, title: undefined }],
    ["state name", { ...ASSIGNED_NODE, state: { type: "started" } }],
    ["state type", { ...ASSIGNED_NODE, state: { name: "In Progress" } }],
    ["state", { ...ASSIGNED_NODE, state: null }],
  ])("rejects the whole answer when a node lacks its %s", async (_field, bad) => {
    stubKey();
    stubFetch(respond(200, assignedPayload([ASSIGNED_NODE, bad])));

    await expect(listAssignedLinearIssues()).rejects.toThrow(UNEXPECTED);
  });

  it.each([
    ["missing pageInfo", { nodes: [] }],
    [
      "non-boolean hasNextPage",
      { nodes: [], pageInfo: { hasNextPage: "yes" } },
    ],
    ["missing nodes", { pageInfo: { hasNextPage: false } }],
    ["non-array nodes", { nodes: {}, pageInfo: { hasNextPage: false } }],
  ])("rejects an answer with %s", async (_case, assignedIssues) => {
    stubKey();
    stubFetch(respond(200, { data: { viewer: { assignedIssues } } }));

    await expect(listAssignedLinearIssues()).rejects.toThrow(UNEXPECTED);
  });

  it("keeps Linear's message when a 200 carries GraphQL errors", async () => {
    stubKey();
    stubFetch(respond(200, { data: null, errors: [{ message: "forbidden" }] }));

    await expect(listAssignedLinearIssues()).rejects.toThrow(
      "Linear: Failed to fetch your issues. forbidden",
    );
  });

  it("rejects a 200 whose valid data comes with GraphQL errors", async () => {
    stubKey();
    stubFetch(
      respond(200, {
        ...assignedPayload([ASSIGNED_NODE]),
        errors: [{ message: "forbidden" }],
      }),
    );

    await expect(listAssignedLinearIssues()).rejects.toThrow(
      "Linear: Failed to fetch your issues. forbidden",
    );
  });

  it("keeps Linear's message on a non-2xx answer", async () => {
    stubKey();
    stubFetch(respond(400, { errors: [{ message: "Not allowed" }] }));

    await expect(listAssignedLinearIssues()).rejects.toThrow(
      "Linear: Failed to fetch your issues. 400. Not allowed.",
    );
  });

  it("reports an unreadable body as unexpected", async () => {
    stubKey();
    stubFetch({
      ok: true,
      status: 200,
      statusText: "",
      json: vi.fn().mockRejectedValue(new SyntaxError("bad json")),
    });

    await expect(listAssignedLinearIssues()).rejects.toThrow(UNEXPECTED);
  });

  it("fails on a 401 with the authentication message", async () => {
    stubKey();
    stubFetch(respond(401, {}));

    await expect(listAssignedLinearIssues()).rejects.toThrow(
      "Linear: Authentication failed. Please verify linear.apiKey in your config.",
    );
  });

  it("fails on an AUTHENTICATION_ERROR body with the authentication message", async () => {
    stubKey();
    stubFetch(
      respond(200, {
        errors: [{ extensions: { code: "AUTHENTICATION_ERROR" } }],
      }),
    );

    await expect(listAssignedLinearIssues()).rejects.toThrow(
      "Linear: Authentication failed. Please verify linear.apiKey in your config.",
    );
  });

  it("fails on a RATELIMITED body with the rate-limit message", async () => {
    stubKey();
    stubFetch(
      respond(400, { errors: [{ extensions: { code: "RATELIMITED" } }] }),
    );

    await expect(listAssignedLinearIssues()).rejects.toThrow(
      "Linear: Rate limited.",
    );
  });

  it("fails on a non-2xx answer with the status", async () => {
    stubKey();
    stubFetch({ ...respond(500, {}), statusText: "Server Error" });

    await expect(listAssignedLinearIssues()).rejects.toThrow(
      "Linear: Failed to fetch your issues. 500 Server Error.",
    );
  });

  it("sends a constant query with no variables and the bare key", async () => {
    stubKey();
    const fetchSpy = stubFetch(respond(200, assignedPayload([])));

    await listAssignedLinearIssues();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.linear.app/graphql");
    expect(init.headers.Authorization).toBe(API_KEY);
    const body = JSON.parse(init.body);
    expect(body.variables).toEqual({});
    // Expected text from the plan's section 4 query, which is built from
    // User.assignedIssues(first, orderBy, filter) and WorkflowStateFilter.type's
    // values "unstarted" and "started" in Linear's schema reference.
    expect(body.query.replace(/\s+/g, " ")).toBe(
      'query { viewer { assignedIssues( first: 50 orderBy: updatedAt filter: { state: { type: { in: ["unstarted", "started"] } } } ) { nodes { identifier title state { name type } } pageInfo { hasNextPage } } } }',
    );
    expect(body.query).not.toContain("$");
  });
});
