// Turns a failure from the model provider into the curated text a reader sees
// (plan #257 §4.2 table, D9). Nothing the provider wrote reaches the reader:
// callers send `message` only, never the upstream text.

export type ChatErrorCode =
  | "misconfigured"
  | "rate_limited_daily"
  | "rate_limited"
  | "upstream_unavailable"
  | "upstream_slow"
  | "allowance_spent"
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
  /**
   * For Gemini, `JSON.stringify` of Google's error body. For Workers AI, the OpenAI client's text: the HTTP status, a
   * space, then Cloudflare's message.
   */
  message?: string;
  /**
   * An `ApiError`'s HTTP `status`, or a `RUN_ERROR`'s `code`. For Workers AI the `code` is Cloudflare's own error number
   * (3036, 3040, 4006), not an HTTP status.
   */
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
  upstream_slow: {
    code: "upstream_slow",
    message:
      "The assistant is slow to respond right now. Please try again in a moment.",
    retryable: true,
  },
  allowance_spent: {
    code: "allowance_spent",
    message: "Dox has used its free allowance for today.",
    retryable: false,
  },
  failed: {
    code: "failed",
    message: "Something went wrong answering that question.",
    retryable: false,
  },
};

const PER_DAY = /per\s*day/i;
const API_KEY_INVALID = /API_KEY_INVALID/;
/** The `code` a walk that ran out of time puts on its `RUN_ERROR` (`brains.ts`). */
export const BRAINS_TIMED_OUT_CODE = "brains_timed_out";
/** The `code` of the `RUN_ERROR` that follows a refusal, for a client that does not read the refusal (`chat-handler.ts`). */
export const ALLOWANCE_SPENT_CODE = "allowance_spent";
/**
 * Workers AI's daily-allocation failure arrives as Cloudflare error 3036 (documented) or 4006 (undocumented, and widely
 * reported on Cloudflare's forum as "you have used up your daily free allocation of 10,000 neurons"; gmt
 * `worker/brains.ts`, `ALLOCATION_EXHAUSTED`). The number is read from the `code` only: a bare number in a message could
 * be a token count in a Gemini error.
 */
const ALLOCATION_CODE = /^(3036|4006)$/;
const ALLOCATION_PHRASE = /daily free allocation/i;
/** The OpenAI client's message for a failed call: the HTTP status first. */
const LEADING_STATUS = /^(\d{3})\b/;

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

/** The HTTP status a failure carries, from wherever the provider's client put it. */
export function statusOf(input: UpstreamError): number | undefined {
  const text = input.message ?? "";
  const leading = LEADING_STATUS.exec(text);
  return (
    asStatus(input.code) ??
    statusFromMessage(text) ??
    (leading ? asStatus(leading[1]) : undefined)
  );
}

/** True when a Workers AI failure says the account's whole Neuron pool is gone for the day. */
export function isAllocationExhausted(input: UpstreamError): boolean {
  return (
    ALLOCATION_CODE.test(String(input.code ?? "")) ||
    ALLOCATION_PHRASE.test(input.message ?? "")
  );
}

export function mapUpstreamError(input: UpstreamError): MappedError {
  const text = input.message ?? "";
  if (input.code === BRAINS_TIMED_OUT_CODE) return MAPPED.upstream_slow;
  if (input.code === ALLOWANCE_SPENT_CODE) return MAPPED.allowance_spent;
  if (isAllocationExhausted(input)) return MAPPED.rate_limited_daily;
  const status = statusOf(input);

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
