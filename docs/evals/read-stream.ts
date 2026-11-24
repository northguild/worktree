// Reads the Worker's SSE answer into one record (plan #355 §4.5, D8, D12). Every `data:` line is parsed through a Zod
// schema, never cast, because the body is network data: a model's output rides in it. A line it cannot use is recorded in
// `faults`, never dropped and never thrown, so a graded run says what it could not read.
//
// Loaded under Node's type stripping (D8): erasable syntax only, and relative imports carry a `.ts` extension. It never
// imports the handler or `prepare-turn.ts`: the runner talks to the Worker over HTTP.

import { z } from "zod";
import {
  PROGRESS_EVENT,
  REFUSAL_EVENT,
  RETRIEVAL_TRACE_EVENT,
  type RefusalData,
  type RetrievalTraceData,
} from "../src/chat/lib/chat-types.ts";

/** The tokens one answer used, summed over the `usage` entries `RUN_FINISHED` carries (D10). */
export interface StreamUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface StreamError {
  message: string;
  code?: string | number;
}

export interface StreamRecord {
  /** The `TEXT_MESSAGE_CONTENT` deltas, joined. */
  text: string;
  /** Every `dox-retrieval` event: one before the answer and one after it, or the one alone when the run failed. */
  traces: RetrievalTraceData[];
  /** The walk's `dox-progress` lines, in order. */
  progress: string[];
  /** The `dox-refusal` event: every brain was out for the day. */
  refusal: RefusalData | null;
  /** The `RUN_ERROR` event. A spent allowance sends one after its refusal, for clients that do not read `CUSTOM`. */
  runError: StreamError | null;
  usage: StreamUsage | null;
  /** `metadata.tanstack.finishReason` of `RUN_FINISHED`: `stop`, `length`, ... */
  finishReason: string | null;
  /** What could not be read, one sentence each. Empty for a clean stream. */
  faults: string[];
}

const ENVELOPE = z.looseObject({ type: z.string() });

const TEXT_CONTENT = z.looseObject({ delta: z.string() });

const CUSTOM = z.looseObject({ name: z.string(), value: z.unknown() });

const TRACE = z.looseObject({
  totalChunks: z.number(),
  retrievedCount: z.number(),
  chunkTitles: z.array(z.string()),
  chunkUrls: z.array(z.string()),
  timings: z
    .looseObject({
      corpus: z.number(),
      search: z.number(),
      prompt: z.number(),
      firstToken: z.number().optional(),
      total: z.number().optional(),
    })
    .optional(),
  brainLabel: z.string().optional(),
});

const PROGRESS = z.looseObject({ text: z.string() });

const REFUSAL = z.looseObject({
  status: z.number(),
  payload: z.looseObject({
    error: z.string(),
    retryable: z.boolean(),
    resetsAt: z.string().optional(),
  }),
});

const RUN_ERROR = z.looseObject({
  message: z.string(),
  code: z.union([z.string(), z.number()]).optional(),
});

const USAGE_ENTRY = z.looseObject({
  inputTokens: z.number(),
  outputTokens: z.number(),
});

// The library sends `usage` as a list of entries (the handler's recorded `RUN_FINISHED` does); a single object is read too.
const RUN_FINISHED = z.looseObject({
  usage: z.union([USAGE_ENTRY, z.array(USAGE_ENTRY)]).optional(),
  finishReason: z.string().optional(),
  metadata: z
    .looseObject({
      tanstack: z
        .looseObject({ finishReason: z.string().optional() })
        .optional(),
    })
    .optional(),
});

const NO_TERMINAL = "the stream ended with neither RUN_FINISHED nor RUN_ERROR";

/** Parses a whole SSE body. Total: it never throws, whatever the body holds. */
export function parseStream(body: string): StreamRecord {
  const record: StreamRecord = {
    text: "",
    traces: [],
    progress: [],
    refusal: null,
    runError: null,
    usage: null,
    finishReason: null,
    faults: [],
  };
  let ended = false;
  let event = 0;

  const fault = (what: string, why: z.ZodError | string) => {
    const detail = typeof why === "string" ? why : z.prettifyError(why);
    record.faults.push(
      `event ${event}: ${what}: ${detail.replaceAll("\n", " ")}`,
    );
  };

  for (const line of body.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const payload = line.slice("data:".length).trim();
    if (payload === "" || payload === "[DONE]") continue;
    event += 1;

    let json: unknown;
    try {
      json = JSON.parse(payload);
    } catch {
      record.faults.push(`event ${event}: not JSON`);
      continue;
    }
    const envelope = ENVELOPE.safeParse(json);
    if (!envelope.success) {
      fault("not an event", envelope.error);
      continue;
    }
    const { type } = envelope.data;

    if (type === "TEXT_MESSAGE_CONTENT") {
      const parsed = TEXT_CONTENT.safeParse(json);
      if (parsed.success) record.text += parsed.data.delta;
      else fault(type, parsed.error);
    } else if (type === "CUSTOM") {
      readCustom(json, record, fault);
    } else if (type === "RUN_ERROR") {
      ended = true;
      const parsed = RUN_ERROR.safeParse(json);
      if (parsed.success) {
        const { message, code } = parsed.data;
        record.runError = code === undefined ? { message } : { message, code };
      } else fault(type, parsed.error);
    } else if (type === "RUN_FINISHED") {
      ended = true;
      const parsed = RUN_FINISHED.safeParse(json);
      if (!parsed.success) {
        fault(type, parsed.error);
        continue;
      }
      const { usage, finishReason, metadata } = parsed.data;
      const entries = usage === undefined ? [] : [usage].flat();
      if (entries.length > 0) {
        record.usage = {
          inputTokens: entries.reduce((sum, e) => sum + e.inputTokens, 0),
          outputTokens: entries.reduce((sum, e) => sum + e.outputTokens, 0),
        };
      }
      record.finishReason =
        metadata?.tanstack?.finishReason ?? finishReason ?? null;
    }
  }

  if (!ended) record.faults.push(NO_TERMINAL);
  return record;
}

function readCustom(
  json: unknown,
  record: StreamRecord,
  fault: (what: string, why: z.ZodError) => void,
): void {
  const custom = CUSTOM.safeParse(json);
  if (!custom.success) {
    fault("CUSTOM", custom.error);
    return;
  }
  const { name, value } = custom.data;

  if (name === RETRIEVAL_TRACE_EVENT) {
    const parsed = TRACE.safeParse(value);
    if (parsed.success) record.traces.push(parsed.data);
    else fault(name, parsed.error);
  } else if (name === PROGRESS_EVENT) {
    const parsed = PROGRESS.safeParse(value);
    if (parsed.success) record.progress.push(parsed.data.text);
    else fault(name, parsed.error);
  } else if (name === REFUSAL_EVENT) {
    const parsed = REFUSAL.safeParse(value);
    if (parsed.success) record.refusal = parsed.data;
    else fault(name, parsed.error);
  }
}

/** Reads a `/api/chat` response to the end. */
export async function readStream(response: Response): Promise<StreamRecord> {
  return parseStream(await response.text());
}
