import { render, screen } from "@testing-library/react";
import { createdAtDate } from "../lib/chat-history";
import { AssistantMessage } from "./AssistantMessage";

// Expected values: the user's request of 2026-11-06 (#266, D12) to name the chat's replies "Dox", as gmt's chat does
// (gmt apps/dox/src/components/ask/hive/HiveNode.tsx: `assistant: "Dox"`). Plan #257 D17: the time comes from
// the message's createdAt, and a message with none shows no time; D18: the bubble stays a polite live region, and
// LoadingDots is aria-hidden beside its sr-only text (§4.4). gmt documents convertUnixToUtc(1709164800000) as
// "2024-02-29T00:00:00Z", which gives the datetime for 1_757_500_000_000 ms: 2025-09-10T10:26:40Z.
function renderMessage(
  overrides: Partial<Parameters<typeof AssistantMessage>[0]> = {},
) {
  return render(
    <AssistantMessage
      text="A reply."
      createdAt={createdAtDate(1_757_500_000_000)}
      streaming={false}
      {...overrides}
    />,
  );
}

describe("AssistantMessage", () => {
  it("is an article named Dox", () => {
    renderMessage();
    expect(screen.getByRole("article", { name: /^Dox/ })).toBeInTheDocument();
    expect(screen.queryByText("Assistant")).not.toBeInTheDocument();
  });

  it("announces 'Dox is typing' while the reply has not started, and hides the dots from assistive tech", () => {
    const { container } = renderMessage({ text: "", streaming: true });
    expect(screen.getByText("Dox is typing")).toBeInTheDocument();
    const dots = container.querySelector("svg");
    expect(dots).toHaveAttribute("aria-hidden", "true");
    expect(dots).not.toHaveAttribute("aria-label");
  });

  it("renders the reply's markdown once it has text, even while it streams", () => {
    renderMessage({ text: "Run **now**.", streaming: true });
    expect(screen.getByText("now").tagName).toBe("STRONG");
    expect(screen.queryByText("Dox is typing")).not.toBeInTheDocument();
  });

  it("keeps the bubble a polite live region", () => {
    renderMessage();
    const region = screen.getByText("A reply.").closest("[aria-live]");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveAttribute("aria-atomic", "false");
  });

  it("stamps the time from createdAt", () => {
    const { container } = renderMessage();
    expect(container.querySelector("time")).toHaveAttribute(
      "datetime",
      "2025-09-10T10:26:40Z",
    );
  });

  it.each([
    ["a number", 1_757_500_000_000],
    ["an ISO string", "2025-09-10T10:26:40.000Z"],
  ])("stamps the time from %s too (a transcript read from storage)", (_name, createdAt) => {
    const { container } = renderMessage({ createdAt });
    expect(container.querySelector("time")).toHaveAttribute(
      "datetime",
      "2025-09-10T10:26:40Z",
    );
  });

  it("shows no time when the message has none", () => {
    const { container } = renderMessage({ createdAt: undefined });
    expect(container.querySelector("time")).toBeNull();
  });
});
