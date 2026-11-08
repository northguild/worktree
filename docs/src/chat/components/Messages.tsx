"use client";

import { useRef } from "react";
import { type ScrollTarget, useBottomScroll } from "../hooks/useBottomScroll";
import { messageText } from "../lib/chat-history";
import type { UIMessage } from "../lib/chat-types";
import { AssistantMessage } from "./AssistantMessage";
import { ChatStarters } from "./ChatStarters";
import { UserMessage } from "./UserMessage";

interface MessagesProps {
  messages: ReadonlyArray<UIMessage>;
  /** True from the moment a question is sent until its answer ends. */
  isStreaming: boolean;
  /** Sends a starter question; without it the empty transcript offers none. */
  onStarter?: (text: string) => void;
}

export function Messages({ messages, isStreaming, onStarter }: MessagesProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const lastSnapshotRef = useRef<string | undefined>(undefined);

  // Only questions and answers with text are shown, with one exception: while
  // an answer is arriving, the library's empty trailing assistant message stays
  // and renders the typing state. Its polite live region then exists, under the
  // same key, before the first text lands (a region announces changes, not what
  // it holds when inserted; plan #257 D18). Behind a failed answer the empty
  // message is hidden: the reader sees the warning, never an empty bubble.
  const lastMessage = messages.at(-1);
  const shown = messages.filter(
    (message) =>
      (message.role === "user" || message.role === "assistant") &&
      (message.role === "user" ||
        messageText(message).trim() !== "" ||
        (isStreaming && message === lastMessage)),
  );
  const last = shown.at(-1);
  const waitingForText = isStreaming && last?.role !== "assistant";

  const scrollTarget: ScrollTarget | undefined = waitingForText
    ? { id: "typing", role: "assistant", text: "", streaming: true }
    : last && (last.role === "user" || last.role === "assistant")
      ? {
          id: last.id,
          role: last.role,
          text: messageText(last),
          streaming: isStreaming,
        }
      : undefined;

  useBottomScroll({
    containerRef,
    endRef,
    lastSnapshotRef,
    last: scrollTarget,
  });

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto p-4 scroll-smooth"
      style={{ WebkitOverflowScrolling: "touch" }}
    >
      {shown.length === 0 && !isStreaming && onStarter && (
        <ChatStarters onPick={onStarter} />
      )}
      {shown.map((message) =>
        message.role === "assistant" ? (
          <AssistantMessage
            key={message.id}
            text={messageText(message)}
            createdAt={message.createdAt}
            streaming={isStreaming && message === last}
          />
        ) : (
          <UserMessage key={message.id} message={message} />
        ),
      )}
      {waitingForText && <AssistantMessage text="" streaming />}
      <div ref={endRef} />
    </div>
  );
}
