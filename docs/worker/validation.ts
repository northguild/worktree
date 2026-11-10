// Request validation for POST /api/chat (plan #257, D7). The Worker checks the
// body itself before `chat()` sees it, because TanStack AI's own
// `chatParamsFromRequest` accepts roles, tools, context and per-message
// metadata this chat never uses. Only `{ role, content }` pairs leave here.
//
// Order: envelope shape, then sanitise, then lengths, then the whole-
// conversation cap. Text is sanitised BEFORE it is measured (D8), so invisible
// padding neither counts against a cap nor smuggles anything through.
//
// The client replays the whole stored transcript on every request, so a cap
// that the history crosses refuses every later question too. Only the question
// being asked is the reader's to shorten: every refusal the history causes —
// the message count, an earlier turn over the per-message cap, the whole-
// conversation cap — says to start a new chat instead.

import { z } from "zod";
import {
  BRAIN_IDS,
  type BrainId,
  CHAT_MODEL_IDS,
  MAX_CONVERSATION_CHARS,
  MAX_MESSAGES,
} from "../src/chat/lib/chat-constants";
import {
  checkUserText,
  conversationLength,
  sanitizeUserText,
} from "../src/chat/lib/chat-sanitize";
import {
  MAX_PAGE_CONTEXT_LENGTH,
  PAGE_CONTEXT_PATTERN,
} from "../src/chat/lib/page-context";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export type ChatRequestResult =
  | {
      ok: true;
      value: {
        messages: ChatMessage[];
        /** The brain the reader asked for, if they did: `brain`, else #306's `model`. Absent is Automatic (D3, D9). */
        brain?: BrainId;
        /** The route of the page the reader came from, without the base: only a bias for the search (D3, D8). */
        pageContext?: string;
      };
    }
  | { ok: false; status: 400; error: string };

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

// The page the reader came from. It never reaches a prompt: the Worker reads one word of it (its section). So it is held
// to the shape of a route, and anything else is refused, not repaired.
const pageContextSchema = z
  .string()
  .max(MAX_PAGE_CONTEXT_LENGTH, "The page context is too long.")
  .regex(PAGE_CONTEXT_PATTERN, "The page context is not a page route.");

const envelopeSchema = z.object({
  threadId: z.string().max(200),
  runId: z.string().max(200),
  messages: z
    .array(messageSchema, { error: "Messages must be a list." })
    .min(1, "Send at least one message.")
    // One question at a time: only a long history can pass the count.
    .max(MAX_MESSAGES, TOO_LONG_CONVERSATION),
  tools: emptyList,
  context: emptyList,
  forwardedProps: z
    .strictObject({
      // #306's client names a model; `/dox` names a brain. Both stay accepted (D3), and `brain` wins when both come.
      model: z.enum(CHAT_MODEL_IDS, { error: "Unknown model." }).optional(),
      brain: z.enum(BRAIN_IDS, { error: "Unknown model." }).optional(),
      pageContext: pageContextSchema.optional(),
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

  const finalIndex = messages.length - 1;
  const cleaned: ChatMessage[] = [];
  for (const [index, { role, content }] of messages.entries()) {
    const text = sanitizeUserText(content);
    // Turns with nothing left are dropped, as the client does (`sendableHistory`).
    // An empty assistant turn goes now, so it cannot stand in for the final turn;
    // an empty user turn is kept until the final turn has been checked below.
    if (text === "") {
      if (role === "user") cleaned.push({ role, content: "" });
      continue;
    }
    const checked = checkUserText(text);
    if (!checked.ok) {
      const isQuestion = index === finalIndex && role === "user";
      return refuse(isQuestion ? checked.reason : TOO_LONG_CONVERSATION);
    }
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

  const brain = forwardedProps?.brain ?? forwardedProps?.model;
  return {
    ok: true,
    value: {
      messages: sendable,
      ...(brain !== undefined && { brain }),
      ...(forwardedProps?.pageContext !== undefined && {
        pageContext: forwardedProps.pageContext,
      }),
    },
  };
}
