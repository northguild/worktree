"use client";
import { useEffect, useRef } from "react";
import { useChatContext } from "./ChatContext";
import { ChatForm } from "./ChatForm";
import { AccuracyNote } from "./ChatInfo";
import { ChatWarning } from "./ChatWarning";
import { Messages } from "./Messages";

export function ChatPanel() {
  const { messages, isStreaming, submit, stop, warning, retry } =
    useChatContext();
  const submitRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const focusStopWhenAnswering = useRef(false);

  // "Try again" clears the warning, which unmounts the button the keyboard user
  // is on, and focus would fall to the page. It goes to the submit button
  // instead, which is "Stop answer" for as long as the retry is answering. The
  // button only becomes that on the next render, so the move waits for it.
  useEffect(() => {
    if (isStreaming && focusStopWhenAnswering.current) {
      focusStopWhenAnswering.current = false;
      submitRef.current?.focus();
    }
  }, [isStreaming]);

  async function handleRetry() {
    focusStopWhenAnswering.current = true;
    await retry();
    // The retry ended without ever showing Stop, or ended and left Send disabled
    // for an empty box (a disabled Send is not worth keeping focus on): the field can.
    focusStopWhenAnswering.current = false;
    const active = document.activeElement;
    if (
      active === document.body ||
      (active === submitRef.current &&
        submitRef.current?.getAttribute("aria-disabled") === "true")
    ) {
      inputRef.current?.focus();
    }
  }

  // The starters unmount once the question is in the transcript, and with them the button the reader is on. The
  // field takes focus, as it does after a typed send. A refused question leaves the starters, and focus, in place.
  function handleStarter(text: string) {
    if (submit(text)) inputRef.current?.focus();
  }

  return (
    <div className="flex-1 overflow-y-auto p-2">
      <div className="flex flex-col h-full max-h-[90vh] border border-chat-border rounded-lg bg-chat-bg text-chat-fg">
        <Messages
          messages={messages}
          isStreaming={isStreaming}
          onStarter={handleStarter}
        />
        {warning && <ChatWarning state={warning} onRetry={handleRetry} />}
        <ChatForm
          onSubmit={submit}
          answering={isStreaming}
          onStop={stop}
          submitRef={submitRef}
          inputRef={inputRef}
        />
        <AccuracyNote className="px-4 pb-3 text-xs text-chat-muted" />
      </div>
    </div>
  );
}
