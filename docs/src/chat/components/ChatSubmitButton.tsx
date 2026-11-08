import { Button } from "@base-ui/react";
import { RocketLaunchIcon, StopIcon } from "@heroicons/react/24/outline";
import type { Ref } from "react";
import { cn } from "../../utils";

interface ChatSubmitButtonProps {
  ref?: Ref<HTMLButtonElement>;
  /** An answer is on its way: the button stops it instead of sending. */
  answering: boolean;
  /** Nothing to send yet (blank or only whitespace). */
  empty: boolean;
  onStop: () => void;
}

/**
 * Send while idle, Stop while an answer is arriving (plan #257 D15). It is one
 * element in both states, so focus on it survives the swap: after "Try again"
 * (ChatPanel moves focus here) the keyboard user can stop without finding it.
 * An accepted send returns focus to the message field (ChatForm), not here.
 */
export function ChatSubmitButton({
  ref,
  answering,
  empty,
  onStop,
}: ChatSubmitButtonProps) {
  return (
    <Button
      ref={ref}
      type={answering ? "button" : "submit"}
      aria-label={answering ? "Stop answer" : "Send message"}
      onClick={answering ? onStop : undefined}
      disabled={!answering && empty}
      // aria-disabled rather than the native attribute, so a Stop that gives
      // way to a Send with nothing to send keeps the keyboard user's focus.
      focusableWhenDisabled
      className={cn(
        "bg-chat-accent text-chat-on-accent hover:brightness-110 rounded-lg transition-colors",
        "disabled:opacity-80 disabled:cursor-not-allowed aria-disabled:opacity-80 aria-disabled:cursor-not-allowed",
        // The transparent border is load-bearing: it is the second half of the
        // arithmetic below, matching the 1px the field spends on its own.
        "p-2 ml-2 border border-transparent",
      )}
    >
      {/*
        The button stands exactly as tall as the collapsed field, and does so by
        construction rather than by a matching pixel value. Both boxes are now
        one line box plus `py-2` plus a 1px border, so they agree at whatever
        type scale the Nextra theme hands down — the same reason D5 counts the
        growth cap in `lh` rather than pixels. The icon keeps its own 20px and
        is centred in that line box; sizing the icon to `1lh` instead would tie
        the glyph to the text scale, which is not what is being matched here.
      */}
      <span className="flex h-[1lh] items-center">
        {answering ? (
          <StopIcon className="w-5 h-5" aria-hidden="true" />
        ) : (
          <RocketLaunchIcon className="w-5 h-5" aria-hidden="true" />
        )}
      </span>
    </Button>
  );
}
