import {
  type BranchMatch,
  type BranchNaming,
  evaluateBranchTypeRules,
  type IssueField,
  matchOfResult,
} from "../lib/branch-type.js";
import { gitGetConfigValue } from "../lib/config.js";
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
  { method = "GET", body }: { method?: "GET" | "PUT"; body?: unknown } = {},
): Promise<Response> {
  try {
    return await fetch(`${CLICKUP_API}${path}`, {
      method,
      // D4: the raw token, no `Bearer` prefix (that is for OAuth tokens).
      headers: { "Content-Type": "application/json", Authorization: token },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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

interface FailureMessages {
  notFound: string;
  // The sentence a generic non-2xx answer continues: "<failed> <status> <text>".
  failed: string;
}

// The one classifier for a ClickUp answer (D9). It returns for a 2xx and
// throws otherwise.
async function rejectFailedResponse(
  response: Response,
  messages: FailureMessages,
  detail?: (response: Response) => Promise<string>,
): Promise<void> {
  // D11: ClickUp's status for a task the token cannot see is unconfirmed, so
  // 401 and 403 share the authentication message.
  if (response.status === 401 || response.status === 403) {
    throw new Error(AUTH_FAILED_MESSAGE);
  }

  if (response.status === 404) {
    throw new Error(messages.notFound);
  }

  // The reset header's format is unconfirmed, so it is not parsed.
  if (response.status === 429) {
    throw new Error(
      "ClickUp: Rate limited. ClickUp limits requests per API token; wait a moment and try again.",
    );
  }

  if (!response.ok) {
    const extra = detail ? await detail(response) : "";
    throw new Error(
      `${messages.failed} ${response.status} ${response.statusText}`.trimEnd() +
        extra,
    );
  }
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

  await rejectFailedResponse(response, {
    notFound: `ClickUp: Unable to find task ${parsed.id}.`,
    failed: `ClickUp: Failed to fetch task ${parsed.id}.`,
  });

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
// D3, D4: the portable `Labels` is added beside it, never in place of it, with
// the same values.
export function getClickUpTaskFields(task: ClickUpTask): IssueField[] {
  const values = task.tags.map((name) => ({ name }));
  return [
    { id: "Tags", name: "Tags", values },
    { id: "Labels", name: "Labels", values },
  ];
}

// Takes the task already fetched so a caller can keep its url from the same
// request. D6: `CU-<id>` for a short id, the custom id upper-cased otherwise;
// it is told apart by the shape the user typed, not by `custom_id`, so the
// branch carries the id that was asked for. With `clickup.branchType` (else the
// shared `branchType`) in the project file the rules decide the kind (D10) and
// a task no rule matches gets no prefix; without either the built-in mapping
// applies. Rule warnings go to `onWarning`.
export async function getClickUpBranchNaming(
  task: ClickUpTask,
  typedId: string,
  onWarning: (warning: string) => void = () => {},
  dryRun = false,
): Promise<BranchNaming> {
  const list = await getBranchTypeRules("clickup");
  const fields = getClickUpTaskFields(task);

  let kind: BranchKind | undefined;
  let match: BranchMatch;
  if (list) {
    const result = evaluateBranchTypeRules(list.rules, fields, list.listName, {
      // A dry run is where rules are written and checked, so a misspelt field
      // in the shared list still warns there (D5 holds for real runs).
      shared: list.shared && !dryRun,
    });
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

export type ClickUpStart =
  | { outcome: "started"; from: string; to: string }
  | { outcome: "already-started"; status: string }
  | { outcome: "left-alone"; status: string; type: string }
  | { outcome: "no-in-progress-status"; status: string };

interface ClickUpListStatus {
  status: string;
  type: string;
  orderindex: number;
}

// Get Task's `status` and `list.id`, the only fields the start reads.
function parseStartState(
  body: Record<string, unknown> | undefined,
): { status: string; type: string; listId: string } | undefined {
  if (!body) {
    return undefined;
  }
  const { status, list } = body;

  if (
    !isRecord(status) ||
    typeof status.status !== "string" ||
    typeof status.type !== "string" ||
    !isRecord(list) ||
    typeof list.id !== "string" ||
    list.id === ""
  ) {
    return undefined;
  }

  return { status: status.status, type: status.type, listId: list.id };
}

// Get List's `statuses[]`; one malformed item makes the whole answer unusable.
function parseListStatuses(
  body: Record<string, unknown> | undefined,
): ClickUpListStatus[] | undefined {
  const statuses = body?.statuses;

  if (!Array.isArray(statuses)) {
    return undefined;
  }

  const parsed: ClickUpListStatus[] = [];
  for (const item of statuses) {
    if (
      !isRecord(item) ||
      typeof item.status !== "string" ||
      typeof item.type !== "string" ||
      typeof item.orderindex !== "number"
    ) {
      return undefined;
    }
    parsed.push({
      status: item.status,
      type: item.type,
      orderindex: item.orderindex,
    });
  }
  return parsed;
}

// ClickUp's own `err` text, when the refusal carries a string one.
async function refusalDetail(response: Response): Promise<string> {
  const body = await readBody(response);
  return typeof body?.err === "string" && body.err !== ""
    ? `: ${body.err}`
    : "";
}

// D1, D2, D3, D7: read the task, then its List, then move an `open` task to
// the List's lowest-`orderindex` `custom` status and confirm the answer echoes
// it. Every failure throws a `ClickUp:` message; none holds the token.
export async function startClickUpTask(typedId: string): Promise<ClickUpStart> {
  const parsed = parseClickUpTaskId(typedId);
  const token = await resolveClickUpToken();

  // D7: the timeout already reads `ClickUp:`; any other send failure (a
  // network error, or an undici header error that quotes the token) becomes a
  // fixed message that interpolates nothing from the error.
  async function send(
    path: string,
    options?: { method?: "GET" | "PUT"; body?: unknown },
  ): Promise<Response> {
    try {
      return await fetchClickUp(path, token, options);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("ClickUp: ")) {
        throw error;
      }
      throw new Error("ClickUp: the request could not be sent.", {
        cause: error,
      });
    }
  }

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
  const taskPath = `/task/${encodeURIComponent(parsed.id)}${query}`;
  const unexpectedTask = `ClickUp: Unexpected response for task ${parsed.id}.`;

  const taskResponse = await send(taskPath);
  await rejectFailedResponse(taskResponse, {
    notFound: `ClickUp: Unable to find task ${parsed.id}.`,
    failed: `ClickUp: Failed to fetch task ${parsed.id}.`,
  });
  const current = parseStartState(await readBody(taskResponse));

  if (!current) {
    throw new Error(unexpectedTask);
  }

  // D1: only exactly `open` moves; `custom` is already started; any other
  // type is finished or unknown and is left alone.
  if (current.type === "custom") {
    return { outcome: "already-started", status: current.status };
  }

  if (current.type !== "open") {
    return {
      outcome: "left-alone",
      status: current.status,
      type: current.type,
    };
  }

  const listPath = `/list/${encodeURIComponent(current.listId)}`;
  const listResponse = await send(listPath);
  await rejectFailedResponse(listResponse, {
    notFound: `ClickUp: Unable to find list ${current.listId}.`,
    failed: `ClickUp: Failed to fetch list ${current.listId}.`,
  });
  const statuses = parseListStatuses(await readBody(listResponse));

  if (!statuses) {
    throw new Error(`ClickUp: Unexpected response for list ${current.listId}.`);
  }

  const target = statuses
    .filter((status) => status.type === "custom")
    .sort((a, b) => a.orderindex - b.orderindex)[0];

  if (!target) {
    return { outcome: "no-in-progress-status", status: current.status };
  }

  const writeResponse = await send(taskPath, {
    method: "PUT",
    body: { status: target.status },
  });
  await rejectFailedResponse(
    writeResponse,
    {
      notFound: `ClickUp: Unable to find task ${parsed.id}.`,
      failed: `ClickUp: Failed to move task ${parsed.id} to "${target.status}".`,
    },
    async (response) =>
      `${await refusalDetail(response)}. Moving a task needs edit access to it.`,
  );

  // D3: a 2xx is not enough; the answer must be a task in the chosen status.
  const written = await readBody(writeResponse);
  const echoed =
    isRecord(written?.status) && typeof written.status.status === "string"
      ? written.status.status
      : undefined;

  if (typeof written?.id !== "string" || echoed === undefined) {
    throw new Error(unexpectedTask);
  }

  if (echoed.toLowerCase() !== target.status.toLowerCase()) {
    throw new Error(
      `ClickUp: Task ${parsed.id} did not move to "${target.status}"; it is in "${echoed}".`,
    );
  }

  return { outcome: "started", from: current.status, to: target.status };
}
