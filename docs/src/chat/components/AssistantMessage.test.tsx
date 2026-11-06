import { render, screen } from "@testing-library/react";
import type { ChatMessage } from "../types";
import { AssistantMessage } from "./AssistantMessage";

// Expected values: the user's request of 2026-11-06 (#266, D12) to name the chat's replies "Dox", as gmt's chat does
// (gmt apps/dox/src/components/ask/hive/HiveNode.tsx: `assistant: "Dox"`).
function renderMessage(overrides: Partial<ChatMessage> = {}) {
  const message: ChatMessage = {
    id: "a1",
    role: "assistant",
    content: "A reply.",
    createdAt: 1_757_500_000_000,
    ...overrides,
  };
  render(<AssistantMessage message={message} />);
}

describe("AssistantMessage", () => {
  it("is an article named Dox", () => {
    renderMessage();
    expect(screen.getByRole("article", { name: /^Dox/ })).toBeInTheDocument();
    expect(screen.queryByText("Assistant")).not.toBeInTheDocument();
  });

  it("announces 'Dox is typing' while the reply has not started", () => {
    renderMessage({ content: "", streaming: true });
    expect(screen.getByText("Dox is typing")).toBeInTheDocument();
  });
});
