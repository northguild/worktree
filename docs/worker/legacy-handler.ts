// The protocol the live site's current client speaks, frozen at plan #257's
// baseline (D3). It is served at `POST /` until a stable release has shipped the
// new client; do not "improve" it. Its model list and caps are its own copies so
// that later changes to src/chat cannot change what an old client is told.

import { SYSTEM_PROMPT } from "./docs-context.js";
import { chatRateLimiter, nowMs, retryAfterSeconds } from "./rate-limit.js";

export const LEGACY_ALLOWED_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3-flash-preview",
] as const;
export const LEGACY_MAX_MESSAGE_LENGTH = 20_000;
const LEGACY_MAX_MESSAGES = 50;

const DEFAULT_MODEL = LEGACY_ALLOWED_MODELS[0];
const ALLOWED_CHAT_ROLES = new Set(["user", "assistant"]);

// Grouped once here rather than inside the rejection, so the number a caller is
// told about is read from the same constant that is enforced above it.
const MAX_MESSAGE_LENGTH_LABEL =
  LEGACY_MAX_MESSAGE_LENGTH.toLocaleString("en-US");

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

type GeminiPart = { text: string };
type GeminiContent = { role: string; parts: GeminiPart[] };

function toGeminiContents(
  messages: Array<{ role: string; content: string }>,
): GeminiContent[] {
  return messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
}

function jsonError(
  error: string,
  status: number,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

export async function handleLegacyRequest(
  request: Request,
  env: Record<string, string>,
  cors: Record<string, string>,
): Promise<Response> {
  const rateLimit = chatRateLimiter.checkRequest(request, env);
  if (rateLimit.limited) {
    return new Response(
      JSON.stringify({
        error:
          "Rate limit exceeded for this worker. Please wait and try again.",
      }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": retryAfterSeconds(rateLimit, nowMs()).toString(),
          ...cors,
        },
      },
    );
  }

  const key = env.GEMINI_API_KEY;
  if (!key) return jsonError("GEMINI_API_KEY not configured", 500, cors);

  let body: {
    messages?: Array<{ role: string; content: string }>;
    model?: string;
  };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON", 400, cors);
  }

  const url = new URL(request.url);
  const model = url.searchParams.get("model") ?? body.model ?? DEFAULT_MODEL;

  // ── Input validation ──────────────────────────────────────────────────────
  const messages = body.messages;
  if (!Array.isArray(messages)) {
    return jsonError("messages must be an array", 400, cors);
  }
  if (messages.length > LEGACY_MAX_MESSAGES) {
    return jsonError(
      `Too many messages (max ${LEGACY_MAX_MESSAGES})`,
      400,
      cors,
    );
  }
  for (const msg of messages) {
    if (
      typeof msg !== "object" ||
      msg === null ||
      typeof (msg as Record<string, unknown>).role !== "string" ||
      typeof (msg as Record<string, unknown>).content !== "string"
    ) {
      return jsonError("Invalid message format", 400, cors);
    }
    const role = (msg as Record<string, unknown>).role as string;
    if (!ALLOWED_CHAT_ROLES.has(role)) {
      return jsonError(
        "Invalid message role (must be user or assistant)",
        400,
        cors,
      );
    }
    if (
      ((msg as Record<string, unknown>).content as string).length >
      LEGACY_MAX_MESSAGE_LENGTH
    ) {
      return jsonError(
        `Message too long (max ${MAX_MESSAGE_LENGTH_LABEL} chars)`,
        400,
        cors,
      );
    }
  }

  if (!(LEGACY_ALLOWED_MODELS as readonly string[]).includes(model)) {
    return jsonError("Model not allowed", 400, cors);
  }

  const geminiBody: Record<string, unknown> = {
    contents: toGeminiContents(body.messages ?? []),
  };
  if (SYSTEM_PROMPT) {
    geminiBody.systemInstruction = { parts: [{ text: SYSTEM_PROMPT }] };
  }

  // D10: the key travels in a header, never in the URL, where it would reach logs.
  const endpoint = `${GEMINI_BASE}/${model}:streamGenerateContent?alt=sse`;
  const upstream = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify(geminiBody),
  });

  if (!upstream.ok) {
    let userMessage: string;
    if (upstream.status === 429) {
      let isDaily = false;
      try {
        const errBody = (await upstream.json()) as {
          error?: { message?: string };
        };
        const msg = errBody.error?.message?.toLowerCase() ?? "";
        isDaily =
          msg.includes("daily") ||
          msg.includes("per_day") ||
          msg.includes("per day");
      } catch {
        // couldn't parse — default to the shorter hint
      }
      userMessage = isDaily
        ? "Daily request limit reached for this model — try again tomorrow, or switch to a different model."
        : "Rate limit reached for this model — try again in a minute, or switch to a different model.";
    } else {
      try {
        const errBody = (await upstream.json()) as {
          error?: { status?: string; message?: string };
        };
        const { status, message } = errBody.error ?? {};
        userMessage =
          status && message
            ? `${status}: ${message}`
            : `Request failed (${upstream.status})`;
      } catch {
        userMessage = `Request failed (${upstream.status})`;
      }
    }
    return jsonError(userMessage, upstream.status, cors);
  }

  // Pipe the Gemini SSE stream directly to the client.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...cors,
    },
  });
}
