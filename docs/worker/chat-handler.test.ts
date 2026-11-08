// @vitest-environment node
import { inspect } from "node:util";
import type { TextOptions } from "@tanstack/ai";
import { fakeText } from "@tanstack/ai/testing";
import { createGeminiChat } from "@tanstack/ai-gemini";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createChatHandler, mapStreamErrors } from "./chat-handler";
import { getCorsHeaders } from "./cors";

// Expected values come from: the AG-UI event names (docs.ag-ui.com/concepts/
// events: RUN_STARTED, TEXT_MESSAGE_START/CONTENT/END, RUN_FINISHED,
// RUN_ERROR); plan #257 §4.2 (pipeline order, mapping table, status codes) and
// its phase 3 "Done when"; and Google's documented error bodies
// (ai.google.dev/gemini-api/docs/troubleshooting). None comes from the handler.

const PROMPT = "You answer questions about the Worktree docs.";
const GOOGLE_DAILY_429 = JSON.stringify({
  error: {
    code: 429,
    message: "You exceeded your current quota. GOOGLE-QUOTA-SENTENCE",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [
          { quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" },
        ],
      },
    ],
  },
});

let ipCounter = 0;
/** A fresh client address per request: the limiter is shared across tests. */
function nextIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

function chatBody(
  content = "How do I remove a worktree?",
  extra: Record<string, unknown> = {},
) {
  return {
    threadId: "docs-chat",
    runId: "run-1",
    messages: [{ id: "m1", role: "user", content }],
    tools: [],
    context: [],
    forwardedProps: {},
    ...extra,
  };
}

function post(
  body: unknown,
  init: { ip?: string; signal?: AbortSignal; raw?: string } = {},
): Request {
  return new Request("https://worker.example.com/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://northguild.dev",
      "CF-Connecting-IP": init.ip ?? nextIp(),
    },
    body: init.raw ?? JSON.stringify(body),
    signal: init.signal,
  });
}

const CORS = getCorsHeaders("https://northguild.dev");
const ENV = { GEMINI_API_KEY: "test-key" };

type Event = { type: string } & Record<string, unknown>;

async function events(res: Response): Promise<Event[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((frame) => frame.startsWith("data: "))
    .map((frame) => JSON.parse(frame.slice("data: ".length)) as Event);
}

function setup(
  responses: Parameters<ReturnType<typeof fakeText>["setResponses"]>[0],
) {
  const fake = fakeText({ model: "gemini-3.5-flash-lite" });
  fake.setResponses(responses);
  const createAdapter = vi.fn(() => fake);
  const log = vi.fn();
  const handler = createChatHandler({
    createAdapter: createAdapter as never,
    systemPrompt: PROMPT,
    now: () => 1_700_000_000_000,
    log,
  });
  return { handler, createAdapter, log, fake };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createChatHandler — a streamed answer", () => {
  it("arrives as AG-UI events ending in RUN_FINISHED, with CORS", async () => {
    const { handler } = setup([{ text: "Run `worktree remove`." }]);

    const res = await handler(post(chatBody()), ENV, CORS);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://northguild.dev",
    );
    expect(res.headers.get("Access-Control-Expose-Headers")).toBe(
      "Retry-After",
    );
    const types = (await events(res)).map((e) => e.type);
    expect(types[0]).toBe("RUN_STARTED");
    expect(types).toContain("TEXT_MESSAGE_START");
    expect(types).toContain("TEXT_MESSAGE_CONTENT");
    expect(types).toContain("TEXT_MESSAGE_END");
    expect(types.at(-1)).toBe("RUN_FINISHED");
    expect(types).not.toContain("RUN_ERROR");
  });

  it("carries the answer's text in TEXT_MESSAGE_CONTENT deltas", async () => {
    const { handler } = setup([{ text: "Run `worktree remove`." }]);

    const res = await handler(post(chatBody()), ENV, CORS);

    const text = (await events(res))
      .filter((e) => e.type === "TEXT_MESSAGE_CONTENT")
      .map((e) => e.delta)
      .join("");
    expect(text).toBe("Run `worktree remove`.");
  });
});

describe("createChatHandler — what the model receives", () => {
  it("gets the injected prompt, { role, content } pairs and reasoning low", async () => {
    let received: TextOptions | undefined;
    const { handler, createAdapter } = setup([
      ({ request }) => {
        received = request;
        return { text: "ok" };
      },
    ]);
    const body = chatBody("What does clean do?", {
      messages: [
        { id: "a", role: "user", content: "hi", metadata: { x: 1 } },
        { id: "b", role: "assistant", content: "Hello." },
        { id: "c", role: "user", content: "What does clean do?" },
      ],
    });

    const res = await handler(post(body), ENV, CORS);
    await res.text();

    expect(received?.systemPrompts).toEqual([PROMPT]);
    expect(received?.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hello." },
      { role: "user", content: "What does clean do?" },
    ]);
    // chat() normalises the option; "low" alone would arrive as summary: true.
    expect(received?.reasoning).toEqual({ level: "low", summary: false });
    expect(received?.threadId).toBe("docs-chat");
    expect(received?.runId).toBe("run-1");
    // D4: the key is passed explicitly, with the default model's id.
    expect(createAdapter).toHaveBeenCalledWith(
      "gemini-3.5-flash-lite",
      "test-key",
    );
  });

  it("uses the model the request names", async () => {
    const { handler, createAdapter } = setup([{ text: "ok" }]);

    const res = await handler(
      post(chatBody("hi", { forwardedProps: { model: "gemini-3.6-flash" } })),
      ENV,
      CORS,
    );
    await res.text();

    expect(createAdapter).toHaveBeenCalledWith("gemini-3.6-flash", "test-key");
  });
});

describe("createChatHandler — failures before the stream", () => {
  it("429 with Retry-After when the client is limited, before anything else", async () => {
    const { handler, createAdapter } = setup([{ text: "ok" }]);
    const env = { WORKER_RATE_LIMIT_MAX: "1" }; // no key either: the limiter comes first
    const ip = nextIp();

    await handler(
      post(chatBody(), { ip }),
      { ...env, GEMINI_API_KEY: "k" },
      CORS,
    );
    const res = await handler(post(chatBody(), { ip }), env, CORS);

    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(await res.json()).toEqual({
      error: expect.any(String),
      retryable: true,
    });
    expect(createAdapter).toHaveBeenCalledTimes(1);
  });

  it("the limiter is the one the legacy route shares (chat:<clientId>)", async () => {
    const { chatRateLimiter } = await import("./rate-limit");
    const { handler } = setup([{ text: "ok" }]);
    const ip = nextIp();
    const env = { GEMINI_API_KEY: "k", WORKER_RATE_LIMIT_MAX: "1" };
    // Spend the client's allowance through the shared limiter, as `/` would.
    chatRateLimiter.checkRequest(post(chatBody(), { ip }), env);

    const res = await handler(post(chatBody(), { ip }), env, CORS);

    expect(res.status).toBe(429);
  });

  it("500 when the key is missing", async () => {
    const { handler } = setup([{ text: "ok" }]);

    const res = await handler(post(chatBody()), {}, CORS);

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "The assistant is not configured.",
      retryable: false,
    });
  });

  it("400 for a body that is not JSON", async () => {
    const { handler } = setup([{ text: "ok" }]);

    const res = await handler(post(null, { raw: "{nope" }), ENV, CORS);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: expect.any(String),
      retryable: false,
    });
  });

  it("400 with the validator's reason for a bad request", async () => {
    const { handler } = setup([{ text: "ok" }]);

    const res = await handler(
      post(chatBody("x", { tools: [{ name: "evil" }] })),
      ENV,
      CORS,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Tools and context are not accepted.",
      retryable: false,
    });
  });

  it("400 'Conversation is too long. Start a new chat.' over the cap", async () => {
    const { handler, createAdapter } = setup([{ text: "ok" }]);
    const long = "a".repeat(20_000);
    const messages = Array.from({ length: 7 }, (_, i) => ({
      id: `m${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: long,
    })); // 7 x 20,000 = 140,000 > 100,000 (plan §9 Q4)

    const res = await handler(post(chatBody("x", { messages })), ENV, CORS);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "Conversation is too long. Start a new chat.",
      retryable: false,
    });
    expect(createAdapter).not.toHaveBeenCalled();
  });

  it("carries CORS on every pre-stream failure", async () => {
    const { handler } = setup([{ text: "ok" }]);

    const res = await handler(post(chatBody()), {}, CORS);

    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://northguild.dev",
    );
    expect(res.headers.get("Content-Type")).toBe("application/json");
  });
});

describe("createChatHandler — failures inside the stream (D9)", () => {
  it("a Google daily 429 becomes the curated RUN_ERROR; Google's text appears nowhere", async () => {
    const { handler, log } = setup([{ error: GOOGLE_DAILY_429 }]);

    const res = await handler(post(chatBody()), ENV, CORS);
    const raw = await res.clone().text();
    const sent = await events(res);

    expect(res.status).toBe(200);
    const error = sent.find((e) => e.type === "RUN_ERROR");
    expect(error).toMatchObject({
      type: "RUN_ERROR",
      code: "rate_limited_daily",
      message:
        "The assistant has reached its daily limit. Try again tomorrow, or pick the other model.",
    });
    expect(sent.filter((e) => e.type === "RUN_ERROR")).toHaveLength(1);
    expect(raw).not.toContain("GOOGLE-QUOTA-SENTENCE");
    expect(raw).not.toContain("RESOURCE_EXHAUSTED");
    expect(raw).not.toContain("quotaId");
    // Logged once, structured, with no upstream text.
    expect(log).toHaveBeenCalledTimes(1);
    const entry = JSON.stringify(log.mock.calls[0]);
    expect(entry).toContain("rate_limited_daily");
    expect(entry).not.toContain("GOOGLE-QUOTA-SENTENCE");
    expect(entry).not.toContain("test-key");
  });

  it("the curated error is stamped with the injected clock", async () => {
    const { handler } = setup([{ error: GOOGLE_DAILY_429 }]);

    const res = await handler(post(chatBody()), ENV, CORS);
    const error = (await events(res)).find((e) => e.type === "RUN_ERROR");

    expect(error?.timestamp).toBe(1_700_000_000_000);
  });

  it("a real createGeminiChat over a stubbed 429 yields the same curated error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(GOOGLE_DAILY_429, {
            status: 429,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const handler = createChatHandler({
      createAdapter: createGeminiChat as never,
      systemPrompt: PROMPT,
      now: () => 1,
      log: vi.fn(),
    });

    const res = await handler(post(chatBody()), ENV, CORS);
    const raw = await res.clone().text();

    expect(
      (await events(res)).find((e) => e.type === "RUN_ERROR"),
    ).toMatchObject({ code: "rate_limited_daily" });
    expect(raw).not.toContain("GOOGLE-QUOTA-SENTENCE");
  });

  it("does not retry a 429 against the quota (D9: retry stays unset)", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(GOOGLE_DAILY_429, {
          status: 429,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const handler = createChatHandler({
      createAdapter: createGeminiChat as never,
      systemPrompt: PROMPT,
      now: () => 1,
      log: vi.fn(),
    });

    await (await handler(post(chatBody()), ENV, CORS)).text();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("the library's own error logging does not print Google's body", async () => {
    // Only the real Gemini adapter logs (the fake does not), so use it.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(GOOGLE_DAILY_429, {
            status: 429,
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    const printed = [
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "debug").mockImplementation(() => {}),
      // On Node the library prints with console.dir.
      vi.spyOn(console, "dir").mockImplementation(() => {}),
    ];
    const handler = createChatHandler({
      createAdapter: createGeminiChat as never,
      systemPrompt: PROMPT,
      now: () => 1,
    });

    await (await handler(post(chatBody()), ENV, CORS)).text();

    // inspect, not JSON.stringify: an Error has no enumerable message.
    const everything = inspect(
      printed.map((spy) => spy.mock.calls),
      { depth: null },
    );
    expect(everything).toContain("rate_limited_daily"); // our own line is there
    expect(everything).not.toContain("GOOGLE-QUOTA-SENTENCE");
  });
});

describe("mapStreamErrors — an error thrown by the stream itself", () => {
  async function* throwsAfterText(): AsyncGenerator<never> {
    yield { type: "TEXT_MESSAGE_CONTENT", delta: "Par" } as never;
    throw Object.assign(new Error(GOOGLE_DAILY_429), { status: 429 });
  }

  it("is replaced by one curated RUN_ERROR after the text already sent", async () => {
    const log = vi.fn();
    const out: Event[] = [];
    for await (const chunk of mapStreamErrors(throwsAfterText(), {
      threadId: "t",
      runId: "r",
      model: "gemini-3.5-flash-lite",
      now: () => 5,
      log,
    })) {
      out.push(chunk as unknown as Event);
    }

    expect(out.map((e) => e.type)).toEqual([
      "TEXT_MESSAGE_CONTENT",
      "RUN_ERROR",
    ]);
    expect(out[1]).toMatchObject({
      code: "rate_limited_daily",
      timestamp: 5,
    });
    expect(JSON.stringify(out)).not.toContain("GOOGLE-QUOTA-SENTENCE");
    expect(log).toHaveBeenCalledTimes(1);
  });
});

describe("createChatHandler — cancellation", () => {
  it("aborting the request aborts the signal chat() hands the adapter", async () => {
    let signal: AbortSignal | undefined;
    const { handler } = setup([
      ({ request }) => {
        signal =
          (request.request as RequestInit | undefined)?.signal ?? undefined;
        return { text: "ok" };
      },
    ]);
    const client = new AbortController();

    const res = await handler(
      post(chatBody(), { signal: client.signal }),
      ENV,
      CORS,
    );
    await res.text();
    expect(signal).toBeDefined();
    expect(signal?.aborted).toBe(false);
    client.abort();

    expect(signal?.aborted).toBe(true);
  });

  it("a request that is already aborted never reaches the model", async () => {
    const { handler, fake } = setup([{ text: "ok" }]);
    const client = new AbortController();
    client.abort();

    const res = await handler(
      post(chatBody(), { signal: client.signal }),
      ENV,
      CORS,
    );
    await res.text().catch(() => "");

    expect(fake.state.callCount).toBe(0);
  });
});

describe("createChatHandler — the key's placement (D10)", () => {
  it("a real createGeminiChat sends x-goog-api-key and no key= in the URL", async () => {
    const fetchMock = vi.fn(
      async (_url: unknown, _init?: RequestInit) =>
        new Response(GOOGLE_DAILY_429, {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const handler = createChatHandler({
      createAdapter: createGeminiChat as never,
      systemPrompt: PROMPT,
      now: () => 1,
      log: vi.fn(),
    });

    await (await handler(post(chatBody()), ENV, CORS)).text();

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toContain("generativelanguage.googleapis.com");
    expect(String(url)).not.toMatch(/[?&]key=/);
    const headers = new Headers(init?.headers);
    expect(headers.get("x-goog-api-key")).toBe("test-key");
    // D4: "low" is thinkingLevel LOW (Gemini API, thinking docs), and no thought
    // summaries are requested.
    const sent = JSON.parse(String(init?.body)) as {
      generationConfig?: {
        thinkingConfig?: { thinkingLevel?: string; includeThoughts?: boolean };
      };
    };
    expect(sent.generationConfig?.thinkingConfig).toEqual({
      thinkingLevel: "LOW",
      includeThoughts: false,
    });
  });
});
