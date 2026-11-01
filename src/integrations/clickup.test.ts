import * as cli from "../lib/cli.js";
import * as config from "../lib/config.js";
import * as git from "../lib/git.js";
import { resetProjectConfigCache } from "../lib/project-config.js";
import { expectCommands } from "../test-setup.js";
import {
  fetchClickUpTask,
  getClickUpBranchNameFromTask,
  getClickUpBranchNaming,
  getClickUpBranchType,
  parseClickUpTaskId,
  resolveClickUpToken,
  resolveClickUpWorkspaceId,
  startClickUpTask,
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

// A project file on origin/main, and no working copy of it to disagree with.
function stubProjectFile(content: string) {
  vi.spyOn(git, "gitResolveOriginHead").mockResolvedValue("origin/main");
  vi.spyOn(git, "gitReadBlobAtRef").mockResolvedValue({
    status: "found",
    content,
  });
  vi.spyOn(git, "gitGetTopLevelPath").mockResolvedValue("/nonexistent");
}

describe("ClickUp integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProjectConfigCache();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    // The project-file cases spy on git.js; the rest read through cli.run.
    vi.restoreAllMocks();
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
    it("reads clickup.workspaceId from the project file when git config has none", async () => {
      stubProjectFile("clickup:\n  workspaceId: 9012345\n");
      vi.spyOn(config, "gitGetConfigValue").mockResolvedValue("");

      await expect(resolveClickUpWorkspaceId()).resolves.toBe("9012345");
    });

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

    // The fetch signal also bounds the body: headers in time and a body that
    // stalls past 15s rejects response.json() with the signal's TimeoutError.
    it("reports a body that stalls past the timeout as a timeout", async () => {
      stubToken();
      const answer = respond(200, null);
      answer.json.mockRejectedValue(
        new DOMException("timed out", "TimeoutError"),
      );
      stubFetch(answer);

      const failure = fetchClickUpTask("9hx");

      // TIMEOUT_MESSAGE in base-command.ts is /did not (?:answer|finish) within \d+s/
      await expect(failure).rejects.toThrow(
        "ClickUp: the request did not answer within 15s.",
      );
      await expect(failure).rejects.not.toThrow(/pk_/);
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
  // D8-D12. ClickUp's rule field in v1 is `Tags`, by name only: a tag has no
  // id (developer.clickup.com, Get Task). Kinds and prefixes come from the
  // plan's example file; the default names from the ClickUp guide (`CU-<id>`).
  describe("branch-type rules (clickup.branchType)", () => {
    const PREFIXES = `branchPrefix:
  feature: feat/
  bugfix: fix/
  chore: chore/
`;
    const task = {
      id: "9hx",
      customId: null,
      name: "Fix login bug",
      url: null,
      tags: ["Urgent"],
    };

    function projectFile(rules: string, rest = "") {
      stubProjectFile(`${PREFIXES}${rest}clickup:\n  branchType:\n${rules}`);
      vi.spyOn(config, "gitGetConfigValue").mockResolvedValue("");
    }

    it("a tag in a rule gives its kind, and the rules replace the built-in mapping", async () => {
      projectFile(`    - when: { Tags: [urgent, hotfix] }
      type: bugfix
`);

      expect(await getClickUpBranchNameFromTask(task, "9hx")).toBe(
        "fix/CU-9hx-fix-login-bug",
      );
      // "Bug" is bugfix in the built-in mapping; here no rule names it.
      expect(
        await getClickUpBranchNameFromTask({ ...task, tags: ["Bug"] }, "9hx"),
      ).toBe("CU-9hx-fix-login-bug");
    });

    it("no match and no otherwise gets no prefix; otherwise: feature opts in", async () => {
      projectFile(`    - when: { Tags: hotfix }
      type: bugfix
`);
      expect(await getClickUpBranchNameFromTask(task, "9hx")).toBe(
        "CU-9hx-fix-login-bug",
      );

      resetProjectConfigCache();
      projectFile(`    - when: { Tags: hotfix }
      type: bugfix
    - otherwise: feature
`);
      expect(await getClickUpBranchNameFromTask(task, "9hx")).toBe(
        "feat/CU-9hx-fix-login-bug",
      );
    });

    it("warns, naming the rule and the field, for a field ClickUp does not have (D11)", async () => {
      projectFile(`    - when: { Space: Core }
      type: bugfix
`);
      const warnings: string[] = [];

      await getClickUpBranchNameFromTask(task, "9hx", (w) => warnings.push(w));

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("Rule 1 of clickup.branchType");
      expect(warnings[0]).toContain('"Space"');
    });

    it("keeps the built-in mapping when the file has no clickup.branchType", async () => {
      stubProjectFile(PREFIXES);
      vi.spyOn(config, "gitGetConfigValue").mockResolvedValue("");

      expect(
        await getClickUpBranchNameFromTask({ ...task, tags: ["Bug"] }, "9hx"),
      ).toBe("fix/CU-9hx-fix-login-bug");
    });

    it("the default template reproduces today's names, short and custom id", async () => {
      projectFile(
        `    - otherwise: chore
`,
        'branchName: "{prefix}{id}-{slug}"\n',
      );

      expect(await getClickUpBranchNameFromTask(task, "9hx")).toBe(
        "chore/CU-9hx-fix-login-bug",
      );
      expect(
        await getClickUpBranchNameFromTask(
          { ...task, customId: "DEV-42" },
          "dev-42",
        ),
      ).toBe("chore/DEV-42-fix-login-bug");
    });

    it("applies the branchName template to the id the person typed", async () => {
      projectFile(
        `    - otherwise: chore
`,
        'branchName: "{id}/{prefix}{slug}"\n',
      );

      expect(await getClickUpBranchNameFromTask(task, "9hx")).toBe(
        "CU-9hx/chore/fix-login-bug",
      );
    });
  });

  describe("getClickUpBranchNameFromTask", () => {
    const task = {
      id: "9hx",
      customId: null,
      name: "Fix login bug",
      url: null,
      tags: ["Bug"],
    };

    // The scripted `git config` answers below are prefixes; the rules and
    // template lookup finds no project file and so consumes none of them.
    beforeEach(() => {
      stubProjectFile("");
      vi.spyOn(git, "gitReadBlobAtRef").mockResolvedValue({
        status: "absent-path",
      });
    });

    it("takes the prefix from the project file when git config has none", async () => {
      stubProjectFile("branchPrefix:\n  bugfix: fix/\n");
      vi.spyOn(config, "gitGetConfigValue").mockResolvedValue("");

      const name = await getClickUpBranchNameFromTask(task, "9hx");

      expect(name).toBe("fix/CU-9hx-fix-login-bug");
    });

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

// Phase 5 (#181): ClickUp tags have a name and no id (developer.clickup.com,
// *Get Task*), so a dry run shows them by name.
describe("getClickUpBranchNaming", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows tags by name and reports the built-in mapping with no rules", async () => {
    resetProjectConfigCache();
    stubProjectFile("branchPrefix:\n  bugfix: fix/\n");
    vi.spyOn(config, "gitGetConfigValue").mockResolvedValue("");

    const naming = await getClickUpBranchNaming(
      {
        id: "9hx",
        customId: null,
        name: "Fix login",
        url: null,
        tags: ["Bug"],
      },
      "9hx",
    );

    // The portable `Labels` (D3) sits beside `Tags`, never in place of it (D4),
    // so the dry run shows both and a `when` line can be pasted from either.
    expect(naming.fields).toEqual([
      { id: "Tags", name: "Tags", values: [{ name: "Bug" }] },
      { id: "Labels", name: "Labels", values: [{ name: "Bug" }] },
    ]);
    expect(naming.match).toEqual({ source: "built-in" });
    expect(naming.branchName).toBe("fix/CU-9hx-fix-login");
  });
});

// The shared top-level `branchType` list (#128, D1). Expected names come from
// the plan's Phase 1 "Done when" and the built-in mapping above (a `Bug` tag
// is `fix/`, the id segment is `CU-<id>`).
describe("the shared branchType list for ClickUp", () => {
  const PREFIXES = `branchPrefix:
  feature: feat/
  bugfix: fix/
  chore: chore/
`;
  const SHARED = `branchType:
  - when: { Tags: chore }
    type: chore
`;
  const OWN = `clickup:
  branchType:
    - when: { Tags: chore }
      type: feature
`;

  const clickUpTask = (tags: string[]) => ({
    id: "9hx",
    customId: null,
    name: "Tidy",
    url: null,
    tags,
  });

  function projectFile(content: string) {
    resetProjectConfigCache();
    stubProjectFile(content);
    vi.spyOn(config, "gitGetConfigValue").mockResolvedValue("");
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("neither list: today's built-in mapping", async () => {
    projectFile(PREFIXES);

    expect(
      (await getClickUpBranchNaming(clickUpTask(["Bug", "chore"]), "9hx"))
        .branchName,
    ).toBe("fix/CU-9hx-tidy");
  });

  it("shared list only: a rule-matched task gets its rule's prefix, and an otherwise covers the rest", async () => {
    projectFile(`${PREFIXES + SHARED}  - otherwise: feature\n`);

    const matched = await getClickUpBranchNaming(clickUpTask(["chore"]), "9hx");
    const rest = await getClickUpBranchNaming(clickUpTask([]), "9hx");

    expect(matched.branchName).toBe("chore/CU-9hx-tidy");
    expect(matched.match).toMatchObject({ source: "rule", position: 1 });
    expect(rest.branchName).toBe("feat/CU-9hx-tidy");
  });

  const PORTABLE = `branchType:
  - when: { Type: Bug }
    type: bugfix
  - when: { Labels: bug }
    type: bugfix
`;

  // Plan Phase 2 "Done when": the portable list gives fix/ on a `bug` tag, and
  // ClickUp has no Type, which the shared list may name without a warning.
  it("the portable Labels rule gives fix/ on a bug-tagged task, with no warning", async () => {
    projectFile(PREFIXES + PORTABLE);
    const warnings: string[] = [];

    const naming = await getClickUpBranchNaming(
      clickUpTask(["bug"]),
      "9hx",
      (w) => warnings.push(w),
    );

    expect(naming.branchName).toBe("fix/CU-9hx-tidy");
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

    await getClickUpBranchNaming(clickUpTask(["bug"]), "9hx", (w) =>
      real.push(w),
    );
    await getClickUpBranchNaming(
      clickUpTask(["bug"]),
      "9hx",
      (w) => dry.push(w),
      true,
    );

    expect(real).toEqual([]);
    expect(dry).toHaveLength(1);
    expect(dry[0]).toContain("Rule 1 of branchType names");
  });

  it("a clickup.branchType keeps matching on Tags, and a Labels rule matches the same tags", async () => {
    projectFile(
      `${PREFIXES}clickup:\n  branchType:\n    - when: { Tags: bug }\n      type: bugfix\n`,
    );
    expect(
      (await getClickUpBranchNaming(clickUpTask(["bug"]), "9hx")).kind,
    ).toBe("bugfix");

    projectFile(
      `${PREFIXES}clickup:\n  branchType:\n    - when: { Labels: bug }\n      type: bugfix\n`,
    );
    expect(
      (await getClickUpBranchNaming(clickUpTask(["bug"]), "9hx")).kind,
    ).toBe("bugfix");
  });

  it("shared list only: it replaces the built-in mapping, with no fall-through on no match", async () => {
    projectFile(PREFIXES + SHARED);

    const naming = await getClickUpBranchNaming(clickUpTask(["Bug"]), "9hx");

    expect(naming.branchName).toBe("CU-9hx-tidy");
    expect(naming.match).toEqual({ source: "none" });
  });

  it("both lists: the provider's wins", async () => {
    projectFile(PREFIXES + OWN + SHARED);

    expect(
      (await getClickUpBranchNaming(clickUpTask(["chore"]), "9hx")).branchName,
    ).toBe("feat/CU-9hx-tidy");
  });

  // Shapes follow ClickUp's OpenAPI definitions, read 2026-11-01:
  // Get Task (status{status,type}, list{id}), Get List (statuses[] with
  // status, type, orderindex) and Update Task (200 answers a task).
  describe("startClickUpTask", () => {
    const BASE = "https://api.clickup.com/api/v2";

    function startTask(
      type: string,
      status = "to do",
      overrides: Record<string, unknown> = {},
    ) {
      return taskPayload({
        status: { status, type },
        list: { id: "901" },
        ...overrides,
      });
    }

    // Deliberately not in orderindex order, so "first in the array" and
    // "lowest orderindex" give different answers (the entry's rule).
    const STATUSES = [
      { status: "review", type: "custom", orderindex: 3 },
      { status: "to do", type: "open", orderindex: 0 },
      { status: "in progress", type: "custom", orderindex: 1 },
      { status: "qa", type: "custom", orderindex: 2 },
      { status: "complete", type: "done", orderindex: 4 },
      { status: "closed", type: "closed", orderindex: 5 },
    ];

    function stubSequence(...answers: unknown[]) {
      const fetchSpy = vi.fn();
      for (const answer of answers) {
        fetchSpy.mockResolvedValueOnce(answer);
      }
      vi.stubGlobal("fetch", fetchSpy);
      return fetchSpy;
    }

    function calls(fetchSpy: ReturnType<typeof vi.fn>) {
      return fetchSpy.mock.calls.map(([url, init]) => [
        (init as RequestInit).method,
        url,
      ]);
    }

    const movedTask = (status: string) => startTask("custom", status);

    it("moves an open task to the lowest-orderindex custom status", async () => {
      stubToken();
      const fetchSpy = stubSequence(
        respond(200, startTask("open")),
        respond(200, { statuses: STATUSES }),
        respond(200, movedTask("in progress")),
      );

      await expect(startClickUpTask("9hx")).resolves.toEqual({
        outcome: "started",
        from: "to do",
        to: "in progress",
      });

      expect(calls(fetchSpy)).toEqual([
        ["GET", `${BASE}/task/9hx`],
        ["GET", `${BASE}/list/901`],
        ["PUT", `${BASE}/task/9hx`],
      ]);
      const [, put] = fetchSpy.mock.calls[2] as [string, RequestInit];
      expect(put.body).toBe('{"status":"in progress"}');
      for (const [, init] of fetchSpy.mock.calls as [string, RequestInit][]) {
        expect(init.headers).toEqual({
          "Content-Type": "application/json",
          Authorization: TOKEN,
        });
        expect(init.signal).toBeInstanceOf(AbortSignal);
      }
    });

    it("sends the custom-id query on Get Task and Update Task, not Get List", async () => {
      stubTokenAndWorkspace("9012345");
      const fetchSpy = stubSequence(
        respond(200, startTask("open", "to do", { custom_id: "DEV-123" })),
        respond(200, { statuses: STATUSES }),
        respond(200, movedTask("in progress")),
      );

      await startClickUpTask("DEV-123");

      const query = "?custom_task_ids=true&team_id=9012345";
      expect(calls(fetchSpy)).toEqual([
        ["GET", `${BASE}/task/DEV-123${query}`],
        ["GET", `${BASE}/list/901`],
        ["PUT", `${BASE}/task/DEV-123${query}`],
      ]);
    });

    it("accepts an echoed status that differs only in case", async () => {
      stubToken();
      stubSequence(
        respond(200, startTask("open")),
        respond(200, { statuses: STATUSES }),
        respond(200, movedTask("IN PROGRESS")),
      );

      await expect(startClickUpTask("9hx")).resolves.toMatchObject({
        outcome: "started",
      });
    });

    it("reports a custom-type task as already started, with no List read or write", async () => {
      stubToken();
      const fetchSpy = stubSequence(
        respond(200, startTask("custom", "in review")),
      );

      await expect(startClickUpTask("9hx")).resolves.toEqual({
        outcome: "already-started",
        status: "in review",
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it.each([
      ["done", "complete"],
      ["closed", "closed"],
      ["somethingnew", "weird"],
    ])("leaves a %s task alone with no List read or write", async (type, status) => {
      stubToken();
      const fetchSpy = stubSequence(respond(200, startTask(type, status)));

      await expect(startClickUpTask("9hx")).resolves.toEqual({
        outcome: "left-alone",
        status,
        type,
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("reports a List with no custom status and writes nothing", async () => {
      stubToken();
      const fetchSpy = stubSequence(
        respond(200, startTask("open")),
        respond(200, {
          statuses: [
            { status: "to do", type: "open", orderindex: 0 },
            { status: "complete", type: "done", orderindex: 1 },
          ],
        }),
      );

      await expect(startClickUpTask("9hx")).resolves.toEqual({
        outcome: "no-in-progress-status",
        status: "to do",
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("does not treat an unknown status type as an in-progress target", async () => {
      stubToken();
      const fetchSpy = stubSequence(
        respond(200, startTask("open")),
        respond(200, {
          statuses: [
            { status: "backlog", type: "active", orderindex: 0 },
            { status: "complete", type: "done", orderindex: 1 },
          ],
        }),
      );

      await expect(startClickUpTask("9hx")).resolves.toEqual({
        outcome: "no-in-progress-status",
        status: "to do",
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("refuses an invalid id before any request", async () => {
      const fetchSpy = stubSequence();

      await expect(startClickUpTask("a b")).rejects.toMatchObject({
        code: "invalid_value",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("refuses a custom id with no workspace id before any request", async () => {
      stubTokenAndWorkspace("");
      const fetchSpy = stubSequence();

      await expect(startClickUpTask("DEV-1")).rejects.toMatchObject({
        name: "MissingValueError",
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    // The three requests each map 401/403, 404 and 429 to the existing texts.
    describe.each([
      ["Get Task", 0, "ClickUp: Unable to find task 9hx."],
      ["Get List", 1, "ClickUp: Unable to find list 901."],
      ["Update Task", 2, "ClickUp: Unable to find task 9hx."],
    ])("a failing %s", (_name, index, notFound) => {
      function sequenceFailing(failure: unknown) {
        const answers = [
          respond(200, startTask("open")),
          respond(200, { statuses: STATUSES }),
          respond(200, movedTask("in progress")),
        ];
        answers[index] = failure as ReturnType<typeof respond>;
        return stubSequence(...answers);
      }

      it.each([
        401, 403,
      ])("reports authentication on HTTP %i", async (status) => {
        stubToken();
        sequenceFailing(respond(status, {}));

        await expect(startClickUpTask("9hx")).rejects.toThrow(
          "ClickUp: Authentication failed. Please verify clickup.apiToken in your config.",
        );
      });

      it("reports not found on HTTP 404", async () => {
        stubToken();
        sequenceFailing(respond(404, { err: "not found" }));

        await expect(startClickUpTask("9hx")).rejects.toThrow(notFound);
      });

      it("says so on HTTP 429", async () => {
        stubToken();
        sequenceFailing(respond(429, {}));

        await expect(startClickUpTask("9hx")).rejects.toThrow(
          "ClickUp: Rate limited. ClickUp limits requests per API token; wait a moment and try again.",
        );
      });
    });

    it("keeps the Get Task not-found text word for word", async () => {
      stubToken();
      stubSequence(respond(404, {}));

      await expect(startClickUpTask("9hx")).rejects.toThrow(
        "ClickUp: Unable to find task 9hx.",
      );
    });

    it("carries the status line, ClickUp's err and the edit-access hint when the write is refused", async () => {
      stubToken();
      const refused = respond(400, { err: "Status does not exist" });
      refused.statusText = "Bad Request";
      stubSequence(
        respond(200, startTask("open")),
        respond(200, { statuses: STATUSES }),
        refused,
      );

      const failure = startClickUpTask("9hx");

      await expect(failure).rejects.toThrow(
        /^ClickUp: Failed to move task 9hx to "in progress"\. 400 Bad Request: Status does not exist\. Moving a task needs edit access to it\.$/,
      );
    });

    it("still gives the hint when the refusal has no err", async () => {
      stubToken();
      stubSequence(
        respond(200, startTask("open")),
        respond(200, { statuses: STATUSES }),
        respond(500, "<html>"),
      );

      await expect(startClickUpTask("9hx")).rejects.toThrow(
        /500.*Moving a task needs edit access to it\./,
      );
    });

    it("fails when the echoed status is not the chosen one", async () => {
      stubToken();
      stubSequence(
        respond(200, startTask("open")),
        respond(200, { statuses: STATUSES }),
        respond(200, movedTask("to do")),
      );

      await expect(startClickUpTask("9hx")).rejects.toThrow(
        'ClickUp: Task 9hx did not move to "in progress"; it is in "to do".',
      );
    });

    it("fails when a 2xx write answer is not a task", async () => {
      stubToken();
      stubSequence(
        respond(200, startTask("open")),
        respond(200, { statuses: STATUSES }),
        respond(200, { ok: true }),
      );

      await expect(startClickUpTask("9hx")).rejects.toThrow(
        "ClickUp: Unexpected response for task 9hx.",
      );
    });

    it("reports a timeout on the write and names ClickUp, not the token", async () => {
      stubToken();
      const fetchSpy = vi
        .fn()
        .mockResolvedValueOnce(respond(200, startTask("open")))
        .mockResolvedValueOnce(respond(200, { statuses: STATUSES }))
        .mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
      vi.stubGlobal("fetch", fetchSpy);

      const failure = startClickUpTask("9hx");

      await expect(failure).rejects.toThrow(
        "ClickUp: the request did not answer within 15s.",
      );
      await expect(failure).rejects.not.toThrow(/pk_/);
    });

    it.each([
      ["Get Task", 0],
      ["Get List", 1],
      ["Update Task", 2],
    ])("turns a non-timeout fetch failure on %s into a fixed ClickUp message", async (_name, index) => {
      for (const message of [
        "fetch failed",
        `Headers.append: "${TOKEN}\nX" is invalid`,
      ]) {
        stubToken();
        const fetchSpy = vi.fn();
        const answers = [
          respond(200, startTask("open")),
          respond(200, { statuses: STATUSES }),
        ];
        for (const answer of answers.slice(0, index)) {
          fetchSpy.mockResolvedValueOnce(answer);
        }
        fetchSpy.mockRejectedValueOnce(new TypeError(message));
        vi.stubGlobal("fetch", fetchSpy);

        const failure = startClickUpTask("9hx");

        await expect(failure).rejects.toThrow(
          "ClickUp: the request could not be sent.",
        );
        await expect(failure).rejects.toThrow(/^ClickUp: /);
        await expect(failure).rejects.not.toThrow(TOKEN);
      }
    });

    it.each([
      [
        "a body that is not JSON",
        () => {
          const answer = respond(200, null);
          answer.json.mockRejectedValue(new SyntaxError("Unexpected token <"));
          return answer;
        },
      ],
      [
        "a missing status object",
        () => respond(200, taskPayload({ list: { id: "901" } })),
      ],
      [
        "a status without a type",
        () =>
          respond(
            200,
            taskPayload({ status: { status: "to do" }, list: { id: "901" } }),
          ),
      ],
      [
        "a status without a name",
        () =>
          respond(
            200,
            taskPayload({ status: { type: "open" }, list: { id: "901" } }),
          ),
      ],
      [
        "a missing list",
        () =>
          respond(
            200,
            taskPayload({ status: { status: "to do", type: "open" } }),
          ),
      ],
      [
        "a list without an id",
        () =>
          respond(
            200,
            taskPayload({
              status: { status: "to do", type: "open" },
              list: {},
            }),
          ),
      ],
    ])("reports %s on Get Task as an unexpected response", async (_name, answer) => {
      stubToken();
      stubSequence(answer());

      await expect(startClickUpTask("9hx")).rejects.toThrow(
        "ClickUp: Unexpected response for task 9hx.",
      );
    });

    it.each([
      ["an item missing orderindex", [{ status: "a", type: "custom" }]],
      [
        "a string orderindex",
        [{ status: "a", type: "custom", orderindex: "1" }],
      ],
      ["an item missing its name", [{ type: "custom", orderindex: 1 }]],
      ["statuses that is not an array", "nope"],
    ])("reports Get List with %s as an unexpected response", async (_name, statuses) => {
      stubToken();
      stubSequence(respond(200, startTask("open")), respond(200, { statuses }));

      await expect(startClickUpTask("9hx")).rejects.toThrow(
        "ClickUp: Unexpected response for list 901.",
      );
    });

    it("never puts the token in a thrown message", async () => {
      const failures = [
        respond(401, {}),
        respond(404, {}),
        respond(429, {}),
        respond(500, { err: "boom" }),
      ];
      for (const failure of failures) {
        stubToken();
        stubSequence(
          respond(200, startTask("open")),
          respond(200, { statuses: STATUSES }),
          failure,
        );
        const error = await startClickUpTask("9hx").catch((e: Error) => e);

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).not.toContain(TOKEN);
        expect((error as Error).message).toMatch(/^ClickUp: /);
      }
    });
  });
});
