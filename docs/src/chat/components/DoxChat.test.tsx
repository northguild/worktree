import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import answerStream from "../hooks/fixtures/chat-answer.sse?raw";
import runErrorStream from "../hooks/fixtures/chat-run-error.sse?raw";
import { DoxChat } from "./DoxChat";

// Expected values: plan #309 Phase 2 "Done when" and §4.1 rows 8-11, 16-20. The engine is the real `useDocsChat` over a
// stubbed `fetch`, so what is asserted is what a reader sees. The streams are the recorded output of the Worker's
// handler (`chat-answer.sse`, `chat-run-error.sse`, the same ones `useDocsChat.test.tsx` replays), with its RUN-ID
// placeholder put back as the request's runId. The motion values (a 2600 ms spin that does not end until the first
// text, a 900 ms landing) are gmt's `use-crystal-spin.ts`, written out in `hive/hive.test.tsx` from that file.

const RUN_ID = "RUN-ID";
const QUESTION = "How do I remove a worktree?";
const PLACEHOLDER = "Ask about @northguild/worktree…";
const FRAMES = answerStream.split("\n\n").filter(Boolean);
/** RUN_STARTED, then TEXT_MESSAGE_START, then the first delta ("To r") of the recorded answer. */
const [RUN_STARTED, TEXT_START, FIRST_DELTA] = FRAMES;

let storage: Map<string, string>;
let animations: Array<{
  keyframes: unknown;
  options: Record<string, unknown>;
  cancel: ReturnType<typeof vi.fn>;
}>;

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
  // jsdom has no scrollIntoView, and no Web Animations: the crystal's spin is observed through `animate`.
  Element.prototype.scrollIntoView = vi.fn();
  animations = [];
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    writable: true,
    value: vi.fn((keyframes: unknown, options: Record<string, unknown>) => {
      const animation = {
        keyframes,
        options,
        cancel: vi.fn(),
        currentTime: 650,
      };
      animations.push(animation);
      return animation;
    }),
  });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});

afterEach(async () => {
  cleanup();
  // A disposed chat client may still save on a timer; let it land in this test's storage.
  await new Promise((resolve) => setTimeout(resolve, 20));
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as { animate?: unknown }).animate;
});

/** An SSE answer whose frames the test releases one at a time. */
function openStream() {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let runId = "";
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    runId = (JSON.parse(init.body as string) as { runId: string }).runId;
    return new Response(
      new ReadableStream({
        start(c) {
          controller = c;
        },
      }),
      { status: 200, headers: { "Content-Type": "text/event-stream" } },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  return {
    fetchMock,
    push: (...frames: string[]) =>
      act(async () => {
        // The request leaves a tick after the key press.
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        for (const frame of frames) {
          controller.enqueue(
            encoder.encode(`${frame.replaceAll(RUN_ID, runId)}\n\n`),
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }),
    end: () =>
      act(async () => {
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        controller.close();
        await new Promise((resolve) => setTimeout(resolve, 10));
      }),
  };
}

function whole(stream: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const { runId } = JSON.parse(init.body as string) as { runId: string };
      return new Response(stream.replaceAll(RUN_ID, runId), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }),
  );
}

function ask(text: string) {
  const box = screen.getByRole("textbox", { name: "Message" });
  fireEvent.change(box, { target: { value: text } });
  fireEvent.keyDown(box, { key: "Enter" });
}

const spins = () =>
  animations.filter((a) => a.options.iterations === Number.POSITIVE_INFINITY);
const landings = () => animations.filter((a) => a.options.duration === 900);

describe("DoxChat -- the transcript", () => {
  it("shows a question and its recorded answer as two turns, the reader's first", async () => {
    whole(answerStream);
    render(<DoxChat />);
    ask(QUESTION);

    const you = await screen.findByRole("article", { name: "You" });
    expect(you).toHaveTextContent(QUESTION);
    const dox = await screen.findByRole("article", { name: "Dox" });
    await waitFor(() =>
      expect(dox).toHaveTextContent("To remove a worktree, run"),
    );
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  // Kept from the drawer's UserMessage test (#257 D7), whose component went with the drawer: what the reader typed is shown as typed.
  it("shows the reader's question as the characters typed, newlines kept, never as markdown", async () => {
    whole(answerStream);
    render(<DoxChat />);
    ask("*not italic*\n# not a heading");

    const you = await screen.findByRole("article", { name: "You" });
    expect(you).toHaveTextContent("*not italic* # not a heading");
    expect(you.querySelector(".gmt-hive-user-text")?.textContent).toBe(
      "*not italic*\n# not a heading",
    );
    expect(you.querySelector("em, h1")).toBeNull();
    await screen.findByRole("article", { name: "Dox" });
  });

  it("waits on a turn that says it is searching the docs, and drops it when the answer fails with no text", async () => {
    whole(runErrorStream);
    render(<DoxChat />);
    ask(QUESTION);

    // The Worker's own failure text, as the warning; the empty answer behind it is not a turn.
    expect(
      await screen.findByText(/reached its daily limit/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Dox" })).toBeNull();
    expect(screen.getByRole("article", { name: "You" })).toBeInTheDocument();
    expect(screen.queryByText("Searching docs…")).toBeNull();
  });

  it("keeps the crystal turning, and says what it is doing, until the first text, then lands it", async () => {
    const stream = openStream();
    render(<DoxChat />);
    ask(QUESTION);

    // The stream is open and has said nothing yet: no assistant message exists, the waiting turn stands in for it.
    await stream.push(RUN_STARTED);
    expect(await screen.findByText("Searching docs…")).toBeInTheDocument();
    expect(spins()).toHaveLength(1);
    expect(landings()).toHaveLength(0);

    // The message exists but is still empty: the same turn, still waiting, still one spin.
    await stream.push(TEXT_START);
    expect(screen.getByText("Searching docs…")).toBeInTheDocument();
    expect(screen.getAllByRole("article", { name: "Dox" })).toHaveLength(1);
    expect(spins()).toHaveLength(1);
    expect(spins()[0].cancel).not.toHaveBeenCalled();

    // The first text: the spin is stopped from the angle it reached (650 ms of 2600 is 90 degrees) and lands.
    await stream.push(FIRST_DELTA);
    await waitFor(() =>
      expect(screen.queryByText("Searching docs…")).toBeNull(),
    );
    expect(screen.getByRole("article", { name: "Dox" })).toHaveTextContent(
      "To r",
    );
    expect(spins()[0].cancel).toHaveBeenCalled();
    expect(landings()).toHaveLength(1);
    expect(landings()[0].keyframes).toEqual([
      { transform: "rotateX(10deg) rotateZ(90deg)" },
      { transform: "rotateX(10deg) rotateZ(360deg)" },
    ]);
    await stream.end();
  });

  it("holds one polite live region for the answer from the wait to the text", async () => {
    const stream = openStream();
    render(<DoxChat />);
    ask(QUESTION);
    await stream.push(RUN_STARTED, TEXT_START);
    await screen.findByText("Searching docs…");

    const waiting = screen
      .getByRole("article", { name: "Dox" })
      .querySelector('[aria-live="polite"]');
    expect(waiting).not.toBeNull();

    await stream.push(FIRST_DELTA);
    await waitFor(() => expect(waiting).toHaveTextContent("To r"));
    expect(
      screen
        .getByRole("article", { name: "Dox" })
        .querySelector('[aria-live="polite"]'),
    ).toBe(waiting);
    expect(waiting).toHaveAttribute("aria-atomic", "false");
    await stream.end();
  });

  it("marks no spin under reduced motion, yet still says it is searching", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("reduce"),
    }));
    const stream = openStream();
    render(<DoxChat />);
    ask(QUESTION);
    await stream.push(RUN_STARTED);
    expect(await screen.findByText("Searching docs…")).toBeInTheDocument();
    expect(animations).toHaveLength(0);
    await stream.end();
  });
});

describe("DoxChat -- the composer", () => {
  it("is pinned with the placeholder naming the package, and sends on Enter but not on Shift+Enter", async () => {
    const stream = openStream();
    render(<DoxChat />);
    const box = screen.getByRole("textbox", { name: "Message" });
    expect(box).toHaveAttribute("placeholder", PLACEHOLDER);

    fireEvent.change(box, { target: { value: "one line" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(stream.fetchMock).not.toHaveBeenCalled();

    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(stream.fetchMock).toHaveBeenCalledOnce());
    expect(box).toHaveValue("");
    await stream.end();
  });

  // Kept from the drawer's ChatInput test (through ChatForm): a blank box sends nothing, by Enter or by the disabled Send.
  it("sends nothing from a blank box, by Enter or by clicking the disabled Send", () => {
    const stream = openStream();
    render(<DoxChat />);
    const box = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "   \n " } });

    fireEvent.keyDown(box, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    expect(stream.fetchMock).not.toHaveBeenCalled();
  });

  // Kept from the drawer's ChatInput test (through ChatForm): a message the guarded send refuses stays in the box. A lone
  // zero-width space is not empty to `trim()`, so it reaches `submit`, which strips it and refuses it ("Message is empty.").
  it("keeps a message the guarded send refuses in the box, and says why", () => {
    const stream = openStream();
    render(<DoxChat />);
    const box = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "\u200b" } });

    fireEvent.keyDown(box, { key: "Enter" });

    expect(stream.fetchMock).not.toHaveBeenCalled();
    expect(box).toHaveValue("\u200b");
    expect(screen.getByText("Message is empty.")).toBeInTheDocument();
  });

  // WCAG-adjacent and #257 D15: while an IME composition is open, Enter confirms a candidate; it must not send.
  it("does not send on the Enter that confirms an IME candidate, and keeps what was typed", () => {
    const stream = openStream();
    render(<DoxChat />);
    const box = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "にほん" } });

    fireEvent.keyDown(box, { key: "Enter", isComposing: true });

    expect(stream.fetchMock).not.toHaveBeenCalled();
    expect(box).toHaveValue("にほん");
  });

  it("offers one button: Send, disabled with nothing to send, then Stop while an answer arrives", async () => {
    const stream = openStream();
    render(<DoxChat />);
    expect(
      screen.getByRole("button", { name: "Send message" }),
    ).toHaveAttribute("aria-disabled", "true");

    ask(QUESTION);
    const stop = await screen.findByRole("button", { name: "Stop answer" });
    expect(
      screen.getAllByRole("button", { name: /Send message|Stop answer/ }),
    ).toHaveLength(1);
    // Enter while answering sends nothing more.
    const box = screen.getByRole("textbox", { name: "Message" });
    fireEvent.change(box, { target: { value: "a second question" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(stream.fetchMock).toHaveBeenCalledOnce();
    fireEvent.click(stop);
    await stream.end();
  });

  it("says under the composer that the answers can be wrong, and keeps it within an info button's popup for a phone", () => {
    render(<DoxChat />);
    const note =
      "AI writes these answers and can be wrong — check the linked docs before relying on them.";
    // Once under the composer, and once in the popup the info button opens.
    expect(screen.getAllByText(note)).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "About Dox's answers" }),
    ).toBeInTheDocument();
  });

  it("shows a warning the reader can retry from, and asks the last question again", async () => {
    whole(runErrorStream);
    render(<DoxChat />);
    ask(QUESTION);
    const warning = (
      await screen.findByText(/reached its daily limit/)
    ).closest("[role='status']");
    expect(warning).not.toBeNull();

    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const { runId } = JSON.parse(init.body as string) as { runId: string };
      return new Response(answerStream.replaceAll(RUN_ID, runId), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const tryAgain = screen.getByRole("button", { name: "Try again" });
    tryAgain.focus();
    fireEvent.click(tryAgain);
    await waitFor(() =>
      expect(screen.getByRole("article", { name: "Dox" })).toHaveTextContent(
        "To remove a worktree",
      ),
    );
    expect(screen.queryByText(/reached its daily limit/)).toBeNull();
    // "Try again" unmounted under the keyboard user: the retry has ended and Send has nothing to send, so the field has focus.
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: "Message" })).toHaveFocus(),
    );
  });

  // Focus on "Try again" is lost when the warning clears; it goes to the submit button, which is "Stop answer" while the
  // retry answers (ported from ChatPanel, a #257 review finding).
  it("leaves focus on Stop answer while a retry is answering", async () => {
    whole(runErrorStream);
    render(<DoxChat />);
    ask(QUESTION);
    const tryAgain = await screen.findByRole("button", { name: "Try again" });

    const stream = openStream();
    tryAgain.focus();
    fireEvent.click(tryAgain);
    await stream.push(RUN_STARTED);

    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByRole("button", { name: "Stop answer" })).toHaveFocus();
    await stream.end();
  });
});

describe("DoxChat -- the scroller", () => {
  let overflowing: boolean;
  let resize: () => void;

  beforeEach(() => {
    overflowing = false;
    // jsdom does no layout: the box's heights are what the test says they are.
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => (overflowing ? 1000 : 400),
    });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 400,
    });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          resize = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
  });
  afterEach(() => {
    delete (HTMLElement.prototype as { scrollHeight?: unknown }).scrollHeight;
    delete (HTMLElement.prototype as { clientHeight?: unknown }).clientHeight;
  });

  it("is a focusable, named region only while it overflows (WCAG 2.2 SC 2.1.1 for a scrollable box)", () => {
    render(<DoxChat />);
    expect(
      screen.queryByRole("region", { name: "Conversation, scrollable" }),
    ).toBeNull();

    overflowing = true;
    act(() => resize());
    const region = screen.getByRole("region", {
      name: "Conversation, scrollable",
    });
    expect(region).toHaveAttribute("tabindex", "0");

    overflowing = false;
    act(() => resize());
    expect(
      screen.queryByRole("region", { name: "Conversation, scrollable" }),
    ).toBeNull();
  });

  it("offers a jump to the latest turn only while scrolled up, and gives focus back to the scroller after it", () => {
    overflowing = true;
    render(<DoxChat />);
    act(() => resize());
    const region = screen.getByRole("region", {
      name: "Conversation, scrollable",
    });

    // 1000 high, 400 showing, scrolled to the top: 600px short of the end, past the 120px that counts as at the end.
    fireEvent.scroll(region);
    const jump = screen.getByRole("button", { name: "Jump to latest message" });
    fireEvent.click(jump);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(region).toHaveFocus();

    // Scrolled to within 120px of the end: no button.
    Object.defineProperty(region, "scrollTop", {
      configurable: true,
      value: 500,
    });
    fireEvent.scroll(region);
    expect(
      screen.queryByRole("button", { name: "Jump to latest message" }),
    ).toBeNull();
  });
});

// Plan #309 Phase 5: the trace in the answer's card (§4.1 row 12) and the hub's status line (§4.1 row 6). The trace
// frames are AG-UI `CUSTOM` events named `dox-retrieval`, written by hand to the shape `chat-types.ts` documents; the
// 28 is the number of docs pages (`find docs/src/content/docs -name '*.mdx'`).
const TRACE_FRAME = `data: ${JSON.stringify({
  type: "CUSTOM",
  name: "dox-retrieval",
  value: {
    totalChunks: 210,
    retrievedCount: 2,
    chunkTitles: ["Cleanup › Usage", "Cleanup › Flags"],
    chunkUrls: ["/commands/cleanup/"],
    timings: { corpus: 0, search: 4, prompt: 1 },
  },
  timestamp: 1,
})}`;

describe("DoxChat -- the retrieval trace", () => {
  it("shows the counts, collapsed, in the answer's card as soon as the Worker says, before any text", async () => {
    const stream = openStream();
    render(<DoxChat />);
    ask(QUESTION);

    await stream.push(RUN_STARTED, TRACE_FRAME);

    const trigger = await screen.findByRole("button", {
      name: "Searched 210 chunks → 2 matched",
    });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Searching docs…")).toBeInTheDocument();
    await stream.end();
  });

  it("opens to the chunk titles", async () => {
    const stream = openStream();
    render(<DoxChat />);
    ask(QUESTION);
    await stream.push(RUN_STARTED, TRACE_FRAME);

    fireEvent.click(
      await screen.findByRole("button", { name: /Searched 210 chunks/ }),
    );

    expect(screen.getByText("Cleanup › Usage")).toBeInTheDocument();
    await stream.end();
  });

  it("stays outside the answer's live region, so the answer is announced and the trace is not", async () => {
    const stream = openStream();
    render(<DoxChat />);
    ask(QUESTION);
    await stream.push(RUN_STARTED, TRACE_FRAME, TEXT_START, FIRST_DELTA);

    const trigger = await screen.findByRole("button", {
      name: /Searched 210 chunks/,
    });
    const live = screen
      .getByRole("article", { name: "Dox" })
      .querySelector('[aria-live="polite"]');

    await waitFor(() => expect(live).toHaveTextContent("To r"));
    expect(live?.contains(trigger)).toBe(false);
    await stream.end();
  });

  it("shows no trace for a question the Worker said nothing about", async () => {
    whole(answerStream);
    render(<DoxChat />);
    ask(QUESTION);

    await screen.findByText(/To remove a worktree/);
    expect(screen.queryByRole("button", { name: /Searched/ })).toBeNull();
  });
});

describe("DoxChat -- the hub's status line", () => {
  it("counts the pages and sections the Worker indexes", () => {
    render(<DoxChat />);

    expect(
      screen.getByText(/^Dox \/\/ 28 pages · \d+ sections indexed$/),
    ).toBeInTheDocument();
  });
});

// Plan #309 Phase 6 (§4.1 rows 11 and 12): the Worker's progress lines replace the waiting text, and the trace's last
// write names the brain that answered. The frames are `CUSTOM` events written by hand to the shape `chat-types.ts`
// documents (names `dox-progress`, `dox-retrieval`); the wording is the Worker's own, from gmt's `chat-handler.ts`.
const progressFrame = (text: string) =>
  `data: ${JSON.stringify({ type: "CUSTOM", name: "dox-progress", value: { text }, timestamp: 1 })}`;

describe("DoxChat -- the Worker's progress lines", () => {
  it("replaces the waiting text with each line as the Worker says it, and drops it with the first text", async () => {
    const stream = openStream();
    render(<DoxChat />);
    ask(QUESTION);

    await stream.push(RUN_STARTED);
    expect(await screen.findByText("Searching docs…")).toBeInTheDocument();

    await stream.push(progressFrame("Asking Gemma 4 26B…"));
    expect(await screen.findByText("Asking Gemma 4 26B…")).toBeInTheDocument();
    expect(screen.queryByText("Searching docs…")).toBeNull();

    await stream.push(
      progressFrame("Gemma 4 26B is busy — trying the next model…"),
    );
    expect(
      await screen.findByText("Gemma 4 26B is busy — trying the next model…"),
    ).toBeInTheDocument();

    await stream.push(TEXT_START, FIRST_DELTA);
    await waitFor(() =>
      expect(screen.queryByText(/trying the next model/)).toBeNull(),
    );
    expect(screen.getByRole("article", { name: "Dox" })).toHaveTextContent(
      "To r",
    );
    await stream.end();
  });

  it("names the answering brain in the trace's summary once the Worker has", async () => {
    const stream = openStream();
    render(<DoxChat />);
    ask(QUESTION);
    const named = `data: ${JSON.stringify({
      type: "CUSTOM",
      name: "dox-retrieval",
      value: {
        totalChunks: 210,
        retrievedCount: 2,
        chunkTitles: ["Cleanup › Usage", "Cleanup › Flags"],
        chunkUrls: ["/commands/cleanup/"],
        brainLabel: "GLM 4.7 Flash",
      },
      timestamp: 1,
    })}`;

    await stream.push(RUN_STARTED, TRACE_FRAME, TEXT_START, FIRST_DELTA, named);

    expect(
      await screen.findByRole("button", {
        name: "Searched 210 chunks → 2 matched · GLM 4.7 Flash",
      }),
    ).toBeInTheDocument();
    await stream.end();
  });
});
