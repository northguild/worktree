import { type RefObject, useEffect, useLayoutEffect, useState } from "react";

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

/** How far from the end still counts as at the end, in pixels: a line or two of the last turn. */
const AT_BOTTOM_THRESHOLD = 120;

function distanceFromBottom(el: HTMLElement): number {
  return el.scrollHeight - el.scrollTop - el.clientHeight;
}

/**
 * Keeps the transcript at its end while the reader is there, and reports whether they are, so a jump-to-latest control
 * can show only once they have scrolled up (plan #309 §4.1 row 17).
 */
export function useBottomScroll({
  containerRef,
  endRef,
  lastSnapshotRef,
  last,
}: UseBottomScrollProps) {
  const [isAtBottom, setIsAtBottom] = useState(true);

  // Scrolling is the one thing that moves the reader off the end without the transcript changing.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () =>
      setIsAtBottom(distanceFromBottom(el) < AT_BOTTOM_THRESHOLD);
    el.addEventListener("scroll", update, { passive: true });
    return () => el.removeEventListener("scroll", update);
  }, [containerRef]);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const snapshot = last
      ? `${last.id}:${last.text.length}:${String(last.streaming)}`
      : "empty";

    if (lastSnapshotRef.current === snapshot) return;
    lastSnapshotRef.current = snapshot;

    const atBottom = distanceFromBottom(el) < AT_BOTTOM_THRESHOLD;

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

    if (atBottom) {
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  });

  /** Back to the newest turn. Instant under reduced motion, as the library's smooth scroll is not the reader's choice there. */
  function scrollToBottom() {
    const reduced =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    endRef.current?.scrollIntoView({
      behavior: reduced ? "auto" : "smooth",
      block: "end",
    });
  }

  return { isAtBottom, scrollToBottom };
}
