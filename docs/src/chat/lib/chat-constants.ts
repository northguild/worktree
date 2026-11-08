// The contract the chat client and the chat Worker share (plan #257, D5).
// Nothing in this folder imports React or the DOM: the Worker bundles it.

/** Models the Worker will call (D4): both stable on Google's list. */
export const CHAT_MODELS = [
  { id: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite" },
  { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
] as const;

export type ChatModelId = (typeof CHAT_MODELS)[number]["id"];

/** Tuple form for `z.enum`, which needs at least one member. */
export const CHAT_MODEL_IDS = [CHAT_MODELS[0].id, CHAT_MODELS[1].id] as const;

export const DEFAULT_MODEL_ID: ChatModelId = CHAT_MODELS[0].id;

/**
 * Hard cap on a single message, in characters, measured after sanitising (D8).
 * Set by #40; the compose field stops a value reaching it and the Worker
 * rejects anything over it, so both read this one number.
 */
export const MAX_MESSAGE_LENGTH = 20_000;

/** Most messages one request may carry. */
export const MAX_MESSAGES = 50;

/**
 * Cap on the whole conversation, user and assistant text together, measured
 * like the per-message cap (sanitised, NFC). 100,000 is the maintainer's answer
 * to plan §9 Q4.
 */
export const MAX_CONVERSATION_CHARS = 100_000;

/** Requests allowed per client per window, unless the Worker's env overrides. */
export const RATE_LIMIT_MAX_REQUESTS = 30;
export const RATE_LIMIT_WINDOW_SECONDS = 60;

/** Client stops a stream silent for this long, or running this long overall. */
export const STREAM_IDLE_TIMEOUT_MS = 30_000;
export const REQUEST_TIMEOUT_MS = 120_000;
