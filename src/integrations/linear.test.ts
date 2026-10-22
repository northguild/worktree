import * as cli from "../lib/cli.js";
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

describe("Linear integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
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

  // D6: prefix + IDENTIFIER + "-" + sanitized title, "issue" when it empties.
  describe("getLinearBranchNameFromIssue", () => {
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
