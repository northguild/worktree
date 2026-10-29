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

// The classification every Linear answer goes through: auth, rate limit,
// non-2xx and an unreadable body. Each caller words its own non-2xx and
// malformed-body messages; auth and rate limit read the same everywhere,
// except that a caller may follow the auth message with a hint of its own.
async function readLinearAnswer(
  response: Response,
  messages: {
    failed: (body: LinearGraphqlResponse | undefined) => string;
    unexpected: string;
    authHint?: string;
  },
): Promise<LinearGraphqlResponse> {
  const authFailed = messages.authHint
    ? `${AUTH_FAILED_MESSAGE} ${messages.authHint}`
    : AUTH_FAILED_MESSAGE;

  if (response.status === 401 || response.status === 403) {
    throw new Error(authFailed);
  }

  const body = await readBody(response);

  // Linear can report bad auth in the body of a 200 or a 4xx answer.
  if (body && hasErrorCode(body, "AUTHENTICATION_ERROR")) {
    throw new Error(authFailed);
  }

  // Linear answers a rate-limited GraphQL request with HTTP 400 and the code
  // in the body (https://linear.app/developers/rate-limiting); 429 is kept too.
  if (response.status === 429 || (body && hasErrorCode(body, "RATELIMITED"))) {
    throw new Error(
      "Linear: Rate limited. Linear limits requests per API key; wait a moment and try again.",
    );
  }

  if (!response.ok) {
    throw new Error(messages.failed(body));
  }

  if (!body) {
    throw new Error(messages.unexpected);
  }

  return body;
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

  const body = await readLinearAnswer(response, {
    failed: () =>
      `Linear: Failed to fetch issue ${identifier}. ${response.status} ${response.statusText}`.trimEnd(),
    unexpected: `Linear: Unexpected response for issue ${identifier}.`,
  });

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
  dryRun = false,
): Promise<BranchNaming> {
  const list = await getBranchTypeRules("linear");
  const fields = getLinearIssueFields(issue);

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

export type LinearStart =
  | { outcome: "started"; from: string; to: string }
  | { outcome: "already-started"; state: string }
  | { outcome: "left-alone"; state: string; type: string }
  | { outcome: "no-started-state"; state: string };

// D1: the read asks for the team's started states in the same request.
const START_READ_QUERY = `query IssueToStart($id: String!) {
  issue(id: $id) {
    identifier
    state { id name type }
    team {
      states(filter: { type: { eq: "started" } }) {
        nodes { id name position }
      }
    }
  }
}`;

// D3: the answer carries the state the issue is in, so the move is confirmed.
const START_WRITE_MUTATION = `mutation StartIssue($id: String!, $stateId: String!) {
  issueUpdate(id: $id, input: { stateId: $stateId }) {
    success
    issue { state { id name type } }
  }
}`;

const WRITE_PERMISSION_HINT =
  "Moving an issue needs a key with the Write permission and access to the issue's team.";

interface LinearState {
  id: string;
  name: string;
  type: string;
}

function parseState(value: unknown): LinearState | undefined {
  if (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    typeof value.type === "string"
  ) {
    return { id: value.id, name: value.name, type: value.type };
  }
  return undefined;
}

function errorMessages(body: LinearGraphqlResponse | undefined): string[] {
  return (Array.isArray(body?.errors) ? body.errors : [])
    .map((error) => error?.message)
    .filter((message): message is string => typeof message === "string");
}

// The started state with the lowest position; a tie keeps the first node.
function lowestStartedState(
  nodes: unknown[],
): { id: string; name: string } | null | undefined {
  let lowest: { id: string; name: string; position: number } | undefined;

  for (const node of nodes) {
    if (
      !isRecord(node) ||
      typeof node.id !== "string" ||
      typeof node.name !== "string" ||
      typeof node.position !== "number"
    ) {
      return undefined;
    }
    if (!lowest || node.position < lowest.position) {
      lowest = { id: node.id, name: node.name, position: node.position };
    }
  }

  return lowest ?? null;
}

/**
 * D1-D3, D7: moves a backlog or unstarted issue to its team's first started
 * state, and confirms the move from the answer. Throws a `Linear:` error on
 * every failure; the caller turns it into a warning.
 */
export async function startLinearIssue(issueId: string): Promise<LinearStart> {
  const identifier = getIssueIdentifier(issueId);
  const apiKey = await resolveLinearApiKey();

  const readResponse = await fetchLinear(
    START_READ_QUERY,
    { id: identifier },
    apiKey,
  );
  const readAnswer = await readLinearAnswer(readResponse, {
    failed: (body) =>
      `Linear: Failed to fetch issue ${identifier}. ${failureDetail(readResponse, body)}`,
    unexpected: `Linear: Unexpected response for issue ${identifier}.`,
  });

  const rawIssue = isRecord(readAnswer.data)
    ? readAnswer.data.issue
    : undefined;

  if (rawIssue === undefined || rawIssue === null) {
    throw new Error(
      `Linear: Unable to find issue ${identifier}.${withMessages(readAnswer)}`,
    );
  }

  const unexpected = `Linear: Unexpected response for issue ${identifier}.`;
  const team = isRecord(rawIssue) ? rawIssue.team : undefined;
  const states = isRecord(team) ? team.states : undefined;
  const nodes = isRecord(states) ? states.nodes : undefined;
  const current = isRecord(rawIssue) ? parseState(rawIssue.state) : undefined;

  if (!current || !Array.isArray(nodes)) {
    throw new Error(unexpected);
  }

  const target = lowestStartedState(nodes);

  if (target === undefined) {
    throw new Error(unexpected);
  }

  if (current.type === "started") {
    return { outcome: "already-started", state: current.name };
  }

  if (current.type !== "backlog" && current.type !== "unstarted") {
    return { outcome: "left-alone", state: current.name, type: current.type };
  }

  if (target === null) {
    return { outcome: "no-started-state", state: current.name };
  }

  const writeResponse = await fetchLinear(
    START_WRITE_MUTATION,
    { id: identifier, stateId: target.id },
    apiKey,
  );
  // The same key has just read the issue, so an auth refusal here is most
  // likely a key without the Write permission or the team's access.
  const writeBody = await readLinearAnswer(writeResponse, {
    failed: (body) =>
      `Linear: Failed to move issue ${identifier}. ${failureDetail(writeResponse, body, WRITE_PERMISSION_HINT)}`,
    unexpected: `Linear: Unexpected response moving issue ${identifier}.`,
    authHint: WRITE_PERMISSION_HINT,
  });

  const messages = errorMessages(writeBody);
  if (messages.length > 0) {
    throw new Error(
      `Linear: Failed to move issue ${identifier}. ${sentence(messages.join(", "))} ${WRITE_PERMISSION_HINT}`,
    );
  }

  const update = isRecord(writeBody.data)
    ? writeBody.data.issueUpdate
    : undefined;
  const moved =
    isRecord(update) && update.success === true && isRecord(update.issue)
      ? parseState(update.issue.state)
      : undefined;

  if (!moved || moved.id !== target.id) {
    throw new Error(
      `Linear: The answer did not confirm moving issue ${identifier} to "${target.name}".`,
    );
  }

  return { outcome: "started", from: current.name, to: moved.name };
}

function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

// Keeps the HTTP status (as fetchLinearIssue does) and Linear's own text; the
// hint is added only when Linear's answer carried errors and it was not a 5xx.
function failureDetail(
  response: Response,
  body: LinearGraphqlResponse | undefined,
  hint?: string,
): string {
  const messages = errorMessages(body);
  const parts = [`${response.status} ${response.statusText}`.trimEnd()];
  if (messages.length > 0) {
    parts.push(messages.join(", "));
    if (hint !== undefined && response.status < 500) {
      parts.push(hint);
    }
  }
  return parts.map(sentence).join(" ");
}

function withMessages(body: LinearGraphqlResponse | undefined): string {
  const messages = errorMessages(body);
  return messages.length > 0 ? ` ${messages.join(", ")}` : "";
}
