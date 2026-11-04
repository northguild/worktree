import { redactSecrets } from "../lib/redact.js";

// Writes to Linear as an OAuth app (the agent), not as a person. The personal
// key client in linear.ts sends the raw key; an OAuth access token goes behind
// `Bearer` (https://linear.app/developers/graphql, "OAuth2 authentication").
// Timeout and bounded body read follow linear.ts's fetchLinear (#115 D10).
const LINEAR_ENDPOINT = "https://api.linear.app/graphql";
const LINEAR_REQUEST_TIMEOUT_MS = 15_000;

// https://linear.app/developers/graphql, "viewer".
const VIEWER_QUERY = "query Me { viewer { id } }";

// https://linear.app/developers/agent-interaction, `agentActivityCreate`.
const AGENT_ACTIVITY_CREATE_MUTATION = `mutation AgentActivityCreate($input: AgentActivityCreateInput!) {
  agentActivityCreate(input: $input) {
    success
  }
}`;

/** The activity types this listener writes; each carries `type` and a Markdown `body`. */
export type AgentActivityContent = {
  type: "thought" | "response" | "error";
  body: string;
};

interface GraphqlBody {
  data?: unknown;
  errors?: { message?: unknown }[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

// The token is masked by value as well as by shape: an OAuth token has no
// fixed prefix `redactSecrets` could know.
function failure(token: string, message: string, cause?: unknown): Error {
  const clean = redactSecrets(message).split(token).join("***");
  return new Error(clean, cause === undefined ? undefined : { cause });
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

function timeoutFailure(token: string, cause: unknown): Error {
  return failure(
    token,
    `Linear: the request did not answer within ${LINEAR_REQUEST_TIMEOUT_MS / 1000}s.`,
    cause,
  );
}

async function postGraphql(
  token: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(LINEAR_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
      // Also aborts a body that stalls after the headers arrive.
      signal: AbortSignal.timeout(LINEAR_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (isTimeout(error)) {
      throw timeoutFailure(token, error);
    }
    const detail = error instanceof Error ? `: ${error.message}` : "";
    throw failure(token, `Linear: the request failed${detail}`, error);
  }

  let body: GraphqlBody | undefined;
  try {
    const parsed: unknown = await response.json();
    body = isRecord(parsed) ? (parsed as GraphqlBody) : undefined;
  } catch (error) {
    if (isTimeout(error)) {
      throw timeoutFailure(token, error);
    }
  }

  if (!response.ok) {
    throw failure(
      token,
      `Linear: the request failed with HTTP ${response.status}.`,
    );
  }

  if (!body) {
    throw failure(token, "Linear: unexpected response (not a JSON object).");
  }

  if (Array.isArray(body.errors) && body.errors.length > 0) {
    const message = body.errors[0]?.message;
    const detail = typeof message === "string" ? `: ${message}` : "";
    throw failure(token, `Linear: the request was rejected${detail}`);
  }

  return body.data;
}

/** The id of the user the token belongs to: the app itself, for an agent token. */
export async function getViewerId(token: string): Promise<string> {
  const data = await postGraphql(token, VIEWER_QUERY, {});
  const viewer = isRecord(data) ? data.viewer : undefined;
  const id = isRecord(viewer) ? viewer.id : undefined;

  if (typeof id !== "string" || id === "") {
    throw failure(token, "Linear: unexpected response (no viewer id).");
  }

  return id;
}

/** Writes one activity to an agent session. */
export async function createAgentActivity(
  token: string,
  sessionId: string,
  content: AgentActivityContent,
): Promise<void> {
  const data = await postGraphql(token, AGENT_ACTIVITY_CREATE_MUTATION, {
    input: {
      agentSessionId: sessionId,
      content: { type: content.type, body: content.body },
    },
  });
  const result = isRecord(data) ? data.agentActivityCreate : undefined;

  if (!isRecord(result) || result.success !== true) {
    throw failure(token, "Linear: the activity was not created.");
  }
}
