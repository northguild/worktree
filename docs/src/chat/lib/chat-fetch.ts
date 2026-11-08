// The `fetchClient` for `fetchServerSentEvents` (plan #257 D11).
//
// The library throws a non-OK response as `HTTP error! status: N` and discards
// the body, so the Worker's own `{ error, retryable }` never reaches the page.
// This wrapper reads it first and throws it as the error's `cause`. It also
// drops assistant turns with no text from the request before it leaves.

import { z } from "zod";
import { sendableHistory } from "./chat-history";

/** The body the Worker sends with a status before a stream opens (D9). */
const workerErrorBody = z.object({ error: z.string(), retryable: z.boolean() });

export type WorkerErrorBody = z.infer<typeof workerErrorBody>;

/**
 * A non-OK response from the Worker. `cause` is the Worker's `{ error,
 * retryable }` when it sent one; a 404 from a dev server, a gateway page or
 * anything else leaves it undefined and only the status is known.
 */
export class ChatHttpError extends Error {
  declare readonly cause: WorkerErrorBody | undefined;
  readonly status: number;

  constructor(status: number, body?: WorkerErrorBody) {
    super(body?.error ?? `HTTP ${status}`, { cause: body });
    this.name = "ChatHttpError";
    this.status = status;
  }
}

const requestBody = z.looseObject({
  messages: z.array(
    z.looseObject({ role: z.string(), content: z.unknown().optional() }),
  ),
});

function withoutEmptyAssistantTurns(body: BodyInit | null | undefined) {
  if (typeof body !== "string") return body;
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return body;
  }
  const parsed = requestBody.safeParse(json);
  if (!parsed.success) return body;
  // After a failed answer the library sends the assistant turn with no `content` key at all.
  const messages = sendableHistory(parsed.data.messages, (message) =>
    typeof message.content === "string" ? message.content : "",
  );
  return JSON.stringify({ ...parsed.data, messages });
}

/**
 * `fetchServerSentEvents` adds `X-Run-Id` to every POST. A browser preflights any
 * request header outside the safelist and the Worker allows `Content-Type` alone
 * (cors.ts), so left in, every request would be blocked. The header only keys a
 * durable-stream log this chat does not have.
 */
function withoutRunId(
  headers: HeadersInit | undefined,
): HeadersInit | undefined {
  if (!headers) return headers;
  const kept = new Headers(headers);
  kept.delete("X-Run-Id");
  return Object.fromEntries(kept);
}

async function readWorkerError(
  response: Response,
): Promise<WorkerErrorBody | undefined> {
  try {
    const parsed = workerErrorBody.safeParse(await response.json());
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export async function chatFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const response = await fetch(input, {
    ...init,
    headers: withoutRunId(init?.headers),
    body: withoutEmptyAssistantTurns(init?.body),
  });
  if (response.ok) return response;
  throw new ChatHttpError(response.status, await readWorkerError(response));
}
