import * as cli from "../lib/cli.js";
import * as git from "../lib/git.js";
import { resetProjectConfigCache } from "../lib/project-config.js";
import { expectCommands } from "../test-setup.js";
import {
  fetchLinearIssue,
  getLinearBranchNameFromIssue,
  getLinearBranchType,
  resolveLinearApiKey,
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
      vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("");

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
      vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("bug/");

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
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((name: string) =>
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
      vi.spyOn(git, "gitGetConfigValue").mockImplementation((name: string) =>
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
      vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("");

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
      vi.spyOn(git, "gitGetConfigValue").mockResolvedValue("");

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
