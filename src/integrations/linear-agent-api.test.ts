import { createAgentActivity, getViewerId } from "./linear-agent-api.js";

// Shapes below come from Linear's docs, not from the module:
// - https://linear.app/developers/agent-interaction : `agentActivityCreate`
//   takes `input.agentSessionId` and `input.content` ({ type, body }) for
//   `thought`, `response` and `error`.
// - https://linear.app/developers/graphql : `viewer { id }`, and OAuth tokens
//   go in `Authorization: Bearer <ACCESS_TOKEN>`.
const TOKEN = "oauth-agent-token-0123456789";
const SESSION = "session-abc";

function respond(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(body),
  };
}

function stubFetch(response: unknown) {
  const spy = vi.fn().mockResolvedValue(response);
  vi.stubGlobal("fetch", spy);
  return spy;
}

function sent(spy: ReturnType<typeof vi.fn>) {
  const [, init] = spy.mock.calls[0];
  return { init, payload: JSON.parse(init.body) };
}

async function message(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected a rejection");
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("getViewerId", () => {
  it("sends the token behind Bearer and returns viewer.id", async () => {
    const spy = stubFetch(respond(200, { data: { viewer: { id: "app-1" } } }));

    await expect(getViewerId(TOKEN)).resolves.toBe("app-1");

    const { init, payload } = sent(spy);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(payload.query).toContain("viewer");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("refuses an answer without a viewer id", async () => {
    stubFetch(respond(200, { data: { viewer: {} } }));
    const text = await message(getViewerId(TOKEN));
    expect(text).toContain("Linear");
    expect(text).not.toContain(TOKEN);
  });
});

describe("createAgentActivity", () => {
  it.each([
    "thought",
    "response",
    "error",
  ] as const)("sends a %s as agentActivityCreate with input.agentSessionId and content", async (type) => {
    const spy = stubFetch(
      respond(200, { data: { agentActivityCreate: { success: true } } }),
    );

    await createAgentActivity(TOKEN, SESSION, { type, body: "hello **md**" });

    const { init, payload } = sent(spy);
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(payload.query).toContain("agentActivityCreate");
    expect(payload.variables).toEqual({
      input: {
        agentSessionId: SESSION,
        content: { type, body: "hello **md**" },
      },
    });
  });

  it("fails when success is not true", async () => {
    stubFetch(
      respond(200, { data: { agentActivityCreate: { success: false } } }),
    );
    await expect(
      createAgentActivity(TOKEN, SESSION, { type: "thought", body: "x" }),
    ).rejects.toThrow(/Linear/);
  });

  it("turns a GraphQL errors array into one error without the token", async () => {
    stubFetch(
      respond(200, { errors: [{ message: `bad token ${TOKEN} given` }] }),
    );
    const text = await message(
      createAgentActivity(TOKEN, SESSION, { type: "thought", body: "x" }),
    );
    expect(text).toContain("Linear");
    expect(text).not.toContain(TOKEN);
  });

  it("names Linear and the HTTP status on a non-200, without the token", async () => {
    stubFetch(respond(502, { errors: [{ message: TOKEN }] }));
    const text = await message(
      createAgentActivity(TOKEN, SESSION, { type: "response", body: "x" }),
    );
    expect(text).toContain("Linear");
    expect(text).toContain("502");
    expect(text).not.toContain(TOKEN);
  });

  it("reports a body that stalls past the timeout as a timeout", async () => {
    const stalled = respond(200, null);
    stalled.json.mockRejectedValue(
      new DOMException(`timed out ${TOKEN}`, "TimeoutError"),
    );
    stubFetch(stalled);
    const text = await message(
      createAgentActivity(TOKEN, SESSION, { type: "thought", body: "x" }),
    );
    expect(text).toContain("Linear");
    expect(text).toContain("15s");
    expect(text).not.toContain(TOKEN);
  });

  it("reports an aborted request as a timeout and uses a 15s signal", async () => {
    vi.spyOn(AbortSignal, "timeout");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockRejectedValue(
          new DOMException(`timed out ${TOKEN}`, "TimeoutError"),
        ),
    );
    const text = await message(
      createAgentActivity(TOKEN, SESSION, { type: "error", body: "x" }),
    );
    expect(AbortSignal.timeout).toHaveBeenCalledWith(15_000);
    expect(text).toContain("Linear");
    expect(text).toContain("15s");
    expect(text).not.toContain(TOKEN);
  });

  it("wraps a network failure that echoes the token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error(`socket hang up ${TOKEN}`)),
    );
    const text = await message(
      createAgentActivity(TOKEN, SESSION, { type: "error", body: "x" }),
    );
    expect(text).toContain("Linear");
    expect(text).not.toContain(TOKEN);
  });

  it("refuses a body that is not a JSON object", async () => {
    stubFetch(respond(200, "nope"));
    await expect(
      createAgentActivity(TOKEN, SESSION, { type: "thought", body: "x" }),
    ).rejects.toThrow(/Linear/);
  });
});
