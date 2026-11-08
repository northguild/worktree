import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { ChatSubmitButton } from "./ChatSubmitButton";

// Expected values: plan #257 §4.4's names table (submit idle "Send message", submit answering "Stop answer") and
// D15 (while an answer is in flight the submit button becomes Stop, which calls `useChat`'s `stop`; an empty field
// cannot be sent).

describe("ChatSubmitButton", () => {
  it("is named 'Send message' and is a submit button when idle", () => {
    render(
      <ChatSubmitButton answering={false} empty={false} onStop={vi.fn()} />,
    );

    const button = screen.getByRole("button", { name: "Send message" });
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("type", "submit");
  });

  it("is disabled for an empty field", () => {
    render(<ChatSubmitButton answering={false} empty onStop={vi.fn()} />);

    // aria-disabled, not the native attribute: see the focus case below.
    const button = screen.getByRole("button", { name: "Send message" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toHaveAttribute("disabled");
  });

  it("does not submit its form while it is disabled for an empty field", () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <ChatSubmitButton answering={false} empty onStop={vi.fn()} />
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("keeps focus when Stop gives way to a disabled Send", () => {
    const { rerender } = render(
      <ChatSubmitButton answering empty onStop={vi.fn()} />,
    );
    const stop = screen.getByRole("button", { name: "Stop answer" });
    stop.focus();

    rerender(<ChatSubmitButton answering={false} empty onStop={vi.fn()} />);

    // A natively disabled button is dropped from the focus order by browsers
    // (jsdom keeps focus on it, so the attributes are what is asserted).
    const send = screen.getByRole("button", { name: "Send message" });
    expect(send).toBe(stop);
    expect(send).toHaveFocus();
    expect(send).toHaveAttribute("aria-disabled", "true");
    expect(send).not.toHaveAttribute("disabled");
  });

  it("is named 'Stop answer' while answering, and clicking it stops", () => {
    const onStop = vi.fn();
    render(<ChatSubmitButton answering empty onStop={onStop} />);

    const button = screen.getByRole("button", { name: "Stop answer" });
    // Enabled although the field is empty: Stop does not depend on what was typed.
    expect(button).toBeEnabled();
    expect(button).toHaveAttribute("type", "button");
    fireEvent.click(button);

    expect(onStop).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("button", { name: "Send message" }),
    ).not.toBeInTheDocument();
  });

  it("is the same element after the swap, so it keeps focus", () => {
    const { rerender } = render(
      <ChatSubmitButton answering={false} empty={false} onStop={vi.fn()} />,
    );
    const send = screen.getByRole("button", { name: "Send message" });
    send.focus();

    rerender(<ChatSubmitButton answering empty={false} onStop={vi.fn()} />);

    const stop = screen.getByRole("button", { name: "Stop answer" });
    expect(stop).toBe(send);
    expect(stop).toHaveFocus();
  });
});
