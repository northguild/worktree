// Request validation for POST /api/chat (plan #257, D7). The Worker checks the
// body itself before `chat()` sees it, because TanStack AI's own
// `chatParamsFromRequest` accepts roles, tools, context and per-message
// metadata this chat never uses. Only `{ role, content }` pairs leave here.
//
// Order: envelope shape, then sanitise, then lengths, then the whole-
// conversation cap. Text is sanitised BEFORE it is measured (D8), so invisible
// padding neither counts against a cap nor smuggles anything through.

import { z } from "zod";
import {
  CHAT_MODEL_IDS,
  type ChatModelId,
  DEFAULT_MODEL_ID,
  MAX_CONVERSATION_CHARS,
  MAX_MESSAGES,
} from "../src/chat/lib/chat-constants";
import {
  checkUserText,
  conversationLength,
  sanitizeUserText,
} from "../src/chat/lib/chat-sanitize";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type ChatRequestResult =
  | { ok: true; value: { messages: ChatMessage[]; model: ChatModelId } }
  | { ok: false; status: 400; error: string };

const TOO_MANY_MESSAGES = `Too many messages — limit ${MAX_MESSAGES.toLocaleString("en-US")}.`;
const TOO_LONG_CONVERSATION = "Conversation is too long. Start a new chat.";
const EMPTY_MESSAGE = "Message is empty.";

// Messages: unknown keys are ignored (the library's wire shape may grow), and
// `metadata` is accepted so a real request is not rejected, then never read.
const messageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"], {
    error: "Messages must come from the user or the assistant.",
  }),
  content: z.string({ error: "Message content must be text." }),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// `tools` and `context` exist in the AG-UI shape; this chat sends none, and a
// client must not be able to declare any.
const emptyList = z
  .array(z.unknown())
  .max(0, "Tools and context are not accepted.")
  .optional();

const envelopeSchema = z.object({
  threadId: z.string().max(200),
  runId: z.string().max(200),
  messages: z
    .array(messageSchema, { error: "Messages must be a list." })
    .min(1, "Send at least one message.")
    .max(MAX_MESSAGES, TOO_MANY_MESSAGES),
  tools: emptyList,
  context: emptyList,
  forwardedProps: z
    .strictObject({
      model: z.enum(CHAT_MODEL_IDS, { error: "Unknown model." }).optional(),
    })
    .optional(),
});

function refuse(error: string): ChatRequestResult {
  return { ok: false, status: 400, error };
}

export function validateChatRequest(body: unknown): ChatRequestResult {
  const parsed = envelopeSchema.safeParse(body);
  if (!parsed.success) {
    return refuse(parsed.error.issues[0]?.message ?? "Invalid request.");
  }
  const { messages, forwardedProps } = parsed.data;

  const cleaned: ChatMessage[] = [];
  for (const { role, content } of messages) {
    const text = sanitizeUserText(content);
    // Turns with nothing left are dropped, as the client does (`sendableHistory`).
    // An empty assistant turn goes now, so it cannot stand in for the final turn;
    // an empty user turn is kept until the final turn has been checked below.
    if (text === "") {
      if (role === "user") cleaned.push({ role, content: "" });
      continue;
    }
    const checked = checkUserText(text);
    if (!checked.ok) return refuse(checked.reason);
    cleaned.push({ role, content: checked.text });
  }

  const last = cleaned.at(-1);
  if (last?.role !== "user") {
    return refuse("The last message must be from the user.");
  }
  if (last.content === "") return refuse(EMPTY_MESSAGE);

  const sendable = cleaned.filter((message) => message.content !== "");
  if (
    conversationLength(sendable.map((message) => message.content)) >
    MAX_CONVERSATION_CHARS
  ) {
    return refuse(TOO_LONG_CONVERSATION);
  }

  return {
    ok: true,
    value: {
      messages: sendable,
      model: forwardedProps?.model ?? DEFAULT_MODEL_ID,
    },
  };
}
