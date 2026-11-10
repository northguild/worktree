/**
 * The examples: the starter questions, grouped by area (plan #309 Phase 3, §4.1 row 25; ported from gmt's `ExamplesPanel`).
 *
 * A card is a native `<button>`: its accessible name is exactly the question (`aria-labelledby`), and the chip naming the
 * docs page that answers it is the description (D7: gmt's chip names the widget it opens; this site has none). Activating
 * one is the host's `onPick`, which sends the question.
 */
import {
  ArchiveBoxIcon,
  KeyIcon,
  TicketIcon,
} from "@heroicons/react/24/outline";
import { type ComponentType, useId } from "react";
import {
  CHAT_STARTERS,
  type ChatStarter,
  startersByArea,
} from "../lib/chat-starters";

type Icon = ComponentType<{ className?: string; "aria-hidden"?: "true" }>;

/** One glyph per area, from the icon set the rest of the chat uses. An area with none shows its name alone. */
const AREA_ICONS: Record<string, Icon> = {
  Issues: TicketIcon,
  "Environment files": KeyIcon,
  Cleanup: ArchiveBoxIcon,
};

interface ExamplesPanelProps {
  onPick: (starter: ChatStarter) => void;
}

export function ExamplesPanel({ onPick }: ExamplesPanelProps) {
  const uid = useId();

  return (
    <div className="gmt-hive-examples">
      <div className="gmt-hive-examples-header">
        <h2>Examples</h2>
        <span className="gmt-hive-examples-count">{CHAT_STARTERS.length}</span>
      </div>
      <div className="gmt-hive-examples-body">
        {startersByArea().map((group, index) => {
          // By position: an area's name has spaces, and an id with one is two ids to `aria-labelledby`.
          const groupId = `${uid}-area-${index}`;
          const AreaIcon = AREA_ICONS[group.area];
          return (
            <section
              key={group.area}
              className="gmt-hive-examples-area"
              aria-labelledby={groupId}
            >
              <h3 className="gmt-hive-examples-area-title" id={groupId}>
                {AreaIcon && (
                  <AreaIcon
                    className="gmt-hive-examples-area-icon"
                    aria-hidden="true"
                  />
                )}
                {group.area}
              </h3>
              <ul className="gmt-hive-examples-list">
                {group.starters.map((starter) => {
                  const questionId = `${uid}-q-${starter.route}`;
                  const chipId = `${uid}-p-${starter.route}`;
                  return (
                    <li key={starter.route}>
                      <button
                        type="button"
                        className="gmt-hive-example"
                        aria-labelledby={questionId}
                        aria-describedby={chipId}
                        onClick={() => onPick(starter)}
                      >
                        <span className="gmt-hive-example-text" id={questionId}>
                          {starter.text}
                        </span>
                        <span className="gmt-hive-example-chip" id={chipId}>
                          {starter.route}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
