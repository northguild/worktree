"use client";

import { useForm } from "@tanstack/react-form";
import { useEffect, useRef } from "react";
import { MAX_MESSAGE_LENGTH } from "../constants";
import { FormProvider } from "../form/FormContext";
import { FormField } from "../form/FormField";
import { ChatInput } from "./ChatInput";
import { ChatSubmitButton } from "./ChatSubmitButton";

interface ChatFormProps {
  onSubmit: (message: string) => Promise<void> | void;
  disabled?: boolean;
}

export function ChatForm({ onSubmit, disabled }: ChatFormProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const form = useForm({
    defaultValues: { message: "" },
    validators: {
      onSubmit: ({ value }) => {
        if (!value.message || value.message.trim().length === 0) {
          return "Message is required";
        }
      },
    },
    onSubmit: async ({ value }) => {
      const msg = value.message.trim();
      if (!msg) return;
      await onSubmit(msg);
      form.reset();
      setTimeout(() => inputRef.current?.focus(), 0);
    },
  });

  useEffect(() => {
    const t = setTimeout(() => {
      inputRef.current?.focus();
    }, 180);
    return () => clearTimeout(t);
  }, []);

  // What Enter means belongs to the form, not to the field: the field already
  // couples to the form through useField(), and deciding the submit key inside
  // it would put that decision where the form can no longer change it.
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey) return;
    // While an IME composition is active, Enter confirms a candidate rather
    // than ending the message. Sending here would cut a CJK user off mid-word,
    // and it is invisible to anyone testing in a Latin script.
    if (e.nativeEvent.isComposing) return;
    e.preventDefault();
    form.handleSubmit();
  }

  return (
    <FormProvider form={form}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
        className="p-4 border-t border-gray-200 dark:border-neutral-800"
      >
        <div className="flex gap-1 items-end">
          <FormField name="message">
            <ChatInput
              ref={inputRef}
              label="Message"
              placeholder="Type a message... (Shift+Enter for a new line)"
              className="flex-1 px-4 py-2 border rounded-lg bg-white dark:bg-neutral-900 text-gray-900 dark:text-gray-100 border-gray-200 dark:border-neutral-700 focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500"
              disabled={disabled}
              maxLength={MAX_MESSAGE_LENGTH}
              onKeyDown={handleKeyDown}
            />
          </FormField>
          <ChatSubmitButton disabled={disabled} />
        </div>
      </form>
    </FormProvider>
  );
}
