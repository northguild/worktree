import { Button } from "@base-ui/react";
import {
  CubeTransparentIcon,
  RocketLaunchIcon,
} from "@heroicons/react/24/outline";
import { cn } from "../../utils";
import { useFormStore } from "../form/FormContext";

interface ChatSubmitButtonProps {
  disabled?: boolean;
}

export function ChatSubmitButton({ disabled }: ChatSubmitButtonProps) {
  const value = useFormStore((s) => s.values?.message);
  const isSubmitting = useFormStore((s) => s.isSubmitting);

  return (
    <Button
      type="submit"
      disabled={!!(disabled || isSubmitting || !String(value ?? "").trim())}
      className={cn(
        "bg-blue-600 hover:bg-blue-500 dark:bg-blue-500 dark:hover:bg-blue-400 text-white rounded-lg transition-colors",
        "disabled:opacity-80 disabled:cursor-not-allowed",
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
        {isSubmitting ? (
          <CubeTransparentIcon className="w-5 h-5 animate-spin" />
        ) : (
          <RocketLaunchIcon className="w-5 h-5" />
        )}
      </span>
    </Button>
  );
}
