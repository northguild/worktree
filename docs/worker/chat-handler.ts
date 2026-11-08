// POST /api/chat — the TanStack AI handler (plan #257, §4.2 pipeline).
//
//   1. rate limit      -> 429 + Retry-After   (the limiter the legacy route shares)
//   2. key present     -> else 500
//   3. JSON parse      -> 400
//   4. validation      -> 400 (D7, incl. the whole-conversation cap)
//   5. { role, content } pairs only; metadata, tools and context never pass
//   6. chat() -> mapStreamErrors -> toServerSentEventsResponse
//
// Failures before the stream keep an HTTP status and `{ error, retryable }`.
// Once the stream is open a failure is a RUN_ERROR event whose text is ours,
// never the provider's (D9).

import {
  type AnyTextAdapter,
  chat,
  EventType,
  type StreamChunk,
  toServerSentEventsResponse,
} from "@tanstack/ai";
import type { ChatModelId } from "../src/chat/lib/chat-constants";
import {
  describeThrown,
  type MappedError,
  mapUpstreamError,
} from "./error-mapping";
import { chatRateLimiter, nowMs, retryAfterSeconds } from "./rate-limit";
import { validateChatRequest } from "./validation";

type Env = Record<string, string>;
type Cors = Record<string, string>;

/** One structured line per mapped failure. Never the key, never message text. */
export interface ChatLogEntry {
  event: "chat.failed";
  level: "warn" | "error";
  code: MappedError["code"];
  model: ChatModelId;
  threadId: string;
  runId: string;
}

export interface ChatHandlerDeps {
  createAdapter: (model: ChatModelId, apiKey: string) => AnyTextAdapter;
  systemPrompt: string;
  /** Milliseconds, stamped on the errors this handler makes. */
  now: () => number;
  log?: (entry: ChatLogEntry) => void;
}

export interface StreamErrorContext {
  threadId: string;
  runId: string;
  model: ChatModelId;
  now: () => number;
  log: (entry: ChatLogEntry) => void;
}

function logToConsole(entry: ChatLogEntry): void {
  const line = JSON.stringify(entry);
  if (entry.level === "warn") console.warn(line);
  else console.error(line);
}

function jsonError(
  status: number,
  error: string,
  retryable: boolean,
  cors: Cors,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error, retryable }), {
    status,
    headers: { "Content-Type": "application/json", ...extra, ...cors },
  });
}

function curatedRunError(
  mapped: MappedError,
  context: StreamErrorContext,
): StreamChunk {
  // Built from scratch: the upstream chunk also carries the provider's text in
  // `rawEvent`, `error` and `metadata`.
  return {
    type: EventType.RUN_ERROR,
    timestamp: context.now(),
    message: mapped.message,
    code: mapped.code,
  } as StreamChunk;
}

function report(mapped: MappedError, context: StreamErrorContext): void {
  context.log({
    event: "chat.failed",
    level:
      mapped.code === "rate_limited" || mapped.code === "rate_limited_daily"
        ? "warn"
        : "error",
    code: mapped.code,
    model: context.model,
    threadId: context.threadId,
    runId: context.runId,
  });
}

/**
 * Passes the stream through, replacing a RUN_ERROR chunk, or an error the
 * stream throws, with one curated RUN_ERROR (D9). Each is logged once.
 */
export async function* mapStreamErrors(
  stream: AsyncIterable<StreamChunk>,
  context: StreamErrorContext,
): AsyncGenerator<StreamChunk> {
  try {
    for await (const chunk of stream) {
      if (chunk.type !== EventType.RUN_ERROR) {
        yield chunk;
        continue;
      }
      const mapped = mapUpstreamError({
        message: chunk.message,
        code: chunk.code,
      });
      report(mapped, context);
      yield curatedRunError(mapped, context);
      return;
    }
  } catch (error) {
    const mapped = mapUpstreamError(describeThrown(error));
    report(mapped, context);
    yield curatedRunError(mapped, context);
  }
}

export function createChatHandler(deps: ChatHandlerDeps) {
  const log = deps.log ?? logToConsole;

  return async function handleChatRequest(
    request: Request,
    env: Env,
    cors: Cors,
  ): Promise<Response> {
    const verdict = chatRateLimiter.checkRequest(request, env);
    if (verdict.limited) {
      return jsonError(
        429,
        "The assistant is receiving too many requests. Wait a moment and try again.",
        true,
        cors,
        { "Retry-After": retryAfterSeconds(verdict, nowMs()).toString() },
      );
    }

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return jsonError(500, "The assistant is not configured.", false, cors);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError(400, "The request body is not valid JSON.", false, cors);
    }

    const validated = validateChatRequest(body);
    if (!validated.ok) {
      return jsonError(validated.status, validated.error, false, cors);
    }
    const { messages, model } = validated.value;
    // validateChatRequest has accepted these as strings.
    const { threadId, runId } = body as { threadId: string; runId: string };

    const abortController = new AbortController();
    if (request.signal.aborted) abortController.abort();
    else {
      request.signal.addEventListener("abort", () => abortController.abort(), {
        once: true,
      });
    }

    const stream = chat({
      adapter: deps.createAdapter(model, apiKey),
      messages,
      systemPrompts: [deps.systemPrompt],
      // `summary: false`: the string form "low" is normalised to summary: true,
      // which asks Gemini for thought summaries (includeThoughts). D4 wants none.
      reasoning: { level: "low", summary: false },
      threadId,
      runId,
      abortController,
      // The library's own error log prints the provider's body (D9).
      debug: false,
    });

    return toServerSentEventsResponse(
      mapStreamErrors(stream, {
        threadId,
        runId,
        model,
        now: deps.now,
        log,
      }),
      { abortController, headers: cors },
    );
  };
}
