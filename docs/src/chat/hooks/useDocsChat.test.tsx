import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fakeText } from "@tanstack/ai/testing";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { buildCorpus } from "../../../worker/build-context.mjs";
import {
  createChatHandler,
  type RetrievalCorpus,
} from "../../../worker/chat-handler";
import { validateChatRequest } from "../../../worker/validation";
import { messageText, TRANSCRIPT_KEY_PREFIX } from "../lib/chat-history";
import { RETRIEVAL_TRACE_EVENT } from "../lib/chat-types";
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
          "Dox stopped responding. The answer above may be incomplete — try asking again.",
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

// ---------------------------------------------------------------------------------------------------------------------
// Plan #309 Phase 5: the retrieval trace travels as AG-UI `CUSTOM` events (D3) and the request carries the page the
// reader came from. Expected values: the AG-UI `CUSTOM` event shape (`{ type, name, value }`, docs.ag-ui.com/concepts/
// events); `useChat`'s `onCustomEvent(name, value, { toolCallId })`, which the installed @tanstack/ai 1.2.0's stream
// processor calls for every custom event it does not handle itself, with `toolCallId` read from `value.toolCallId` and
// undefined without one; the trace's own shape from `chat-types.ts`; and §4.1 row 12.
// ---------------------------------------------------------------------------------------------------------------------

const TRACE = {
  totalChunks: 210,
  retrievedCount: 2,
  chunkTitles: ["Cleanup › Usage", "Cleanup › Flags"],
  chunkUrls: ["/commands/cleanup/"],
  timings: { corpus: 0, search: 4, prompt: 1 },
};

/** The recorded answer with a trace frame after RUN_STARTED and, if given, another before RUN_FINISHED. */
function withTrace(
  first: unknown,
  last?: unknown,
  name = RETRIEVAL_TRACE_EVENT,
) {
  const frames = answerStream.split("\n\n").filter(Boolean);
  const custom = (value: unknown) =>
    `data: ${JSON.stringify({ type: "CUSTOM", name, value, timestamp: 1 })}`;
  const finished = frames.length - 1;
  const joined = [
    frames[0],
    custom(first),
    ...frames.slice(1, finished),
    ...(last === undefined ? [] : [custom(last)]),
    frames[finished],
  ].join("\n\n");
  return `${joined}\n\n`;
}

describe("useDocsChat -- the retrieval trace", () => {
  it("holds the trace the Worker wrote for the first question, under 1", async () => {
    stubFetch(withTrace(TRACE));
    const { result } = setup();

    await act(() => result.current.sendMessage(QUESTION));

    await waitFor(() => expect(result.current.traces[1]).toEqual(TRACE));
    expect(result.current.traces[2]).toBeUndefined();
  });

  it("keeps the later write of the same answer: the second trace replaces the first", async () => {
    const finished = {
      ...TRACE,
      timings: {
        corpus: 0,
        search: 4,
        prompt: 1,
        firstToken: 900,
        total: 1500,
      },
    };
    stubFetch(withTrace(TRACE, finished));
    const { result } = setup();

    await act(() => result.current.sendMessage(QUESTION));

    await waitFor(() => expect(result.current.traces[1]).toEqual(finished));
  });

  it("files each answer's trace under its own question", async () => {
    const second = {
      ...TRACE,
      retrievedCount: 0,
      chunkTitles: [],
      chunkUrls: [],
    };
    stubFetch(withTrace(TRACE), withTrace(second));
    const { result } = setup();

    await act(() => result.current.sendMessage(QUESTION));
    await waitFor(() => expect(result.current.traces[1]).toEqual(TRACE));
    await act(() => result.current.sendMessage("And for env files?"));

    await waitFor(() => expect(result.current.traces[2]).toEqual(second));
    expect(result.current.traces[1]).toEqual(TRACE);
  });

  it("files the trace of a retried answer under the same question, replacing it", async () => {
    const retried = {
      ...TRACE,
      retrievedCount: 1,
      chunkTitles: ["Cleanup › Usage"],
    };
    stubFetch(withTrace(TRACE), withTrace(retried));
    const { result } = setup();

    await act(() => result.current.sendMessage(QUESTION));
    await waitFor(() => expect(result.current.traces[1]).toEqual(TRACE));
    await act(() => result.current.retry());

    await waitFor(() => expect(result.current.traces[1]).toEqual(retried));
    expect(result.current.traces[2]).toBeUndefined();
  });

  it("forgets the traces when the chat is cleared", async () => {
    stubFetch(withTrace(TRACE));
    const { result } = setup();
    await act(() => result.current.sendMessage(QUESTION));
    await waitFor(() => expect(result.current.traces[1]).toEqual(TRACE));

    act(() => result.current.clear());

    expect(result.current.traces).toEqual({});
  });

  it.each([
    [
      "an event of another name",
      () => withTrace(TRACE, undefined, "dox-other"),
    ],
    ["a value that is not a trace", () => withTrace({ totalChunks: "many" })],
    ["a value that is null", () => withTrace(null)],
  ])("ignores %s, and the answer still arrives", async (_why, stream) => {
    stubFetch(stream());
    const { result } = setup();

    await act(() => result.current.sendMessage(QUESTION));

    await waitFor(() =>
      expect(texts(result)[1]).toEqual(["assistant", ANSWER]),
    );
    expect(result.current.traces).toEqual({});
  });

  it("keeps the answer's text out of the trace: the trace is not a message", async () => {
    stubFetch(withTrace(TRACE));
    const { result } = setup();

    await act(() => result.current.sendMessage(QUESTION));

    await waitFor(() => expect(result.current.traces[1]).toEqual(TRACE));
    expect(texts(result)).toEqual([
      ["user", QUESTION],
      ["assistant", ANSWER],
    ]);
  });
});

// Plan #309 R4 / §9 Q12, proven against the installed code: the Worker's real handler, wrapped as it is deployed,
// answers a real `useChat` over `fetchServerSentEvents`, and the trace its wrapper yields reaches `onCustomEvent`.
describe("useDocsChat -- R4: the Worker's own CUSTOM events reach onCustomEvent", () => {
  // Vitest runs from `docs/`.
  const REPO = join(process.cwd(), "..");
  const BUILT = buildCorpus(
    join(REPO, "docs/src/content/docs"),
    readFileSync(join(REPO, "skills/worktree/SKILL.md"), "utf8"),
  );
  const CORPUS: RetrievalCorpus = {
    chunks: BUILT.chunks,
    searchIndexJson: BUILT.indexJson,
    vocabulary: BUILT.vocabulary,
  };

  it("delivers both writes of the trace from the handler's stream, with the question's retrieval in them", async () => {
    const fake = fakeText({ model: "gemini-3.5-flash-lite" });
    fake.setResponses([{ text: "Run `worktree cleanup`." }]);
    const handler = createChatHandler({
      createAdapter: (() => fake) as never,
      corpus: CORPUS,
      now: () => 1_700_000_000_000,
      log: vi.fn(),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) =>
        handler(
          new Request(url, {
            ...init,
            headers: { ...init.headers, "CF-Connecting-IP": "198.51.100.7" },
          }),
          { GEMINI_API_KEY: "k" },
          {},
        ),
      ),
    );
    const { result } = setup();

    await act(() =>
      result.current.sendMessage(
        "How do I clean up worktrees whose branches are merged?",
      ),
    );

    await waitFor(() =>
      expect(result.current.traces[1]?.timings?.total).toBeDefined(),
    );
    const trace = result.current.traces[1];
    expect(trace?.totalChunks).toBe(BUILT.chunks.length);
    expect(trace?.chunkUrls).toContain("/commands/cleanup/");
    expect(trace?.retrievedCount).toBe(trace?.chunkTitles.length);
    await waitFor(() =>
      expect(texts(result)[1]).toEqual([
        "assistant",
        "Run `worktree cleanup`.",
      ]),
    );
  });
});

describe("useDocsChat -- the page the reader came from (D3)", () => {
  function referrer(url: string) {
    Object.defineProperty(document, "referrer", {
      configurable: true,
      value: url,
    });
  }
  afterEach(() => {
    vi.unstubAllEnvs();
    Reflect.deleteProperty(document, "referrer");
  });

  it("sends the referrer's route as forwardedProps.pageContext, and the body passes validateChatRequest", async () => {
    vi.stubEnv("BASE_URL", "/worktree/");
    referrer(`${window.location.origin}/worktree/commands/branch/`);
    const sent = stubFetch(answerStream);
    const { result } = setup();

    await act(() => result.current.sendMessage(QUESTION));

    expect(sent[0]?.body.forwardedProps).toEqual({
      model: DEFAULT_MODEL,
      pageContext: "/commands/branch/",
    });
    const checked = validateChatRequest(sent[0]?.body);
    expect(checked.ok && checked.value.pageContext).toBe("/commands/branch/");
  });

  it("sends none when the reader did not come from a docs page", async () => {
    vi.stubEnv("BASE_URL", "/worktree/");
    referrer("https://example.com/worktree/commands/branch/");
    const sent = stubFetch(answerStream);
    const { result } = setup();

    await act(() => result.current.sendMessage(QUESTION));

    expect(sent[0]?.body.forwardedProps).toEqual({ model: DEFAULT_MODEL });
  });
});
