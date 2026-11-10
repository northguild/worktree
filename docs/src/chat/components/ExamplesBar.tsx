/**
 * The phone's way back to the examples once a conversation has started: a bar above the composer that toggles the sheet
 * (plan #309 §4.1 row 24; ported from gmt's `ExamplesBar`). Hidden by CSS everywhere else (`dox-hive.css`), so on a wide
 * screen it is neither seen nor tabbed to.
 */
import { ChevronUpIcon } from "@heroicons/react/24/outline";
import type { Ref } from "react";
import { CHAT_STARTERS } from "../lib/chat-starters";

interface ExamplesBarProps {
  expanded: boolean;
  /** The rail's id, for `aria-controls`. */
  railId: string;
  onToggle: () => void;
  ref?: Ref<HTMLButtonElement>;
}

export function ExamplesBar({
  expanded,
  railId,
  onToggle,
  ref,
}: ExamplesBarProps) {
  return (
    <button
      ref={ref}
      type="button"
      className="gmt-hive-examples-bar"
      aria-expanded={expanded}
      aria-controls={railId}
      onClick={onToggle}
    >
      {/* The literal spaces keep the accessible name "Examples 3": inline spans otherwise run together, and a flex
          container ignores them. */}
      <span>Examples</span> <span aria-hidden="true">·</span>{" "}
      <span>{CHAT_STARTERS.length}</span>
      <ChevronUpIcon
        className="gmt-hive-examples-bar-chevron"
        aria-hidden="true"
      />
    </button>
  );
}
