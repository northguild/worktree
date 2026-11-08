/**
 * The panel beside the transcript, or under it as a sheet on a phone (plan #309 Phase 3, §4.1 row 25; gmt's `WidgetRail`
 * with no widget to hold, D7). Its id is what the bar's and the resizer's `aria-controls` point at. `data-collapsed` is
 * the reader's choice on a phone, and `dox-hive.css` decides whether it hides anything: only once a conversation has started
 * (or on a short phone), so the server's markup is already right and nothing snaps shut on load.
 */
import type { ChatStarter } from "../lib/chat-starters";
import { ExamplesPanel } from "./ExamplesPanel";

interface ExamplesRailProps {
  railId: string;
  /** Phone only: the sheet is folded away until the bar opens it. */
  collapsed: boolean;
  onPick: (starter: ChatStarter) => void;
}

export function ExamplesRail({ railId, collapsed, onPick }: ExamplesRailProps) {
  return (
    <aside
      className="gmt-hive-rail"
      id={railId}
      aria-label="Examples"
      data-collapsed={collapsed ? "" : undefined}
    >
      <ExamplesPanel onPick={onPick} />
    </aside>
  );
}
