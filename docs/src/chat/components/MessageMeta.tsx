"use client";

import {
  convertUnixToPlainTime,
  convertUnixToUtc,
  formatTime,
} from "@northguild/gmt";

interface MessageMetaProps {
  titleId: string;
  title: string;
  titleClass?: string;
  createdAt: number;
}

export function MessageMeta({
  titleId,
  title,
  titleClass = "font-semibold",
  createdAt, // unix
}: MessageMetaProps) {
  return (
    <div className="flex items-baseline justify-between mb-1">
      <div id={titleId} className={titleClass}>
        {title}
      </div>
      <time
        dateTime={convertUnixToUtc(createdAt)}
        className="text-xs text-chat-muted ml-2"
      >
        {formatTime(convertUnixToPlainTime(createdAt))}
      </time>
    </div>
  );
}
