import * as cli from "../lib/cli.js";
import { expectCommands } from "../test-setup.js";
import {
  fetchClickUpTask,
  getClickUpBranchNameFromTask,
  getClickUpBranchType,
  parseClickUpTaskId,
  resolveClickUpToken,
  resolveClickUpWorkspaceId,
} from "./clickup.js";

// Built at runtime: a literal in this shape trips GitHub push protection.
const TOKEN = `pk_${"AbCdEf0123".repeat(3)}`;

// The fields ClickUp's Get Task answers with that this client reads
// (https://developer.clickup.com/reference/gettask).
function taskPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: "9hx",
    custom_id: null,
    name: "Add dark mode",
    url: "https://app.clickup.com/t/9hx",
    tags: [{ name: "Feature" }],
    ...overrides,
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

function stubToken(value = TOKEN) {
  expectCommands("git config northguild.worktree.clickup.apiToken");
  vi.spyOn(cli, "run").mockResolvedValueOnce(value);
}

function stubTokenAndWorkspace(workspaceId: string, token = TOKEN) {
  expectCommands(
    "git config northguild.worktree.clickup.apiToken",
    "git config northguild.worktree.clickup.workspaceId",
  );
  vi.spyOn(cli, "run")
    .mockResolvedValueOnce(token)
    .mockResolvedValueOnce(workspaceId);
}

describe("ClickUp integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  // D3: a short id has no hyphen and keeps its case; a custom id is
  // PREFIX-<digits>; anything else is invalid_value, exit 2.
  describe("parseClickUpTaskId", () => {
    it.each([
      ["9hx", { kind: "short", id: "9hx" }],
      ["86a1B2c3d", { kind: "short", id: "86a1B2c3d" }],
      ["  9hx  ", { kind: "short", id: "9hx" }],
      ["DEV-123", { kind: "custom", id: "DEV-123" }],
      ["dev-7", { kind: "custom", id: "dev-7" }],
    ] as const)("reads %j", (input, expected) => {
      expect(parseClickUpTaskId(input)).toEqual(expected);
    });

    it.each([
      "",
      "   ",
      "DEV-",
      "-123",
      "123-DEV",
      "DEV-1a",
      "DEV--1",
      "a b",
      "9hx/../team",
      "9hx?x=1",
      "9hx#frag",
      "CU-9hx",
    ])("refuses %j", (input) => {
      expect(() => parseClickUpTaskId(input)).toThrow(
        `ClickUp: Invalid task id "${input}".`,
      );
      try {
        parseClickUpTaskId(input);
      } catch (error) {
        expect(error).toMatchObject({
          code: "invalid_value",
          oclif: { exit: 2 },
        });
      }
    });
  });

  describe("resolveClickUpToken", () => {
    it("reads clickup.apiToken from git config", async () => {
      stubToken();

      await expect(resolveClickUpToken()).resolves.toBe(TOKEN);
    });

    it("tells the user to run worktree config when the token is missing", async () => {
      stubToken("");

      await expect(resolveClickUpToken()).rejects.toThrow(
        'ClickUp: Missing config value "clickup.apiToken". Run "worktree config" to configure ClickUp integration.',
      );
    });
  });

  describe("resolveClickUpWorkspaceId", () => {
    it("reads clickup.workspaceId from git config", async () => {
      expectCommands("git config northguild.worktree.clickup.workspaceId");
      vi.spyOn(cli, "run").mockResolvedValueOnce("9012345");

      await expect(resolveClickUpWorkspaceId()).resolves.toBe("9012345");
    });

    it("is undefined when it is not set", async () => {
      expectCommands("git config northguild.worktree.clickup.workspaceId");
      vi.spyOn(cli, "run").mockResolvedValueOnce("");

      await expect(resolveClickUpWorkspaceId()).resolves.toBeUndefined();
    });
  });

  describe("fetchClickUpTask", () => {
    it.each([
      "DEV-",
      "a b",
      "",
    ])("refuses the id %j before any call", async (id) => {
      const fetchSpy = stubFetch(respond(200, taskPayload()));
      const refusal = fetchClickUpTask(id);

      await expect(refusal).rejects.toThrow(
        `ClickUp: Invalid task id "${id}".`,
      );
      await expect(refusal).rejects.toMatchObject({
        code: "invalid_value",
        oclif: { exit: 2 },
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("fails with the config hint when clickup.apiToken is missing", async () => {
      stubToken("");
      const fetchSpy = stubFetch(respond(200, taskPayload()));

      await expect(fetchClickUpTask("9hx")).rejects.toThrow(
        'ClickUp: Missing config value "clickup.apiToken"',
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    // D3/D4/D5: GET the one task URL, the bare token in Authorization (no
    // Bearer), and no query for a short id.
    it("gets the task with the bare token and no query for a short id", async () => {
      stubToken();
      const fetchSpy = stubFetch(respond(200, taskPayload()));

      const task = await fetchClickUpTask("9hx");

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.clickup.com/api/v2/task/9hx");
      expect(init.method).toBe("GET");
      expect(init.headers).toEqual({
        "Content-Type": "application/json",
        Authorization: TOKEN,
      });
      expect(init.body).toBeUndefined();
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(task).toEqual({
        id: "9hx",
        customId: null,
        name: "Add dark mode",
        url: "https://app.clickup.com/t/9hx",
        tags: ["Feature"],
      });
    });

    it("keeps the case of a short id in the URL", async () => {
      stubToken();
      const fetchSpy = stubFetch(respond(200, taskPayload({ id: "86aB" })));

      await fetchClickUpTask("86aB");

      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        "https://api.clickup.com/api/v2/task/86aB",
      );
    });

    // D3: custom_task_ids and team_id travel with a custom id, and only then.
    it("adds custom_task_ids and the workspace id for a custom id", async () => {
      stubTokenAndWorkspace("9012345");
      const fetchSpy = stubFetch(
        respond(200, taskPayload({ custom_id: "DEV-123" })),
      );

      const task = await fetchClickUpTask("DEV-123");

      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        "https://api.clickup.com/api/v2/task/DEV-123?custom_task_ids=true&team_id=9012345",
      );
      expect(task.customId).toBe("DEV-123");
    });

    it("never reads the workspace id for a short id", async () => {
      stubToken();
      stubFetch(respond(200, taskPayload()));

      await fetchClickUpTask("9hx");

      expect(vi.mocked(cli.run)).toHaveBeenCalledTimes(1);
    });

    it("asks for the workspace id when a custom id has none, before any call", async () => {
      stubTokenAndWorkspace("");
      const fetchSpy = stubFetch(respond(200, taskPayload()));
      const failure = fetchClickUpTask("DEV-123");

      await expect(failure).rejects.toThrow(/clickup\.workspaceId/);
      await expect(failure).rejects.toMatchObject({
        name: "MissingValueError",
        oclif: { exit: 2 },
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    // An id that passed the closed pattern needs no encoding today; the
    // workspace id comes from config and can hold anything `git config` does.
    it("encodes the workspace id placed in the query", async () => {
      stubTokenAndWorkspace("1&custom_task_ids=false");
      const fetchSpy = stubFetch(respond(200, taskPayload()));

      await fetchClickUpTask("DEV-1");

      expect(fetchSpy.mock.calls[0]?.[0]).toBe(
        "https://api.clickup.com/api/v2/task/DEV-1?custom_task_ids=true&team_id=1%26custom_task_ids%3Dfalse",
      );
    });

    // Task content is the branch name's input and nothing else.
    it("never asks for subtasks, the description or comments", async () => {
      stubToken();
      const fetchSpy = stubFetch(respond(200, taskPayload()));

      await fetchClickUpTask("9hx");

      expect(fetchSpy.mock.calls[0]?.[0]).not.toMatch(
        /subtasks|description|comment/i,
      );
    });

    it("does not return fields the branch name does not need", async () => {
      stubToken();
      stubFetch(
        respond(
          200,
          taskPayload({
            description: "secret plans",
            text_content: "secret plans",
            comments: ["x"],
          }),
        ),
      );

      const task = await fetchClickUpTask("9hx");

      expect(Object.keys(task).sort()).toEqual([
        "customId",
        "id",
        "name",
        "tags",
        "url",
      ]);
    });

    it("returns a null url when the API sends none", async () => {
      stubToken();
      stubFetch(respond(200, taskPayload({ url: undefined })));

      await expect(fetchClickUpTask("9hx")).resolves.toMatchObject({
        url: null,
      });
    });

    it("treats an empty custom_id as none", async () => {
      stubToken();
      stubFetch(respond(200, taskPayload({ custom_id: "" })));

      await expect(fetchClickUpTask("9hx")).resolves.toMatchObject({
        customId: null,
      });
    });

    it("rejects a request that never answers, naming the call and not the token", async () => {
      stubToken();
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

      const failure = fetchClickUpTask("9hx");

      // TIMEOUT_MESSAGE in base-command.ts is /did not (?:answer|finish) within \d+s/
      await expect(failure).rejects.toThrow(
        "ClickUp: the request did not answer within 15s.",
      );
      await expect(failure).rejects.not.toThrow(/pk_/);
      expect(AbortSignal.timeout).toHaveBeenCalledWith(15_000);
    });

    it.each([
      401, 403,
    ])("reports an authentication failure on HTTP %i", async (status) => {
      stubToken();
      stubFetch(respond(status, {}));

      await expect(fetchClickUpTask("9hx")).rejects.toThrow(
        "ClickUp: Authentication failed. Please verify clickup.apiToken in your config.",
      );
    });

    it("reports not found on HTTP 404", async () => {
      stubToken();
      stubFetch(respond(404, { err: "Task not found", ECODE: "ITEM_015" }));

      await expect(fetchClickUpTask("9hx")).rejects.toThrow(
        "ClickUp: Unable to find task 9hx.",
      );
    });

    it("says so on HTTP 429", async () => {
      stubToken();
      stubFetch(respond(429, {}));

      await expect(fetchClickUpTask("9hx")).rejects.toThrow(
        "ClickUp: Rate limited. ClickUp limits requests per API token; wait a moment and try again.",
      );
    });

    it("reports the status on any other non-2xx answer", async () => {
      stubToken();
      const answer = respond(500, "<html>");
      answer.statusText = "Internal Server Error";
      stubFetch(answer);

      await expect(fetchClickUpTask("9hx")).rejects.toThrow(
        "ClickUp: Failed to fetch task 9hx. 500 Internal Server Error",
      );
    });

    it("reports a body that is not JSON", async () => {
      stubToken();
      const answer = respond(200, null);
      answer.json.mockRejectedValue(new SyntaxError("Unexpected token <"));
      stubFetch(answer);

      await expect(fetchClickUpTask("9hx")).rejects.toThrow(
        "ClickUp: Unexpected response for task 9hx.",
      );
    });

    it.each([
      ["a body that is not an object", "oops"],
      ["a list", []],
      ["a task without a name", taskPayload({ name: undefined })],
      ["a task without an id", taskPayload({ id: undefined })],
      ["tags that are not a list", taskPayload({ tags: "bug" })],
      ["a tag without a name", taskPayload({ tags: [{}] })],
    ])("reports %s", async (_name, body) => {
      stubToken();
      stubFetch(respond(200, body));

      await expect(fetchClickUpTask("9hx")).rejects.toThrow(
        "ClickUp: Unexpected response for task 9hx.",
      );
    });

    it("never puts the token in an error message", async () => {
      stubToken();
      stubFetch(respond(401, {}));

      await expect(fetchClickUpTask("9hx")).rejects.not.toThrow(/pk_/);
    });
  });

  // D7, chosen in the plan: bug -> bugfix; chore|maintenance -> chore; else feature.
  describe("getClickUpBranchType", () => {
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
    ] as const)("maps tags %j to %s", (tags, expected) => {
      expect(getClickUpBranchType([...tags])).toBe(expected);
    });
  });

  // D6: prefix + (CU-<id> | CUSTOM-ID) + "-" + slugified name (cut to 48 at a
  // word boundary), "issue" when it empties.
  describe("getClickUpBranchNameFromTask", () => {
    const task = {
      id: "9hx",
      customId: null,
      name: "Fix login bug",
      url: null,
      tags: ["Bug"],
    };

    it("builds the name from the tag prefix, CU-<id> and the name for a short id", async () => {
      expectCommands("git config northguild.worktree.branchPrefix.bugfix");
      vi.spyOn(cli, "run").mockResolvedValueOnce("fix/");

      const name = await getClickUpBranchNameFromTask(task, "9hx");

      expect(name).toBe("fix/CU-9hx-fix-login-bug");
    });

    it("keeps the case of a short id", async () => {
      expectCommands("git config northguild.worktree.branchPrefix.bugfix");
      vi.spyOn(cli, "run").mockResolvedValueOnce("fix/");

      const name = await getClickUpBranchNameFromTask(
        { ...task, id: "86aBc" },
        "86aBc",
      );

      expect(name).toBe("fix/CU-86aBc-fix-login-bug");
    });

    it("uses the custom id, upper-cased, when a custom id was typed", async () => {
      expectCommands("git config northguild.worktree.branchPrefix.bugfix");
      vi.spyOn(cli, "run").mockResolvedValueOnce("fix/");

      const name = await getClickUpBranchNameFromTask(
        { ...task, customId: "DEV-42" },
        "dev-42",
      );

      expect(name).toBe("fix/DEV-42-fix-login-bug");
    });

    // D6: the segment follows the id the user typed, not the task's custom_id.
    it("uses CU-<id> when a short id was typed for a task that has a custom id", async () => {
      expectCommands("git config northguild.worktree.branchPrefix.bugfix");
      vi.spyOn(cli, "run").mockResolvedValueOnce("fix/");

      const name = await getClickUpBranchNameFromTask(
        { ...task, customId: "DEV-42" },
        "9hx",
      );

      expect(name).toBe("fix/CU-9hx-fix-login-bug");
    });

    it("uses the typed custom id, upper-cased, even when the response carries no custom_id", async () => {
      expectCommands("git config northguild.worktree.branchPrefix.bugfix");
      vi.spyOn(cli, "run").mockResolvedValueOnce("fix/");

      const name = await getClickUpBranchNameFromTask(
        { ...task, customId: null },
        "dev-42",
      );

      expect(name).toBe("fix/DEV-42-fix-login-bug");
    });

    it("uses branchPrefix.feature when no tag matches", async () => {
      expectCommands("git config northguild.worktree.branchPrefix.feature");
      vi.spyOn(cli, "run").mockResolvedValueOnce("feature/");

      const name = await getClickUpBranchNameFromTask(
        { ...task, name: "Add dark mode", tags: [] },
        "9hx",
      );

      expect(name).toBe("feature/CU-9hx-add-dark-mode");
    });

    it("uses branchPrefix.chore for a maintenance tag", async () => {
      expectCommands("git config northguild.worktree.branchPrefix.chore");
      vi.spyOn(cli, "run").mockResolvedValueOnce("chore/");

      const name = await getClickUpBranchNameFromTask(
        { ...task, name: "Bump deps", tags: ["Maintenance"] },
        "9hx",
      );

      expect(name).toBe("chore/CU-9hx-bump-deps");
    });

    it("cuts a long name to a whole-word slug of at most 48 characters", async () => {
      expectCommands("git config northguild.worktree.branchPrefix.feature");
      vi.spyOn(cli, "run").mockResolvedValueOnce("feature/");

      const name = await getClickUpBranchNameFromTask(
        {
          ...task,
          name: "Login redirect loops forever when the session cookie expires during a multi step checkout flow",
          tags: [],
        },
        "9hx",
      );

      expect(name).toBe(
        "feature/CU-9hx-login-redirect-loops-forever-when-the-session",
      );
    });

    it('falls back to "issue" when the name leaves no slug', async () => {
      expectCommands("git config northguild.worktree.branchPrefix.feature");
      vi.spyOn(cli, "run").mockResolvedValueOnce("feature/");

      const name = await getClickUpBranchNameFromTask(
        { ...task, name: "!!!", tags: [] },
        "9hx",
      );

      expect(name).toBe("feature/CU-9hx-issue");
    });
  });
});
