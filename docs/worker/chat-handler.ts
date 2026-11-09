// POST /api/chat — the TanStack AI handler (plan #257, §4.2 pipeline).
//
//   1. rate limit      -> 429 + Retry-After   (the limiter the legacy route shares)
//   2. key present     -> else 500
//   3. JSON parse      -> 400
//   4. validation      -> 400 (D7, incl. the whole-conversation cap)
//   5. { role, content } pairs only; metadata, tools and context never pass
//   6. retrieval: search the question, keep what fits, choose the vocabulary, assemble the prompt (D8)
//   7. chat() -> withRetrievalTrace -> mapStreamErrors -> toServerSentEventsResponse
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
  RETRIEVAL_TRACE_EVENT,
  type RetrievalChunk,
  type RetrievalTimings,
  type RetrievalTraceData,
  type VocabularySection,
} from "../src/chat/lib/chat-types";
import { namespaceFromPageContext } from "../src/chat/lib/page-context";
import {
  describeThrown,
  type MappedError,
  mapUpstreamError,
} from "./error-mapping";
import { chatRateLimiter, nowMs, retryAfterSeconds } from "./rate-limit";
import { fitChunks } from "./retrieval/fit-chunks";
import { loadIndex, searchChunks } from "./retrieval/search";
import { selectVocabulary } from "./retrieval/select-vocabulary";
import {
  assembleSystemPrompt,
  routeAllowlist,
} from "./retrieval/system-prompt";
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

/** What `build-context.mjs` generates (`docs-context.ts`): the corpus the handler retrieves from. */
export interface RetrievalCorpus {
  chunks: readonly RetrievalChunk[];
  /** `MiniSearch#toJSON` of `chunks`. Empty when there is no corpus (the test stub). */
  searchIndexJson: string;
  vocabulary: readonly VocabularySection[];
}

export interface ChatHandlerDeps {
  createAdapter: (model: ChatModelId, apiKey: string) => AnyTextAdapter;
  corpus: RetrievalCorpus;
  /** Milliseconds, stamped on the events this handler makes. */
  now: () => number;
  /** A monotonic clock in milliseconds, for the stage timings. */
  clock?: () => number;
  log?: (entry: ChatLogEntry) => void;
}

export interface StreamErrorContext {
  threadId: string;
  runId: string;
  model: ChatModelId;
  now: () => number;
  log: (entry: ChatLogEntry) => void;
}

interface Retriever {
  index: ReturnType<typeof loadIndex> | null;
  byId: ReadonlyMap<string, RetrievalChunk>;
}

// The serialized index is parsed once per isolate and kept for as long as the corpus object lives (R1).
const RETRIEVERS = new WeakMap<RetrievalCorpus, Retriever>();

function retrieverFor(corpus: RetrievalCorpus): Retriever {
  let retriever = RETRIEVERS.get(corpus);
  if (!retriever) {
    retriever = {
      index:
        corpus.searchIndexJson === ""
          ? null
          : loadIndex(corpus.searchIndexJson),
      byId: new Map(corpus.chunks.map((chunk) => [chunk.id, chunk])),
    };
    RETRIEVERS.set(corpus, retriever);
  }
  return retriever;
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

export interface TraceContext {
  /** The trace as it stands: called once before the answer, and once when the run finishes. */
  trace: () => RetrievalTraceData;
  now: () => number;
  /** Told when the first answer text arrives, and when the run finishes, so the timings can say so. */
  onFirstText: () => void;
  onFinish: () => void;
}

function traceChunk(data: RetrievalTraceData, now: () => number): StreamChunk {
  return {
    type: EventType.CUSTOM,
    name: RETRIEVAL_TRACE_EVENT,
    value: data,
    timestamp: now(),
  } as StreamChunk;
}

/**
 * Passes the stream through and adds the retrieval trace to it as `CUSTOM` events (D3): once straight after the first
 * chunk, which is `RUN_STARTED`, so it is there while the reader waits, and once more just before `RUN_FINISHED`, with
 * the timings the answer completed. A run that fails (`RUN_ERROR`, or a throw) gets no second one: its trace is the
 * first, and the failure is the answer.
 */
export async function* withRetrievalTrace(
  stream: AsyncIterable<StreamChunk>,
  context: TraceContext,
): AsyncGenerator<StreamChunk> {
  let opened = false;
  let sawText = false;
  for await (const chunk of stream) {
    if (chunk.type === EventType.RUN_FINISHED) {
      context.onFinish();
      yield traceChunk(context.trace(), context.now);
    }
    yield chunk;
    if (chunk.type === EventType.TEXT_MESSAGE_CONTENT && !sawText) {
      sawText = true;
      context.onFirstText();
    }
    if (!opened && chunk.type !== EventType.RUN_ERROR) {
      opened = true;
      yield traceChunk(context.trace(), context.now);
    }
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
    const { messages, model, pageContext } = validated.value;
    // validateChatRequest has accepted these as strings.
    const { threadId, runId } = body as { threadId: string; runId: string };

    const abortController = new AbortController();
    if (request.signal.aborted) abortController.abort();
    else {
      request.signal.addEventListener("abort", () => abortController.abort(), {
        once: true,
      });
    }

    // Retrieval (D8): the question is the last message, which the validator has made a non-empty user turn.
    const clock = deps.clock ?? (() => performance.now());
    const started = clock();
    const timings: RetrievalTimings = { corpus: 0, search: 0, prompt: 0 };
    const timed = <T>(
      stage: "corpus" | "search" | "prompt",
      work: () => T,
    ): T => {
      const at = clock();
      try {
        return work();
      } finally {
        timings[stage] = Math.round(clock() - at);
      }
    };

    const question = messages.at(-1)?.content ?? "";
    let kept: RetrievalChunk[];
    let systemPrompt: string;
    try {
      const retriever = timed("corpus", () => retrieverFor(deps.corpus));
      const found = timed("search", () =>
        retriever.index === null
          ? []
          : searchChunks(retriever.index, retriever.byId, question, {
              namespace: namespaceFromPageContext(pageContext),
            }),
      );
      kept = fitChunks(found);
      systemPrompt = timed("prompt", () =>
        assembleSystemPrompt({
          chunks: kept,
          vocabulary: selectVocabulary(deps.corpus.vocabulary, question, kept),
        }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "chat.retrieval_failed",
          error: describeThrown(error).message,
        }),
      );
      return jsonError(
        500,
        "The assistant could not search the docs. Try again later.",
        true,
        cors,
      );
    }

    const trace = (): RetrievalTraceData => ({
      totalChunks: deps.corpus.chunks.length,
      retrievedCount: kept.length,
      chunkTitles: kept.map((chunk) => chunk.title),
      chunkUrls: routeAllowlist(kept),
      timings: { ...timings },
    });

    const stream = chat({
      adapter: deps.createAdapter(model, apiKey),
      messages,
      systemPrompts: [systemPrompt],
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
      mapStreamErrors(
        withRetrievalTrace(stream, {
          trace,
          now: deps.now,
          onFirstText: () => {
            timings.firstToken = Math.round(clock() - started);
          },
          onFinish: () => {
            timings.total = Math.round(clock() - started);
          },
        }),
        {
          threadId,
          runId,
          model,
          now: deps.now,
          log,
        },
      ),
      { abortController, headers: cors },
    );
  };
}
