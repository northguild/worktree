import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { classifyChatError } from "../components/ChatWarning";
import type { ChatModelId } from "../lib/chat-constants";
import { chatEndpoint } from "../lib/chat-endpoint";
import { chatFetch } from "../lib/chat-fetch";
import { messageText, removeLegacyHistory } from "../lib/chat-history";
import { checkUserText } from "../lib/chat-sanitize";
import {
  type ChatWarningState,
  RETRIEVAL_TRACE_EVENT,
  type RetrievalTraceData,
  readRetrievalTrace,
  type UIMessage,
} from "../lib/chat-types";
import { pageContextFromReferrer } from "../lib/page-context";
import { createTranscriptStorage } from "./transcript-storage";
import { useIdleTimeout } from "./useIdleTimeout";

/** One conversation, one thread (plan #257 D11, D12). */
const THREAD_ID = "docs-chat";

const STALLED: ChatWarningState = {
  message:
    "Dox stopped responding. The answer above may be incomplete — try asking again.",
  retryable: true,
};

// Both are made once: the connection reads the Worker URL, and the transcript
// storage reads `localStorage` lazily on each call.
const connection = fetchServerSentEvents(
  chatEndpoint(import.meta.env.PUBLIC_GEMINI_WORKER_URL),
  { fetchClient: chatFetch },
);
const persistence = createTranscriptStorage();

/** What the Worker said it retrieved, by the question's place in the conversation: 1 for the first, 2 for the second. */
export type RetrievalTraces = Readonly<Record<number, RetrievalTraceData>>;

/** How many of the messages are the reader's questions. */
function questionCount(messages: ReadonlyArray<UIMessage>): number {
  return messages.filter((message) => message.role === "user").length;
}

export interface DocsChat {
  messages: ReadonlyArray<UIMessage>;
  /**
   * The retrieval trace of each answer this page has seen (plan #309 D3). Not kept with the stored transcript: an
   * answer restored from an earlier visit has none, and the reader is shown none rather than a guess.
   */
  traces: RetrievalTraces;
  isStreaming: boolean;
  /** The failure to show under the transcript, if the last answer failed. */
  warning: ChatWarningState | null;
  sendMessage: (text: string) => Promise<void>;
  /**
   * The composer's send (D8): checks the text, sends what survives and answers
   * whether it was accepted. A refusal is shown as a warning and sends nothing.
   */
  submit: (text: string) => boolean;
  /** Asks the last question again, replacing whatever answered it. */
  retry: () => Promise<void>;
  stop: () => void;
  clear: () => void;
}

/**
 * The chat: TanStack AI's `useChat` over the Worker's `POST /api/chat`, with
 * the one transcript kept in `localStorage`, failures held as a warning rather
 * than as messages, and an answer that goes silent stopped (plan #257 §4.4).
 */
export function useDocsChat(model: ChatModelId): DocsChat {
  const [warning, setWarning] = useState<ChatWarningState | null>(null);
  const [traces, setTraces] = useState<RetrievalTraces>({});

  // The page the reader came from, which the Worker's search leans toward (D3, D8). Read once: `document.referrer`
  // does not change while this page is open, and `/dox/` itself is no page to lean toward.
  const [pageContext] = useState(() =>
    typeof document === "undefined"
      ? undefined
      : pageContextFromReferrer(
          document.referrer,
          window.location.origin,
          import.meta.env.BASE_URL,
        ),
  );

  // The question the answer on its way belongs to. The Worker's trace arrives as a custom event with no message in it,
  // so the hook says which question is being answered: set where a question is sent, read where the event arrives.
  const answeringRef = useRef(0);
  const messagesRef = useRef<ReadonlyArray<UIMessage>>([]);

  const chat = useChat({
    connection,
    threadId: THREAD_ID,
    persistence,
    forwardedProps: { model, ...(pageContext ? { pageContext } : {}) },
    onError: (error) => setWarning(classifyChatError(error)),
    onCustomEvent: (name, value) => {
      if (name !== RETRIEVAL_TRACE_EVENT) return;
      const trace = readRetrievalTrace(value);
      if (trace === null || answeringRef.current === 0) return;
      const question = answeringRef.current;
      setTraces((current) => ({ ...current, [question]: trace }));
    },
  });
  const { messages, isLoading, stop } = chat;
  // After the render commits, not during it: a ref is not written while rendering.
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // The retired client kept one transcript per model; they are removed, not migrated (D12).
  useEffect(removeLegacyHistory, []);

  const lastMessage = messages.at(-1);
  useIdleTimeout({
    active: isLoading,
    signal: lastMessage
      ? `${lastMessage.id}:${messageText(lastMessage).length}`
      : "",
    onTimeout: () => {
      stop();
      setWarning(STALLED);
    },
  });

  const { sendMessage: send, reload, clear: clearMessages } = chat;

  const sendMessage = useCallback(
    async (text: string) => {
      setWarning(null);
      answeringRef.current = questionCount(messagesRef.current) + 1;
      await send(text);
    },
    [send],
  );

  const submit = useCallback(
    (text: string) => {
      const checked = checkUserText(text);
      if (!checked.ok) {
        setWarning({ message: checked.reason, retryable: false });
        return false;
      }
      void sendMessage(checked.text);
      return true;
    },
    [sendMessage],
  );

  const retry = useCallback(async () => {
    setWarning(null);
    answeringRef.current = questionCount(messagesRef.current);
    await reload();
  }, [reload]);

  const clear = useCallback(() => {
    clearMessages();
    setWarning(null);
    setTraces({});
    answeringRef.current = 0;
  }, [clearMessages]);

  return {
    messages,
    traces,
    isStreaming: isLoading,
    warning,
    sendMessage,
    submit,
    retry,
    stop,
    clear,
  };
}
