import { render, screen } from "@testing-library/react";
import { createdAtDate } from "../lib/chat-history";
import type { UIMessage } from "../lib/chat-types";
import { UserMessage } from "./UserMessage";

function renderMessage(content: string) {
  const message: UIMessage = {
    id: "m1",
    role: "user",
    parts: [{ type: "text", content }],
    createdAt: createdAtDate(1_757_500_000_000),
  };
  render(<UserMessage message={message} />);
}

/**
 * The bubble is the element whose whole text is the message: its ancestors also
 * carry the "You" heading and the timestamp, so only this one matches. Found by
 * its text rather than by a container walk, which keeps the query off the
 * component's structure.
 */
function bubble() {
  return screen.getByText("line one line two");
}

describe("UserMessage", () => {
  it("keeps the newlines the field now produces", () => {
    renderMessage("line one\nline two");

    // getByText normalises whitespace, so matching it proves nothing about the
    // newline — the raw textContent is what says the message was not flattened
    // on the way into the transcript.
    expect(bubble().textContent).toBe("line one\nline two");
  });

  it("renders those newlines rather than collapsing them", () => {
    renderMessage("line one\nline two");

    // The one place this suite asserts on classes, because here the class *is*
    // the behaviour: HTML collapses a newline by default, and pre-wrap is what
    // stops it. jsdom loads no stylesheet, so there is no computed white-space
    // to read instead — proving the two lines render as two is a browser's job
    // and §8's manual check owns it.
    expect(bubble()).toHaveClass("whitespace-pre-wrap");
    expect(bubble()).toHaveClass("break-words");
  });

  it("renders markdown syntax as the characters the user typed", () => {
    // The hash sits at the start of its own line, where Markdown would actually
    // make a heading of it — mid-line it is only ever a literal hash, so the
    // assertion would hold whether or not the content had been rendered.
    renderMessage("*not italic*\n# not a heading");

    // D7: user content never goes through MarkdownContent. If it ever did, the
    // asterisks and the hash would vanish into an <em> and an <h1>.
    expect(
      screen.getByText("*not italic* # not a heading"),
    ).toBeInTheDocument();
  });
});

describe("UserMessage -- the time (plan #257 D17)", () => {
  it("is stamped from createdAt; 1_757_500_000_000 ms is 2025-09-10T10:26:40Z", () => {
    const { container } = render(
      <UserMessage
        message={{
          id: "m1",
          role: "user",
          parts: [{ type: "text", content: "hi" }],
          createdAt: createdAtDate(1_757_500_000_000),
        }}
      />,
    );
    expect(container.querySelector("time")).toHaveAttribute(
      "datetime",
      "2025-09-10T10:26:40Z",
    );
  });

  it("is absent when the message has no createdAt", () => {
    const { container } = render(
      <UserMessage
        message={{
          id: "m1",
          role: "user",
          parts: [{ type: "text", content: "hi" }],
        }}
      />,
    );
    expect(container.querySelector("time")).toBeNull();
  });
});
