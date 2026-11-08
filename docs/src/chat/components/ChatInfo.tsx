import { InformationCircleIcon } from "@heroicons/react/24/outline";
import { useId } from "react";

/** The answers are generated (plan #257 D16; adapted from gmt's `AccuracyNote`, which also names its widgets and tests: this site has neither). */
export function AccuracyNote({ className }: { className?: string }) {
  return (
    <p className={className}>
      AI writes these answers and can be wrong — check the linked docs before
      relying on them.
    </p>
  );
}

/**
 * The info button that opens the note in a popup (plan #309 §4.1 row 20; gmt's `ChatInfo`). On a wide screen the note is
 * shown under the composer and this button is hidden; on a phone the note moves in here, where it costs no height. CSS
 * picks the form (`dox-hive.css`, "Fine print"), so the server-rendered page is already right. Native `popover` gives
 * Escape, outside click and focus return with no script.
 */
export function ChatInfo() {
  const panelId = useId();
  return (
    <>
      <button
        type="button"
        className="gmt-hive-info"
        popoverTarget={panelId}
        aria-label="About Dox's answers"
      >
        <InformationCircleIcon aria-hidden="true" />
      </button>
      <section
        id={panelId}
        popover="auto"
        aria-label="Fine print"
        className="gmt-hive-info-panel"
      >
        <AccuracyNote />
      </section>
    </>
  );
}
