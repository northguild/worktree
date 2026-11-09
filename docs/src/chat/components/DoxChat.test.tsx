import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createRef } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, vi } from "vitest";
import answerStream from "../hooks/fixtures/chat-answer.sse?raw";
import runErrorStream from "../hooks/fixtures/chat-run-error.sse?raw";
import { brainsInfo } from "./brains.fixture";
import { DoxChat, type DoxChatHandle } from "./DoxChat";

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

// Phase 8's control bar (plan #309 §4.1 rows 21-23, D10, and the phase's "Done when"). Expected values: the banner and the
// placeholder are §4.1 row 23's own words ("Dox has used its free allowance for today. Back <time>." / the visitor variant /
// "Dox is resting until the quota resets…"); the reset time is `formatCalendarUtc`'s documented "today at <time>" for a value
// on the reference's day, worked by hand in the reader's zone: with the clock at 2026-06-15T19:00Z (12:00 PM PDT) in Los
// Angeles, the UTC midnight 2026-06-16T00:00Z is 5:00 PM that day. The pool's soonest refill is Workers AI's (00:00Z, seven
// hours before Gemini's), and the later of the two is taken when the reader's own questions are gone too (quota-resets.test.ts).
const LA_NOW_MS = 1_781_550_000_000; // 2026-06-15T19:00:00Z
const ALL_BRAINS = [
  "cf-gemma-4-26b",
  "cf-glm-4.7-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
];
const allOut = Object.fromEntries(ALL_BRAINS.map((id) => [id, 0]));

/** A fetch that answers with `stream` for every call and keeps the body each request sent. */
function capture(stream: string) {
  const bodies: Array<{ forwardedProps?: Record<string, unknown> }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as {
        runId: string;
        forwardedProps?: Record<string, unknown>;
      };
      bodies.push(body);
      return new Response(stream.replaceAll(RUN_ID, body.runId), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }),
  );
  return bodies;
}

const customFrame = (name: string, value: unknown) =>
  `data: ${JSON.stringify({ type: "CUSTOM", name, value, timestamp: 1 })}`;

describe("DoxChat -- the control bar", () => {
  const realZone = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = "America/Los_Angeles";
    // Only the clock is pinned: the streams and effects run on real timers.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(LA_NOW_MS);
  });
  afterEach(() => {
    vi.useRealTimers();
    if (realZone === undefined) delete process.env.TZ;
    else process.env.TZ = realZone;
  });

  it("puts the info button, the reset chip and the brain badge on the left of the bar and Send on the right", async () => {
    render(<DoxChat brains={brainsInfo()} />);
    const chip = await screen.findByRole("button", { name: /reset/ });
    const info = screen.getByRole("button", { name: "About Dox's answers" });
    const badge = screen.getByRole("button", { name: /left/ });
    const send = screen.getByRole("button", { name: "Send message" });
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(info, chip)).toBe(true);
    expect(follows(chip, badge)).toBe(true);
    expect(follows(badge, send)).toBe(true);
  });

  it("shows no chip and no badge without a budget, and the chat still sends", async () => {
    const bodies = capture(answerStream);
    render(<DoxChat brains={null} />);
    expect(screen.queryByRole("button", { name: /left/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /reset/ })).toBeNull();
    ask(QUESTION);
    expect(
      await screen.findByRole("article", { name: "Dox" }),
    ).toBeInTheDocument();
    expect(bodies).toHaveLength(1);
  });

  it("sends no brain id for Automatic", async () => {
    const bodies = capture(answerStream);
    render(<DoxChat brains={brainsInfo()} />);
    ask(QUESTION);
    await screen.findByRole("article", { name: "Dox" });
    expect(bodies[0]?.forwardedProps).not.toHaveProperty("brain");
  });

  it("sends the brain the reader picked, as forwardedProps.brain, and none again after picking Automatic", async () => {
    const bodies = capture(answerStream);
    render(<DoxChat brains={brainsInfo()} />);
    fireEvent.click(screen.getByRole("button", { name: /left/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /^3\.6 Flash/ }));
    ask(QUESTION);
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]?.forwardedProps?.brain).toBe("gemini-3.6-flash");
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Send message" }),
      ).toBeVisible(),
    );
    await screen.findByRole("article", { name: "Dox" });
    await waitFor(() =>
      expect(
        screen.getByRole("textbox", { name: "Message" }),
      ).not.toBeDisabled(),
    );

    fireEvent.click(screen.getByRole("button", { name: /left/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Automatic/ }));
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    // The pick reaches the client in an effect after the commit: let it land before the next question.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    ask("And another?");
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1]?.forwardedProps).not.toHaveProperty("brain");
  });

  it("hands the Worker's counts to the host when they arrive, and asks it to read again after a refusal", async () => {
    const info = brainsInfo({ visitorRemaining: 4 });
    const onUsage = vi.fn();
    const onSpent = vi.fn();
    const usage = customFrame("dox-usage", info);
    capture(
      [RUN_STARTED, usage, ...FRAMES.slice(1)].join("\n\n").concat("\n\n"),
    );
    const { unmount } = render(
      <DoxChat brains={brainsInfo()} onUsage={onUsage} onSpent={onSpent} />,
    );
    ask(QUESTION);
    await waitFor(() => expect(onUsage).toHaveBeenCalledExactlyOnceWith(info));
    expect(onSpent).not.toHaveBeenCalled();
    unmount();

    const refusal = customFrame("dox-refusal", {
      status: 429,
      payload: {
        error: "Dox has used its free allowance for today.",
        retryable: false,
        resetsAt: "2026-06-16T00:00:00Z",
      },
    });
    // The Worker follows a refusal with a RUN_ERROR for older clients: one re-read is enough, not two.
    const runError = `data: ${JSON.stringify({ type: "RUN_ERROR", timestamp: 1, message: "Dox has used its free allowance for today.", code: "allowance_spent" })}`;
    capture([RUN_STARTED, refusal, runError].join("\n\n").concat("\n\n"));
    render(
      <DoxChat brains={brainsInfo()} onUsage={onUsage} onSpent={onSpent} />,
    );
    ask(QUESTION);
    await waitFor(() => expect(onSpent).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onSpent).toHaveBeenCalledTimes(1);
  });

  it("ignores a usage event that is not the Worker's counts", async () => {
    const onUsage = vi.fn();
    capture(
      [RUN_STARTED, customFrame("dox-usage", { hello: 1 }), ...FRAMES.slice(1)]
        .join("\n\n")
        .concat("\n\n"),
    );
    render(<DoxChat brains={brainsInfo()} onUsage={onUsage} />);
    ask(QUESTION);
    await screen.findByRole("article", { name: "Dox" });
    expect(onUsage).not.toHaveBeenCalled();
  });
});

describe("DoxChat -- out of budget", () => {
  const realZone = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = "America/Los_Angeles";
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(LA_NOW_MS);
  });
  afterEach(() => {
    vi.useRealTimers();
    if (realZone === undefined) delete process.env.TZ;
    else process.env.TZ = realZone;
  });

  it("rests when every brain is out: the banner says when, the field is disabled with the resting placeholder", async () => {
    render(<DoxChat brains={brainsInfo({ remaining: allOut })} />);
    const banner = await screen.findByText(/for today/);
    expect(banner).toHaveTextContent(
      "Dox has used its free allowance for today. Back today at 5:00 PM.",
    );
    // An <output>: a polite live region, so the state is announced when it arrives.
    expect(banner.tagName).toBe("OUTPUT");
    const field = screen.getByRole("textbox", { name: "Message" });
    expect(field).toBeDisabled();
    expect(field).toHaveAttribute(
      "placeholder",
      "Dox is resting until the quota resets…",
    );
    expect(
      screen.getByRole("button", { name: "Send message" }),
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("says the reader's own questions are used when only theirs are gone", async () => {
    render(<DoxChat brains={brainsInfo({ visitorRemaining: 0 })} />);
    expect(await screen.findByText(/for today/)).toHaveTextContent(
      "You have used your 5 questions for today. Back today at 5:00 PM.",
    );
    expect(screen.getByRole("textbox", { name: "Message" })).toBeDisabled();
  });

  it("counts a brain marked out as spent: all five spent or unavailable is out of budget", async () => {
    const states = Object.fromEntries(
      ALL_BRAINS.map((id, i) => [id, i % 2 ? "spent" : "unavailable"] as const),
    );
    render(<DoxChat brains={brainsInfo({ remaining: allOut, states })} />);
    expect(await screen.findByText(/for today/)).toHaveTextContent(
      "Dox has used its free allowance for today.",
    );
  });

  it("sends nothing while resting, from the keyboard or an example card", async () => {
    const bodies = capture(answerStream);
    const handle = createRef<DoxChatHandle>();
    render(<DoxChat ref={handle} brains={brainsInfo({ remaining: allOut })} />);
    await screen.findByText(/for today/);
    ask(QUESTION);
    let sent = true;
    act(() => {
      sent = handle.current?.send(QUESTION) ?? true;
    });
    expect(sent).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(bodies).toHaveLength(0);
  });

  it("shows no banner and an enabled field while there is budget", async () => {
    render(<DoxChat brains={brainsInfo()} />);
    await screen.findByRole("button", { name: /reset/ });
    expect(screen.queryByText(/for today/)).toBeNull();
    const field = screen.getByRole("textbox", { name: "Message" });
    expect(field).not.toBeDisabled();
    expect(field).toHaveAttribute("placeholder", PLACEHOLDER);
  });

  it("keeps the banner and the chat when the budget cannot be read: no budget is not an empty budget", () => {
    render(<DoxChat brains={null} />);
    expect(screen.queryByText(/for today/)).toBeNull();
    expect(screen.getByRole("textbox", { name: "Message" })).not.toBeDisabled();
  });
});

describe("DoxChat -- on the server", () => {
  it("renders no time and no control of the build's own, even given the budget: the zone and locale are the reader's", () => {
    const html = renderToString(<DoxChat brains={brainsInfo()} />);
    // The chip and the badge's menu read the zone and locale, so neither is in the server's markup; the badge's counts are
    // not time-based and are shown.
    expect(html).not.toContain("gmt-hive-clock");
    expect(html).not.toContain("resets");
    expect(html).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("renders the banner without its 'Back <time>' until the reader's zone is known", () => {
    const html = renderToString(
      <DoxChat brains={brainsInfo({ remaining: allOut })} />,
    );
    expect(html).toContain("Dox has used its free allowance for today.");
    expect(html).not.toContain("Back ");
  });
});

describe("DoxChat -- a deployment that reports no brains", () => {
  it("is not out of budget: an empty list is nothing to wait for, not a spent pool", () => {
    const info = brainsInfo();
    info.brains = [];
    render(<DoxChat brains={info} />);
    expect(screen.queryByText(/for today/)).toBeNull();
    expect(screen.getByRole("textbox", { name: "Message" })).not.toBeDisabled();
  });
});
