import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { validateChatRequest } from "../../../worker/validation";
import { ChatProvider, useChatContext } from "../components/ChatContext";
import { messageText, TRANSCRIPT_KEY_PREFIX } from "../lib/chat-history";
import answerStream from "./fixtures/chat-answer.sse?raw";
import runErrorStream from "./fixtures/chat-run-error.sse?raw";
import { useDocsChat } from "./useDocsChat";

// The streams replayed here are real output of the phase-3 handler (`createChatHandler`), not written by this
// client. `chat-answer.sse` is the body `createChatHandler` returned for
// `fakeText` answering "How do I remove a worktree?"; `chat-run-error.sse` is the body it returned when the
// adapter failed with Google's daily-quota 429 (the curated RUN_ERROR of D9). Both were recorded with the request's
// runId set to the placeholder RUN_ID below; the stub puts the real request's runId back, as the Worker does.
//
// Expected values: the recorded answer text (the deltas of the fixture, concatenated); the Worker's error text from
// §4.2/D9; D11 (the request carries forwardedProps.model and no empty assistant turns) and R11 (the body `useChat`
// really sends passes `validateChatRequest`); D12 (the model preference falls back to the default unless it is one
// of D4's ids; the transcript survives a reload; Clear removes it); D16 (Try again is `reload`, Stop keeps the
// partial answer).

const RUN_ID = "RUN-ID";
const ANSWER =
  "To remove a worktree, run `worktree remove <branch>`. See [the branch command](/commands/branch/) for how worktrees are created.";
const DAILY_LIMIT =
  "The assistant has reached its daily limit. Try again tomorrow, or pick the other model.";
const QUESTION = "How do I remove a worktree?";
const DEFAULT_MODEL = "gemini-3.5-flash-lite";

interface Sent {
  url: string;
  body: {
    runId: string;
    threadId: string;
    messages: Array<{ role: string; content: string }>;
    forwardedProps: { model?: string };
  };
}

type Reply = string | { status: number; json: unknown } | Error | "hang";

/** A fetch that answers each call with the next reply, recording what was sent. */
function stubFetch(...replies: Reply[]) {
  const sent: Sent[] = [];
  let call = 0;
  const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string) as Sent["body"];
    sent.push({ url, body });
    const reply = replies[Math.min(call, replies.length - 1)];
    call += 1;
    if (reply instanceof Error) throw reply;
    if (reply === "hang") return partialStream(init.signal);
    if (typeof reply === "string") {
      return new Response(reply.replaceAll(RUN_ID, body.runId), {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    return new Response(JSON.stringify(reply.json), {
      status: reply.status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return sent;
}

/** The first events of the recorded answer, then silence until the request is aborted. */
function partialStream(signal: AbortSignal | null | undefined): Response {
  const frames = answerStream.split("\n\n").filter(Boolean);
  const firstFrames = frames.slice(0, 5); // RUN_STARTED, TEXT_MESSAGE_START, then the deltas "To r", "emov", "e a "
  return new Response(
    new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        for (const frame of firstFrames) {
          controller.enqueue(encoder.encode(`${frame}\n\n`));
        }
        signal?.addEventListener("abort", () =>
          controller.error(new DOMException("Aborted", "AbortError")),
        );
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}
/** The three deltas above, joined. */
const PARTIAL = "To remove a ";

let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  });
});
afterEach(async () => {
  // Unmounting disposes the chat client on a timer, and a disposed client may still save. Let that land in this
  // test's storage, not the next one's.
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 20));
  vi.unstubAllGlobals();
});

function setup(
  model = DEFAULT_MODEL as "gemini-3.5-flash-lite" | "gemini-3.6-flash",
) {
  return renderHook(({ model }) => useDocsChat(model), {
    initialProps: { model },
  });
}

function texts(result: { current: ReturnType<typeof useDocsChat> }) {
  return result.current.messages.map((m) => [m.role, messageText(m)]);
}

describe("useDocsChat -- a streamed answer", () => {
  it("renders the recorded answer under the question", async () => {
    const sent = stubFetch(answerStream);
    const { result } = setup();

    await act(() => result.current.sendMessage(QUESTION));

    await waitFor(() =>
      expect(texts(result)).toEqual([
        ["user", QUESTION],
        ["assistant", ANSWER],
      ]),
    );
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.warning).toBeNull();
    expect(sent[0]?.url).toBe("http://localhost:8787/api/chat");
  });

  it("stamps both messages with a time", async () => {
    stubFetch(answerStream);
    const { result } = setup();

    await act(() => result.current.sendMessage(QUESTION));

    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    for (const message of result.current.messages) {
      expect(message.createdAt).toBeInstanceOf(Date);
    }
  });
});

describe("useDocsChat -- what is sent (R11)", () => {
  it("sends forwardedProps.model, and the body passes validateChatRequest", async () => {
    const sent = stubFetch(answerStream);
    const { result } = setup("gemini-3.6-flash");

    await act(() => result.current.sendMessage(QUESTION));

    const body = sent[0]?.body;
    expect(body?.threadId).toBe("docs-chat");
    expect(body?.forwardedProps).toEqual({ model: "gemini-3.6-flash" });
    expect(validateChatRequest(body)).toEqual({
      ok: true,
      value: {
        messages: [{ role: "user", content: QUESTION }],
        model: "gemini-3.6-flash",
      },
    });
  });

  it("sends the model chosen after the chat was created", async () => {
    const sent = stubFetch(answerStream);
    const { result, rerender } = setup("gemini-3.5-flash-lite");

    rerender({ model: "gemini-3.6-flash" });
    await act(() => result.current.sendMessage(QUESTION));

    expect(sent[0]?.body.forwardedProps.model).toBe("gemini-3.6-flash");
  });

  it("leaves out the empty assistant turn a failed answer left behind", async () => {
    const sent = stubFetch(runErrorStream, answerStream);
    const { result } = setup();

    await act(() => result.current.sendMessage(QUESTION));
    await waitFor(() => expect(result.current.warning).not.toBeNull());
    await act(() => result.current.sendMessage("And with a different model?"));

    const second = sent[1]?.body;
    expect(second?.messages.map((m) => m.role)).toEqual(["user", "user"]);
    expect(
      second?.messages.some((m) => m.role === "assistant" && m.content === ""),
    ).toBe(false);
    expect(validateChatRequest(second).ok).toBe(true);
  });
});

describe("useDocsChat -- failures", () => {
  it("shows the Worker's text for a 429 with a JSON body, and offers a retry", async () => {
    stubFetch({
      status: 429,
      json: { error: "Too many requests. Wait a moment.", retryable: true },
    });
    const { result } = setup();

    await act(() => result.current.sendMessage(QUESTION));

    await waitFor(() =>
      expect(result.current.warning).toEqual({
        message: "Too many requests. Wait a moment.",
        retryable: true,
      }),
    );
    expect(result.current.isStreaming).toBe(false);
    // The library leaves an empty assistant placeholder behind a failed answer (processor.ts, ensureAssistantMessage);
    // the reader sees only the question and the warning, and the next request carries no such turn.
    expect(texts(result)).toEqual([
      ["user", QUESTION],
      ["assistant", ""],
    ]);
  });

  it("shows the curated text of a streamed RUN_ERROR, retryable by its code", async () => {
    stubFetch(runErrorStream);
    const { result } = setup();

    await act(() => result.current.sendMessage(QUESTION));

    await waitFor(() =>
      expect(result.current.warning).toEqual({
        message: DAILY_LIMIT,
        retryable: true, // rate_limited_daily
      }),
    );
  });

  it("says the assistant cannot be reached when the network fails", async () => {
    stubFetch(new TypeError("Failed to fetch"));
    const { result } = setup();

    await act(() => result.current.sendMessage(QUESTION));

    await waitFor(() =>
      expect(result.current.warning).toEqual({
        message:
          "Couldn't reach the assistant. Check your connection and try again.",
        retryable: true,
      }),
    );
  });

  it("Try again re-asks the last question once, replacing the failed answer", async () => {
    const sent = stubFetch(
      { status: 429, json: { error: "Too many.", retryable: true } },
      answerStream,
    );
    const { result } = setup();
    await act(() => result.current.sendMessage(QUESTION));
    await waitFor(() => expect(result.current.warning).not.toBeNull());

    await act(() => result.current.retry());

    await waitFor(() =>
      expect(texts(result)).toEqual([
        ["user", QUESTION],
        ["assistant", ANSWER],
      ]),
    );
    expect(result.current.warning).toBeNull();
    expect(sent).toHaveLength(2);
    expect(sent[1]?.body.messages).toEqual(sent[0]?.body.messages);
  });

  it("clears the warning when a new question is sent", async () => {
    stubFetch(
      { status: 429, json: { error: "Too many.", retryable: true } },
      answerStream,
    );
    const { result } = setup();
    await act(() => result.current.sendMessage(QUESTION));
    await waitFor(() => expect(result.current.warning).not.toBeNull());

    await act(() => result.current.sendMessage("Again?"));

    await waitFor(() => expect(result.current.warning).toBeNull());
  });
});

describe("useDocsChat -- Stop", () => {
  it("keeps the partial answer and leaves no stuck spinner or warning", async () => {
    stubFetch("hang");
    const { result } = setup();

    act(() => {
      void result.current.sendMessage(QUESTION);
    });
    await waitFor(() =>
      expect(texts(result).at(-1)).toEqual(["assistant", PARTIAL]),
    );
    expect(result.current.isStreaming).toBe(true);

    act(() => result.current.stop());

    await waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(texts(result).at(-1)).toEqual(["assistant", PARTIAL]);
    expect(result.current.warning).toBeNull();
    // Let the save of the partial answer land inside this test, not in the next one's storage.
    await waitFor(() =>
      expect(storage.get(`${TRANSCRIPT_KEY_PREFIX}docs-chat`)).toContain(
        PARTIAL,
      ),
    );
  });
});

describe("useDocsChat -- a stalled answer", () => {
  it("stops an answer that goes silent for 30 s, keeps what arrived, and offers a retry (D16)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      stubFetch("hang");
      const { result } = setup();
      act(() => {
        void result.current.sendMessage(QUESTION);
      });
      await waitFor(() =>
        expect(texts(result).at(-1)).toEqual(["assistant", PARTIAL]),
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });

      await waitFor(() => expect(result.current.isStreaming).toBe(false));
      expect(texts(result).at(-1)).toEqual(["assistant", PARTIAL]);
      expect(result.current.warning).toEqual({
        message:
          "The assistant stopped responding. The answer above may be incomplete — try again.",
        retryable: true,
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("useDocsChat -- the transcript", () => {
  it("is restored after a reload, and Clear removes it", async () => {
    stubFetch(answerStream);
    const first = setup();
    await act(() => first.result.current.sendMessage(QUESTION));
    await waitFor(() => expect(first.result.current.messages).toHaveLength(2));
    // Saved on every change, so wait for the write that holds the whole answer.
    await waitFor(() =>
      expect(storage.get(`${TRANSCRIPT_KEY_PREFIX}docs-chat`)).toContain(
        "are created.",
      ),
    );
    first.unmount();

    const second = setup();

    await waitFor(() =>
      expect(texts(second.result)).toEqual([
        ["user", QUESTION],
        ["assistant", ANSWER],
      ]),
    );
    expect(second.result.current.messages[0]?.createdAt).toBeInstanceOf(Date);

    act(() => second.result.current.clear());

    expect(second.result.current.messages).toEqual([]);
    await waitFor(() =>
      expect(storage.has(`${TRANSCRIPT_KEY_PREFIX}docs-chat`)).toBe(false),
    );
  });

  it("starts empty, and removes the stored value, when the stored transcript is invalid", async () => {
    storage.set(
      `${TRANSCRIPT_KEY_PREFIX}docs-chat`,
      JSON.stringify({ messages: [{ id: "x", role: "tool", parts: [] }] }),
    );

    const { result } = setup();

    await waitFor(() =>
      expect(storage.has(`${TRANSCRIPT_KEY_PREFIX}docs-chat`)).toBe(false),
    );
    expect(result.current.messages).toEqual([]);
  });

  it("removes the three per-model transcripts of the retired client on first mount", async () => {
    for (const model of [
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-3-flash-preview",
    ]) {
      storage.set(`docs_chat_history_${model}`, "[]");
    }

    setup();

    await waitFor(() =>
      expect(
        [...storage.keys()].filter((k) => k.startsWith("docs_chat_history_")),
      ).toEqual([]),
    );
  });
});

/**
 * `useLocalStorage` re-reads on a "storage" event it dispatches itself, but jsdom's `StorageEvent` refuses the
 * Map-backed stub as a `storageArea` and the hook swallows that, so the dispatch is repeated here with a plain event.
 * A real browser needs none of this.
 */
function announceStorageChange(key: string) {
  const event = new Event("storage");
  Object.assign(event, { key, storageArea: window.localStorage });
  act(() => {
    window.dispatchEvent(event);
  });
}

describe("the model preference (through ChatProvider)", () => {
  function setupProvider() {
    return renderHook(() => useChatContext(), { wrapper: ChatProvider });
  }

  it("falls back to the default when the stored model is one the retired client offered", async () => {
    storage.set("docs_chat_model", JSON.stringify("gemini-2.5-flash"));
    const sent = stubFetch(answerStream);
    const { result } = setupProvider();

    expect(result.current.model).toBe("gemini-3.5-flash-lite");
    await act(() => result.current.sendMessage(QUESTION));

    expect(sent[0]?.body.forwardedProps.model).toBe("gemini-3.5-flash-lite");
  });

  it("falls back to the default when the stored value is not a model id at all", () => {
    storage.set("docs_chat_model", JSON.stringify({ model: 3 }));

    expect(setupProvider().result.current.model).toBe("gemini-3.5-flash-lite");
  });

  it("keeps a stored model that is one of the two on offer, and sends it", async () => {
    storage.set("docs_chat_model", JSON.stringify("gemini-3.6-flash"));
    const sent = stubFetch(answerStream);
    const { result } = setupProvider();

    expect(result.current.model).toBe("gemini-3.6-flash");
    await act(() => result.current.sendMessage(QUESTION));

    expect(sent[0]?.body.forwardedProps.model).toBe("gemini-3.6-flash");
  });

  it("switching model keeps the transcript and the next request uses the new model", async () => {
    const sent = stubFetch(answerStream, answerStream);
    const { result } = setupProvider();
    await act(() => result.current.sendMessage(QUESTION));
    await waitFor(() => expect(result.current.messages).toHaveLength(2));

    act(() => result.current.setModel("gemini-3.6-flash"));
    announceStorageChange("docs_chat_model");
    await act(() => result.current.sendMessage("And again?"));

    expect(result.current.messages.length).toBeGreaterThanOrEqual(4);
    expect(sent[1]?.body.forwardedProps.model).toBe("gemini-3.6-flash");
    expect(sent[1]?.body.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
    ]);
    expect(storage.get("docs_chat_model")).toBe(
      JSON.stringify("gemini-3.6-flash"),
    );
  });
});

describe("useDocsChat -- submit, the guarded send (D8)", () => {
  it("refuses a blank message, keeps it out of the request and says why", () => {
    const sent = stubFetch(answerStream);
    const { result } = setup();

    let accepted = true;
    act(() => {
      accepted = result.current.submit("  \n ");
    });

    expect(accepted).toBe(false);
    expect(result.current.warning).toEqual({
      message: "Message is empty.",
      retryable: false,
    });
    expect(sent).toHaveLength(0);
  });

  it("refuses a message over the 20,000-character cap, counting what the reader typed", () => {
    const sent = stubFetch(answerStream);
    const { result } = setup();

    let accepted = true;
    act(() => {
      accepted = result.current.submit("x".repeat(20_001));
    });

    expect(accepted).toBe(false);
    expect(result.current.warning).toEqual({
      message: "Message is too long — 20,001 characters, limit 20,000.",
      retryable: false,
    });
    expect(sent).toHaveLength(0);
  });

  it("sends the sanitised text and clears an earlier warning", async () => {
    const sent = stubFetch(answerStream);
    const { result } = setup();
    act(() => {
      result.current.submit("");
    });
    expect(result.current.warning).not.toBeNull();

    let accepted = false;
    act(() => {
      // A zero-width space (U+200B) is stripped by D8; the rest is the question.
      accepted = result.current.submit(
        `${QUESTION.slice(0, 3)}​${QUESTION.slice(3)}`,
      );
    });

    expect(accepted).toBe(true);
    expect(result.current.warning).toBeNull();
    await waitFor(() =>
      expect(texts(result)).toEqual([
        ["user", QUESTION],
        ["assistant", ANSWER],
      ]),
    );
    expect(sent[0]?.body.messages.at(-1)?.content).toBe(QUESTION);
  });
});
