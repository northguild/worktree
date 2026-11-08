"use client";

import { useId } from "react";
import { messageText } from "../lib/chat-history";
import type { UIMessage } from "../lib/chat-types";
import { MessageMeta } from "./MessageMeta";

interface UserMessageProps {
  message: UIMessage;
}

export function UserMessage({ message }: UserMessageProps) {
  const titleId = useId();

  return (
    <article aria-labelledby={titleId} className="mb-4 text-chat-fg">
      <MessageMeta
        titleId={titleId}
        title="You"
        createdAt={message.createdAt}
      />
      {/*
        The user's own text is rendered as text, never through MarkdownContent
        the way the assistant's is: someone who types * or # means those
        characters. So the newlines they typed have to survive here, which HTML
        would otherwise collapse — pre-wrap keeps them and still wraps long
        lines, and break-words keeps an unbroken paste (a URL, a path) inside
        the bubble instead of widening it.
      */}
      <div className="bg-chat-raised rounded-lg px-3 py-2 whitespace-pre-wrap break-words">
        {messageText(message)}
      </div>
    </article>
  );
}
