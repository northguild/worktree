import { forwardRef } from "react";
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

interface ChatInputProps {
  /** Accessible name for the field. The placeholder is not a substitute. */
  label: string;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

export const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(
  function ChatInput(
    { label, placeholder, className, disabled, onKeyDown },
    ref,
  ) {
    const field = useField();
    const value = String(field.state.value ?? "");

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
      </label>
    );
  },
);
ChatInput.displayName = "ChatInput";
