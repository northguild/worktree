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
  renderBranchName,
} from "../lib/project-config.js";
import { InvalidValueError } from "../lib/prompt.js";
import { slugifyBranchTitle } from "../lib/utils.js";

export interface LinearIssue {
  identifier: string;
  title: string;
  url: string | null;
  labels: string[];
  /** Each label with its id; present only when asked for, which rules need (D9). */
  labelNodes?: { id: string; name: string }[];
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
const issueQuery = (labelFields: string) => `query Issue($id: String!) {
  issue(id: $id) {
    identifier
    title
    url
    labels {
      nodes {
${labelFields}
      }
    }
  }
}`;

const ISSUE_QUERY = issueQuery("        name");

// D9: the label id is asked for only when `linear.branchType` or the shared
// `branchType` rules exist, so a run without them sends the request it always sent. `id` is a field of
// Linear's `IssueLabel` type (https://studio.apollographql.com/public/Linear-API/variant/current/schema/reference/objects/IssueLabel).
const ISSUE_QUERY_WITH_LABEL_IDS = issueQuery("        id\n        name");

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

function parseLinearIssue(
  issue: unknown,
  withLabelIds: boolean,
): LinearIssue | undefined {
  if (!isRecord(issue)) {
    return undefined;
  }

  const { identifier, title, url, labels } = issue;
  const nodes = isRecord(labels) ? labels.nodes : undefined;

  if (
    typeof identifier !== "string" ||
    typeof title !== "string" ||
    !Array.isArray(nodes) ||
    !nodes.every(
      (node) =>
        isRecord(node) &&
        typeof node.name === "string" &&
        (!withLabelIds || typeof node.id === "string"),
    )
  ) {
    return undefined;
  }

  const labelNodes = nodes as { id: string; name: string }[];
  return {
    identifier,
    title,
    url: typeof url === "string" ? url : null,
    labels: labelNodes.map((node) => node.name),
    ...(withLabelIds
      ? { labelNodes: labelNodes.map(({ id, name }) => ({ id, name })) }
      : {}),
  };
}

/**
 * `labelIds` asks for each label's id even with no rules: a dry run exists to
 * show them (D9, D13).
 */
export async function fetchLinearIssue(
  issueId: string,
  options: { labelIds?: boolean } = {},
): Promise<LinearIssue> {
  const identifier = getIssueIdentifier(issueId);
  const apiKey = await resolveLinearApiKey();
  const withLabelIds =
    options.labelIds === true ||
    (await getBranchTypeRules("linear")) !== undefined;

  const response = await fetchLinear(
    withLabelIds ? ISSUE_QUERY_WITH_LABEL_IDS : ISSUE_QUERY,
    { id: identifier },
    apiKey,
  );

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

  const issue = parseLinearIssue(rawIssue, withLabelIds);

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

// D9: Linear's rule field in v1 is `Labels`, with ids when the issue was
// fetched for rules and names alone otherwise.
export function getLinearIssueFields(issue: LinearIssue): IssueField[] {
  return [
    {
      id: "Labels",
      name: "Labels",
      values: issue.labelNodes ?? issue.labels.map((name) => ({ name })),
    },
  ];
}

// Takes the issue already fetched so a caller can keep its url from the same
// request. D6: the same shape as Jira's name. With `linear.branchType` (else
// the shared `branchType`) in the project file the rules decide the kind (D10)
// and an issue no rule matches gets no prefix; without either the built-in
// mapping applies. Rule warnings go to `onWarning`.
export async function getLinearBranchNaming(
  issue: LinearIssue,
  onWarning: (warning: string) => void = () => {},
): Promise<BranchNaming> {
  const list = await getBranchTypeRules("linear");
  const fields = getLinearIssueFields(issue);

  let kind: BranchKind | undefined;
  let match: BranchMatch;
  if (list) {
    const result = evaluateBranchTypeRules(list.rules, fields, list.listName);
    for (const warning of result.warnings) {
      onWarning(warning);
    }
    kind = result.kind;
    match = matchOfResult(result);
  } else {
    kind = getLinearBranchType(issue.labels);
    match = { source: "built-in" };
  }

  const branchName = await renderBranchName({
    prefix: await getBranchPrefix(kind),
    id: issue.identifier,
    slug: slugifyBranchTitle(issue.title),
  });
  return { branchName, kind, fields, match };
}

export async function getLinearBranchNameFromIssue(
  issue: LinearIssue,
  onWarning: (warning: string) => void = () => {},
): Promise<string> {
  return (await getLinearBranchNaming(issue, onWarning)).branchName;
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
