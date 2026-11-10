// The contract the chat client and the chat Worker share (plan #257, D5).
// Nothing in this folder imports React or the DOM: the Worker bundles it.

/**
 * The two models #306's client could name in `forwardedProps.model` (D4). Still accepted (plan #309 D3), so a client
 * cut before `/dox` keeps working; both are also brains below.
 */
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

/** Where a brain runs: Gemini needs the key, Workers AI needs the `AI` binding (plan #309 D9). */
export type BrainProvider = "google" | "workers-ai";

/** A model Dox can answer with. */
export interface Brain {
  /** Short and URL-safe: Workers AI's own ids carry `@` and `/`. */
  id: string;
  /** What the reader sees: in the trace and, from phase 8, the brain menu. */
  label: string;
  provider: BrainProvider;
  /** The provider's own model id, when it differs from `id` (Workers AI). */
  model?: string;
  /**
   * Workers AI defaults `max_tokens` to 256, which cuts a Dox answer off mid-sentence, so its brains carry an explicit
   * cap. Gemini leaves it unset.
   */
  maxOutputTokens?: number;
  /**
   * Workers AI: whether a model that thinks before answering may. gmt measured one short grounded question at 1.6 s
   * (Gemma) and 2.5 s (GLM) with thinking off, and 4-21 s with it on (`chat-constants.ts`, `enableThinking`).
   */
  enableThinking?: boolean;
  /**
   * What the badge shows as "N left" (D10). Advisory: it never gates a request, because the provider's own refusal is the
   * only real gate, so a wrong number misprints a digit and nothing more. Sized for gmt's pools (plan §8; open until
   * §9 Q4 answers).
   */
  dailyLimit: number;
}

/**
 * Dox's brains in the order the Worker tries them (plan #309 D9, from gmt `chat-constants.ts` `BRAINS`): the two Workers
 * AI models first, because Workers AI is a pool this site's questions can spend free of charge, then Gemini, Flash-Lite
 * first and the full Flash models after it.
 */
export const BRAINS = [
  {
    id: "cf-gemma-4-26b",
    label: "Gemma 4 26B",
    provider: "workers-ai",
    model: "@cf/google/gemma-4-26b-a4b-it",
    enableThinking: false,
    maxOutputTokens: 2048,
    dailyLimit: 40,
  },
  {
    id: "cf-glm-4.7-flash",
    label: "GLM 4.7 Flash",
    provider: "workers-ai",
    model: "@cf/zai-org/glm-4.7-flash",
    enableThinking: false,
    maxOutputTokens: 2048,
    dailyLimit: 40,
  },
  {
    id: "gemini-3.5-flash-lite",
    label: "3.5 Flash-Lite",
    provider: "google",
    dailyLimit: 20,
  },
  {
    id: "gemini-3.6-flash",
    label: "3.6 Flash",
    provider: "google",
    dailyLimit: 20,
  },
  {
    id: "gemini-3.5-flash",
    label: "3.5 Flash",
    provider: "google",
    dailyLimit: 20,
  },
] as const satisfies readonly Brain[];

export type BrainId = (typeof BRAINS)[number]["id"];

/** Tuple form for `z.enum`, which needs at least one member. */
export const BRAIN_IDS = BRAINS.map((brain) => brain.id) as [
  BrainId,
  ...BrainId[],
];

/**
 * How long one brain may take to produce its first content before the Worker moves on without it (D9, from gmt
 * `BRAIN_START_TIMEOUT_MS`). Workers AI gets longer because its models start more slowly under load. A slow start is
 * not a spent allowance, so nothing is marked.
 */
export const BRAIN_START_TIMEOUT_MS: Readonly<Record<BrainProvider, number>> = {
  google: 15_000,
  "workers-ai": 20_000,
};

/**
 * Whose midnight a provider's daily allowance refills at (D9; plan §8): Gemini's requests-per-day reset at midnight
 * Pacific (Google's rate-limit docs, as gmt `BRAIN_PROVIDERS`), and Workers AI's 10,000 Neurons at 00:00 UTC
 * (Cloudflare's pricing page: "All limits reset daily at 00:00 UTC").
 */
export const BRAIN_RESET_TIME_ZONE: Readonly<Record<BrainProvider, string>> = {
  google: "America/Los_Angeles",
  "workers-ai": "UTC",
};

/** What a provider is called beside its reset time in the brain menu (D10; gmt `BRAIN_PROVIDERS`). */
export const BRAIN_PROVIDER_LABEL: Readonly<Record<BrainProvider, string>> = {
  google: "Gemini",
  "workers-ai": "Workers AI",
};

/**
 * Questions one visitor may ask in a UTC day (D10; gmt `VISITOR_DAILY_MAX`), sized for gmt's pool and kept until §9 Q4
 * answers. Enforced before any brain is asked, and advisory in the way the ledger is: it lives in KV.
 */
export const VISITOR_DAILY_MAX = 5;
