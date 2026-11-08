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

describe("ChatPanel -- starters", () => {
  // Expected values: the brief's accessibility rule -- focus after a starter is clicked must not be lost when the
  // starters unmount; the message field takes it. Sent text is the starter's question, through the guarded submit.
  const question = "How do I create a worktree for a GitHub issue?";

  function Starting({ accept }: { accept: boolean }) {
    const [sent, setSent] = useState<string[]>([]);
    const value = {
      messages: sent.map((content, i) => ({
        id: `u${i}`,
        role: "user",
        parts: [{ type: "text", content }],
      })),
      isStreaming: false,
      warning: null,
      sendMessage: vi.fn(),
      submit: (text: string) => {
        if (accept) setSent([text]);
        return accept;
      },
      retry: vi.fn(),
      stop: vi.fn(),
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

  it("moves focus to the message field when the starters go", () => {
    render(<Starting accept />);
    const starter = screen.getByRole("button", { name: question });
    starter.focus();

    fireEvent.click(starter);

    expect(screen.queryByRole("button", { name: question })).toBeNull();
    // The starter's own question is what was submitted: it is now the user's turn.
    expect(screen.getByText(question)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveFocus();
  });

  it("keeps the starters, and focus on the one clicked, when the guarded submit refuses", () => {
    render(<Starting accept={false} />);
    const starter = screen.getByRole("button", { name: question });
    starter.focus();

    fireEvent.click(starter);

    expect(screen.getByRole("button", { name: question })).toHaveFocus();
  });

  it("says under the composer that the answers can be wrong", () => {
    render(<Starting accept />);
    expect(
      screen.getByText(
        "AI writes these answers and can be wrong — check the linked docs before relying on them.",
      ),
    ).toBeInTheDocument();
  });
});
