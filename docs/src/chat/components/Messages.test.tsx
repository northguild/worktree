import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, vi } from "vitest";
import { createdAtDate } from "../lib/chat-history";
import type { UIMessage } from "../lib/chat-types";
import { Messages } from "./Messages";

// Expected values: plan #257 §4.4 and D13 (Messages renders UIMessage[], text parts only) and D18 (the typing
// state is announced as "Dox is typing"). The empty assistant message is what the library leaves after a failed or
// not-yet-started answer (ai StreamProcessor, ensureAssistantMessage); the reader must never see an empty bubble.

beforeEach(() => {
  // jsdom has no scrollIntoView; the transcript scrolls to its end.
  Element.prototype.scrollIntoView = vi.fn();
});

function text(
  role: "user" | "assistant",
  content: string,
  id: string,
): UIMessage {
  return {
    id,
    role,
    parts: content === "" ? [] : [{ type: "text", content }],
    createdAt: createdAtDate(1_757_500_000_000),
  };
}

describe("Messages", () => {
  it("shows each question and answer in order", () => {
    render(
      <Messages
        isStreaming={false}
        messages={[
          text("user", "How do I clean up?", "u1"),
          text("assistant", "Run `worktree cleanup`.", "a1"),
        ]}
      />,
    );

    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(2);
    expect(articles[0]).toHaveTextContent("How do I clean up?");
    expect(articles[1]).toHaveTextContent("Run worktree cleanup.");
  });

  it("shows no bubble for an assistant message with no text once the answer is over", () => {
    render(
      <Messages
        isStreaming={false}
        messages={[text("user", "q", "u1"), text("assistant", "", "a1")]}
      />,
    );

    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.queryByText("Dox is typing")).toBeNull();
  });

  it("shows Dox typing from the moment a question is sent until text arrives", () => {
    const { rerender } = render(
      <Messages isStreaming messages={[text("user", "q", "u1")]} />,
    );
    expect(screen.getByText("Dox is typing")).toBeInTheDocument();

    // The library adds an empty assistant message before the first token: still one typing indicator.
    rerender(
      <Messages
        isStreaming
        messages={[text("user", "q", "u1"), text("assistant", "", "a1")]}
      />,
    );
    expect(screen.getAllByText("Dox is typing")).toHaveLength(1);
    expect(screen.getAllByRole("article")).toHaveLength(2);

    rerender(
      <Messages
        isStreaming
        messages={[text("user", "q", "u1"), text("assistant", "Par", "a1")]}
      />,
    );
    expect(screen.queryByText("Dox is typing")).toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getByText("Par")).toBeInTheDocument();
  });

  it("keeps one polite live region from the empty message to its first text (D18)", () => {
    // A live region announces what changes inside it, not what it holds when inserted: the node must survive.
    const empty = [text("user", "q", "u1"), text("assistant", "", "a1")];
    const { container, rerender } = render(
      <Messages isStreaming messages={empty} />,
    );
    const before = container.querySelector("[aria-live=polite]");
    expect(before).not.toBeNull();

    rerender(
      <Messages
        isStreaming
        messages={[text("user", "q", "u1"), text("assistant", "Par", "a1")]}
      />,
    );

    expect(container.querySelector("[aria-live=polite]")).toBe(before);
  });
});

describe("Messages -- starters", () => {
  // Expected values: plan #257 Phase 6 and the accessible-name rule (a real button named by its question).
  const questions = [
    "How do I create a worktree for a GitHub issue?",
    "How do I copy my .env files into a new worktree?",
    "How do I clean up worktrees whose branches are merged?",
  ];

  it("offers the three starters as buttons in an empty transcript, and sends the one clicked", () => {
    const onStarter = vi.fn();
    render(
      <Messages isStreaming={false} messages={[]} onStarter={onStarter} />,
    );

    for (const name of questions) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: questions[1] }));
    expect(onStarter).toHaveBeenCalledExactlyOnceWith(questions[1]);
  });

  it("drops the starters once there is a question", () => {
    render(
      <Messages
        isStreaming={false}
        messages={[text("user", "hi", "u1")]}
        onStarter={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: questions[0] })).toBeNull();
  });

  it("offers no starters while an answer is arriving", () => {
    render(<Messages isStreaming messages={[]} onStarter={vi.fn()} />);
    expect(screen.queryByRole("button", { name: questions[0] })).toBeNull();
  });
});
