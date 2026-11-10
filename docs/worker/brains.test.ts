// @vitest-environment node
import { convertUnixToUtc, convertUtcToUnix } from "@northguild/gmt";
import { chat, EventType, type StreamChunk } from "@tanstack/ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BRAINS, type Brain } from "../src/chat/lib/chat-constants";
import {
  type AiBinding,
  brainChatOptions,
  classifyFailure,
  configuredBrains,
  createWorkersAIAdapter,
  nextMidnightMs,
  orderCandidates,
  soonestReset,
  stringVars,
  type WalkEnd,
  type WalkStep,
  walkBrains,
  withoutRetries,
} from "./brains";
import { BRAINS_TIMED_OUT_CODE } from "./error-mapping";

// Expected values come from: plan #309 D9 (the list, its order, the settings, the timeouts, which failures retire a
// brain); the HTTP status codes' meanings (RFC 9110); Cloudflare's Workers AI error codes as gmt's `brains.ts` records
// them (3036 allocation, 3040 "no more data centers", 4006 undocumented allocation, 5018/3041 model not allowed); the
// IANA time zone rules for the midnights (the US clock changes of 2026-03-08 and 2026-11-01), worked by hand below. None
// is read from the code under test.

/** An ISO instant as milliseconds. */
function unix(iso: string): number {
  const ms = convertUtcToUnix(iso);
  if (ms === null) throw new Error(`not an instant: ${iso}`);
  return ms;
}

const [GEMMA, GLM, FLASH_LITE, FLASH_36, FLASH_35] = BRAINS as unknown as [
  Brain,
  Brain,
  Brain,
  Brain,
  Brain,
];

describe("which brains a deployment offers (D9: configured brains only)", () => {
  const ids = (env: Parameters<typeof configuredBrains>[0]) =>
    configuredBrains(env).map((brain) => brain.id);
  const AI: AiBinding = { run: vi.fn() };

  it("lists the five in D9's order, written out", () => {
    expect(BRAINS.map((brain) => brain.id)).toEqual([
      "cf-gemma-4-26b",
      "cf-glm-4.7-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
    ]);
    expect(BRAINS.map((brain) => (brain as Brain).model)).toEqual([
      "@cf/google/gemma-4-26b-a4b-it",
      "@cf/zai-org/glm-4.7-flash",
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("offers all five with the key and the binding", () => {
    expect(ids({ GEMINI_API_KEY: "k", AI })).toHaveLength(5);
  });

  it("offers Gemini only with no AI binding", () => {
    expect(ids({ GEMINI_API_KEY: "k" })).toEqual([
      "gemini-3.5-flash-lite",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
    ]);
  });

  it("offers Workers AI only with no key", () => {
    expect(ids({ AI })).toEqual(["cf-gemma-4-26b", "cf-glm-4.7-flash"]);
  });

  it("offers nothing with neither", () => {
    expect(ids({})).toEqual([]);
    // An empty key is no key.
    expect(ids({ GEMINI_API_KEY: "" })).toEqual([]);
  });

  it("hands the rate limiter and the legacy route string variables only", () => {
    expect(
      stringVars({ GEMINI_API_KEY: "k", WORKER_RATE_LIMIT_MAX: "3", AI }),
    ).toEqual({ GEMINI_API_KEY: "k", WORKER_RATE_LIMIT_MAX: "3" });
  });
});

describe("orderCandidates", () => {
  it("is the registry order with no pick", () => {
    expect(orderCandidates(BRAINS).map((b) => b.id)).toEqual(
      BRAINS.map((b) => b.id),
    );
  });

  it("puts the reader's pick first and keeps the rest in order", () => {
    expect(
      orderCandidates(BRAINS, "gemini-3.6-flash").map((b) => b.id),
    ).toEqual([
      "gemini-3.6-flash",
      "cf-gemma-4-26b",
      "cf-glm-4.7-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.5-flash",
    ]);
  });

  it("ignores a pick the deployment cannot reach", () => {
    const geminiOnly = [FLASH_LITE, FLASH_36, FLASH_35];
    expect(orderCandidates(geminiOnly, "cf-gemma-4-26b")).toEqual(geminiOnly);
  });
});

describe("what chat() is given for a brain (D9: thinking off, 2048 tokens)", () => {
  it("Workers AI: max_tokens and chat_template_kwargs.enable_thinking in modelOptions, and no reasoning", () => {
    for (const brain of [GEMMA, GLM]) {
      expect(brainChatOptions(brain)).toEqual({
        modelOptions: {
          max_tokens: 2048,
          chat_template_kwargs: { enable_thinking: false },
        },
      });
    }
  });

  it("Gemini: reasoning low with no summary (#257 D4), and no modelOptions", () => {
    for (const brain of [FLASH_LITE, FLASH_36, FLASH_35]) {
      expect(brainChatOptions(brain)).toEqual({
        reasoning: { level: "low", summary: false },
      });
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Plan §9 Q13, against the installed adapter: what does `createCloudflareText` send to `env.AI.run`?
// ---------------------------------------------------------------------------------------------------------------------

function sse(...events: unknown[]): Response {
  const body = `${events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("")}data: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const ANSWER = () =>
  sse(
    {
      id: "c1",
      object: "chat.completion.chunk",
      model: "m",
      choices: [{ index: 0, delta: { content: "Hi" }, finish_reason: null }],
    },
    {
      id: "c1",
      object: "chat.completion.chunk",
      model: "m",
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    },
  );

function recordingBinding(respond: () => Response = ANSWER) {
  const calls: Array<{
    model: string;
    inputs: Record<string, unknown>;
    options: Record<string, unknown> | undefined;
  }> = [];
  const binding: AiBinding = {
    async run(model, inputs, options) {
      calls.push({ model, inputs, options });
      return respond();
    },
  };
  return { binding, calls };
}

async function drain(stream: AsyncIterable<StreamChunk>) {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

const MESSAGES = [
  { role: "user" as const, content: "How do I remove a worktree?" },
];

describe("the installed Cloudflare adapter and Workers AI's settings (plan §9 Q13, R3)", () => {
  it("sends max_tokens, enable_thinking false and the model id when chat() is given modelOptions", async () => {
    const { binding, calls } = recordingBinding();

    await drain(
      chat({
        adapter: createWorkersAIAdapter(GEMMA, binding),
        messages: MESSAGES,
        ...brainChatOptions(GEMMA),
        threadId: "t",
        runId: "r",
        debug: false,
      }),
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.model).toBe("@cf/google/gemma-4-26b-a4b-it");
    expect(calls[0]?.inputs.max_tokens).toBe(2048);
    expect(calls[0]?.inputs.chat_template_kwargs).toEqual({
      enable_thinking: false,
    });
    // `reasoning_effort: null` is what the adapter sends for reasoning "off", and gmt measured it not to turn thinking
    // off. Workers AI brains are given no `reasoning`, so none is sent.
    expect("reasoning_effort" in (calls[0]?.inputs ?? {})).toBe(false);
  });

  // `chat()` has no `maxTokens` option at all (its types refuse one), and the adapter's own comment says `modelOptions` is
  // "the sole sampling surface", so `modelOptions` is the only way to set either value.
  it("sends neither on its own: the adapter does not set them (R3 applies)", async () => {
    const { binding, calls } = recordingBinding();

    await drain(
      chat({
        adapter: createWorkersAIAdapter(GLM, binding),
        messages: MESSAGES,
        threadId: "t",
        runId: "r",
        debug: false,
      }),
    );

    expect(calls[0]?.inputs).not.toHaveProperty("max_tokens");
    expect(calls[0]?.inputs).not.toHaveProperty("chat_template_kwargs");
  });

  it("a Workers AI answer's RUN_FINISHED carries the request's run id, as its RUN_STARTED does", async () => {
    const { binding } = recordingBinding();
    const generator = walkBrains({
      candidates: [GEMMA],
      runId: "request-run",
      open: (brain, abortController) =>
        chat({
          adapter: createWorkersAIAdapter(brain, binding),
          messages: MESSAGES,
          ...brainChatOptions(brain),
          threadId: "t",
          runId: "request-run",
          abortController,
          debug: false,
        }),
    });
    let next = await generator.next();
    while (!next.done) next = await generator.next();
    if (next.value.kind !== "answered") throw new Error("not answered");

    const out = await drain(next.value.stream);

    const finished = out.find((c) => c.type === EventType.RUN_FINISHED) as
      | { runId?: string }
      | undefined;
    expect(finished?.runId).toBe("request-run");
  });

  it("makes one run for a failed call: the adapter's own retries are off", async () => {
    const { binding, calls } = recordingBinding(
      () =>
        new Response(
          JSON.stringify({
            errors: [{ code: 3040, message: "no more data centers" }],
          }),
          { status: 429, headers: { "content-type": "application/json" } },
        ),
    );

    await drain(
      chat({
        adapter: createWorkersAIAdapter(GEMMA, binding),
        messages: MESSAGES,
        ...brainChatOptions(GEMMA),
        threadId: "t",
        runId: "r",
        debug: false,
      }),
    );

    expect(calls).toHaveLength(1);
  });

  it("surfaces Cloudflare's 3036 as a RUN_ERROR the walk reads as the whole pool gone", async () => {
    const { binding } = recordingBinding(
      () =>
        new Response(
          JSON.stringify({
            errors: [
              {
                code: 3036,
                message:
                  "you have used up your daily free allocation of 10,000 neurons",
              },
            ],
          }),
          { status: 429, headers: { "content-type": "application/json" } },
        ),
    );

    const chunks = await drain(
      chat({
        adapter: createWorkersAIAdapter(GEMMA, binding),
        messages: MESSAGES,
        ...brainChatOptions(GEMMA),
        threadId: "t",
        runId: "r",
        debug: false,
      }),
    );
    const error = chunks.find((c) => c.type === EventType.RUN_ERROR);

    expect(error).toBeDefined();
    expect(
      classifyFailure("workers-ai", {
        message: (error as { message?: string }).message,
        code: (error as { code?: string }).code,
      }),
    ).toEqual({ verdict: "spent", allocationExhausted: true });
  });

  it("surfaces Cloudflare's 3040 as busy, not spent: the pool is not gone", async () => {
    const { binding } = recordingBinding(
      () =>
        new Response(
          JSON.stringify({
            errors: [
              {
                code: 3040,
                message: "no more data centers to forward the request to",
              },
            ],
          }),
          { status: 429, headers: { "content-type": "application/json" } },
        ),
    );

    const chunks = await drain(
      chat({
        adapter: createWorkersAIAdapter(GEMMA, binding),
        messages: MESSAGES,
        ...brainChatOptions(GEMMA),
        threadId: "t",
        runId: "r",
        debug: false,
      }),
    );
    const error = chunks.find((c) => c.type === EventType.RUN_ERROR) as {
      message?: string;
      code?: string;
    };

    expect(classifyFailure("workers-ai", error)).toEqual({
      verdict: "busy",
      allocationExhausted: false,
    });
  });
});

describe("withoutRetries", () => {
  it("marks a failed run x-should-retry: false and keeps its status and body", async () => {
    const binding: AiBinding = {
      run: async () => new Response("no", { status: 503 }),
    };

    const result = (await withoutRetries(binding).run("m", {})) as Response;

    expect(result.status).toBe(503);
    expect(result.headers.get("x-should-retry")).toBe("false");
    expect(await result.text()).toBe("no");
  });

  it("returns a successful run as it came", async () => {
    const ok = new Response("fine");
    const binding: AiBinding = { run: async () => ok };

    expect(await withoutRetries(binding).run("m", {})).toBe(ok);
  });

  it("turns a throw into a 500 that keeps the message, so an allocation error can still be read", async () => {
    const binding: AiBinding = {
      run: async () => {
        throw Object.assign(new Error("4006: daily free allocation used"), {
          code: 4006,
        });
      },
    };

    const result = (await withoutRetries(binding).run("m", {})) as Response;

    expect(result.status).toBe(500);
    expect(result.headers.get("x-should-retry")).toBe("false");
    expect(await result.json()).toEqual({
      error: { message: "4006: daily free allocation used", code: 4006 },
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Which failures retire a brain
// ---------------------------------------------------------------------------------------------------------------------

const google = (status: number, extra = "") => ({
  message: JSON.stringify({ error: { code: status, message: `x ${extra}` } }),
});
const workersAI = (status: number, text: string, code?: string) => ({
  message: `${status} ${text}`,
  code,
});

describe("classifyFailure (D9: 429 or quota is spent; 400 or 404 is unavailable)", () => {
  it.each([
    ["Gemini 429", "google", google(429), "spent"],
    ["Gemini 404, no such model", "google", google(404), "unavailable"],
    [
      "Gemini 400 for a model the key may not use",
      "google",
      google(400),
      "unavailable",
    ],
    ["Gemini 503, high demand", "google", google(503), "busy"],
    ["Gemini 529, overloaded", "google", google(529), "busy"],
    ["Gemini 500, an error in the request", "google", google(500), "other"],
    ["Gemini 403, a bad key", "google", google(403), "other"],
    [
      "Gemini 400 API_KEY_INVALID, a bad key, not a retired model",
      "google",
      google(400, "API_KEY_INVALID"),
      "other",
    ],
    [
      "Workers AI 403, not allowed to access this model",
      "workers-ai",
      workersAI(403, "5018: not allowed to access this model", "5018"),
      "unavailable",
    ],
    [
      "Workers AI 404",
      "workers-ai",
      workersAI(404, "no such model"),
      "unavailable",
    ],
    [
      "Workers AI 3040, no more data centers",
      "workers-ai",
      workersAI(429, "3040: no more data centers", "3040"),
      "busy",
    ],
    ["Workers AI 503", "workers-ai", workersAI(503, "unavailable"), "busy"],
    ["Workers AI 500", "workers-ai", workersAI(500, "boom"), "other"],
  ] as const)("%s", (_name, provider, failure, verdict) => {
    expect(classifyFailure(provider, failure).verdict).toBe(verdict);
  });

  it.each([
    ["3036 as the code", workersAI(429, "limit", "3036")],
    [
      "4006 as the code, with no status at all",
      { message: "Run failed", code: "4006" },
    ],
    [
      "the documented sentence",
      workersAI(
        429,
        "you have used up your daily free allocation of 10,000 neurons",
      ),
    ],
    ["4006 in a thrown error's text", workersAI(500, "4006: allocation")],
  ])("Workers AI allocation exhausted: %s", (_name, failure) => {
    expect(classifyFailure("workers-ai", failure)).toEqual({
      verdict: "spent",
      allocationExhausted: true,
    });
  });

  it("does not read a bare 3036 or 4006 in a Gemini error as an allocation", () => {
    expect(
      classifyFailure("google", {
        message: JSON.stringify({
          error: { code: 400, message: "input has 4006 tokens" },
        }),
      }),
    ).toEqual({ verdict: "unavailable", allocationExhausted: false });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------------------------------------------------

type Script =
  | { text: string }
  | { error: { message: string; code?: string } }
  | "silent";

const chunk = (type: string, rest: object = {}) =>
  ({ type, timestamp: 1, ...rest }) as unknown as StreamChunk;

/** A brain's stream, scripted: the adapter's `RUN_STARTED`, then what the script says. */
function scripted(
  script: Script,
  signal: AbortSignal,
): AsyncIterable<StreamChunk> {
  return (async function* () {
    yield chunk(EventType.RUN_STARTED);
    if (script === "silent") {
      await new Promise<void>((resolve) =>
        signal.addEventListener("abort", () => resolve(), { once: true }),
      );
      return;
    }
    if ("error" in script) {
      yield chunk(EventType.RUN_ERROR, script.error);
      return;
    }
    yield chunk(EventType.TEXT_MESSAGE_START);
    yield chunk(EventType.TEXT_MESSAGE_CONTENT, { delta: script.text });
    yield chunk(EventType.TEXT_MESSAGE_END);
    yield chunk(EventType.RUN_FINISHED);
  })();
}

async function walk(
  scripts: Record<string, Script>,
  candidates: readonly Brain[] = BRAINS as unknown as Brain[],
  signal?: AbortSignal,
) {
  const asked: string[] = [];
  const aborts: Record<string, AbortSignal> = {};
  const generator = walkBrains({
    candidates,
    signal,
    startTimeoutMs: () => 25,
    open: (brain, abortController) => {
      asked.push(brain.id);
      aborts[brain.id] = abortController.signal;
      const script = scripts[brain.id];
      if (script === undefined) throw new Error(`no script for ${brain.id}`);
      return scripted(script, abortController.signal);
    },
  });
  const steps: WalkStep[] = [];
  let next = await generator.next();
  while (!next.done) {
    steps.push(next.value);
    next = await generator.next();
  }
  const end: WalkEnd = next.value;
  return { steps, end, asked, aborts };
}

const trail = (steps: WalkStep[]) =>
  steps.map((s) =>
    s.type === "attempt" ? `ask ${s.brain.id}` : `${s.outcome} ${s.brain.id}`,
  );

const GOOGLE_429 = {
  message: JSON.stringify({ error: { code: 429, message: "quota" } }),
};

describe("walkBrains", () => {
  it("answers from the first brain when it starts: one step, the adapter's RUN_STARTED left out", async () => {
    const { steps, end, asked } = await walk({
      "cf-gemma-4-26b": { text: "Hello" },
    });

    expect(asked).toEqual(["cf-gemma-4-26b"]);
    expect(trail(steps)).toEqual(["ask cf-gemma-4-26b"]);
    expect(end.kind).toBe("answered");
    if (end.kind !== "answered") return;
    expect(end.brain.id).toBe("cf-gemma-4-26b");
    const types = (await drain(end.stream)).map((c) => c.type);
    expect(types).toEqual([
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);
  });

  it("a 429 on brain 1 answers from brain 2, after a step that says brain 1 was passed over", async () => {
    const { steps, end } = await walk({
      "cf-gemma-4-26b": {
        error: { message: "429 3040: no more data centers", code: "3040" },
      },
      "cf-glm-4.7-flash": { text: "From GLM" },
    });

    expect(trail(steps)).toEqual([
      "ask cf-gemma-4-26b",
      "busy cf-gemma-4-26b",
      "ask cf-glm-4.7-flash",
    ]);
    expect(end.kind === "answered" && end.brain.id).toBe("cf-glm-4.7-flash");
  });

  it("a brain silent past its timeout is skipped, and its call is aborted", async () => {
    const { steps, end, aborts } = await walk({
      "cf-gemma-4-26b": "silent",
      "cf-glm-4.7-flash": { text: "From GLM" },
    });

    expect(trail(steps)).toEqual([
      "ask cf-gemma-4-26b",
      "slow cf-gemma-4-26b",
      "ask cf-glm-4.7-flash",
    ]);
    expect(aborts["cf-gemma-4-26b"]?.aborted).toBe(true);
    expect(end.kind === "answered" && end.brain.id).toBe("cf-glm-4.7-flash");
  });

  it("allocation exhausted on one Workers AI brain skips the other without asking it", async () => {
    const { steps, end, asked } = await walk({
      "cf-gemma-4-26b": {
        error: {
          message: "429 you have used up your daily free allocation",
          code: "3036",
        },
      },
      "gemini-3.5-flash-lite": { text: "From Gemini" },
    });

    expect(asked).toEqual(["cf-gemma-4-26b", "gemini-3.5-flash-lite"]);
    expect(trail(steps)).toEqual([
      "ask cf-gemma-4-26b",
      "spent cf-gemma-4-26b",
      "ask gemini-3.5-flash-lite",
    ]);
    expect(steps[1]).toMatchObject({ allocation: true });
    expect(end.kind === "answered" && end.brain.id).toBe(
      "gemini-3.5-flash-lite",
    );
  });

  it("a plain 429 on one Workers AI brain does not retire the other", async () => {
    const { asked } = await walk({
      "cf-gemma-4-26b": { error: { message: "429 busy" } },
      "cf-glm-4.7-flash": { text: "ok" },
    });

    expect(asked).toEqual(["cf-gemma-4-26b", "cf-glm-4.7-flash"]);
  });

  it("every brain out ends spent", async () => {
    const out = { error: GOOGLE_429 };
    const { end, asked } = await walk({
      "cf-gemma-4-26b": {
        error: { message: "429 daily free allocation", code: "3036" },
      },
      "cf-glm-4.7-flash": out,
      "gemini-3.5-flash-lite": out,
      "gemini-3.6-flash": out,
      "gemini-3.5-flash": out,
    });

    expect(end).toEqual({ kind: "spent" });
    // The second Workers AI brain was never asked.
    expect(asked).toEqual([
      "cf-gemma-4-26b",
      "gemini-3.5-flash-lite",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
    ]);
  });

  it("only busy brains end in the last overload, not in a spent allowance", async () => {
    const busy = (n: number) => ({
      error: {
        message: JSON.stringify({
          error: { code: 503, message: `high demand ${n}` },
        }),
      },
    });
    const { end } = await walk(
      { "gemini-3.5-flash-lite": busy(1), "gemini-3.6-flash": busy(2) },
      [FLASH_LITE, FLASH_36],
    );

    expect(end.kind).toBe("failed");
    expect(end.kind === "failed" && end.failure.message).toContain(
      "high demand 2",
    );
  });

  it("only slow brains end in the timed-out failure, not in a spent allowance", async () => {
    const { end } = await walk(
      { "cf-gemma-4-26b": "silent", "cf-glm-4.7-flash": "silent" },
      [GEMMA, GLM],
    );

    expect(end).toEqual({
      kind: "failed",
      failure: { message: expect.any(String), code: BRAINS_TIMED_OUT_CODE },
    });
  });

  it("a failure that says nothing about the brain stops the walk at once: the next brain would fail too", async () => {
    const { end, asked } = await walk(
      {
        "gemini-3.5-flash-lite": {
          error: {
            message: JSON.stringify({ error: { code: 500, message: "boom" } }),
          },
        },
        "gemini-3.6-flash": { text: "never asked" },
      },
      [FLASH_LITE, FLASH_36],
    );

    expect(end.kind).toBe("failed");
    expect(asked).toEqual(["gemini-3.5-flash-lite"]);
  });

  it("a busy brain, then one out, then none left ends busy: someone was only busy", async () => {
    const { end } = await walk(
      {
        "gemini-3.5-flash-lite": {
          error: {
            message: JSON.stringify({ error: { code: 503, message: "busy" } }),
          },
        },
        "gemini-3.6-flash": { error: GOOGLE_429 },
      },
      [FLASH_LITE, FLASH_36],
    );

    expect(end.kind).toBe("failed");
  });

  it("a request that is already cancelled asks no brain", async () => {
    const controller = new AbortController();
    controller.abort();

    const { end, asked } = await walk(
      {},
      BRAINS as unknown as Brain[],
      controller.signal,
    );

    expect(end).toEqual({ kind: "aborted" });
    expect(asked).toEqual([]);
  });

  it("cancelling the request aborts the answering brain's call", async () => {
    const controller = new AbortController();
    const { end, aborts } = await walk(
      { "gemini-3.5-flash-lite": { text: "hi" } },
      [FLASH_LITE],
      controller.signal,
    );
    expect(end.kind).toBe("answered");

    controller.abort();

    expect(aborts["gemini-3.5-flash-lite"]?.aborted).toBe(true);
  });

  describe("D9's start times, with no startTimeoutMs given", () => {
    afterEach(() => vi.useRealTimers());

    /** Walks one silent brain with the default deadline; reports whether it has been moved on from at each time. */
    async function movedOnAt(brain: Brain, times: number[]) {
      vi.useFakeTimers();
      const generator = walkBrains({
        candidates: [brain],
        open: (_brain, abortController) =>
          scripted("silent", abortController.signal),
      });
      const steps: WalkStep[] = [];
      const done = (async () => {
        let next = await generator.next();
        while (!next.done) {
          steps.push(next.value);
          next = await generator.next();
        }
      })();
      const seen: boolean[] = [];
      let at = 0;
      for (const time of times) {
        await vi.advanceTimersByTimeAsync(time - at);
        at = time;
        seen.push(steps.some((s) => s.type === "moved-on"));
      }
      await done;
      return seen;
    }

    it("moves on from a silent Gemini brain at 15 s, not before", async () => {
      expect(await movedOnAt(FLASH_LITE, [14_999, 15_000])).toEqual([
        false,
        true,
      ]);
    });

    it("moves on from a silent Workers AI brain at 20 s: still waiting at 15 s", async () => {
      expect(await movedOnAt(GEMMA, [15_000, 19_999, 20_000])).toEqual([
        false,
        false,
        true,
      ]);
    });
  });

  it("rewrites the run id on every chunk that carries one to the request's", async () => {
    const generator = walkBrains({
      candidates: [GEMMA],
      runId: "request-run",
      open: () =>
        (async function* () {
          yield chunk(EventType.RUN_STARTED, { runId: "adapter-run" });
          yield chunk(EventType.TEXT_MESSAGE_CONTENT, { delta: "hi" });
          yield chunk(EventType.RUN_FINISHED, { runId: "adapter-run" });
        })(),
    });
    let next = await generator.next();
    while (!next.done) next = await generator.next();
    if (next.value.kind !== "answered") throw new Error("not answered");

    const out = await drain(next.value.stream);

    expect(out.map((c) => (c as { runId?: string }).runId)).toEqual([
      undefined,
      "request-run",
    ]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// When the allowance comes back
// ---------------------------------------------------------------------------------------------------------------------

describe("nextMidnightMs", () => {
  // Worked by hand from the zone rules: Pacific is UTC-8 in winter and UTC-7 from 2026-03-08 10:00Z to 2026-11-01 09:00Z.
  it.each([
    [
      "Pacific, winter: midnight is 08:00Z",
      "2026-11-09T12:00:00Z",
      "America/Los_Angeles",
      "2026-11-10T08:00:00Z",
    ],
    [
      "Pacific, summer: midnight is 07:00Z",
      "2026-07-01T12:00:00Z",
      "America/Los_Angeles",
      "2026-07-02T07:00:00Z",
    ],
    [
      "Pacific, evening before the clocks go back: still PDT, so 07:00Z",
      "2026-11-01T03:00:00Z",
      "America/Los_Angeles",
      "2026-11-01T07:00:00Z",
    ],
    [
      "Pacific, the 25-hour day: the next midnight is PST, 08:00Z the day after",
      "2026-11-01T12:00:00Z",
      "America/Los_Angeles",
      "2026-11-02T08:00:00Z",
    ],
    [
      "Pacific, the 23-hour day: midnight after it is PDT",
      "2026-03-08T12:00:00Z",
      "America/Los_Angeles",
      "2026-03-09T07:00:00Z",
    ],
    ["UTC", "2026-11-09T12:34:56Z", "UTC", "2026-11-10T00:00:00Z"],
    [
      "UTC, a second before midnight",
      "2026-11-09T23:59:59Z",
      "UTC",
      "2026-11-10T00:00:00Z",
    ],
    [
      "UTC, at midnight, is the one after",
      "2026-11-10T00:00:00Z",
      "UTC",
      "2026-11-11T00:00:00Z",
    ],
  ])("%s", (_name, now, zone, expected) => {
    expect(convertUnixToUtc(nextMidnightMs(unix(now), zone))).toBe(expected);
  });
});

describe("soonestReset", () => {
  const now = unix("2026-11-09T12:00:00Z");

  it("names UTC midnight when only Workers AI is offered", () => {
    expect(soonestReset([GEMMA, GLM], now)).toBe("2026-11-10T00:00:00Z");
  });

  it("names Pacific midnight when only Gemini is offered", () => {
    expect(soonestReset([FLASH_LITE, FLASH_36], now)).toBe(
      "2026-11-10T08:00:00Z",
    );
  });

  it("names the sooner of the two when both are offered", () => {
    expect(soonestReset(BRAINS as unknown as Brain[], now)).toBe(
      "2026-11-10T00:00:00Z",
    );
  });
});
