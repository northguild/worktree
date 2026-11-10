import { fireEvent, render, screen } from "@testing-library/react";
import { ChatHttpError } from "../lib/chat-fetch";
import { ChatWarning, classifyChatError } from "./ChatWarning";

// Expected values: plan #257 §4.4 (classifyChatError): the Worker's { error, retryable } body, carried as the
// error's cause, wins; a local 404 says the local Worker is not running and names `pnpm --filter docs run dev:local` (docs/README.md, "To run with the AI chat worker locally");
// a TypeError/AbortError is "Couldn't reach the assistant. Check your connection and try again." (retryable); a
// streamed RUN_ERROR shows its curated text, retryable by its `code` -- the retryable column of §4.2's mapping table
// (rate_limited_daily, rate_limited, upstream_unavailable: yes; misconfigured, failed: no). D18: warnings are
// role="status", a hard failure role="alert". The library wraps what a fetchClient throws in a StreamReadError whose
// `cause` is the original (ai-client connection-adapters.ts, fetchEventSource).

function wrapped(cause: unknown): Error {
  return new Error("Stream response body read failed", { cause });
}

function streamed(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe("classifyChatError", () => {
  it("shows the Worker's own text and retryable flag, through the library's wrapper", () => {
    const failure = wrapped(
      new ChatHttpError(429, {
        error: "The assistant is receiving too many requests.",
        retryable: true,
      }),
    );

    expect(classifyChatError(failure)).toEqual({
      message: "The assistant is receiving too many requests.",
      retryable: true,
    });
  });

  it("honours retryable: false from the Worker", () => {
    expect(
      classifyChatError(
        new ChatHttpError(400, {
          error: "Message is empty.",
          retryable: false,
        }),
      ),
    ).toEqual({ message: "Message is empty.", retryable: false });
  });

  it("names the local Worker on a 404 from localhost", () => {
    const state = classifyChatError(wrapped(new ChatHttpError(404)));

    expect(state.retryable).toBe(false);
    expect(state.message).toContain("pnpm --filter docs run dev:local");
  });

  it("says the assistant is unavailable on another status, retryable from 500 up", () => {
    expect(classifyChatError(new ChatHttpError(502))).toEqual({
      message: "The assistant is unavailable (HTTP 502).",
      retryable: true,
    });
    expect(classifyChatError(new ChatHttpError(403))).toEqual({
      message: "The assistant is unavailable (HTTP 403).",
      retryable: false,
    });
  });

  it.each([
    ["a TypeError", new TypeError("Failed to fetch")],
    [
      "an AbortError",
      Object.assign(new Error("aborted"), { name: "AbortError" }),
    ],
    ["a wrapped TypeError", wrapped(new TypeError("Failed to fetch"))],
  ])("calls %s a connection problem", (_name, failure) => {
    expect(classifyChatError(failure)).toEqual({
      message:
        "Couldn't reach the assistant. Check your connection and try again.",
      retryable: true,
    });
  });

  it.each([
    ["rate_limited_daily", true],
    ["rate_limited", true],
    ["upstream_unavailable", true],
    // Plan #309 D9, the Worker's table (`error-mapping.ts`): no brain started in time is worth asking again; every brain
    // out for the day is not.
    ["upstream_slow", true],
    ["allowance_spent", false],
    ["misconfigured", false],
    ["failed", false],
  ])("shows a streamed %s error's text, retryable=%s", (code, retryable) => {
    expect(
      classifyChatError(streamed("Curated text for the reader.", code)),
    ).toEqual({ message: "Curated text for the reader.", retryable });
  });
});

describe("ChatWarning", () => {
  it("is a polite status with Try again when the failure is retryable", () => {
    const onRetry = vi.fn();
    render(
      <ChatWarning
        state={{ message: "Wait a moment.", retryable: true }}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Wait a moment.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("is an alert, with no Try again, when the failure is not retryable", () => {
    render(
      <ChatWarning
        state={{ message: "Unavailable.", retryable: false }}
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Unavailable.");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });

  // §4.1 row 16: gmt's warning carries a marker, `⟨ ! ⟩`, that is decoration: the message is the content.
  it("draws its marker hidden from assistive technology, so a screen reader hears only the message", () => {
    render(
      <ChatWarning state={{ message: "Wait a moment.", retryable: true }} />,
    );

    const marker = screen.getByText("⟨ ! ⟩");
    expect(marker).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("status").textContent).toContain("Wait a moment.");
  });
});
