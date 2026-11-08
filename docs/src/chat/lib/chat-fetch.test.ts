import { afterEach, vi } from "vitest";
import { ChatHttpError, chatFetch } from "./chat-fetch";

// Expected values: plan #257 D11 -- chatFetch reads the Worker's { error, retryable } body on a non-OK response and
// throws it as the error's `cause`; an OK response passes through untouched; assistant turns with no text are
// dropped from the request body before it leaves. D9 fixes the body shape: { error: string, retryable: boolean }.

const URL_ = "https://w.example/api/chat";

function stubFetch(response: Response | Error) {
  const fetchMock = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentBody(fetchMock: ReturnType<typeof stubFetch>): unknown {
  const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
  return JSON.parse(init.body as string);
}

afterEach(() => vi.unstubAllGlobals());

describe("chatFetch -- responses", () => {
  it("passes an OK response through, with the request's own options", async () => {
    const ok = new Response("data: {}\n\n", { status: 200 });
    const fetchMock = stubFetch(ok);
    const signal = new AbortController().signal;

    const res = await chatFetch(URL_, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [] }),
      signal,
    });

    expect(res).toBe(ok);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(URL_);
    expect(init.method).toBe("POST");
    expect(init.signal).toBe(signal);
  });

  it("throws the Worker's { error, retryable } as the cause of a non-OK response", async () => {
    stubFetch(
      new Response(
        JSON.stringify({ error: "Too many requests.", retryable: true }),
        { status: 429, headers: { "Content-Type": "application/json" } },
      ),
    );

    const failure = await chatFetch(URL_, { method: "POST" }).catch(
      (e: unknown) => e,
    );

    expect(failure).toBeInstanceOf(ChatHttpError);
    expect((failure as ChatHttpError).status).toBe(429);
    expect((failure as ChatHttpError).cause).toEqual({
      error: "Too many requests.",
      retryable: true,
    });
  });

  it.each([
    ["a plain-text body", new Response("Not found", { status: 404 })],
    [
      "JSON that is not the Worker's shape",
      new Response(JSON.stringify({ error: 42 }), { status: 404 }),
    ],
    ["no body", new Response(null, { status: 404 })],
  ])("throws with the status and no cause for %s", async (_name, response) => {
    stubFetch(response);

    const failure = await chatFetch(URL_, { method: "POST" }).catch(
      (e: unknown) => e,
    );

    expect(failure).toBeInstanceOf(ChatHttpError);
    expect((failure as ChatHttpError).status).toBe(404);
    expect((failure as ChatHttpError).cause).toBeUndefined();
  });

  it("lets a network failure through as the browser threw it", async () => {
    const offline = new TypeError("Failed to fetch");
    stubFetch(offline);

    await expect(chatFetch(URL_, { method: "POST" })).rejects.toBe(offline);
  });
});

describe("chatFetch -- the request headers (plan #257 R2)", () => {
  it("sends only Content-Type: the Worker's CORS allows no other request header", async () => {
    // fetchServerSentEvents adds `X-Run-Id` to every POST (ai-client connection-adapters.ts, runIdHeader). It is not a
    // CORS-safelisted header, so the browser would preflight it, and the Worker's Access-Control-Allow-Headers is
    // exactly "Content-Type" (docs/worker/cors.ts): every request would be blocked. Nothing here reads the header.
    const fetchMock = stubFetch(new Response("", { status: 200 }));

    await chatFetch(URL_, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Run-Id": "run-1" },
      body: "{}",
    });

    const init = (
      fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    )[1];
    // Header names are case-insensitive; compare as the browser would see them.
    expect([...new Headers(init.headers)]).toEqual([
      ["content-type", "application/json"],
    ]);
  });
});

describe("chatFetch -- the request body", () => {
  const envelope = {
    threadId: "docs-chat",
    runId: "run-1",
    state: {},
    tools: [],
    context: [],
    forwardedProps: { model: "gemini-3.6-flash" },
  };

  it("drops assistant turns with no text and nothing else", async () => {
    const fetchMock = stubFetch(new Response("", { status: 200 }));
    const messages = [
      { id: "1", role: "user", content: "first" },
      { id: "2", role: "assistant", content: "" },
      { id: "3", role: "user", content: "second" },
      { id: "4", role: "assistant", content: "an answer" },
      { id: "5", role: "user", content: "third" },
    ];

    await chatFetch(URL_, {
      method: "POST",
      body: JSON.stringify({ ...envelope, messages }),
    });

    expect(sentBody(fetchMock)).toEqual({
      ...envelope,
      messages: messages.filter((m) => m.id !== "2"),
    });
  });

  it("drops the assistant turn the library sends with no content key at all", async () => {
    // Observed: after a failed answer `useChat` puts { id, metadata, role: "assistant" } on the wire, with no
    // `content`, which the Worker's validator would refuse as "Message content must be text."
    const fetchMock = stubFetch(new Response("", { status: 200 }));
    const messages = [
      { id: "1", role: "user", content: "first" },
      {
        id: "2",
        role: "assistant",
        metadata: { tanstack: { stopReason: "error" } },
      },
      { id: "3", role: "user", content: "second" },
    ];

    await chatFetch(URL_, {
      method: "POST",
      body: JSON.stringify({ ...envelope, messages }),
    });

    expect(
      (sentBody(fetchMock) as { messages: Array<{ id: string }> }).messages.map(
        (m) => m.id,
      ),
    ).toEqual(["1", "3"]);
  });

  it("leaves a body it does not recognise as it was", async () => {
    const fetchMock = stubFetch(new Response("", { status: 200 }));

    await chatFetch(URL_, { method: "POST", body: "not json" });

    const init = (
      fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    )[1];
    expect(init.body).toBe("not json");
  });
});
