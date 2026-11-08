import { fetchServerSentEvents, useChat } from "@tanstack/ai-react";
import { useCallback, useEffect, useState } from "react";
import { classifyChatError } from "../components/ChatWarning";
import type { ChatModelId } from "../lib/chat-constants";
import { chatEndpoint } from "../lib/chat-endpoint";
import { chatFetch } from "../lib/chat-fetch";
import { messageText, removeLegacyHistory } from "../lib/chat-history";
import { checkUserText } from "../lib/chat-sanitize";
import type { ChatWarningState, UIMessage } from "../lib/chat-types";
import { createTranscriptStorage } from "./transcript-storage";
import { useIdleTimeout } from "./useIdleTimeout";

/** One conversation, one thread (plan #257 D11, D12). */
const THREAD_ID = "docs-chat";

const STALLED: ChatWarningState = {
  message:
    "The assistant stopped responding. The answer above may be incomplete — try again.",
  retryable: true,
};

// Both are made once: the connection reads the Worker URL, and the transcript
// storage reads `localStorage` lazily on each call.
const connection = fetchServerSentEvents(
  chatEndpoint(import.meta.env.PUBLIC_GEMINI_WORKER_URL),
  { fetchClient: chatFetch },
);
const persistence = createTranscriptStorage();

export interface DocsChat {
  messages: ReadonlyArray<UIMessage>;
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

  const chat = useChat({
    connection,
    threadId: THREAD_ID,
    persistence,
    forwardedProps: { model },
    onError: (error) => setWarning(classifyChatError(error)),
  });
  const { messages, isLoading, stop } = chat;

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
    await reload();
  }, [reload]);

  const clear = useCallback(() => {
    clearMessages();
    setWarning(null);
  }, [clearMessages]);

  return {
    messages,
    isStreaming: isLoading,
    warning,
    sendMessage,
    submit,
    retry,
    stop,
    clear,
  };
}
