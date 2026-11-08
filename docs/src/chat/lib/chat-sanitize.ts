// Input hardening shared by the client and the Worker (plan #257, D8; ported
// from gmt's Dox `chat-sanitize.ts`). The client runs it for an immediate
// message; the Worker runs it again because the client is not a boundary
// (security/validation.md).
//
// Stripped: characters that render as nothing, or reorder what the reader sees,
// so that what is sent and what was visible can differ — Unicode tag characters
// (hidden prompt payloads), bidi controls ("Trojan Source"), zero-width
// padding, and control characters with no meaning in prose. Kept on purpose:
// ZWNJ (U+200C) and ZWJ (U+200D), which Persian, Indic scripts and every
// multi-part emoji need and which cannot carry a payload. The set is
// enumerated, not `\p{Cf}`, because that category also holds the soft hyphen.
//
// Plain-text prompt injection cannot be told apart at the character level; the
// system prompt defends against it (D19).

import { MAX_MESSAGE_LENGTH } from "./chat-constants";

const INVISIBLE = new RegExp(
  [
    "[\\u0000-\\u0008\\u000B-\\u001F\\u007F]", // C0 + DEL, keeping \t (09) and \n (0A)
    "[\\u0080-\\u009F]", // C1
    "\\u200B", // zero-width space
    "[\\u200E\\u200F]", // LRM / RLM
    "[\\u202A-\\u202E]", // bidi embedding / override
    "[\\u2060-\\u2064]", // word joiner + invisible operators
    "[\\u2066-\\u2069]", // bidi isolates
    "\\uFEFF", // BOM / zero-width no-break space
    "[\\u{E0000}-\\u{E007F}]", // Unicode tag block
  ].join("|"),
  "gu",
);

/** Three or more newlines collapse to two, so padding cannot reach the cap. */
const EXCESS_BLANK_LINES = /\n{3,}/g;

/**
 * NFC first, so a composed and a decomposed accent measure the same against
 * the cap whatever the reader's keyboard produced.
 */
export function sanitizeUserText(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(INVISIBLE, "")
    .replace(EXCESS_BLANK_LINES, "\n\n")
    .trim();
}

export type UserTextCheck =
  | { ok: true; text: string }
  | { ok: false; reason: string };

/**
 * Sanitise, then apply the per-message limits. Returns the cleaned text so a
 * caller cannot use the raw input by mistake. Length is `String.length` (UTF-16
 * code units) of the sanitised text.
 */
export function checkUserText(raw: string): UserTextCheck {
  const text = sanitizeUserText(raw);

  if (text === "") {
    return { ok: false, reason: "Message is empty." };
  }
  if (text.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      reason: `Message is too long — ${text.length.toLocaleString("en-US")} characters, limit ${MAX_MESSAGE_LENGTH.toLocaleString("en-US")}.`,
    };
  }
  return { ok: true, text };
}

/** Characters across already-sanitised texts, for the whole-conversation cap. */
export function conversationLength(texts: readonly string[]): number {
  return texts.reduce((total, text) => total + text.length, 0);
}
