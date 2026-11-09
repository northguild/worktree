/**
 * Dox's brain: which model is answering, what is left today, and a way to change it (plan #309 Phase 8, §4.1 row 22; ported
 * from gmt's `BrainSelector`).
 *
 * ## Why this is on the page at all
 *
 * The free tiers behind Dox are small and shared by every visitor: a few dozen requests a day per model, and one Neuron pool
 * for every Workers AI model. That is a strange enough constraint that hiding it is worse than showing it. Without the
 * badge Dox stops answering part way through a day for reasons the reader cannot see; with it the limit is legible and the
 * reader can switch to a brain that still has budget. The reader's own allowance comes first because it is the number they
 * can act on; the shared pool follows because it explains a refusal their own number would not.
 *
 * ## Where it lives
 *
 * In the composer's control bar, beside Send, opening upward. The brains are grouped by provider because the providers
 * refill on different clocks (Gemini at midnight Pacific, Workers AI at 00:00 UTC) and each heading says when, in the
 * reader's own zone.
 *
 * ## The menu
 *
 * Base UI's `Menu` radio group (D4), where gmt has a Radix dropdown: a menu of `menuitemradio`s is the honest role for "pick
 * one of these", and the part gives roving focus, typeahead, Escape, outside click and focus return to the badge.
 */
import { Menu } from "@base-ui/react/menu";
import { findResetFormat } from "../time/reset-formats";
import type { ResetClockState } from "../time/use-reset-clock";
import type { BrainsInfo } from "./use-brains";

/** The radio group addresses items by string value and "no explicit pick" has to be one of them; no brain id is this. */
const AUTOMATIC = "automatic";

/** Group headings are human wording whatever format the reader picked for the reset clock: "resets 1781593200000" is a fine demo and a poor label. */
const HEADING_FORMAT = findResetFormat("calendar");

/** What a brain's row says beside its name. */
function brainMeta(brain: BrainsInfo["brains"][number]): string {
  if (brain.state === "unavailable") return "not available";
  if (brain.state === "spent") return "spent today";
  return `${brain.remaining} left`;
}

export function BrainSelector({
  info,
  selectedId,
  onSelect,
  clock,
}: {
  info: BrainsInfo | null;
  /** The reader's explicit pick, or null for "whichever has budget". */
  selectedId: string | null;
  onSelect: (brainId: string | null) => void;
  /** The reader's zone and locale, for each provider's reset. */
  clock: ResetClockState;
}) {
  // No data (the endpoint is missing, the Worker is restarting, offline): no badge. The chat stays fully usable; this is
  // information and a way to choose, not a gate.
  if (!info) return null;

  const active =
    info.brains.find(
      (brain) => brain.id === (selectedId ?? info.activeBrainId),
    ) ?? info.brains[0];
  const poolLeft = info.brains.reduce(
    (total, brain) => total + brain.remaining,
    0,
  );

  return (
    <div className="gmt-hive-brains">
      <Menu.Root>
        <Menu.Trigger className="gmt-hive-brain-badge">
          <span className="gmt-hive-brain-name">{active?.label ?? "Dox"}</span>
          <span className="gmt-hive-brain-counts">
            You {info.visitor.remaining} left
            <span aria-hidden="true"> · </span>
            Dox {poolLeft} today
          </span>
        </Menu.Trigger>

        <Menu.Portal>
          {/* Upward: the badge sits at the bottom of the viewport. The part keeps the popup inside the space it measures. */}
          <Menu.Positioner
            side="top"
            align="start"
            sideOffset={6}
            className="gmt-hive-brain-positioner"
          >
            <Menu.Popup className="gmt-hive-brain-list">
              <Menu.RadioGroup
                value={selectedId ?? AUTOMATIC}
                onValueChange={(value) =>
                  onSelect(value === AUTOMATIC ? null : String(value))
                }
              >
                <Menu.RadioItem
                  value={AUTOMATIC}
                  label="Automatic"
                  closeOnClick
                  className="gmt-hive-brain-option"
                >
                  <Menu.RadioItemIndicator className="gmt-hive-brain-check" />
                  <span className="gmt-hive-brain-label">Automatic</span>
                  <span className="gmt-hive-brain-meta">
                    whichever has budget
                  </span>
                </Menu.RadioItem>

                {info.providers.map((provider) => {
                  const brains = info.brains.filter(
                    (brain) => brain.provider === provider.id,
                  );
                  if (brains.length === 0) return null;

                  // Empty until the reader's zone is known: see use-reset-clock.
                  const resets = clock.ready
                    ? HEADING_FORMAT.format(provider.resetsAt, {
                        timeZone: clock.zone,
                        locale: clock.locale,
                        now: clock.now,
                      })
                    : "";

                  return (
                    <Menu.Group key={provider.id}>
                      <Menu.Separator className="gmt-hive-brain-separator" />
                      <Menu.GroupLabel className="gmt-hive-brain-group">
                        <span className="gmt-hive-brain-group-name">
                          {provider.label}
                        </span>
                        {resets && (
                          <span className="gmt-hive-brain-group-reset">
                            resets {resets}
                          </span>
                        )}
                      </Menu.GroupLabel>
                      {brains.map((brain) => (
                        <Menu.RadioItem
                          key={brain.id}
                          value={brain.id}
                          label={brain.label}
                          closeOnClick
                          data-brain-state={brain.state}
                          className="gmt-hive-brain-option"
                        >
                          <Menu.RadioItemIndicator className="gmt-hive-brain-check" />
                          <span className="gmt-hive-brain-label">
                            {brain.label}
                          </span>
                          <span className="gmt-hive-brain-meta">
                            {brainMeta(brain)}
                          </span>
                        </Menu.RadioItem>
                      ))}
                    </Menu.Group>
                  );
                })}
              </Menu.RadioGroup>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
}
