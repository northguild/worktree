/**
 * The reset clock: when Dox's allowance comes back, in the reader's zone and a format they choose (plan #309 Phase 8, §4.1
 * row 21; ported from gmt's `ResetClock`).
 *
 * ## Why a chip and one popover
 *
 * The composer's control bar already holds the brain badge and Send. Two more dropdowns would crowd it and fall apart at
 * phone width, so the readout is itself the trigger and every choice lives behind it. The chip sits hard left in the bar:
 * its readout changes width with every format and every minute, so anchoring the panel to its left edge, which never
 * moves, keeps the panel from jumping as the reader clicks through formats.
 *
 * ## Why every format is a gmt call
 *
 * This is the one real instant on screen in the chat, which makes it the cheapest possible tour of the library: the
 * reader changes zone and format, sees the output change, and sees the exact call that produced it, linked to that
 * function's reference page (plan §9 Q11 asks whether this site keeps that; it is ported as gmt has it).
 *
 * ## Parts
 *
 * Base UI's `Popover` for the panel and its `Combobox` for the zone search (D4, D13), where gmt has Radix and cmdk. The
 * combobox renders its list inline, inside the panel: the panel already floats at the bottom of the viewport, and a second
 * floating layer for the list would have nowhere safe to go. A menu was ruled out: its typeahead would swallow the
 * keystrokes a zone search needs. The formats are native radios, so the arrow keys move between them and one Tab stop
 * covers the group.
 */
import { Combobox } from "@base-ui/react/combobox";
import { Popover } from "@base-ui/react/popover";
import { useId, useState } from "react";
import { listResets, nextReset } from "../time/quota-resets";
import { findResetFormat, RESET_FORMATS } from "../time/reset-formats";
import type { ResetClockState } from "../time/use-reset-clock";
import type { BrainsInfo } from "./use-brains";

/** A search for "new york" has to find `America/New_York`: the underscore is a space to the reader. */
function zoneMatches(zone: string, query: string): boolean {
  const spaced = (text: string) => text.replaceAll("_", " ").toLowerCase();
  return spaced(zone).includes(spaced(query.trim()));
}

export function ResetClock({
  info,
  clock,
}: {
  info: BrainsInfo | null;
  clock: ResetClockState;
}) {
  const formatName = useId();
  const [query, setQuery] = useState("");

  // Nothing to show before the budget has loaded or the reader's zone is known (see use-reset-clock.ts on hydration).
  if (!info || !clock.ready) return null;

  const reset = nextReset(info);
  if (!reset) return null;

  const preset = findResetFormat(clock.formatId);
  const ctx = { timeZone: clock.zone, locale: clock.locale, now: clock.now };
  const readout = preset.format(reset.resetsAt, ctx);
  if (readout === "") return null;

  return (
    <Popover.Root>
      <Popover.Trigger
        className="gmt-hive-clock"
        aria-label={`${reset.label} reset ${readout}. Change the zone or format.`}
      >
        <span className="gmt-hive-clock-glyph" aria-hidden="true">
          ↻
        </span>
        <span className="gmt-hive-clock-readout">{readout}</span>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Positioner
          side="top"
          align="start"
          sideOffset={6}
          className="gmt-hive-clock-positioner"
        >
          <Popover.Popup
            className="gmt-hive-clock-panel"
            aria-label="Quota resets"
          >
            <section className="gmt-hive-clock-section">
              <h3 className="gmt-hive-clock-heading">Resets</h3>
              <dl className="gmt-hive-clock-resets">
                {listResets(info).map((row) => (
                  <div
                    key={row.id}
                    className="gmt-hive-clock-reset"
                    data-current={row.id === reset.id ? "" : undefined}
                  >
                    <dt>{row.label}</dt>
                    <dd>{preset.format(row.resetsAt, ctx)}</dd>
                  </div>
                ))}
              </dl>
            </section>

            <fieldset className="gmt-hive-clock-section gmt-hive-clock-formats">
              <legend className="gmt-hive-clock-heading">Format</legend>
              {RESET_FORMATS.map((option) => (
                <label
                  key={option.id}
                  className="gmt-hive-clock-format"
                  data-checked={option.id === preset.id ? "" : undefined}
                >
                  <input
                    type="radio"
                    name={formatName}
                    value={option.id}
                    checked={option.id === preset.id}
                    onChange={() => clock.setFormatId(option.id)}
                  />
                  <span className="gmt-hive-clock-format-label">
                    {option.label}
                  </span>
                  <code className="gmt-hive-clock-format-fn">
                    {option.fnName}
                  </code>
                </label>
              ))}
            </fieldset>

            <section className="gmt-hive-clock-section">
              <h3 className="gmt-hive-clock-heading">
                Zone <span className="gmt-hive-clock-zone">{clock.zone}</span>
              </h3>
              <Combobox.Root
                inline
                open
                items={clock.zones as string[]}
                value={clock.zone}
                onValueChange={(zone) => {
                  if (typeof zone === "string") clock.setZone(zone);
                }}
                inputValue={query}
                onInputValueChange={(next, { reason }) =>
                  setQuery(reason === "item-press" ? "" : next)
                }
                filter={(zone, text) => zoneMatches(zone, text)}
                disabled={!preset.zoned}
              >
                <div className="gmt-hive-clock-zones">
                  <div className="gmt-hive-clock-zone-field">
                    <svg
                      className="gmt-hive-clock-zone-glyph"
                      viewBox="0 0 16 16"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <circle cx="7" cy="7" r="4.5" />
                      <path d="m10.5 10.5 3.5 3.5" />
                    </svg>
                    <Combobox.Input
                      className="gmt-hive-clock-zone-search"
                      aria-label="Time zone"
                      placeholder={
                        preset.zoned ? "Search zones…" : "Same in every zone"
                      }
                    />
                  </div>
                  {/* Rendered whatever the format, so the input's `aria-controls` names a list that exists; hidden, and empty, when the format ignores the zone. */}
                  <div
                    className="gmt-hive-clock-zone-results"
                    hidden={!preset.zoned}
                  >
                    <Combobox.Empty className="gmt-hive-clock-zone-empty">
                      No zone matches.
                    </Combobox.Empty>
                    <Combobox.List className="gmt-hive-clock-zone-list">
                      {(zone: string) => (
                        <Combobox.Item
                          key={zone}
                          value={zone}
                          className="gmt-hive-clock-zone-option"
                          data-current={zone === clock.zone ? "" : undefined}
                        >
                          {zone}
                        </Combobox.Item>
                      )}
                    </Combobox.List>
                  </div>
                </div>
              </Combobox.Root>
            </section>

            {/* A new tab on purpose: navigating this one would throw away the conversation. */}
            <a
              className="gmt-hive-clock-call"
              href={preset.referenceUrl}
              target="_blank"
              rel="noopener"
            >
              <code>{preset.call(ctx)}</code>
              <span aria-hidden="true"> ↗</span>
              <span className="sr-only">
                {" "}
                (opens the reference in a new tab)
              </span>
            </a>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
