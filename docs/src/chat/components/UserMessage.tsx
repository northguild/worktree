"use client";

import { useId } from "react";
import type { ChatMessage } from "../types";
import { MessageMeta } from "./MessageMeta";

type UserMessageProps = {
  message: ChatMessage;
};

export function UserMessage({ message }: UserMessageProps) {
  const { content, createdAt } = message;
  const titleId = useId();

  return (
    <article
      aria-labelledby={titleId}
      className="mb-4 text-gray-800 dark:text-gray-100"
    >
      <MessageMeta titleId={titleId} title="You" createdAt={createdAt} />
      {/*
        The user's own text is rendered as text, never through MarkdownContent
        the way the assistant's is: someone who types * or # means those
        characters. So the newlines they typed have to survive here, which HTML
        would otherwise collapse — pre-wrap keeps them and still wraps long
        lines, and break-words keeps an unbroken paste (a URL, a path) inside
        the bubble instead of widening it.
      */}
      <div className="bg-gray-100 dark:bg-neutral-800 rounded-lg px-3 py-2 whitespace-pre-wrap break-words">
        {content}
      </div>
    </article>
  );
}
