import { forwardRef, useId } from "react";
import { cn } from "../../utils";
import { useField } from "../form/FieldContext";

/**
 * Styles shared by the textarea and its invisible sizer.
 *
 * The field grows by stacking both in a single CSS grid cell: the sizer holds
 * the same text, so the cell grows to whatever that text needs and the textarea
 * stretches to fill it. Growth is therefore pure layout — nothing is measured
 * and nothing runs on a keystroke.
 *
 * That only stays correct while the two wrap text identically, which is what
 * this constant is for. Tailwind's preflight already zeroes padding and border
 * on every element and gives the textarea `font: inherit` and
 * `letter-spacing: inherit`, so both children start as bare boxes in the same
 * inherited type; what this adds is the grid cell they share, how a long
 * unbroken word breaks, and the field's own padding.
 *
 * **The padding is here rather than on the wrapper, and that is the whole
 * point of it.** A scrollbar is laid out inside its element's border box, so
 * padding on the wrapper pushed the textarea's scrollbar 16px in from the
 * field's right edge and 8px from its top and bottom, leaving it floating in
 * the middle of the box. Padding on the textarea instead puts its border box
 * against the field's border, where the scrollbar belongs, and the padding
 * then does what padding is for: it separates the text from the scrollbar.
 * The sizer carries the identical padding because it is what the row is sized
 * from — give it any less and the cell is short by that much.
 */
const SIZED_BOX = "[grid-area:1/1/2/2] break-words px-4 py-2";

/**
 * Growth stops at six rows, then the field scrolls.
 *
 * Counted against the field's own line box rather than in pixels: nothing in
 * the app pins the base type — `globals.css` sets no font-size or line-height —
 * so the field inherits from the Nextra theme, and a pixel literal would
 * silently mean a different number of rows the moment that changes. The cap
 * sits on the sizer because the sizer is what the grid row is sized from;
 * capping it caps the row, and the textarea then scrolls inside it.
 *
 * The `+1rem` is the sizer's own `py-2`, which `box-sizing: border-box` counts
 * inside a `max-height`. Six rows of *text* is what is wanted, so the padding
 * has to be added back or the cap would cut it to five and a third.
 */
const SIX_ROW_CAP = "max-h-[calc(6lh+1rem)]";

/**
 * The remaining-characters count appears only inside the last tenth of the cap.
 *
 * Below that it is noise — the cap is twenty thousand characters and a question
 * asked of a docs chatbot is rarely a hundred, so a count that is always on is a
 * number that never means anything. Inside it, it is the only thing that makes
 * `maxLength` visible: the attribute stops a long paste silently, with nothing
 * on screen to say a paste was truncated at all.
 */
const COUNT_VISIBLE_FRACTION = 0.1;

/**
 * What the count reads, or the empty string while it is not due yet.
 *
 * Grouped in `en-US` rather than the reader's locale so it matches the Worker's
 * own rejection text ("max 20,000 chars"), which is a fixed English string —
 * the two are the same number said twice and should look it.
 */
function formatRemainingLabel(value: string, maxLength: number): string {
  const remaining = maxLength - value.length;
  if (remaining > maxLength * COUNT_VISIBLE_FRACTION) return "";
  const plural = remaining === 1 ? "character" : "characters";
  return `${remaining.toLocaleString("en-US")} ${plural} left`;
}

interface ChatInputProps {
  /** Accessible name for the field. The placeholder is not a substitute. */
  label: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /**
   * Hard cap on the value's length, which also drives the remaining-characters
   * count. Owned by the form rather than the field, for the reason `ChatForm`'s
   * key handler is: how long a message may be is the form's policy.
   */
  maxLength?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

export const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
  function ChatInput(
    { label, placeholder, className, disabled, maxLength, onKeyDown },
    ref,
  ) {
    const field = useField();
    const value = String(field.state.value ?? "");
    const countId = useId();
    const countLabel =
      maxLength === undefined ? "" : formatRemainingLabel(value, maxLength);

    return (
      // The box chrome sits on the wrapper rather than the textarea so that both
      // grid children stay bare, which is what keeps their text metrics
      // identical. That puts the padding outside the textarea's own hit area, so
      // the wrapper is a <label>: clicking anywhere in the visible box focuses
      // the field natively, the way the padded <input> this replaces did. The
      // accessible name still comes from aria-label below — the sizer is
      // aria-hidden and contributes nothing to it.
      // `overflow-hidden` is what keeps the scrollbar inside the field's
      // rounded corners, and it has to be here rather than on the textarea:
      // **Chrome does not apply an element's own border-radius to a native
      // scrollbar.** Rounding the textarea looks like it works right up until
      // you check it against a real scrollbar rather than a `::-webkit-`
      // styled one — a styled scrollbar is a custom one and *is* clipped by
      // radius, which is precisely the difference that hides the bug. The
      // clip has to come from the rounded ancestor, so it comes from here.
      <label className={cn("grid cursor-text overflow-hidden", className)}>
        <span
          aria-hidden="true"
          className={cn(
            SIZED_BOX,
            SIX_ROW_CAP,
            "invisible overflow-hidden whitespace-pre-wrap",
          )}
        >
          {/* The trailing space holds the cell open for the row a caret sits on
              after a trailing newline, which the text alone does not occupy. */}
          {`${value} `}
        </span>
        <textarea
          ref={ref}
          rows={1}
          name={field.name}
          aria-label={label}
          aria-describedby={maxLength === undefined ? undefined : countId}
          maxLength={maxLength}
          value={value}
          onBlur={field.handleBlur}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
            field.handleChange(e.target.value)
          }
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            SIZED_BOX,
            "resize-none overflow-y-auto bg-transparent focus:outline-none",
          )}
        />
        {maxLength === undefined ? null : (
          // A second grid row, under the stacked cell the field occupies, so
          // the count sits inside the same box chrome the wrapper draws.
          //
          // Mounted whenever there is a cap, with only its text conditional. A
          // live region that arrives in the DOM at the same moment as its first
          // content is the standard way to get no announcement at all — and the
          // moment this count appears is the announcement worth having. Empty,
          // it has no line box and the row is zero-height.
          <span
            id={countId}
            role="status"
            className="[grid-area:2/1/3/2] px-4 text-right text-xs text-gray-500 dark:text-gray-400"
          >
            {/* The bottom padding rides the text rather than the region, so an
                empty region is still a zero-height row: horizontal padding
                adds no height, but `pb-2` on the region itself would leave 8px
                of it under a field that has nothing to count. */}
            {countLabel === "" ? null : (
              <span className="block pb-2">{countLabel}</span>
            )}
          </span>
        )}
      </label>
    );
  },
);
ChatInput.displayName = "ChatInput";
