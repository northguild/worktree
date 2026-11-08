// What of a transcript is sent, stored and shown (plan #257 D11, D12, D17).

import { convertUtcToUnix } from "@northguild/gmt";
import { z } from "zod";
import type { UIMessage } from "./chat-types";

/** The text a message carries. Parts that are not text do not count (D13). */
export function messageText(message: UIMessage): string {
  return message.parts
    .map((part) => (part.type === "text" ? part.content : ""))
    .join("");
}

/**
 * Drops assistant turns that carry no text and keeps everything else (D11).
 * A turn the model never answered, or one a stream error left empty, would be
 * replayed on every later question. A user turn is what the reader asked and is
 * never dropped. `textOf` reads the text of whichever message shape is passed:
 * the transcript's `UIMessage` or a request body's `{ content }`.
 */
export function sendableHistory<T extends { role: string }>(
  messages: readonly T[],
  textOf: (message: T) => string,
): T[] {
  return messages.filter(
    (message) => message.role !== "assistant" || textOf(message).trim() !== "",
  );
}

/**
 * A message's creation time in milliseconds, for `MessageMeta` (D17). The
 * library stamps a `Date`; a transcript read back from storage may carry a
 * number or an ISO string. A message with no readable time shows none.
 */
export function createdAtMs(value: unknown): number | undefined {
  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : typeof value === "string"
          ? // A UTC instant, which is what `JSON.stringify` writes for a `Date`.
            convertUtcToUnix(value)
          : null;
  return ms !== null && Number.isFinite(ms) ? ms : undefined;
}

const asDate = z.coerce.date();

/**
 * The `Date` that `UIMessage.createdAt` is typed as. The library owns that type
 * and no @northguild/gmt function makes a `Date`, so zod's coercion does.
 */
export function createdAtDate(ms: number): Date {
  return asDate.parse(ms);
}

// --- Persistence (D12) -------------------------------------------------------

/** What is stored: the messages. (The library's `ChatPersistedState` adds a resume pointer, which is not kept.) */
export interface TranscriptState {
  messages: UIMessage[];
}

/** `localStoragePersistence` stores under `<prefix><threadId>`. */
export const TRANSCRIPT_KEY_PREFIX = "docs_chat_transcript:";

const storedTextPart = z.object({
  type: z.literal("text"),
  content: z.string(),
});

const storedMessage = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  parts: z.array(storedTextPart),
  // A time that cannot be read is dropped; it never costs the reader the transcript.
  createdAt: z
    .union([z.string(), z.number()])
    .transform(createdAtMs)
    .transform((ms) => (ms === undefined ? undefined : createdAtDate(ms)))
    .optional()
    .catch(undefined),
});

const storedTranscript = z.object({ messages: z.array(storedMessage) });

/**
 * Stores the messages only. The library's resume pointer is left out on
 * purpose: a reload mid-answer would try to rejoin a run over a GET this
 * Worker does not serve. Assistant turns without text, and any part that is
 * not text, are not kept.
 */
export function serializeTranscript(state: TranscriptState): string {
  const messages = state.messages.flatMap((message) => {
    if (message.role !== "user" && message.role !== "assistant") return [];
    const text = messageText(message);
    if (message.role === "assistant" && text.trim() === "") return [];
    const { id, role, createdAt } = message;
    return [
      {
        id,
        role,
        parts: [{ type: "text", content: text }],
        ...(createdAt === undefined ? {} : { createdAt }),
      },
    ];
  });
  return JSON.stringify({ messages });
}

/**
 * Throws on anything that is not messages of text parts. Stored data is
 * external input (`security/validation.md`): it is refused whole, not repaired.
 */
export function deserializeTranscript(raw: string): TranscriptState {
  const parsed = storedTranscript.parse(JSON.parse(raw));
  return { messages: parsed.messages };
}

/** The per-model transcripts the retired client kept: `docs_chat_history_` + its three model ids. */
export const LEGACY_HISTORY_KEYS = [
  "docs_chat_history_gemini-2.5-flash",
  "docs_chat_history_gemini-2.5-flash-lite",
  "docs_chat_history_gemini-3-flash-preview",
] as const;

/** Removed, not migrated (D12, R9). */
export function removeLegacyHistory(): void {
  try {
    for (const key of LEGACY_HISTORY_KEYS) localStorage.removeItem(key);
  } catch {
    // No storage, nothing to remove.
  }
}
