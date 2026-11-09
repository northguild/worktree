// Which brain answers, and the walk past the ones that cannot (plan #309 D9; ported from gmt `worker/brains.ts`).
//
// Failover happens inside one request, before any answer text streams: each candidate is asked in turn and the walk
// returns the first that produces content. A busy, slow, spent or unavailable brain is passed over, and the reader is
// told by a progress line, not by an error. The mechanism is gmt's; what differs is the client library underneath. gmt
// walks the AI SDK's `streamText`; this walks TanStack AI's `chat()` stream, where a failure arrives as a `RUN_ERROR`
// chunk, not as a rejected promise.

import {
  convertUnixToUtc,
  convertUnixToZoned,
} from "@northguild/gmt/unix/convert";
import { addZoned, startOfZoned } from "@northguild/gmt/zoned/calculate";
import { convertZonedToUnix } from "@northguild/gmt/zoned/convert";
import { type AnyTextAdapter, EventType, type StreamChunk } from "@tanstack/ai";
import { createCloudflareText } from "@tanstack/ai-cloudflare";
import {
  BRAIN_RESET_TIME_ZONE,
  BRAIN_START_TIMEOUT_MS,
  BRAINS,
  type Brain,
  type BrainProvider,
} from "../src/chat/lib/chat-constants";
import {
  BRAINS_TIMED_OUT_CODE,
  describeThrown,
  isAllocationExhausted,
  statusOf,
  type UpstreamError,
} from "./error-mapping";

/**
 * The Workers AI binding, hand-declared: the Worker only calls `run`, and `@cloudflare/workers-types` is an optional
 * peer of the adapter that this package does not install.
 */
export interface AiBinding {
  run(
    model: string,
    inputs: Record<string, unknown>,
    options?: Record<string, unknown>,
  ): Promise<unknown>;
}

/** What the chat Worker reads from its environment: two secrets and one binding, none required (D9). */
export interface Env {
  GEMINI_API_KEY?: string;
  WORKER_RATE_LIMIT_MAX?: string;
  WORKER_RATE_LIMIT_WINDOW_SECONDS?: string;
  /** Workers AI: `[ai] binding = "AI"` in `wrangler.toml`. */
  AI?: AiBinding;
}

/** The string variables, which is all the rate limiter and the frozen legacy route read. */
export function stringVars(env: Env): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

/** The brains this deployment can reach: Gemini's need the key, Workers AI's need the binding (D9). */
export function configuredBrains(env: Env): Brain[] {
  return BRAINS.filter((brain: Brain) =>
    brain.provider === "google" ? Boolean(env.GEMINI_API_KEY) : Boolean(env.AI),
  );
}

/** The reader's pick first, if it is one of `pool`, then the rest in registry order. A pick outside the pool is no pick. */
export function orderCandidates(
  pool: readonly Brain[],
  requestedId?: string,
): Brain[] {
  const requested = pool.find((brain) => brain.id === requestedId);
  return requested
    ? [requested, ...pool.filter((brain) => brain !== requested)]
    : [...pool];
}

/**
 * What `chat()` is given for a brain, beyond the adapter.
 *
 * Gemini keeps `reasoning: low` with no summary (#257 D4: the string form "low" is normalised to `summary: true`, which
 * asks for thought summaries). Workers AI does not take `reasoning`: the adapter would send `reasoning_effort: null`,
 * which gmt measured not to switch thinking off for Gemma 4 or GLM 4.7. The two settings that matter go in
 * `modelOptions`, which the adapter spreads into the request body untouched (plan §9 Q13; `chat-completions-text.ts`
 * 1577-1583 in `@tanstack/openai-base` 1.0.2): `max_tokens`, because Workers AI defaults to 256 and cuts a Dox answer
 * off mid-sentence, and `chat_template_kwargs.enable_thinking`, the one switch gmt found that works.
 */
export function brainChatOptions(brain: Brain) {
  if (brain.provider === "google") {
    return { reasoning: { level: "low", summary: false } } as const;
  }
  return {
    modelOptions: {
      ...(brain.maxOutputTokens !== undefined && {
        max_tokens: brain.maxOutputTokens,
      }),
      ...(brain.enableThinking !== undefined && {
        chat_template_kwargs: { enable_thinking: brain.enableThinking },
      }),
    },
  };
}

/**
 * `env.AI` as the adapter should see it. Two changes, both about failover:
 *
 * - A failed run is marked `x-should-retry: false`. The adapter's client retries a 429 or a 5xx twice by default, with
 *   0.5 s and 1 s of waiting, and the binding config gives no way to turn that off. A retry delays the next brain, and
 *   the next brain is the retry (gmt sets `maxRetries: 0` for the same reason).
 * - A run that throws becomes a 500 response that keeps the message, so the walk can read an allocation error out of
 *   it. Left alone the client turns it into a bare "Connection error." and retries.
 */
export function withoutRetries(binding: AiBinding): AiBinding {
  return {
    async run(model, inputs, options) {
      let result: unknown;
      try {
        result = await binding.run(model, inputs, options);
      } catch (error) {
        const { message, status, code } = error as {
          message?: unknown;
          status?: unknown;
          code?: unknown;
        };
        return new Response(
          JSON.stringify({
            error: {
              message: typeof message === "string" ? message : "Run failed.",
              code: code ?? null,
            },
          }),
          {
            status: typeof status === "number" && status >= 400 ? status : 500,
            headers: {
              "Content-Type": "application/json",
              "x-should-retry": "false",
            },
          },
        );
      }
      if (!(result instanceof Response) || result.ok) return result;
      const headers = new Headers(result.headers);
      headers.set("x-should-retry", "false");
      return new Response(result.body, {
        status: result.status,
        statusText: result.statusText,
        headers,
      });
    },
  };
}

/** A Workers AI brain's adapter, over the binding. */
export function createWorkersAIAdapter(
  brain: Brain,
  binding: AiBinding,
): AnyTextAdapter {
  return createCloudflareText(brain.model ?? brain.id, {
    // The adapter types the binding as the full `Ai` of `@cloudflare/workers-types`; it only calls `run`.
    binding: withoutRetries(binding) as never,
  }) as unknown as AnyTextAdapter;
}

// ---------------------------------------------------------------------------------------------------------------------
// Classifying a failure
// ---------------------------------------------------------------------------------------------------------------------

export type Verdict =
  /** Out for the provider's day. */
  | "spent"
  /** Not coming back today: no such model, or not allowed to use it. */
  | "unavailable"
  /** Overloaded for this request, which says nothing about tomorrow. */
  | "busy"
  /** Says nothing about the brain: the request would fail on every brain, so the walk stops. */
  | "other";

const API_KEY_INVALID = /API_KEY_INVALID/;
/** A Workers AI failure that names the allocation by Cloudflare's number alone. */
const WORKERS_AI_ALLOCATION_NUMBER = /\b(3036|4006)\b/;

/**
 * What a failure says about the brain that raised it (D9; gmt `brainStateFromError` and `isTransientOverload`).
 *
 * - 429 on Gemini is spent. A Workers AI 429 is spent only when it says the Neuron pool is gone: code 3040 ("no more
 *   data centers") is also a 429, and it is a capacity blip on one model.
 * - 400 and 404 are unavailable, except that Google answers a bad key with 400 `API_KEY_INVALID`, which would otherwise
 *   retire every Gemini brain and end in a refusal that blames the allowance.
 * - 503 and 529 are busy. A 500 is not: an error in the request itself fails on every brain.
 * - A Workers AI 403 is about the model (5018 and 3041 "not allowed to access this model", 5035 "requires a Workers
 *   Paid plan"), not a credential. A Gemini 403 stays "other", because there it means a bad key.
 */
export function classifyFailure(
  provider: BrainProvider,
  failure: UpstreamError,
): { verdict: Verdict; allocationExhausted: boolean } {
  const message = failure.message ?? "";
  const status = statusOf(failure);
  if (API_KEY_INVALID.test(message)) {
    return { verdict: "other", allocationExhausted: false };
  }

  if (provider === "workers-ai") {
    if (
      isAllocationExhausted(failure) ||
      WORKERS_AI_ALLOCATION_NUMBER.test(message)
    ) {
      return { verdict: "spent", allocationExhausted: true };
    }
    if (status === 429) return { verdict: "busy", allocationExhausted: false };
    if (status === 403) {
      return { verdict: "unavailable", allocationExhausted: false };
    }
  } else if (status === 429) {
    return { verdict: "spent", allocationExhausted: false };
  }

  if (status === 400 || status === 404) {
    return { verdict: "unavailable", allocationExhausted: false };
  }
  if (status === 503 || status === 529) {
    return { verdict: "busy", allocationExhausted: false };
  }
  return { verdict: "other", allocationExhausted: false };
}

// ---------------------------------------------------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------------------------------------------------

/** What happened to a brain the walk passed over. */
export type MovedOn = "busy" | "slow" | "spent" | "unavailable";

export type WalkStep =
  /** A brain is about to be asked. */
  | { type: "attempt"; brain: Brain }
  /** A brain refused or was too slow, and the walk goes on. `allocation` says its whole provider's pool is gone. */
  | { type: "moved-on"; brain: Brain; outcome: MovedOn; allocation: boolean };

export type WalkEnd =
  /** `stream` is what the brain wrote, from its first chunk (the adapter's `RUN_STARTED` is left out). */
  | { kind: "answered"; brain: Brain; stream: AsyncGenerator<StreamChunk> }
  /** The walk ended on a failure the reader is told about, in our words: an unrelated error, or only busy and slow brains. */
  | { kind: "failed"; failure: UpstreamError }
  /** Every candidate is out for the day. */
  | { kind: "spent" }
  /** The request was cancelled. */
  | { kind: "aborted" };

export interface WalkOptions {
  candidates: readonly Brain[];
  /** Starts a brain's stream. It must stop when `abortController` aborts. */
  open: (
    brain: Brain,
    abortController: AbortController,
  ) => AsyncIterable<StreamChunk>;
  /** The request's own signal: the walk stops, and the brain's call is aborted, when it fires. */
  signal?: AbortSignal;
  /**
   * The request's run id. Every chunk that carries a run id is rewritten to it: the Workers AI adapter ignores the id
   * `chat()` is given and makes its own, so its `RUN_FINISHED` would not match the `RUN_STARTED` the walk wrote, and the
   * client would keep the run open until the stream ended.
   */
  runId?: string;
  /** Tests shorten it. */
  startTimeoutMs?: (brain: Brain) => number;
}

/** Chunks that mean the model has begun its answer. A `RUN_ERROR` is not one. */
function startsAnswer(chunk: StreamChunk): boolean {
  return (
    chunk.type === EventType.TEXT_MESSAGE_CONTENT ||
    chunk.type === EventType.REASONING_MESSAGE_CONTENT ||
    chunk.type === EventType.TOOL_CALL_START
  );
}

function withRunId(chunk: StreamChunk, runId: string | undefined): StreamChunk {
  return runId !== undefined && "runId" in chunk && chunk.runId !== runId
    ? ({ ...chunk, runId } as StreamChunk)
    : chunk;
}

async function* continued(
  buffered: StreamChunk[],
  iterator: AsyncIterator<StreamChunk>,
  runId: string | undefined,
): AsyncGenerator<StreamChunk> {
  try {
    yield* buffered;
    for (;;) {
      const next = await iterator.next();
      if (next.done) return;
      yield withRunId(next.value, runId);
    }
  } finally {
    // The reader went away, or the answer ended: either way the brain's stream is finished with.
    await iterator.return?.();
  }
}

/**
 * Asks each candidate in turn until one starts answering. A generator: each step is yielded as it happens, so the
 * caller can write the progress line before the next brain is asked, and the `WalkEnd` is its return value.
 *
 * Nothing is retried within a brain: the next brain is the retry. The deadline covers only the start of the answer;
 * once content arrives the brain may take as long as it needs.
 */
export async function* walkBrains({
  candidates,
  open,
  signal,
  runId,
  startTimeoutMs = (brain) => BRAIN_START_TIMEOUT_MS[brain.provider],
}: WalkOptions): AsyncGenerator<WalkStep, WalkEnd> {
  // One Workers AI brain reporting an exhausted allocation means all of them are out: the Neurons are per account.
  const exhausted = new Set<BrainProvider>();
  /* The last overload seen. If every brain was out or busy, this ends the walk rather than a refusal: a reader who hit
     a busy minute has used nobody's allowance and should be told to try again. */
  let lastOverload: UpstreamError | undefined;
  let sawSlow = false;

  for (const brain of candidates) {
    if (signal?.aborted) return { kind: "aborted" };
    if (exhausted.has(brain.provider)) continue;
    yield { type: "attempt", brain };

    const abortController = new AbortController();
    const abort = () => abortController.abort();
    signal?.addEventListener("abort", abort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<"slow">((resolve) => {
      timer = setTimeout(() => resolve("slow"), startTimeoutMs(brain));
    });
    const iterator = open(brain, abortController)[Symbol.asyncIterator]();
    const buffered: StreamChunk[] = [];
    let failure: UpstreamError | undefined;
    let slow = false;

    try {
      for (;;) {
        const pending = iterator.next();
        // If the deadline wins, this call is still in flight and may reject later; nothing will read it.
        pending.catch(() => undefined);
        const next = await Promise.race([pending, deadline]);
        if (next === "slow") {
          slow = true;
          break;
        }
        if (next.done) break;
        const chunk = next.value;
        // The walk's own `RUN_STARTED` has been sent already, and this brain's would arrive after the progress lines.
        if (chunk.type === EventType.RUN_STARTED) continue;
        if (chunk.type === EventType.RUN_ERROR) {
          failure = { message: chunk.message, code: chunk.code };
          break;
        }
        buffered.push(withRunId(chunk, runId));
        if (startsAnswer(chunk)) break;
      }
    } catch (error) {
      failure = describeThrown(error);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    }

    if (slow) {
      abortController.abort();
      void iterator.return?.()?.catch?.(() => undefined);
      sawSlow = true;
      yield { type: "moved-on", brain, outcome: "slow", allocation: false };
      continue;
    }

    if (failure === undefined) {
      // Content arrived, or the stream ended with nothing to say: either way this brain is the answer.
      signal?.addEventListener("abort", abort, { once: true });
      return {
        kind: "answered",
        brain,
        stream: continued(buffered, iterator, runId),
      };
    }

    const { verdict, allocationExhausted } = classifyFailure(
      brain.provider,
      failure,
    );
    if (verdict === "other") return { kind: "failed", failure };
    if (verdict === "busy") lastOverload = failure;
    if (allocationExhausted) exhausted.add(brain.provider);
    yield {
      type: "moved-on",
      brain,
      outcome: verdict,
      allocation: allocationExhausted,
    };
  }

  if (signal?.aborted) return { kind: "aborted" };
  if (lastOverload !== undefined) {
    return { kind: "failed", failure: lastOverload };
  }
  if (sawSlow) {
    return {
      kind: "failed",
      failure: {
        message: "No brain started answering in time.",
        code: BRAINS_TIMED_OUT_CODE,
      },
    };
  }
  return { kind: "spent" };
}

// ---------------------------------------------------------------------------------------------------------------------
// When the allowance comes back
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The next midnight in a zone, as an instant: the start of tomorrow's date, not 24 hours on, because across a clock
 * change the two differ and only the first lands on midnight (gmt `src/lib/pt-day.ts`). An unknown zone or a bad clock
 * returns `nowMs` rather than throwing: gmt answers `""` for invalid input, never an exception.
 */
export function nextMidnightMs(nowMs: number, timeZone: string): number {
  const zoned = convertUnixToZoned(nowMs, timeZone);
  if (zoned === "") return nowMs;
  const unix = convertZonedToUnix(
    addZoned(startOfZoned(zoned, "day"), { days: 1 }),
  );
  return typeof unix === "number" ? unix : nowMs;
}

/** The soonest refill among the providers of `brains` (at least one), as an instant (`2026-11-10T08:00:00Z`). */
export function soonestReset(brains: readonly Brain[], nowMs: number): string {
  const resets = [...new Set(brains.map((brain) => brain.provider))].map(
    (provider) => nextMidnightMs(nowMs, BRAIN_RESET_TIME_ZONE[provider]),
  );
  return convertUnixToUtc(Math.min(...resets));
}
