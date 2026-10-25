import { gitGetConfigValue } from "../lib/git.js";
import { InvalidValueError } from "../lib/prompt.js";
import { slugifyBranchTitle } from "../lib/utils.js";

export interface LinearIssue {
  identifier: string;
  title: string;
  url: string | null;
  labels: string[];
}

interface LinearGraphqlError {
  message?: unknown;
  extensions?: { code?: unknown };
}

interface LinearGraphqlResponse {
  data?: unknown;
  errors?: LinearGraphqlError[];
}

const LINEAR_ENDPOINT = "https://api.linear.app/graphql";
const LINEAR_REQUEST_TIMEOUT_MS = 15_000;

// D4: the id is a variable, never part of the query text. Title and labels are
// all the branch name needs; the description and comments are not requested.
const ISSUE_QUERY = `query Issue($id: String!) {
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

const VIEWER_QUERY = "query { viewer { id } }";

const AUTH_FAILED_MESSAGE =
  "Linear: Authentication failed. Please verify linear.apiKey in your config.";

// D5: same shape as a Jira key.
function getIssueIdentifier(issueId: string): string {
  const normalizedIssueId = issueId.trim().toUpperCase();

  if (!/^[A-Z][A-Z0-9]*-\d+$/.test(normalizedIssueId)) {
    throw new InvalidValueError(`Linear: Invalid issue id "${issueId}".`);
  }

  return normalizedIssueId;
}

export async function resolveLinearApiKey(): Promise<string> {
  const apiKey = await gitGetConfigValue("linear.apiKey");

  if (!apiKey) {
    throw new Error(
      'Linear: Missing config value "linear.apiKey". Run "worktree config" to configure Linear integration.',
    );
  }

  return apiKey;
}

// Every Linear request is bounded. The timeout message matches TIMEOUT_MESSAGE
// in base-command.ts; it names no header and never the key.
export async function fetchLinear(
  query: string,
  variables: Record<string, unknown>,
  apiKey: string,
): Promise<Response> {
  try {
    return await fetch(LINEAR_ENDPOINT, {
      method: "POST",
      // D3: the raw key, no `Bearer` prefix (that is for OAuth tokens).
      headers: { "Content-Type": "application/json", Authorization: apiKey },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(LINEAR_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error(
        `Linear: the request did not answer within ${LINEAR_REQUEST_TIMEOUT_MS / 1000}s.`,
        { cause: error },
      );
    }
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function readBody(
  response: Response,
): Promise<LinearGraphqlResponse | undefined> {
  try {
    const body: unknown = await response.json();
    return isRecord(body) ? (body as LinearGraphqlResponse) : undefined;
  } catch {
    return undefined;
  }
}

// Linear puts the code in extensions.code ("AUTHENTICATION_ERROR",
// "RATELIMITED"); extensions.type is a human-readable label.
function hasErrorCode(body: LinearGraphqlResponse, code: string): boolean {
  return (
    Array.isArray(body.errors) &&
    body.errors.some((error) => error?.extensions?.code === code)
  );
}

function parseLinearIssue(issue: unknown): LinearIssue | undefined {
  if (!isRecord(issue)) {
    return undefined;
  }

  const { identifier, title, url, labels } = issue;
  const nodes = isRecord(labels) ? labels.nodes : undefined;

  if (
    typeof identifier !== "string" ||
    typeof title !== "string" ||
    !Array.isArray(nodes) ||
    !nodes.every((node) => isRecord(node) && typeof node.name === "string")
  ) {
    return undefined;
  }

  return {
    identifier,
    title,
    url: typeof url === "string" ? url : null,
    labels: nodes.map((node) => (node as { name: string }).name),
  };
}

export async function fetchLinearIssue(issueId: string): Promise<LinearIssue> {
  const identifier = getIssueIdentifier(issueId);
  const apiKey = await resolveLinearApiKey();

  const response = await fetchLinear(ISSUE_QUERY, { id: identifier }, apiKey);

  if (response.status === 401 || response.status === 403) {
    throw new Error(AUTH_FAILED_MESSAGE);
  }

  const body = await readBody(response);

  // Linear can report bad auth in the body of a 200 or a 4xx answer.
  if (body && hasErrorCode(body, "AUTHENTICATION_ERROR")) {
    throw new Error(AUTH_FAILED_MESSAGE);
  }

  // Linear answers a rate-limited GraphQL request with HTTP 400 and the code
  // in the body (https://linear.app/developers/rate-limiting); 429 is kept too.
  if (response.status === 429 || (body && hasErrorCode(body, "RATELIMITED"))) {
    throw new Error(
      "Linear: Rate limited. Linear limits requests per API key; wait a moment and try again.",
    );
  }

  if (!response.ok) {
    throw new Error(
      `Linear: Failed to fetch issue ${identifier}. ${response.status} ${response.statusText}`.trimEnd(),
    );
  }

  if (!body) {
    throw new Error(`Linear: Unexpected response for issue ${identifier}.`);
  }

  const rawIssue = isRecord(body.data) ? body.data.issue : undefined;

  if (rawIssue === undefined || rawIssue === null) {
    const messages = (Array.isArray(body.errors) ? body.errors : [])
      .map((error) => error?.message)
      .filter((message): message is string => typeof message === "string");

    throw new Error(
      `Linear: Unable to find issue ${identifier}.${messages.length > 0 ? ` ${messages.join(", ")}` : ""}`,
    );
  }

  const issue = parseLinearIssue(rawIssue);

  if (!issue) {
    throw new Error(`Linear: Unexpected response for issue ${identifier}.`);
  }

  return issue;
}

// D7: Linear has no issue type, so the label decides. Bug wins over the rest.
export function getLinearBranchType(labels: string[]) {
  const names = labels.map((label) => label.toLowerCase());

  if (names.includes("bug")) {
    return "bugfix" as const;
  }

  if (names.includes("chore") || names.includes("maintenance")) {
    return "chore" as const;
  }

  return "feature" as const;
}

// Takes the issue already fetched so a caller can keep its url from the same
// request. D6: the same shape as Jira's name.
export async function getLinearBranchNameFromIssue(
  issue: LinearIssue,
): Promise<string> {
  const branchType = getLinearBranchType(issue.labels);

  const prefix = await gitGetConfigValue(
    branchType === "bugfix"
      ? "branchPrefix.bugfix"
      : branchType === "chore"
        ? "branchPrefix.chore"
        : "branchPrefix.feature",
  );

  return `${prefix}${issue.identifier}-${slugifyBranchTitle(issue.title)}`;
}

export async function validateLinearCredentials(): Promise<boolean> {
  try {
    const apiKey = await resolveLinearApiKey();
    const response = await fetchLinear(VIEWER_QUERY, {}, apiKey);

    if (!response.ok) {
      return false;
    }

    const body = await readBody(response);

    return (
      !!body &&
      !body.errors?.length &&
      isRecord(body.data) &&
      isRecord(body.data.viewer)
    );
  } catch {
    return false;
  }
}
