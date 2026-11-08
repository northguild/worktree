"use client";

import { useId } from "react";
import { LoadingDots } from "./LoadingDots";
import { MarkdownContent } from "./MarkdownContent";
import { MessageMeta } from "./MessageMeta";

const BUBBLE_BASE =
  "rounded-lg px-3 py-2 transition-[background-color,color,border-color] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]";
const DEFAULT_CLASS = "bg-chat-fill text-chat-fg";

interface AssistantMessageProps {
  /** The reply's text so far. Only text parts are shown (plan #257 D13). */
  text: string;
  createdAt?: unknown;
  /** True while this reply is still arriving. */
  streaming: boolean;
}

export function AssistantMessage({
  text,
  createdAt,
  streaming,
}: AssistantMessageProps) {
  const titleId = useId();

  return (
    <article aria-labelledby={titleId} className="mb-4">
      <MessageMeta
        titleId={titleId}
        title="Dox"
        titleClass="font-semibold text-chat-accent-ink"
        createdAt={createdAt}
      />
      <div
        className={`${BUBBLE_BASE} ${DEFAULT_CLASS}`}
        aria-live="polite"
        aria-atomic="false"
      >
        {streaming && !text ? (
          <div className="flex items-center gap-2 text-sm italic">
            <LoadingDots className="text-current h-6" size={12} />
            <span className="sr-only">Dox is typing</span>
          </div>
        ) : (
          <MarkdownContent content={text} />
        )}
      </div>
    </article>
  );
}
