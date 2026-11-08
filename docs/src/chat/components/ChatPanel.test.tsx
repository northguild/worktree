import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, vi } from "vitest";
import { ChatContext } from "./ChatContext";
import { ChatPanel } from "./ChatPanel";

// Expected values: the phase-4 review's accessibility finding. "Try again" clears the warning, which unmounts the
// focused button, so focus must land on the composer's submit button -- "Stop answer" while the retry is answering
// -- and a keyboard user can stop or carry on from where they are. Names: plan #257 §4.4.

beforeEach(() => {
  // jsdom has no scrollIntoView; the transcript scrolls to its end.
  Element.prototype.scrollIntoView = vi.fn();
});

type Value = Parameters<typeof ChatContext.Provider>[0]["value"];

/** A chat that failed once; retrying starts an answer that never ends unless `finish` is called. */
function Harness({ ends = false }: { ends?: boolean }) {
  const [warning, setWarning] = useState<{
    message: string;
    retryable: boolean;
  } | null>({ message: "Too many requests.", retryable: true });
  const [answering, setAnswering] = useState(false);
  const stop = vi.fn(() => setAnswering(false));
  const value = {
    messages: [],
    isStreaming: answering,
    warning,
    sendMessage: vi.fn(),
    submit: vi.fn(() => true),
    retry: async () => {
      setWarning(null);
      setAnswering(true);
      if (ends) await Promise.resolve().then(() => setAnswering(false));
    },
    stop,
    clear: vi.fn(),
    model: "gemini-3.5-flash-lite",
    setModel: vi.fn(),
  } as unknown as Value;
  return (
    <ChatContext.Provider value={value}>
      <ChatPanel />
    </ChatContext.Provider>
  );
}

describe("ChatPanel -- Try again", () => {
  it("leaves focus on 'Stop answer' once the retry is answering", async () => {
    render(<Harness />);
    const tryAgain = screen.getByRole("button", { name: "Try again" });
    tryAgain.focus();

    await act(async () => {
      fireEvent.click(tryAgain);
    });

    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByRole("button", { name: "Stop answer" })).toHaveFocus();
  });

  it("falls back to the message box when the retry ends before it can show Stop", async () => {
    render(<Harness ends />);
    const tryAgain = screen.getByRole("button", { name: "Try again" });
    tryAgain.focus();

    await act(async () => {
      fireEvent.click(tryAgain);
    });

    // The box is empty, so Send is disabled and cannot take focus; the field can.
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveFocus();
  });
});
