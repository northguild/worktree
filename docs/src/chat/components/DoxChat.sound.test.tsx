import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import answerStream from "../hooks/fixtures/chat-answer.sse?raw";
import runErrorStream from "../hooks/fixtures/chat-run-error.sse?raw";
import { DoxChat } from "./DoxChat";

// Expected values: plan #352 D13 and Phase 8 "Done when". `cue` and `loop` are spies, since the audio is the engine's
// (voices.test.ts holds what each voice does); the chat is the real `useDocsChat` over a stubbed `fetch`, replaying the
// recorded Worker streams that DoxChat.test.tsx uses. Each assertion is a line of the "Done when": one send per sent
// message; thinking from send until the first chunk, and also on stop and on error; one stream per chunk; done on a
// completed answer and never on a stopped one; error on a failed answer; loading once per "Try again"; key on a
// printable key and Backspace, not on Enter, a Ctrl chord, a repeat, composition or a password field.

const sound = vi.hoisted(() => ({
  cue: vi.fn(),
  loop: vi.fn(),
  stopThinking: vi.fn(),
}));
vi.mock("../../lib/sound/cue", () => ({
  cue: (name: string) => sound.cue(name),
  loop: (name: string) => {
    sound.loop(name);
    return sound.stopThinking;
  },
}));

const RUN_ID = "RUN-ID";
const QUESTION = "How do I remove a worktree?";
const FRAMES = answerStream.split("\n\n").filter(Boolean);
/** RUN_STARTED, then TEXT_MESSAGE_START, then the recorded answer's first two deltas. */
const [RUN_STARTED, TEXT_START, FIRST_DELTA, SECOND_DELTA] = FRAMES;

const cues = (name: string) =>
  sound.cue.mock.calls.filter(([n]) => n === name).length;

beforeEach(() => {
  vi.stubGlobal("localStorage", {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
  Element.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "animate", {
    configurable: true,
    writable: true,
    value: vi.fn(() => ({ cancel: vi.fn(), currentTime: 0 })),
  });
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  sound.cue.mockClear();
  sound.loop.mockClear();
  sound.stopThinking.mockClear();
});

afterEach(async () => {
  cleanup();
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
    push: (...frames: string[]) =>
      act(async () => {
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());
        for (const frame of frames)
          controller.enqueue(
            encoder.encode(`${frame.replaceAll(RUN_ID, runId)}\n\n`),
          );
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

const box = () => screen.getByRole("textbox", { name: "Message" });

function ask(text = QUESTION) {
  fireEvent.change(box(), { target: { value: text } });
  fireEvent.keyDown(box(), { key: "Enter" });
}

describe("the chat's sound: a question and its answer", () => {
  it("plays one send and starts the thinking loop once when a question is sent", async () => {
    const stream = openStream();
    render(<DoxChat />);
    ask();
    await stream.push(RUN_STARTED);
    expect(cues("send")).toBe(1);
    expect(sound.loop.mock.calls).toEqual([["thinking"]]);
    expect(sound.stopThinking).not.toHaveBeenCalled();
    await stream.end();
  });

  it("plays no send when nothing is sent (Enter on an empty box, or while answering)", async () => {
    const stream = openStream();
    render(<DoxChat />);
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(cues("send")).toBe(0);
    ask();
    await stream.push(RUN_STARTED);
    fireEvent.change(box(), { target: { value: "a second question" } });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(cues("send")).toBe(1);
    await stream.end();
  });

  it("keeps thinking through an empty message and stops it at the first streamed text, with one stream per chunk", async () => {
    const stream = openStream();
    render(<DoxChat />);
    ask();
    await stream.push(RUN_STARTED, TEXT_START);
    expect(sound.stopThinking).not.toHaveBeenCalled();
    expect(cues("stream")).toBe(0);

    await stream.push(FIRST_DELTA);
    await waitFor(() => expect(sound.stopThinking).toHaveBeenCalledTimes(1));
    expect(cues("stream")).toBe(1);

    await stream.push(SECOND_DELTA);
    await waitFor(() => expect(cues("stream")).toBe(2));
    expect(sound.stopThinking).toHaveBeenCalledTimes(1);
    expect(cues("done")).toBe(0);
    await stream.end();
  });

  it("rings done once after an answer that ran to its end, and nothing else", async () => {
    whole(answerStream);
    render(<DoxChat />);
    ask();
    await waitFor(() => expect(cues("done")).toBe(1));
    expect(cues("error")).toBe(0);
    expect(cues("loading")).toBe(0);
    expect(sound.stopThinking).toHaveBeenCalledTimes(1);
  });

  it("stops thinking and rings no done when the reader presses Stop before the first text", async () => {
    const stream = openStream();
    render(<DoxChat />);
    ask();
    await stream.push(RUN_STARTED);
    fireEvent.click(await screen.findByRole("button", { name: "Stop answer" }));
    await waitFor(() => expect(sound.stopThinking).toHaveBeenCalledTimes(1));
    await stream.end();
    expect(cues("done")).toBe(0);
    expect(cues("error")).toBe(0);
  });

  it("rings no done when the reader presses Stop mid-answer", async () => {
    const stream = openStream();
    render(<DoxChat />);
    ask();
    await stream.push(RUN_STARTED, TEXT_START, FIRST_DELTA);
    await waitFor(() => expect(cues("stream")).toBe(1));
    fireEvent.click(await screen.findByRole("button", { name: "Stop answer" }));
    await stream.end();
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: "Stop answer" }),
      ).not.toBeInTheDocument(),
    );
    expect(cues("done")).toBe(0);
  });

  it("buzzes once on a failed answer, stops thinking and rings no done", async () => {
    whole(runErrorStream);
    render(<DoxChat />);
    ask();
    await screen.findByText(/reached its daily limit/);
    expect(cues("error")).toBe(1);
    expect(sound.stopThinking).toHaveBeenCalledTimes(1);
    expect(cues("done")).toBe(0);
  });

  it("plays loading once per Try again, and the retry's own send is not a second send", async () => {
    whole(runErrorStream);
    render(<DoxChat />);
    ask();
    const tryAgain = await screen.findByRole("button", { name: "Try again" });
    expect(cues("loading")).toBe(0);

    whole(answerStream);
    fireEvent.click(tryAgain);
    await waitFor(() => expect(cues("done")).toBe(1));
    expect(cues("loading")).toBe(1);
    expect(cues("send")).toBe(1);
  });

  it("stops the thinking loop when the chat unmounts while Dox is still thinking", async () => {
    const stream = openStream();
    render(<DoxChat />);
    ask();
    await stream.push(RUN_STARTED);
    cleanup();
    expect(sound.stopThinking).toHaveBeenCalledTimes(1);
  });
});

describe("the chat's sound: typing in the composer", () => {
  const press = (init: KeyboardEventInit, target: Element = box()) =>
    fireEvent.keyDown(target, init);

  it("blips on a printable key and on Backspace", () => {
    render(<DoxChat />);
    press({ key: "a" });
    press({ key: "?" });
    press({ key: "Backspace" });
    expect(cues("key")).toBe(3);
  });

  it("is silent on Enter, which sends", () => {
    render(<DoxChat />);
    press({ key: "Enter" });
    expect(cues("key")).toBe(0);
  });

  it("is silent on a Ctrl or Meta chord, a held key and a key during composition", () => {
    render(<DoxChat />);
    press({ key: "a", ctrlKey: true });
    press({ key: "a", metaKey: true });
    press({ key: "a", repeat: true });
    press({ key: "a", isComposing: true });
    expect(cues("key")).toBe(0);
  });

  it("is silent in a password field", () => {
    render(
      <>
        <DoxChat />
        <input type="password" aria-label="Secret" />
      </>,
    );
    press({ key: "a" }, screen.getByLabelText("Secret"));
    expect(cues("key")).toBe(0);
    press({ key: "a" });
    expect(cues("key")).toBe(1);
  });

  it("is silent in a text field outside the composer, such as the site's search box", () => {
    render(
      <>
        <DoxChat />
        <input type="text" aria-label="Search" />
      </>,
    );
    press({ key: "a" }, screen.getByLabelText("Search"));
    expect(cues("key")).toBe(0);
    press({ key: "a" });
    expect(cues("key")).toBe(1);
  });

  it("stops listening when the chat unmounts", () => {
    render(<DoxChat />);
    cleanup();
    const field = document.body.appendChild(document.createElement("textarea"));
    fireEvent.keyDown(field, { key: "a" });
    expect(cues("key")).toBe(0);
  });
});
