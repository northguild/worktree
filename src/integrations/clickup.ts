import {
  type BranchMatch,
  type BranchNaming,
  evaluateBranchTypeRules,
  type IssueField,
  matchOfResult,
} from "../lib/branch-type.js";
import { gitGetConfigValue } from "../lib/git.js";
import {
  type BranchKind,
  getBranchPrefix,
  getBranchTypeRules,
  getTeamConfigValue,
  renderBranchName,
} from "../lib/project-config.js";
import { InvalidValueError, MissingValueError } from "../lib/prompt.js";
import { slugifyBranchTitle } from "../lib/utils.js";

export interface ClickUpTask {
  id: string;
  customId: string | null;
  name: string;
  url: string | null;
  tags: string[];
}

export interface ClickUpTaskId {
  kind: "short" | "custom";
  id: string;
}

const CLICKUP_API = "https://api.clickup.com/api/v2";
const CLICKUP_REQUEST_TIMEOUT_MS = 15_000;

const AUTH_FAILED_MESSAGE =
  "ClickUp: Authentication failed. Please verify clickup.apiToken in your config.";

// D3: a custom id is PREFIX-<digits>, shaped like a Jira key; a short id is
// alphanumeric with no hyphen. Short ids are case-sensitive, so the case the
// user typed is kept.
export function parseClickUpTaskId(input: string): ClickUpTaskId {
  const id = input.trim();

  if (/^[A-Za-z][A-Za-z0-9]*-\d+$/.test(id)) {
    return { kind: "custom", id };
  }

  if (/^[A-Za-z0-9]+$/.test(id)) {
    return { kind: "short", id };
  }

  throw new InvalidValueError(`ClickUp: Invalid task id "${input}".`);
}

export async function resolveClickUpToken(): Promise<string> {
  const token = await gitGetConfigValue("clickup.apiToken");

  if (!token) {
    throw new Error(
      'ClickUp: Missing config value "clickup.apiToken". Run "worktree config" to configure ClickUp integration.',
    );
  }

  return token;
}

export async function resolveClickUpWorkspaceId(): Promise<string | undefined> {
  const workspaceId = await getTeamConfigValue("clickup.workspaceId");

  return workspaceId || undefined;
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

// The timeout message matches TIMEOUT_MESSAGE in base-command.ts; it names no
// header and never the token.
function timeoutError(cause: unknown): Error {
  return new Error(
    `ClickUp: the request did not answer within ${CLICKUP_REQUEST_TIMEOUT_MS / 1000}s.`,
    { cause },
  );
}

// Every ClickUp request is bounded, body included: the signal also aborts a
// body that stalls after the headers arrive (see readBody).
export async function fetchClickUp(
  path: string,
  token: string,
): Promise<Response> {
  try {
    return await fetch(`${CLICKUP_API}${path}`, {
      method: "GET",
      // D4: the raw token, no `Bearer` prefix (that is for OAuth tokens).
      headers: { "Content-Type": "application/json", Authorization: token },
      signal: AbortSignal.timeout(CLICKUP_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (isTimeout(error)) {
      throw timeoutError(error);
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// A body that is not JSON is an unexpected response; one that timed out is a
// timeout, not a parse failure.
async function readBody(
  response: Response,
): Promise<Record<string, unknown> | undefined> {
  try {
    const body: unknown = await response.json();
    return isRecord(body) ? body : undefined;
  } catch (error) {
    if (isTimeout(error)) {
      throw timeoutError(error);
    }
    return undefined;
  }
}

// D5: only id, custom_id, name, url and tags[].name are read.
function parseClickUpTask(
  body: Record<string, unknown>,
): ClickUpTask | undefined {
  const { id, custom_id: customId, name, url, tags } = body;

  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    !Array.isArray(tags) ||
    !tags.every((tag) => isRecord(tag) && typeof tag.name === "string")
  ) {
    return undefined;
  }

  return {
    id,
    customId: typeof customId === "string" && customId !== "" ? customId : null,
    name,
    url: typeof url === "string" ? url : null,
    tags: tags.map((tag) => (tag as { name: string }).name),
  };
}

export async function fetchClickUpTask(taskId: string): Promise<ClickUpTask> {
  const parsed = parseClickUpTaskId(taskId);
  const token = await resolveClickUpToken();

  // D3: custom ids need the workspace id in the same request.
  let query = "";
  if (parsed.kind === "custom") {
    const workspaceId = await resolveClickUpWorkspaceId();

    if (!workspaceId) {
      throw new MissingValueError(
        "the ClickUp workspace id",
        "`worktree config clickup.workspaceId <id>`",
      );
    }

    query = `?custom_task_ids=true&team_id=${encodeURIComponent(workspaceId)}`;
  }

  const response = await fetchClickUp(
    `/task/${encodeURIComponent(parsed.id)}${query}`,
    token,
  );

  // D11: ClickUp's status for a task the token cannot see is unconfirmed, so
  // 401 and 403 share the authentication message.
  if (response.status === 401 || response.status === 403) {
    throw new Error(AUTH_FAILED_MESSAGE);
  }

  if (response.status === 404) {
    throw new Error(`ClickUp: Unable to find task ${parsed.id}.`);
  }

  // The reset header's format is unconfirmed, so it is not parsed.
  if (response.status === 429) {
    throw new Error(
      "ClickUp: Rate limited. ClickUp limits requests per API token; wait a moment and try again.",
    );
  }

  if (!response.ok) {
    throw new Error(
      `ClickUp: Failed to fetch task ${parsed.id}. ${response.status} ${response.statusText}`.trimEnd(),
    );
  }

  const body = await readBody(response);
  const task = body ? parseClickUpTask(body) : undefined;

  if (!task) {
    throw new Error(`ClickUp: Unexpected response for task ${parsed.id}.`);
  }

  return task;
}

// D7: tags decide, as Linear's labels do. Bug wins over the rest.
export function getClickUpBranchType(tags: string[]) {
  const names = tags.map((tag) => tag.toLowerCase());

  if (names.includes("bug")) {
    return "bugfix" as const;
  }

  if (names.includes("chore") || names.includes("maintenance")) {
    return "chore" as const;
  }

  return "feature" as const;
}

// D9: ClickUp's rule field in v1 is `Tags`, by name only (a tag has no id).
export function getClickUpTaskFields(task: ClickUpTask): IssueField[] {
  return [
    {
      id: "Tags",
      name: "Tags",
      values: task.tags.map((name) => ({ name })),
    },
  ];
}

// Takes the task already fetched so a caller can keep its url from the same
// request. D6: `CU-<id>` for a short id, the custom id upper-cased otherwise;
// it is told apart by the shape the user typed, not by `custom_id`, so the
// branch carries the id that was asked for. With `clickup.branchType` in the
// project file the rules decide the kind (D10) and a task no rule matches gets
// no prefix; without it the built-in mapping applies. Rule warnings go to
// `onWarning`.
export async function getClickUpBranchNaming(
  task: ClickUpTask,
  typedId: string,
  onWarning: (warning: string) => void = () => {},
): Promise<BranchNaming> {
  const rules = await getBranchTypeRules("clickup");
  const fields = getClickUpTaskFields(task);

  let kind: BranchKind | undefined;
  let match: BranchMatch;
  if (rules) {
    const result = evaluateBranchTypeRules(rules, fields, "clickup.branchType");
    for (const warning of result.warnings) {
      onWarning(warning);
    }
    kind = result.kind;
    match = matchOfResult(result);
  } else {
    kind = getClickUpBranchType(task.tags);
    match = { source: "built-in" };
  }

  const parsed = parseClickUpTaskId(typedId);
  const segment =
    parsed.kind === "custom" ? parsed.id.toUpperCase() : `CU-${task.id}`;

  const branchName = await renderBranchName({
    prefix: await getBranchPrefix(kind),
    id: segment,
    slug: slugifyBranchTitle(task.name),
  });
  return { branchName, kind, fields, match };
}

export async function getClickUpBranchNameFromTask(
  task: ClickUpTask,
  typedId: string,
  onWarning: (warning: string) => void = () => {},
): Promise<string> {
  return (await getClickUpBranchNaming(task, typedId, onWarning)).branchName;
}
