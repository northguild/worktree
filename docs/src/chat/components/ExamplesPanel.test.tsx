import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { validateChatRequest } from "../../../worker/validation";
import answerStream from "../hooks/fixtures/chat-answer.sse?raw";
import { CHAT_STARTERS } from "../lib/chat-starters";
import { DoxPage } from "./DoxPage";
import { ExamplesPanel } from "./ExamplesPanel";

// Expected values: plan #309 Phase 3 "Done when" and §4.1 rows 24-27. A card's name is its question and its description the
// page that answers it (D7), the heading carries the count of starters, and a click sends exactly the starter's text
// through the composer's own guarded send. The starters themselves are `CHAT_STARTERS`, whose text is fixed by
// `chat-starters.test.ts`; what is asserted here is how the rail shows them, never a second copy of their wording.

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 20));
  vi.unstubAllGlobals();
});

describe("ExamplesPanel", () => {
  it("headed Examples, with the number of starters beside it", () => {
    render(<ExamplesPanel onPick={() => {}} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Examples" }),
    ).toBeInTheDocument();
    expect(screen.getByText(String(CHAT_STARTERS.length))).toBeInTheDocument();
  });

  it("shows one area heading per area, each with an icon hidden from the screen reader", () => {
    render(<ExamplesPanel onPick={() => {}} />);
    for (const { area } of CHAT_STARTERS) {
      const heading = screen.getByRole("heading", { level: 3, name: area });
      const icon = heading.querySelector("svg");
      expect(icon, area).not.toBeNull();
      expect(icon).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("names each card by its question and describes it by the page that answers it", () => {
    render(<ExamplesPanel onPick={() => {}} />);
    for (const { text, route } of CHAT_STARTERS) {
      const card = screen.getByRole("button", { name: text });
      expect(card).toHaveAccessibleDescription(route);
    }
  });

  it("files each card under its area's heading", () => {
    render(<ExamplesPanel onPick={() => {}} />);
    for (const { text, area } of CHAT_STARTERS) {
      const group = screen.getByRole("region", { name: area });
      expect(
        within(group).getByRole("button", { name: text }),
      ).toBeInTheDocument();
    }
  });

  it("hands the host the starter that was clicked", () => {
    const onPick = vi.fn();
    render(<ExamplesPanel onPick={onPick} />);
    fireEvent.click(
      screen.getByRole("button", { name: CHAT_STARTERS[1].text }),
    );
    expect(onPick).toHaveBeenCalledExactlyOnceWith(CHAT_STARTERS[1]);
  });
});

describe("the examples rail on the Dox page", () => {
  function stubFetch(answer: "stream" | "hang") {
    const calls: Array<{ messages: Array<{ content: unknown }> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string) as {
          runId: string;
          messages: Array<{ content: unknown }>;
        };
        calls.push(body);
        if (answer === "hang") return new Promise<Response>(() => {});
        return new Response(answerStream.replaceAll("RUN-ID", body.runId), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        });
      }),
    );
    return calls;
  }

  it("sends exactly the starter's text when a card is clicked, as the reader's question", async () => {
    const calls = stubFetch("stream");
    render(<DoxPage />);
    const starter = CHAT_STARTERS[2];
    fireEvent.click(screen.getByRole("button", { name: starter.text }));

    const question = await screen.findByRole("article", { name: "You" });
    expect(question).toHaveTextContent(starter.text);
    expect(calls).toHaveLength(1);
    // The same check the Worker runs, as `useDocsChat.test.tsx` does: the one message sent is the starter, word for word.
    expect(validateChatRequest(calls[0])).toMatchObject({
      ok: true,
      value: { messages: [{ role: "user", content: starter.text }] },
    });
    // The composer's own send puts focus back in the field, and a draft already there is left alone.
    expect(screen.getByRole("textbox", { name: "Message" })).toHaveFocus();
  });

  it("leaves a draft in the composer alone", async () => {
    stubFetch("stream");
    render(<DoxPage />);
    const box = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "half a thought" } });
    fireEvent.click(
      screen.getByRole("button", { name: CHAT_STARTERS[0].text }),
    );
    await screen.findByRole("article", { name: "You" });
    expect(box).toHaveValue("half a thought");
  });

  it("refuses a card while an answer is still coming, sends nothing, and keeps focus on the card", async () => {
    const calls = stubFetch("hang");
    render(<DoxPage />);
    fireEvent.click(
      screen.getByRole("button", { name: CHAT_STARTERS[0].text }),
    );
    await waitFor(() => expect(calls).toHaveLength(1));

    const second = screen.getByRole("button", { name: CHAT_STARTERS[1].text });
    second.focus();
    fireEvent.click(second);

    expect(calls).toHaveLength(1);
    expect(second).toHaveFocus();
  });

  // jsdom loads no stylesheet, so the bar is visible and the sheet is as open as the reader leaves it: the hiding of both is
  // the stylesheet's (`dox-hive.css`), checked in the browser. What is asserted is the state the markup carries.
  it("opens the sheet from the bar, and Escape folds it back and puts focus on the bar", () => {
    render(<DoxPage />);
    const bar = screen.getByRole("button", {
      name: `Examples ${CHAT_STARTERS.length}`,
    });
    const rail = screen.getByRole("complementary", { name: "Examples" });
    expect(bar).toHaveAttribute("aria-expanded", "false");
    expect(bar).toHaveAttribute("aria-controls", rail.id);
    expect(rail).toHaveAttribute("data-collapsed");

    fireEvent.click(bar);
    expect(bar).toHaveAttribute("aria-expanded", "true");
    expect(rail).not.toHaveAttribute("data-collapsed");

    screen.getByRole("button", { name: CHAT_STARTERS[0].text }).focus();
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });

    expect(bar).toHaveAttribute("aria-expanded", "false");
    expect(rail).toHaveAttribute("data-collapsed");
    expect(bar).toHaveFocus();
  });

  it("leaves Escape alone while the sheet is folded", () => {
    render(<DoxPage />);
    const box = screen.getByRole("textbox", { name: "Message" });
    box.focus();
    const event = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    box.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(box).toHaveFocus();
  });

  it("leaves Escape to an open dialog, such as Starlight's search, and keeps the sheet open", () => {
    render(<DoxPage />);
    const bar = screen.getByRole("button", {
      name: `Examples ${CHAT_STARTERS.length}`,
    });
    fireEvent.click(bar);
    const dialog = document.createElement("dialog");
    dialog.setAttribute("open", "");
    const field = document.createElement("input");
    dialog.append(field);
    document.body.append(dialog);
    try {
      field.focus();
      fireEvent.keyDown(field, { key: "Escape" });
      expect(bar).toHaveAttribute("aria-expanded", "true");
    } finally {
      dialog.remove();
    }
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(bar).toHaveAttribute("aria-expanded", "false");
  });

  it("folds the sheet when a card is picked, so the answer is what the phone shows", async () => {
    stubFetch("stream");
    render(<DoxPage />);
    const bar = screen.getByRole("button", {
      name: `Examples ${CHAT_STARTERS.length}`,
    });
    fireEvent.click(bar);
    fireEvent.click(
      screen.getByRole("button", { name: CHAT_STARTERS[0].text }),
    );
    await screen.findByRole("article", { name: "You" });
    expect(bar).toHaveAttribute("aria-expanded", "false");
  });
});
