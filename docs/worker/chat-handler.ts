// POST /api/chat — the TanStack AI handler (plan #257, §4.2 pipeline).
//
//   1. rate limit      -> 429 + Retry-After   (the limiter the legacy route shares)
//   2. a brain to ask  -> else 500            (a Gemini key, or the Workers AI binding: D9)
//   3. JSON parse      -> 400
//   4. validation      -> 400 (D7, incl. the whole-conversation cap)
//   5. { role, content } pairs only; metadata, tools and context never pass
//   6. the ledger (D10): read what is spent today -> the visitor's cap, 429 before any brain is asked
//   7. retrieval: search the question, keep what fits, choose the vocabulary, assemble the prompt (D8)
//   8. the walk past the brains the ledger has not marked out (D9) -> record the answer and send the counts as a
//      `CUSTOM` usage event -> withRetrievalTrace -> mapStreamErrors -> toServerSentEventsResponse
//
// Failures before the stream keep an HTTP status and `{ error, retryable }`.
// Once the stream is open a failure is a RUN_ERROR event whose text is ours,
// never the provider's (D9). The walk is inside the stream, so each step of it
// is a `CUSTOM` progress event and an allowance spent on every brain is a
// `CUSTOM` refusal (D3). The ledger is advisory and optional: with no `DOX_USAGE` binding the first brain is asked and
// no counts are sent, and a store that throws is never the reason a question goes unanswered.

import { convertUnixToUtc } from "@northguild/gmt/unix/convert";
import {
  type AnyTextAdapter,
  chat,
  EventType,
  type StreamChunk,
  toServerSentEventsResponse,
} from "@tanstack/ai";
import { type Brain, VISITOR_DAILY_MAX } from "../src/chat/lib/chat-constants";
import {
  PROGRESS_EVENT,
  REFUSAL_EVENT,
  RETRIEVAL_TRACE_EVENT,
  type RefusalData,
  type RetrievalChunk,
  type RetrievalTimings,
  type RetrievalTraceData,
  USAGE_EVENT,
  type VocabularySection,
} from "../src/chat/lib/chat-types";
import { nextVisitorMidnightMs } from "../src/chat/lib/day-clock";
import { namespaceFromPageContext } from "../src/chat/lib/page-context";
import {
  type AiBinding,
  brainChatOptions,
  configuredBrains,
  createWorkersAIAdapter,
  type Env,
  type MovedOn,
  orderCandidates,
  soonestReset,
  stringVars,
  walkBrains,
} from "./brains";
import { brainsPayload, isUsable, withRecordedRequest } from "./brains-payload";
import {
  ALLOWANCE_SPENT_CODE,
  describeThrown,
  type MappedError,
  mapUpstreamError,
} from "./error-mapping";
import {
  chatRateLimiter,
  getClientId,
  nowMs,
  retryAfterSeconds,
} from "./rate-limit";
import { fitChunks } from "./retrieval/fit-chunks";
import { loadIndex, searchChunks } from "./retrieval/search";
import { selectVocabulary } from "./retrieval/select-vocabulary";
import {
  assembleSystemPrompt,
  routeAllowlist,
} from "./retrieval/system-prompt";
import {
  type BrainState,
  EMPTY_SNAPSHOT,
  hashVisitor,
  markBrain,
  readUsage,
  recordRequest,
  type UsageSnapshot,
} from "./usage";
import { validateChatRequest } from "./validation";

type Cors = Record<string, string>;

/** One structured line per mapped failure, and one per brain passed over. Never the key, never message text. */
export type ChatLogEntry =
  | {
      event: "chat.failed";
      level: "warn" | "error";
      code: MappedError["code"];
      /** The brain last asked. */
      model: string;
      threadId: string;
      runId: string;
    }
  | {
      event: "chat.brain_skipped";
      level: "warn";
      model: string;
      outcome: MovedOn;
      threadId: string;
      runId: string;
    };

/** What `build-context.mjs` generates (`docs-context.ts`): the corpus the handler retrieves from. */
export interface RetrievalCorpus {
  chunks: readonly RetrievalChunk[];
  /** `MiniSearch#toJSON` of `chunks`. Empty when there is no corpus (the test stub). */
  searchIndexJson: string;
  vocabulary: readonly VocabularySection[];
}

export interface ChatHandlerDeps {
  /** A Gemini brain's adapter: its model id and the key. */
  createAdapter: (model: string, apiKey: string) => AnyTextAdapter;
  /** A Workers AI brain's adapter, over the `AI` binding. Defaults to the real one; tests inject a fake. */
  createWorkersAIAdapter?: (brain: Brain, binding: AiBinding) => AnyTextAdapter;
  corpus: RetrievalCorpus;
  /** Milliseconds, stamped on the events this handler makes. */
  now: () => number;
  /** A monotonic clock in milliseconds, for the stage timings. */
  clock?: () => number;
  /** How long a brain may take to begin answering. Defaults to D9's per-provider times; tests shorten it. */
  startTimeoutMs?: (brain: Brain) => number;
  log?: (entry: ChatLogEntry) => void;
}

export interface StreamErrorContext {
  threadId: string;
  runId: string;
  /** The brain last asked, read when a failure is logged. */
  model: string;
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

const SPENT_MESSAGE = "Dox has used its free allowance for today.";

function progressChunk(text: string, now: () => number): StreamChunk {
  return {
    type: EventType.CUSTOM,
    name: PROGRESS_EVENT,
    value: { text },
    timestamp: now(),
  } as StreamChunk;
}

/** The line for a brain the walk has given up on (D9; gmt `chat-handler.ts`, "Dox" kept). */
function movedOn(brain: Brain, outcome: MovedOn): string {
  const reason =
    outcome === "busy"
      ? "is busy"
      : outcome === "slow"
        ? "is taking too long"
        : "is out for today";
  return `${brain.label} ${reason} \u2014 trying the next model\u2026`;
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
      mapped.code === "rate_limited" ||
      mapped.code === "rate_limited_daily" ||
      mapped.code === "allowance_spent"
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
  /** The trace as it stands: called once before the answer, and once when the run finishes (by then it names the brain). */
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
    const verdict = chatRateLimiter.checkRequest(request, stringVars(env));
    if (verdict.limited) {
      return jsonError(
        429,
        "The assistant is receiving too many requests. Wait a moment and try again.",
        true,
        cors,
        { "Retry-After": retryAfterSeconds(verdict, nowMs()).toString() },
      );
    }

    const brains = configuredBrains(env);
    if (brains.length === 0) {
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
    const { messages, brain: requestedBrain, pageContext } = validated.value;
    // validateChatRequest has accepted these as strings.
    const { threadId, runId } = body as { threadId: string; runId: string };

    const abortController = new AbortController();
    if (request.signal.aborted) abortController.abort();
    else {
      request.signal.addEventListener("abort", () => abortController.abort(), {
        once: true,
      });
    }

    // The ledger (D10): what is spent today. A store that is missing or fails reads as nothing spent.
    const usage = env.DOX_USAGE;
    const ledgerNow = deps.now();
    const visitorHash = usage
      ? await hashVisitor(getClientId(request))
      : undefined;
    const snapshot: UsageSnapshot =
      usage && visitorHash !== undefined
        ? await readUsage(usage, brains, visitorHash, ledgerNow, {
            threadId,
            runId,
          })
        : EMPTY_SNAPSHOT;

    // The visitor's cap, before any brain is asked. Dox's own, so always on the UTC day.
    if (snapshot.visitor >= VISITOR_DAILY_MAX) {
      return new Response(
        JSON.stringify({
          error: `You have used your ${VISITOR_DAILY_MAX} questions for today. They reset at midnight UTC.`,
          retryable: false,
          resetsAt: convertUnixToUtc(nextVisitorMidnightMs(ledgerNow)),
        }),
        {
          status: 429,
          headers: { "Content-Type": "application/json", ...cors },
        },
      );
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

    let answeredBy: Brain | undefined;
    const trace = (): RetrievalTraceData => ({
      totalChunks: deps.corpus.chunks.length,
      retrievedCount: kept.length,
      chunkTitles: kept.map((chunk) => chunk.title),
      chunkUrls: routeAllowlist(kept),
      timings: { ...timings },
      // After a failover this is not the brain the reader's pick or the registry named first.
      ...(answeredBy && { brainLabel: answeredBy.label }),
    });

    // A brain the ledger has marked out is not asked: the walk would only learn again what a provider told us earlier.
    const candidates = orderCandidates(
      brains.filter((brain) => isUsable(brain, snapshot)),
      requestedBrain,
    );
    const errorContext: StreamErrorContext = {
      threadId,
      runId,
      model: candidates[0]?.id ?? "",
      now: deps.now,
      log,
    };
    const makeWorkersAIAdapter =
      deps.createWorkersAIAdapter ?? createWorkersAIAdapter;

    const open = (brain: Brain, brainAbort: AbortController) =>
      chat({
        // `configuredBrains` has made sure what each provider needs is there.
        adapter:
          brain.provider === "google"
            ? deps.createAdapter(brain.id, env.GEMINI_API_KEY as string)
            : makeWorkersAIAdapter(brain, env.AI as AiBinding),
        messages,
        systemPrompts: [systemPrompt],
        ...brainChatOptions(brain),
        threadId,
        runId,
        abortController: brainAbort,
        // The library's own error log prints the provider's body (D9).
        debug: false,
      });

    /**
     * What the reader's stream is made of: the run's own start, a progress line for each step of the walk, then the
     * answering brain's chunks, or the failure. The walk comes before any answer text, so a brain that is busy, slow or
     * out costs the reader a line, never an error.
     */
    async function* walked(): AsyncGenerator<StreamChunk> {
      yield {
        type: EventType.RUN_STARTED,
        threadId,
        runId,
        timestamp: deps.now(),
      } as StreamChunk;

      /** Every brain this walk found out, so the usage event can show them out without waiting on KV. */
      const markedOut: Record<string, Exclude<BrainState, "ok">> = {};
      const walk = walkBrains({
        candidates,
        open,
        signal: abortController.signal,
        runId,
        startTimeoutMs: deps.startTimeoutMs,
      });
      let step = await walk.next();
      while (!step.done) {
        const { value } = step;
        if (value.type === "attempt") {
          errorContext.model = value.brain.id;
          yield progressChunk(`Asking ${value.brain.label}\u2026`, deps.now);
        } else {
          log({
            event: "chat.brain_skipped",
            level: "warn",
            model: value.brain.id,
            outcome: value.outcome,
            threadId,
            runId,
          });
          yield progressChunk(movedOn(value.brain, value.outcome), deps.now);
          if (
            usage &&
            (value.outcome === "spent" || value.outcome === "unavailable")
          ) {
            // Workers AI's Neurons are one pool per account, so an exhausted allocation takes every brain of it.
            const out = value.allocation
              ? brains.filter((b) => b.provider === value.brain.provider)
              : [value.brain];
            for (const brain of out) {
              markedOut[brain.id] = value.outcome;
              await markBrain(usage, brain, value.outcome, ledgerNow, {
                threadId,
                runId,
              });
            }
          }
        }
        step = await walk.next();
      }

      const end = step.value;
      if (end.kind === "answered") {
        answeredBy = end.brain;
        if (usage && visitorHash !== undefined) {
          // Counted once a brain has accepted the question, whether or not it is read. Never throws (`usage.ts`).
          await recordRequest(usage, end.brain, visitorHash, ledgerNow, {
            threadId,
            runId,
          });
          // The counts as they stand now, from memory: KV's reads can lag a write, so a re-read would show the old ones.
          yield {
            type: EventType.CUSTOM,
            name: USAGE_EVENT,
            value: brainsPayload({
              brains,
              snapshot: withRecordedRequest(snapshot, end.brain, markedOut),
              nowMs: ledgerNow,
            }),
            timestamp: deps.now(),
          } as StreamChunk;
        }
        yield* end.stream;
      } else if (end.kind === "failed") {
        yield {
          type: EventType.RUN_ERROR,
          timestamp: deps.now(),
          message: end.failure.message ?? "",
          ...(end.failure.code !== undefined && { code: end.failure.code }),
        } as StreamChunk;
      } else if (end.kind === "spent") {
        const refusal: RefusalData = {
          status: 429,
          payload: {
            error: SPENT_MESSAGE,
            retryable: false,
            resetsAt: soonestReset(brains, deps.now()),
          },
        };
        yield {
          type: EventType.CUSTOM,
          name: REFUSAL_EVENT,
          value: refusal,
          timestamp: deps.now(),
        } as StreamChunk;
        // The same refusal, for a client that does not read `CUSTOM` events (#306's): it shows the curated text.
        yield {
          type: EventType.RUN_ERROR,
          timestamp: deps.now(),
          message: SPENT_MESSAGE,
          code: ALLOWANCE_SPENT_CODE,
        } as StreamChunk;
      }
    }

    return toServerSentEventsResponse(
      mapStreamErrors(
        withRetrievalTrace(walked(), {
          trace,
          now: deps.now,
          onFirstText: () => {
            timings.firstToken = Math.round(clock() - started);
          },
          onFinish: () => {
            timings.total = Math.round(clock() - started);
          },
        }),
        errorContext,
      ),
      { abortController, headers: cors },
    );
  };
}
