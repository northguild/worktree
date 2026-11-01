import {
  type BranchMatch,
  type BranchNaming,
  evaluateBranchTypeRules,
  type FieldValue,
  type IssueField,
  matchOfResult,
} from "../lib/branch-type.js";
import { gitGetConfigValue } from "../lib/config.js";
import {
  getBranchTypeRules,
  getTeamConfigValue,
  renderBranchName,
} from "../lib/project-config.js";
import { InvalidValueError } from "../lib/prompt.js";
import { slugifyBranchTitle } from "../lib/utils.js";

interface JiraCredentials {
  host: string;
  email: string;
  apiToken: string;
}

interface JiraIssue {
  id: string;
  key: string;
  /** Field id to display name; present only when asked for with `expand=names`. */
  names?: Record<string, string>;
  fields: {
    summary: string;
    issuetype: {
      id: string;
      name: string;
    };
    [key: string]: unknown;
  };
}

interface JiraErrorResponse {
  errorMessages?: string[];
  errors: Record<string, string>;
}

export function isJiraError(response: unknown): response is JiraErrorResponse {
  return (
    !!response &&
    typeof response === "object" &&
    ("errorMessages" in response || "errors" in response)
  );
}

export function isJiraIssue(response: unknown): response is JiraIssue {
  return (
    !!response &&
    typeof response === "object" &&
    "key" in response &&
    "fields" in response
  );
}

function normalizeJiraHost(host: string): string {
  return host
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

function getIssueKey(issueId: string): string {
  const normalizedIssueId = issueId.trim().toUpperCase();

  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(normalizedIssueId)) {
    throw new InvalidValueError(`Jira: Invalid issue id "${issueId}".`);
  }

  return normalizedIssueId;
}

function getJiraAuthHeaders({ email, apiToken }: JiraCredentials): HeadersInit {
  const auth = Buffer.from(`${email}:${apiToken}`).toString("base64");

  return {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
  };
}

async function resolveJiraCredentials(): Promise<JiraCredentials> {
  const [host, email, apiToken] = await Promise.all([
    // D17: a host from the project file is trusted like merged code, so no prompt.
    getTeamConfigValue("jira.host"),
    gitGetConfigValue("jira.email"),
    gitGetConfigValue("jira.apiToken"),
  ]);

  if (!host) {
    throw new Error(
      'Jira: Missing config value "jira.host". Run "worktree config" to configure Jira integration.',
    );
  }

  if (!email) {
    throw new Error(
      'Jira: Missing config value "jira.email". Run "worktree config" to configure Jira integration.',
    );
  }

  if (!apiToken) {
    throw new Error(
      'Jira: Missing config value "jira.apiToken". Run "worktree config" to configure Jira integration.',
    );
  }

  const normalizedHost = normalizeJiraHost(host);

  if (!normalizedHost) {
    throw new Error(
      'Jira: Config value "jira.host" cannot be empty. Run "worktree config" to update it.',
    );
  }

  return {
    host: normalizedHost,
    email,
    apiToken,
  };
}

function getJiraBranchType(issue: JiraIssue) {
  const issueType = issue.fields.issuetype;
  const issueTypeName = issueType.name.toLowerCase();

  if (
    issueTypeName === "task" ||
    issueTypeName === "chore" ||
    issueTypeName === "maintenance"
  ) {
    return "chore" as const;
  }

  if (issueTypeName === "bug") {
    return "bugfix" as const;
  }

  return "feature" as const;
}

// D9: what a field holds, in the shape the rules compare. A select option is
// its `value`; an issue type, component, priority or status its `name`; a user
// its `displayName`; a cascading select both levels; a label or a number
// itself. Anything else (rich text, dates, objects of an unknown shape) is
// nothing, so a rule on it matches nothing rather than guessing.
function normalizeJiraFieldValue(raw: unknown): FieldValue[] {
  if (typeof raw === "string" || typeof raw === "number") {
    return [{ name: String(raw) }];
  }
  if (Array.isArray(raw)) {
    return raw.flatMap(normalizeJiraFieldValue);
  }
  if (typeof raw !== "object" || raw === null) {
    return [];
  }
  const option = raw as Record<string, unknown>;
  const label = [option.value, option.name, option.displayName].find(
    (candidate) => typeof candidate === "string",
  );
  const identifier = option.id ?? option.accountId;
  const own: FieldValue[] =
    typeof label === "string" || identifier !== undefined
      ? [
          {
            ...(typeof identifier === "string" || typeof identifier === "number"
              ? { id: String(identifier) }
              : {}),
            ...(typeof label === "string" ? { name: label } : {}),
          },
        ]
      : [];
  return [...own, ...normalizeJiraFieldValue(option.child)];
}

// The portable names (D3, D4): `Type` and `Labels` are added beside `issuetype`
// and `labels`, found by id since the display name only arrives with
// `expand=names` and is localized. Each is skipped when a field of that name or
// id exists, so a real custom field is never shadowed or made ambiguous, and an
// English Jira, whose `labels` is already named Labels, gets no second one.
export function getJiraIssueFields(issue: JiraIssue): IssueField[] {
  const fields = Object.entries(issue.fields).map(([id, raw]) => ({
    id,
    name: issue.names?.[id] ?? id,
    values: normalizeJiraFieldValue(raw),
  }));
  const aliases = [
    { alias: "Type", native: "issuetype" },
    { alias: "Labels", native: "labels" },
  ].flatMap(({ alias, native }) => {
    const source = fields.find((field) => field.id === native);
    const taken = fields.some(
      (field) =>
        field.id === alias || field.name.toLowerCase() === alias.toLowerCase(),
    );
    return source && !taken
      ? [{ id: alias, name: alias, values: source.values }]
      : [];
  });
  return [...fields, ...aliases];
}

const JIRA_REQUEST_TIMEOUT_MS = 15_000;

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

// D5: a timeout names the call. The path goes in the message; the auth
// headers, which carry the token, never do.
function timeoutError(path: string, cause: unknown): Error {
  return new Error(
    `Jira: ${path} did not answer within ${JIRA_REQUEST_TIMEOUT_MS / 1000}s.`,
    { cause },
  );
}

// The request's signal also bounds reading the body, so a body that stalls
// after the headers arrive rejects with the same TimeoutError as the fetch.
async function readJiraBody<T>(
  path: string,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (isTimeout(error)) {
      throw timeoutError(path, error);
    }
    throw error;
  }
}

// D5: every Jira request is bounded, body included.
async function fetchJira(
  path: string,
  credentials: JiraCredentials,
  init: { method?: "GET" | "PUT" | "POST"; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    ...(getJiraAuthHeaders(credentials) as Record<string, string>),
  };
  const hasBody = init.body !== undefined;

  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }

  try {
    return await fetch(`https://${credentials.host}${path}`, {
      method: init.method ?? "GET",
      headers,
      ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(JIRA_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (isTimeout(error)) {
      throw timeoutError(path, error);
    }
    throw error;
  }
}

/** `names` asks Jira for field display names, which only the rules need (D9). */
export async function fetchJiraIssue(
  issueId: string,
  options: { names?: boolean } = {},
): Promise<JiraIssue> {
  const issueKey = getIssueKey(issueId);
  const credentials = await resolveJiraCredentials();

  const issuePath = `/rest/api/3/issue/${issueKey}${options.names ? "?expand=names" : ""}`;
  const response = await fetchJira(issuePath, credentials);
  const loginReason = response.headers?.get?.("x-seraph-loginreason");

  if (response.status === 401 || loginReason === "AUTHENTICATED_FAILED") {
    throw new Error(
      "Jira: Authentication failed. Please verify jira.email and jira.apiToken in your config.",
    );
  }

  if (!response.ok) {
    const errorMessage = await readJiraBody(issuePath, () => response.text());
    throw new Error(
      `Jira: Failed to fetch issue ${issueKey}. ${response.status} ${response.statusText}${errorMessage ? ` - ${errorMessage}` : ""}`,
    );
  }

  const data = await readJiraBody(issuePath, () => response.json());

  if (isJiraError(data)) {
    const errorMessage =
      data.errorMessages?.join(", ") ||
      Object.values(data.errors ?? {}).join(", ") ||
      "Unknown Jira API error";
    throw new Error(`Jira: ${errorMessage}`);
  }

  if (!isJiraIssue(data)) {
    throw new Error(`Jira: Unable to find issue ${issueKey}.`);
  }

  return data;
}

/**
 * With `jira.branchType` (else the shared `branchType`) in the project file the
 * rules decide the kind (D10) and an issue no rule matches gets no prefix;
 * without either the built-in mapping applies. Rule warnings go to
 * `onWarning`. A dry run asks Jira for display names even with no rules (D9),
 * because showing them is its job.
 */
export async function getJiraBranchNaming(
  issueId: string,
  options: { onWarning?: (warning: string) => void; dryRun?: boolean } = {},
): Promise<BranchNaming> {
  const list = await getBranchTypeRules("jira");
  const issue = await fetchJiraIssue(issueId, {
    names: list !== undefined || options.dryRun === true,
  });
  const fields = getJiraIssueFields(issue);

  let kind: ReturnType<typeof getJiraBranchType> | undefined;
  let match: BranchMatch;
  if (list) {
    const result = evaluateBranchTypeRules(list.rules, fields, list.listName, {
      // A dry run is where rules are written and checked, so a misspelt field
      // in the shared list still warns there (D5 holds for real runs).
      shared: list.shared && options.dryRun !== true,
    });
    for (const warning of result.warnings) {
      options.onWarning?.(warning);
    }
    kind = result.kind;
    match = matchOfResult(result);
  } else {
    kind = getJiraBranchType(issue);
    match = { source: "built-in" };
  }

  const prefixConfigName =
    kind === "bugfix"
      ? "branchPrefix.bugfix"
      : kind === "chore"
        ? "branchPrefix.chore"
        : kind === "feature"
          ? "branchPrefix.feature"
          : undefined;

  const prefix = prefixConfigName
    ? await getTeamConfigValue(prefixConfigName)
    : "";

  const branchName = await renderBranchName({
    prefix,
    id: issue.key,
    slug: slugifyBranchTitle(issue.fields.summary),
  });
  return { branchName, kind, fields, match };
}

export async function getJiraBranchNameFromIssue(
  issueId: string,
  onWarning: (warning: string) => void = () => {},
): Promise<string> {
  return (await getJiraBranchNaming(issueId, { onWarning })).branchName;
}

export async function validateJiraCredentials(): Promise<boolean> {
  try {
    const credentials = await resolveJiraCredentials();
    const response = await fetchJira("/rest/api/3/myself", credentials);

    return response.ok;
  } catch {
    return false;
  }
}

/** `displayName` is the caller's own; `heldBy` is whoever has the issue. */
export type JiraAssignment =
  | { outcome: "assigned" | "already-yours"; displayName: string }
  | { outcome: "held-by-other"; displayName: string; heldBy: string };

interface JiraUser {
  accountId?: string;
  displayName?: string;
}

// D5: a failed assignment is named in the person's terms. The messages carry
// the issue key and the API's own text, never a header. `step` is which of the
// three requests failed, because each needs something different: reading the
// caller needs only a login, reading the issue needs Browse Projects, and
// writing its assignee needs Assign Issues.
async function jiraAssignFailure(
  response: Response,
  path: string,
  issueKey: string,
  step: "caller" | "issue" | "assignee",
): Promise<Error> {
  if (response.status === 401) {
    return new Error(
      "Jira: Authentication failed. Please verify jira.email and jira.apiToken in your config.",
    );
  }

  if (response.status === 403 && step !== "caller") {
    const permission = step === "issue" ? "Browse Projects" : "Assign Issues";
    return new Error(
      `Jira: Your account lacks the ${permission} permission on the project of ${issueKey}.`,
    );
  }

  if (response.status === 404 && step !== "caller") {
    return new Error(`Jira: Issue ${issueKey} was not found.`);
  }

  const errorMessage = await readJiraBody(path, () => response.text());
  const detail = `${response.status} ${response.statusText}${errorMessage ? ` - ${errorMessage}` : ""}`;

  if (response.status === 400 && step === "assignee") {
    return new Error(
      `Jira: The account was not accepted as assignee for ${issueKey}. ${detail}`,
    );
  }

  return new Error(`Jira: Failed to assign issue ${issueKey}. ${detail}`);
}

// D1/D2: assigns the issue to the caller unless someone else holds it. Reads
// the caller and the current assignee together, then writes only when the issue
// is free. Jira holds one assignee, so a write would replace a colleague's.
export async function assignJiraIssue(
  issueId: string,
): Promise<JiraAssignment> {
  const issueKey = getIssueKey(issueId);
  const credentials = await resolveJiraCredentials();

  const myselfPath = "/rest/api/3/myself";
  const assigneePath = `/rest/api/3/issue/${issueKey}?fields=assignee`;
  const [myselfResponse, issueResponse] = await Promise.all([
    fetchJira(myselfPath, credentials),
    fetchJira(assigneePath, credentials),
  ]);

  if (!myselfResponse.ok) {
    throw await jiraAssignFailure(
      myselfResponse,
      myselfPath,
      issueKey,
      "caller",
    );
  }

  if (!issueResponse.ok) {
    throw await jiraAssignFailure(
      issueResponse,
      assigneePath,
      issueKey,
      "issue",
    );
  }

  const me = await readJiraBody<JiraUser>(myselfPath, () =>
    myselfResponse.json(),
  );
  const issue = await readJiraBody<{
    fields?: { assignee?: JiraUser | null };
  }>(assigneePath, () => issueResponse.json());
  const assignee = issue.fields?.assignee;
  const displayName = me.displayName ?? "you";

  if (!me.accountId) {
    throw new Error("Jira: Could not determine the account for jira.email.");
  }

  if (assignee?.accountId === me.accountId) {
    return { outcome: "already-yours", displayName };
  }

  if (assignee) {
    return {
      outcome: "held-by-other",
      displayName,
      heldBy: assignee.displayName ?? "someone else",
    };
  }

  // Not atomic: someone who takes the issue between the read above and this
  // write is replaced. Jira has no conditional assign, so the window is
  // narrowed, not closed.
  const path = `/rest/api/3/issue/${issueKey}/assignee`;
  const putResponse = await fetchJira(path, credentials, {
    method: "PUT",
    body: { accountId: me.accountId },
  });

  if (!putResponse.ok) {
    throw await jiraAssignFailure(putResponse, path, issueKey, "assignee");
  }

  return { outcome: "assigned", displayName };
}

/** `from` and `to` are status names; `targets` are the names Jira offered. */
export type JiraStart =
  | { outcome: "started"; from: string; to: string }
  | { outcome: "already-started"; status: string }
  | { outcome: "left-alone"; status: string; category: string }
  | { outcome: "no-in-progress-transition"; status: string }
  | { outcome: "ambiguous"; status: string; targets: string[] };

interface JiraStatus {
  id?: string;
  name?: string;
  statusCategory?: { key?: string };
}

interface JiraTransition {
  id?: string;
  name?: string;
  isAvailable?: boolean;
  to?: JiraStatus;
}

// D8: a failed move is named in the person's terms. The messages carry the
// issue key and the API's own text, never a header. `transitionName` is set
// only for the write, whose 400 means the transition's screen wants a field (D4).
async function jiraStartFailure(
  response: Response,
  path: string,
  issueKey: string,
  transitionName?: string,
): Promise<Error> {
  if (response.status === 401) {
    return new Error(
      "Jira: Authentication failed. Please verify jira.email and jira.apiToken in your config.",
    );
  }

  if (response.status === 404) {
    return new Error(`Jira: Issue ${issueKey} was not found.`);
  }

  const errorMessage = await readJiraBody(path, () => response.text());
  const detail = `${response.status} ${response.statusText}${errorMessage ? ` - ${errorMessage}` : ""}`;

  if (response.status === 400 && transitionName) {
    return new Error(
      `Jira: Could not move ${issueKey} with the "${transitionName}" transition; it may need a field set in Jira. ${detail}`,
    );
  }

  if (response.status === 409) {
    return new Error(
      `Jira: ${issueKey} was changed while it was being moved. Try again. ${detail}`,
    );
  }

  return new Error(`Jira: Failed to move issue ${issueKey}. ${detail}`);
}

// D1-D7: moves a not-yet-begun issue to the one in-progress status its
// workflow offers. Reads the status first and the transitions only when the
// issue is in the "new" category (D5), then writes only when exactly one
// distinct in-progress target exists (D3). A 204 is success (D6).
export async function startJiraIssue(issueId: string): Promise<JiraStart> {
  const issueKey = getIssueKey(issueId);
  const credentials = await resolveJiraCredentials();
  const unexpected = () =>
    new Error(`Jira: Unexpected response for ${issueKey}.`);

  const statusPath = `/rest/api/3/issue/${issueKey}?fields=status`;
  const statusResponse = await fetchJira(statusPath, credentials);

  if (!statusResponse.ok) {
    throw await jiraStartFailure(statusResponse, statusPath, issueKey);
  }

  const issue = await readJiraBody<{ fields?: { status?: JiraStatus } }>(
    statusPath,
    () => statusResponse.json(),
  );
  const current = issue.fields?.status;
  const categoryKey = current?.statusCategory?.key;

  if (!current || typeof categoryKey !== "string") {
    throw unexpected();
  }

  const status = current.name ?? "unknown";

  if (categoryKey === "indeterminate") {
    return { outcome: "already-started", status };
  }

  if (categoryKey !== "new") {
    return { outcome: "left-alone", status, category: categoryKey };
  }

  const transitionsPath = `/rest/api/3/issue/${issueKey}/transitions`;
  const transitionsResponse = await fetchJira(transitionsPath, credentials);

  if (!transitionsResponse.ok) {
    throw await jiraStartFailure(
      transitionsResponse,
      transitionsPath,
      issueKey,
    );
  }

  const body = await readJiraBody<{ transitions?: unknown }>(
    transitionsPath,
    () => transitionsResponse.json(),
  );

  if (!Array.isArray(body.transitions)) {
    throw unexpected();
  }

  const candidates = (body.transitions as JiraTransition[]).filter(
    (transition) =>
      transition.isAvailable !== false &&
      typeof transition.id === "string" &&
      transition.to?.statusCategory?.key === "indeterminate" &&
      transition.to.id !== current.id,
  );
  const targetNames: string[] = [];
  const targetIds = new Set<string | undefined>();

  for (const candidate of candidates) {
    if (!targetIds.has(candidate.to?.id)) {
      targetIds.add(candidate.to?.id);
      targetNames.push(candidate.to?.name ?? "unknown");
    }
  }

  const chosen = candidates[0];

  if (!chosen) {
    return { outcome: "no-in-progress-transition", status };
  }

  if (targetIds.size > 1) {
    return { outcome: "ambiguous", status, targets: targetNames };
  }

  const postResponse = await fetchJira(transitionsPath, credentials, {
    method: "POST",
    body: { transition: { id: chosen.id } },
  });

  if (!postResponse.ok) {
    throw await jiraStartFailure(
      postResponse,
      transitionsPath,
      issueKey,
      chosen.name ?? chosen.id,
    );
  }

  return { outcome: "started", from: status, to: targetNames[0] };
}
