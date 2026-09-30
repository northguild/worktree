import { gitGetConfigValue } from "../lib/git.js";
import { sanitizeBranchName } from "../lib/utils.js";

interface JiraCredentials {
  host: string;
  email: string;
  apiToken: string;
}

interface JiraIssue {
  id: string;
  key: string;
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
    throw new Error(`Jira: Invalid issue id "${issueId}".`);
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
    gitGetConfigValue("jira.host"),
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

const JIRA_REQUEST_TIMEOUT_MS = 15_000;

// D5: every Jira request is bounded, and a timeout names the call. The path
// goes in the message; the auth headers, which carry the token, never do.
async function fetchJira(
  path: string,
  credentials: JiraCredentials,
): Promise<Response> {
  try {
    return await fetch(`https://${credentials.host}${path}`, {
      method: "GET",
      headers: getJiraAuthHeaders(credentials),
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

export async function fetchJiraIssue(issueId: string): Promise<JiraIssue> {
  const issueKey = getIssueKey(issueId);
  const credentials = await resolveJiraCredentials();

  const response = await fetchJira(
    `/rest/api/3/issue/${issueKey}`,
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

export async function getJiraBranchNameFromIssue(
  issueId: string,
): Promise<string> {
  const issue = await fetchJiraIssue(issueId);
  const branchType = getJiraBranchType(issue);

  const prefixConfigName =
    branchType === "bugfix"
      ? "branchPrefix.bugfix"
      : branchType === "chore"
        ? "branchPrefix.chore"
        : "branchPrefix.feature";

  const prefix = await gitGetConfigValue(prefixConfigName);

  return `${prefix}${issue.key}-${sanitizeBranchName(issue.fields.summary) || "issue"}`;
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
