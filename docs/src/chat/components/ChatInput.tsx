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
 * `letter-spacing: inherit`, so both children are bare boxes in the same
 * inherited type — the chrome lives on the container instead. All that is left
 * to state is the grid cell they share and how a long unbroken word breaks.
 */
const SIZED_BOX = "[grid-area:1/1/2/2] break-words";

/**
 * Growth stops at six rows, then the field scrolls.
 *
 * Counted against the field's own line box rather than in pixels: nothing in
 * the app pins the base type — `globals.css` sets no font-size or line-height —
 * so the field inherits from the Nextra theme, and a pixel literal would
 * silently mean a different number of rows the moment that changes. The cap
 * sits on the sizer because the sizer is what the grid row is sized from;
 * capping it caps the row, and the textarea then scrolls inside it.
 */
const SIX_ROW_CAP = "max-h-[6lh]";

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

    return (
      // The box chrome sits on the wrapper rather than the textarea so that both
      // grid children stay bare, which is what keeps their text metrics
      // identical. That puts the padding outside the textarea's own hit area, so
      // the wrapper is a <label>: clicking anywhere in the visible box focuses
      // the field natively, the way the padded <input> this replaces did. The
      // accessible name still comes from aria-label below — the sizer is
      // aria-hidden and contributes nothing to it.
      <label className={cn("grid cursor-text", className)}>
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
            className="[grid-area:2/1/3/2] text-right text-xs text-gray-500 dark:text-gray-400"
          >
            {formatRemainingLabel(value, maxLength)}
          </span>
        )}
      </label>
    );
  },
);
ChatInput.displayName = "ChatInput";
