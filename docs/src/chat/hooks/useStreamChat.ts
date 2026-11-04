"use client";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useRef } from "react";
import { parseGeminiSseLine } from "../../utils/parseGeminiSseLine";
import { useMessageHistory } from "./useMessageHistory";

const REQUEST_TIMEOUT_MS = 120_000;
const STREAM_IDLE_TIMEOUT_MS = 30_000;

export interface UseStreamChatReturn {
  messages: ReturnType<typeof useMessageHistory>["messages"];
  isStreaming: boolean;
  sendMessage: (text: string) => Promise<void>;
  clearMessages: () => void;
}

interface MutationVars {
  text: string;
  historySnapshot: Array<{ role: string; content: string }>;
  assistantId: string;
}

export function useStreamChat(model: string): UseStreamChatReturn {
  const {
    messages,
    warnMessage,
    failMessage,
    appendDelta,
    addUserAndPlaceholder,
    clearAll,
    finalizeMessage,
  } = useMessageHistory(`docs_chat_history_${model}`);
  const abortRef = useRef<AbortController | null>(null);
  // Stable ref so sendMessage always reads the latest messages without
  // needing to list `history.messages` as a useCallback dependency (which
  // would re-create sendMessage on every streaming delta).
  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  const base =
    import.meta.env.PUBLIC_GEMINI_WORKER_URL || "http://localhost:8787";

  const mutation = useMutation({
    mutationFn: async ({
      text,
      historySnapshot,
      assistantId,
    }: MutationVars) => {
      abortRef.current?.abort();
      const abort = new AbortController();
      abortRef.current = abort;
      let didTimeout = false;
      const requestTimeout = setTimeout(() => {
        didTimeout = true;
        abort.abort();
      }, REQUEST_TIMEOUT_MS);

      const readWithTimeout = async (
        reader: ReadableStreamDefaultReader<Uint8Array>,
      ) => {
        // Idle-timeout debounce: reset the timer with every chunk. If no data
        // arrives within STREAM_IDLE_TIMEOUT_MS the stream is considered stalled.
        // The finally block clears the handle when reader.read() wins the race,
        // so each call leaves exactly zero dangling timers.
        let idleHandle: ReturnType<typeof setTimeout> | undefined;
        const idlePromise = new Promise<never>((_, reject) => {
          idleHandle = setTimeout(() => {
            didTimeout = true;
            reject(new Error("Stream timeout"));
          }, STREAM_IDLE_TIMEOUT_MS);
        });
        try {
          return await Promise.race([reader.read(), idlePromise]);
        } finally {
          clearTimeout(idleHandle);
        }
      };

      let receivedText = false;

      try {
        const res = await fetch(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [...historySnapshot, { role: "user", content: text }],
          }),
          signal: abort.signal,
        });

        if (!res.ok) {
          const errText = await res.text();
          let errMsg = `Error ${res.status}`;
          try {
            const parsed = JSON.parse(errText) as { error?: string };
            if (parsed.error) errMsg = parsed.error;
          } catch {
            // plain-text error body
          }
          warnMessage(assistantId, errMsg);
          return;
        }

        if (!res.body) {
          failMessage(assistantId, "Error: empty response body");
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        outer: while (true) {
          const { done, value } = await readWithTimeout(reader);
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";

          for (const line of lines) {
            const delta = parseGeminiSseLine(line);
            switch (delta.type) {
              case "text":
                receivedText = true;
                appendDelta(assistantId, delta.text);
                break;
              case "error":
                console.error("[chat] SSE error:", delta.message);
                warnMessage(assistantId, delta.message);
                return;
              case "done":
                break outer;
              // "skip": do nothing
            }
          }
        }

        if (!receivedText) {
          console.warn(
            "[chat] stream completed with zero text chunks — check worker URL and model",
          );
        }
      } catch (err) {
        if (didTimeout) {
          warnMessage(
            assistantId,
            "Request timed out while waiting for model output. Please retry or switch model.",
          );
        }

        const isAbortError = (err as { name?: string }).name === "AbortError";

        if (!didTimeout && !isAbortError) {
          failMessage(assistantId, "Connection error");
        }
      } finally {
        clearTimeout(requestTimeout);

        // If the request was aborted before any assistant text arrived,
        // mark the placeholder as a warning instead of leaving an empty message.
        // Do not override a timeout warning (didTimeout handled in catch).
        if (abort.signal.aborted && !didTimeout && !receivedText) {
          warnMessage(assistantId, "Request cancelled");
        } else {
          finalizeMessage(assistantId);
        }
      }
    },
  });

  const { isPending, mutateAsync, reset } = mutation;

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isPending) return;
      const trimmed = text.trim();
      // filter out any failed/warning messages and assistant messages that are still streaming or empty, so the history sent to the worker is clean and doesn't include partial assistant messages or messages that didn't go through. This also ensures the "messages" array in the UI can be more forgiving (e.g. it can keep failed/warning messages, and show the assistant message as it's streaming) without affecting the integrity of the history sent to the model.
      const historySnapshot = messagesRef.current
        .filter((m) => !m.isError && !m.isWarning)
        .filter(
          (m) =>
            !(
              m.role === "assistant" &&
              (m.streaming || m.content.trim() === "")
            ),
        )
        .map((m) => ({ role: m.role, content: m.content }));
      // Optimistically append the user message + assistant placeholder so the
      // loading state appears immediately, even before network round-trip.
      const assistantId = addUserAndPlaceholder(trimmed);
      await mutateAsync({ text: trimmed, historySnapshot, assistantId });
    },
    [addUserAndPlaceholder, mutateAsync, isPending],
  );

  const clearMessages = useCallback(() => {
    abortRef.current?.abort();
    reset();
    clearAll();
  }, [reset, clearAll]);

  return {
    messages: messages,
    isStreaming: isPending,
    sendMessage,
    clearMessages,
  };
}
