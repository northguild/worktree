// Turns a failure from the model provider into the curated text a reader sees
// (plan #257 §4.2 table, D9). Nothing the provider wrote reaches the reader:
// callers send `message` only, never the upstream text.

export type ChatErrorCode =
  | "misconfigured"
  | "rate_limited_daily"
  | "rate_limited"
  | "upstream_unavailable"
  | "failed";

export interface MappedError {
  code: ChatErrorCode;
  /** Reader-facing text. */
  message: string;
  /** Whether trying again can help; the client reads it from `code`. */
  retryable: boolean;
}

/** What the mapper reads from a thrown error or a `RUN_ERROR` chunk. */
export interface UpstreamError {
  /** For Gemini, `JSON.stringify` of Google's error body. */
  message?: string;
  /** An `ApiError`'s HTTP `status`, or a `RUN_ERROR`'s `code`. */
  code?: string | number;
}

const MAPPED: Record<ChatErrorCode, MappedError> = {
  misconfigured: {
    code: "misconfigured",
    message: "The assistant is temporarily unavailable.",
    retryable: false,
  },
  rate_limited_daily: {
    code: "rate_limited_daily",
    message:
      "The assistant has reached its daily limit. Try again tomorrow, or pick the other model.",
    retryable: true,
  },
  rate_limited: {
    code: "rate_limited",
    message:
      "The assistant is receiving too many requests. Wait a moment and try again.",
    retryable: true,
  },
  upstream_unavailable: {
    code: "upstream_unavailable",
    message: "The assistant's model is unavailable right now.",
    retryable: true,
  },
  failed: {
    code: "failed",
    message: "Something went wrong answering that question.",
    retryable: false,
  },
};

const PER_DAY = /per\s*day/i;
const API_KEY_INVALID = /API_KEY_INVALID/;

function asStatus(value: unknown): number | undefined {
  const n =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^\d{3}$/.test(value)
        ? Number(value)
        : Number.NaN;
  return Number.isInteger(n) && n >= 400 && n < 600 ? n : undefined;
}

/**
 * The HTTP status inside a Gemini error message. The adapter's message is
 * Google's body as JSON, `{"error":{"code":429,...}}`, and sometimes a second
 * body inside the first one's `message`; one level of nesting is followed.
 */
function statusFromMessage(message: string, depth = 0): number | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return undefined;
  }
  const error = (parsed as { error?: { code?: unknown; message?: unknown } })
    ?.error;
  if (typeof error !== "object" || error === null) return undefined;
  const direct = asStatus(error.code);
  if (typeof error.message === "string" && depth < 1) {
    const inner = statusFromMessage(error.message, depth + 1);
    if (inner !== undefined) return inner;
  }
  return direct;
}

export function mapUpstreamError(input: UpstreamError): MappedError {
  const text = input.message ?? "";
  const status = asStatus(input.code) ?? statusFromMessage(text);

  if (API_KEY_INVALID.test(text)) return MAPPED.misconfigured;
  if (status === 401 || status === 403) return MAPPED.misconfigured;
  if (status === 429) {
    return PER_DAY.test(text) ? MAPPED.rate_limited_daily : MAPPED.rate_limited;
  }
  if (status !== undefined) return MAPPED.upstream_unavailable;
  return MAPPED.failed;
}

/** What `mapUpstreamError` reads from anything a stream can throw. */
export function describeThrown(error: unknown): UpstreamError {
  if (typeof error !== "object" || error === null) return {};
  const { message, status, code } = error as Record<string, unknown>;
  return {
    message: typeof message === "string" ? message : undefined,
    code:
      typeof status === "number" || typeof status === "string"
        ? status
        : typeof code === "number" || typeof code === "string"
          ? code
          : undefined,
  };
}
