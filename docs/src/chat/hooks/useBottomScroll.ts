import { type RefObject, useLayoutEffect } from "react";

/** The last thing in the transcript, as far as scrolling cares. */
export interface ScrollTarget {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** True while this is the answer being written, or the wait for it. */
  streaming: boolean;
}

interface UseBottomScrollProps {
  containerRef: RefObject<HTMLElement | null>;
  endRef: RefObject<HTMLElement | null>;
  lastSnapshotRef: RefObject<string | undefined>;
  last?: ScrollTarget;
}

export function useBottomScroll({
  containerRef,
  endRef,
  lastSnapshotRef,
  last,
}: UseBottomScrollProps) {
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const snapshot = last
      ? `${last.id}:${last.text.length}:${String(last.streaming)}`
      : "empty";

    if (lastSnapshotRef.current === snapshot) return;
    lastSnapshotRef.current = snapshot;

    const threshold = 120;
    const isAtBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < threshold;

    // The wait for an answer just appeared (streaming, no text yet) — always
    // scroll so the user sees the loading dots immediately after submitting.
    if (last?.streaming && !last.text) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      return;
    }

    // Finished assistant reply — jump to it unconditionally.
    if (last?.role === "assistant" && !last.streaming) {
      endRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
      return;
    }

    if (isAtBottom) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  });
}
