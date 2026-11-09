import type { UIMessage as LibraryUIMessage } from "@tanstack/ai/client";

/**
 * The app's message type. This chat sends and renders text only (plan #257
 * D13), but `useChat` hands back the library's full `UIMessage`, so the alias
 * is the one place a later narrowing would go.
 */
export type UIMessage = LibraryUIMessage;

/** What the warning under the transcript shows (plan #257 §4.4). */
export interface ChatWarningState {
  message: string;
  retryable: boolean;
}

/**
 * One retrievable unit: a heading-delimited section of a docs page (plan #309 D8; gmt's `RetrievalChunk`).
 * `build-context.mjs` writes them and the Worker searches them.
 */
export interface RetrievalChunk {
  /** `<route>#<heading slug>`, unique across the corpus. Never shown to the model. */
  id: string;
  /** The page's route, in the `VALID_DOC_ROUTES` form: the one thing the model may link, never a fragment. */
  url: string;
  /** The page's section (`routeNamespace`), which a question's referrer biases the search toward. */
  namespace: string;
  /** "Page title › Heading", or the page title alone for the text before the first heading. Shown in the trace. */
  title: string;
  /** The heading and the section's body. */
  text: string;
}

/**
 * One section of the skill guide, offered to the model as vocabulary and never as a source to link (D8).
 */
export interface VocabularySection {
  title: string;
  text: string;
}

/** What `build-context.mjs` counts, for the status line and the trace. */
export interface CorpusCounts {
  pages: number;
  /** Chunks in the index: every heading section of every page. */
  chunks: number;
}

/** Milliseconds spent in each stage of one `/api/chat` request, whole numbers (a sub-millisecond stage is 0). */
export interface RetrievalTimings {
  /** Loading the serialized index: 0 while the isolate is warm. */
  corpus: number;
  search: number;
  /** Choosing the vocabulary and assembling the prompt. */
  prompt: number;
  /** From the request arriving to the first text. Arrives with the second write. */
  firstToken?: number;
  /** From the request arriving to the end of the answer. Arrives with the second write. */
  total?: number;
}

/**
 * What the Worker says it retrieved, sent as the `RETRIEVAL_TRACE_EVENT` `CUSTOM` event (D3): once before the answer and
 * again after it, with the same shape, the second adding `firstToken` and `total`. The client keeps the latest.
 * `retrievedCount: 0` is the honest-refusal case: the trace says nothing matched, above an answer that declines.
 */
export interface RetrievalTraceData {
  /** Chunks in the index. */
  totalChunks: number;
  /** Chunks the prompt carries (the kept ones, after `fitChunks`). */
  retrievedCount: number;
  chunkTitles: string[];
  /** The routes the prompt lists, which are the kept chunks' pages. */
  chunkUrls: string[];
  timings?: RetrievalTimings;
  /** The brain that answered. Named from phase 6 on; absent before. */
  brainLabel?: string;
}

/** The `CUSTOM` event name the trace travels under. */
export const RETRIEVAL_TRACE_EVENT = "dox-retrieval";

/** A value of `RETRIEVAL_TRACE_EVENT`, checked: the wire is the Worker's, but a stale or foreign value must not throw in render. */
export function readRetrievalTrace(value: unknown): RetrievalTraceData | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  const strings = (x: unknown): x is string[] =>
    Array.isArray(x) && x.every((item) => typeof item === "string");
  if (
    typeof v.totalChunks !== "number" ||
    typeof v.retrievedCount !== "number" ||
    !strings(v.chunkTitles) ||
    !strings(v.chunkUrls)
  ) {
    return null;
  }
  const timings = v.timings;
  const ms = (x: unknown): number | undefined =>
    typeof x === "number" && Number.isFinite(x) ? x : undefined;
  const t =
    typeof timings === "object" && timings !== null
      ? (timings as Record<string, unknown>)
      : null;
  return {
    totalChunks: v.totalChunks,
    retrievedCount: v.retrievedCount,
    chunkTitles: v.chunkTitles,
    chunkUrls: v.chunkUrls,
    ...(t && {
      timings: {
        corpus: ms(t.corpus) ?? 0,
        search: ms(t.search) ?? 0,
        prompt: ms(t.prompt) ?? 0,
        ...(ms(t.firstToken) !== undefined && { firstToken: ms(t.firstToken) }),
        ...(ms(t.total) !== undefined && { total: ms(t.total) }),
      } as RetrievalTimings,
    }),
    ...(typeof v.brainLabel === "string" && { brainLabel: v.brainLabel }),
  };
}
