import {
  evaluateBranchTypeRules,
  type FieldValue,
  type IssueField,
} from "../lib/branch-type.js";
import { gitGetConfigValue } from "../lib/git.js";
import {
  getTeamConfigValue,
  loadProjectConfig,
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

export function getJiraIssueFields(issue: JiraIssue): IssueField[] {
  return Object.entries(issue.fields).map(([id, raw]) => ({
    id,
    name: issue.names?.[id] ?? id,
    values: normalizeJiraFieldValue(raw),
  }));
}

const JIRA_REQUEST_TIMEOUT_MS = 15_000;

// D5: every Jira request is bounded, and a timeout names the call. The path
// goes in the message; the auth headers, which carry the token, never do.
async function fetchJira(
  path: string,
  credentials: JiraCredentials,
  init: { method?: "GET" | "PUT"; body?: unknown } = {},
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
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(
        `Jira: ${path} did not answer within ${JIRA_REQUEST_TIMEOUT_MS / 1000}s.`,
        { cause: error },
      );
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

  const response = await fetchJira(
    `/rest/api/3/issue/${issueKey}${options.names ? "?expand=names" : ""}`,
    credentials,
  );
  const loginReason = response.headers?.get?.("x-seraph-loginreason");

  if (response.status === 401 || loginReason === "AUTHENTICATED_FAILED") {
    throw new Error(
      "Jira: Authentication failed. Please verify jira.email and jira.apiToken in your config.",
    );
  }

  if (!response.ok) {
    const errorMessage = await response.text();
    throw new Error(
      `Jira: Failed to fetch issue ${issueKey}. ${response.status} ${response.statusText}${errorMessage ? ` - ${errorMessage}` : ""}`,
    );
  }

  const data = await response.json();

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
 * With `jira.branchType` in the project file the rules decide the kind (D10)
 * and an issue no rule matches gets no prefix; without it the built-in mapping
 * applies. Rule warnings go to `onWarning`.
 */
export async function getJiraBranchNameFromIssue(
  issueId: string,
  onWarning: (warning: string) => void = () => {},
): Promise<string> {
  const project = await loadProjectConfig();
  const rules =
    project.status === "loaded" ? project.config.jira?.branchType : undefined;
  const issue = await fetchJiraIssue(issueId, { names: rules !== undefined });

  let branchType: ReturnType<typeof getJiraBranchType> | undefined;
  if (rules) {
    const result = evaluateBranchTypeRules(
      rules,
      getJiraIssueFields(issue),
      "jira.branchType",
    );
    for (const warning of result.warnings) {
      onWarning(warning);
    }
    branchType = result.kind;
  } else {
    branchType = getJiraBranchType(issue);
  }

  const prefixConfigName =
    branchType === "bugfix"
      ? "branchPrefix.bugfix"
      : branchType === "chore"
        ? "branchPrefix.chore"
        : branchType === "feature"
          ? "branchPrefix.feature"
          : undefined;

  const prefix = prefixConfigName
    ? await getTeamConfigValue(prefixConfigName)
    : "";

  return renderBranchName({
    prefix,
    id: issue.key,
    slug: slugifyBranchTitle(issue.fields.summary),
  });
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

  const errorMessage = await response.text();
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

  const [myselfResponse, issueResponse] = await Promise.all([
    fetchJira("/rest/api/3/myself", credentials),
    fetchJira(`/rest/api/3/issue/${issueKey}?fields=assignee`, credentials),
  ]);

  if (!myselfResponse.ok) {
    throw await jiraAssignFailure(myselfResponse, issueKey, "caller");
  }

  if (!issueResponse.ok) {
    throw await jiraAssignFailure(issueResponse, issueKey, "issue");
  }

  const me = (await myselfResponse.json()) as JiraUser;
  const issue = (await issueResponse.json()) as {
    fields?: { assignee?: JiraUser | null };
  };
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
    throw await jiraAssignFailure(putResponse, issueKey, "assignee");
  }

  return { outcome: "assigned", displayName };
}
