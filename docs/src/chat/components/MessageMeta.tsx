"use client";

import {
  convertUnixToPlainTime,
  convertUnixToUtc,
  formatTime,
} from "@northguild/gmt";
import { createdAtMs } from "../lib/chat-history";

interface MessageMetaProps {
  titleId: string;
  title: string;
  titleClass?: string;
  /** A `Date`, a number of milliseconds or an ISO string: whatever the transcript holds. None shows no time. */
  createdAt?: unknown;
}

export function MessageMeta({
  titleId,
  title,
  titleClass = "font-semibold",
  createdAt,
}: MessageMetaProps) {
  const ms = createdAtMs(createdAt);
  return (
    <div className="flex items-baseline justify-between mb-1">
      <div id={titleId} className={titleClass}>
        {title}
      </div>
      {ms !== undefined && (
        <time
          dateTime={convertUnixToUtc(ms)}
          className="text-xs text-chat-muted ml-2"
        >
          {formatTime(convertUnixToPlainTime(ms))}
        </time>
      )}
    </div>
  );
}
