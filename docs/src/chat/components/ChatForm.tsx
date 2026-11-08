"use client";

import { type RefObject, useEffect, useRef, useState } from "react";
import { MAX_MESSAGE_LENGTH } from "../lib/chat-constants";
import { ChatInput } from "./ChatInput";
import { ChatSubmitButton } from "./ChatSubmitButton";

interface ChatFormProps {
  /**
   * Sends the text, answering whether it was accepted. A refused message stays
   * in the box and the reason is shown as a warning by whoever refused it.
   */
  onSubmit: (message: string) => boolean;
  /** An answer is on its way: Enter sends nothing and the button stops it. */
  answering: boolean;
  onStop: () => void;
  /** For the panel to put focus back on the composer (see `ChatPanel`). */
  submitRef?: RefObject<HTMLButtonElement | null>;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}

export function ChatForm({
  onSubmit,
  answering,
  onStop,
  submitRef,
  inputRef: inputRefProp,
}: ChatFormProps) {
  const ownInputRef = useRef<HTMLTextAreaElement>(null);
  const inputRef = inputRefProp ?? ownInputRef;
  const [value, setValue] = useState("");
  const empty = value.trim() === "";

  function submit() {
    if (answering || empty) return;
    if (onSubmit(value)) {
      setValue("");
      inputRef.current?.focus();
    }
  }

  useEffect(() => {
    const t = setTimeout(() => {
      inputRef.current?.focus();
    }, 180);
    return () => clearTimeout(t);
  }, [inputRef]);

  // What Enter means belongs to the form, not to the field: the field only
  // reports its value, and deciding the submit key inside it would put that
  // decision where the form can no longer change it.
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey) return;
    // While an IME composition is active, Enter confirms a candidate rather
    // than ending the message. Sending here would cut a CJK user off mid-word,
    // and it is invisible to anyone testing in a Latin script.
    if (e.nativeEvent.isComposing) return;
    e.preventDefault();
    submit();
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="p-4 border-t border-chat-border"
    >
      <div className="flex gap-1 items-end">
        <ChatInput
          ref={inputRef}
          value={value}
          onChange={setValue}
          label="Message"
          // Deliberately short. Naming the Shift+Enter convention here made
          // the string 328px wide against a field that has about 286px in
          // the 400px drawer, so it wrapped to a second line the collapsed
          // one-row field could not show: the sentence was clipped after
          // "for a" and the overflow put a scrollbar in an empty field.
          // The convention is the near-universal one and goes undocumented
          // in Slack, Discord and ChatGPT alike; a placeholder that fits is
          // worth more than one that explains itself and is cut in half.
          placeholder="Type a message..."
          // Border, radius, background and focus ring only. The field's
          // padding belongs to the textarea itself, not to this wrapper —
          // see SIZED_BOX in ChatInput: on the wrapper it held the
          // scrollbar 16px clear of the right edge.
          className="flex-1 border rounded-lg bg-chat-bg text-chat-fg border-chat-control-border focus-within:ring-2 focus-within:ring-chat-accent focus-within:border-chat-accent"
          maxLength={MAX_MESSAGE_LENGTH}
          onKeyDown={handleKeyDown}
        />
        <ChatSubmitButton
          ref={submitRef}
          answering={answering}
          empty={empty}
          onStop={onStop}
        />
      </div>
    </form>
  );
}
