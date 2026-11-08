import { ChatHttpError } from "../lib/chat-fetch";
import type { ChatWarningState } from "../lib/chat-types";

const UNREACHABLE: ChatWarningState = {
  message: "Couldn't reach the assistant. Check your connection and try again.",
  retryable: true,
};

/** Whether asking again can help, per the retryable column of the Worker's error table (plan #257 §4.2, D9). */
const RETRYABLE_BY_CODE: Record<string, boolean> = {
  rate_limited_daily: true,
  rate_limited: true,
  upstream_unavailable: true,
  misconfigured: false,
  failed: false,
};

/** The library wraps what a fetchClient throws; the original sits a few `cause`s down. */
function causeChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  for (let next = error; next instanceof Error && chain.length < 5; ) {
    chain.push(next);
    next = next.cause;
  }
  return chain;
}

function isTransportFailure(error: Error): boolean {
  return error.name === "TypeError" || error.name === "AbortError";
}

function isLocalhost(): boolean {
  const { hostname } = window.location;
  return hostname === "localhost" || hostname === "127.0.0.1";
}

/** Turns whatever `useChat` reports into the one warning the reader sees (plan #257 §4.4). */
export function classifyChatError(error: Error): ChatWarningState {
  const chain = causeChain(error);

  const http = chain.find(
    (e): e is ChatHttpError => e instanceof ChatHttpError,
  );
  if (http) {
    const body = http.cause as
      | { error: string; retryable: boolean }
      | undefined;
    if (body) return { message: body.error, retryable: body.retryable };
    if (http.status === 404 && isLocalhost()) {
      return {
        message:
          "No chat endpoint. The Astro dev server does not run the Worker: start the local stack with `pnpm --filter docs run dev:local`.",
        retryable: false,
      };
    }
    return {
      message: `The assistant is unavailable (HTTP ${http.status}).`,
      retryable: http.status >= 500,
    };
  }

  if (chain.some((e) => e instanceof Error && isTransportFailure(e))) {
    return UNREACHABLE;
  }

  // A failure written into an open stream: the Worker's curated text and `code`.
  const code = (error as { code?: unknown }).code;
  const message = error.message.trim();
  if (message === "") return UNREACHABLE;
  return {
    message,
    retryable:
      typeof code === "string" ? (RETRYABLE_BY_CODE[code] ?? true) : true,
  };
}

interface ChatWarningProps {
  state: ChatWarningState;
  /** Shown as "Try again" when the failure is retryable. */
  onRetry?: () => void;
}

/**
 * A recoverable problem is a polite status; one that asking again will not fix
 * is an alert (plan #257 D18). Held in component state, never in the transcript.
 */
export function ChatWarning({ state, onRetry }: ChatWarningProps) {
  const tone = state.retryable
    ? "bg-chat-warn-wash text-chat-warn-ink"
    : "bg-chat-danger-wash text-chat-fg";
  return (
    <div
      role={state.retryable ? "status" : "alert"}
      className={`mx-4 mb-2 flex flex-col gap-2 rounded-lg px-3 py-2 text-sm ${tone}`}
    >
      <p>{state.message}</p>
      {state.retryable && onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="self-start rounded border border-current px-2 py-1 font-medium hover:bg-chat-fill-strong focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          Try again
        </button>
      )}
    </div>
  );
}
