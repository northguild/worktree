// @vitest-environment node
import { describe, expect, it } from "vitest";
import { describeThrown, mapUpstreamError } from "./error-mapping";

// Expected values come from plan #257 §4.2's mapping table (code, text,
// retryable). The inputs are Google's documented error bodies
// (ai.google.dev/gemini-api/docs/troubleshooting: 400 INVALID_ARGUMENT,
// 403 PERMISSION_DENIED, 429 RESOURCE_EXHAUSTED, 500 INTERNAL, 503
// UNAVAILABLE), wrapped as @tanstack/ai-gemini wraps them: the error's
// `message` is `JSON.stringify` of the body, and an `ApiError` also carries the
// HTTP `status`. A `RUN_ERROR` chunk from that adapter carries the same
// message and no `code` at all (probed against the installed 1.2.0).

function googleBody(code: number, status: string, extra: object = {}) {
  return JSON.stringify({
    error: { code, message: `Google says ${status}`, status, ...extra },
  });
}

const PER_DAY_QUOTA = {
  details: [
    {
      "@type": "type.googleapis.com/google.rpc.QuotaFailure",
      violations: [
        {
          quotaMetric:
            "generativelanguage.googleapis.com/generate_content_free_tier_requests",
          quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier",
        },
      ],
    },
  ],
};
const PER_MINUTE_QUOTA = {
  details: [
    {
      "@type": "type.googleapis.com/google.rpc.QuotaFailure",
      violations: [
        {
          quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier",
        },
      ],
    },
  ],
};

const MISCONFIGURED = {
  code: "misconfigured",
  message: "The assistant is temporarily unavailable.",
  retryable: false,
};
const DAILY = {
  code: "rate_limited_daily",
  message:
    "The assistant has reached its daily limit. Try again tomorrow, or pick the other model.",
  retryable: true,
};
const MINUTE = {
  code: "rate_limited",
  message:
    "The assistant is receiving too many requests. Wait a moment and try again.",
  retryable: true,
};
const UNAVAILABLE = {
  code: "upstream_unavailable",
  message: "The assistant's model is unavailable right now.",
  retryable: true,
};
const FAILED = {
  code: "failed",
  message: "Something went wrong answering that question.",
  retryable: false,
};

// Each row is given twice: as a thrown `ApiError` (message + numeric status)
// and as the message-only `RUN_ERROR` the Gemini adapter yields.
const rows: Array<[string, number, string, object, typeof MISCONFIGURED]> = [
  ["401", 401, "UNAUTHENTICATED", {}, MISCONFIGURED],
  ["403", 403, "PERMISSION_DENIED", {}, MISCONFIGURED],
  ["429 per day", 429, "RESOURCE_EXHAUSTED", PER_DAY_QUOTA, DAILY],
  ["429 per minute", 429, "RESOURCE_EXHAUSTED", PER_MINUTE_QUOTA, MINUTE],
  ["429 with no quota detail", 429, "RESOURCE_EXHAUSTED", {}, MINUTE],
  ["500", 500, "INTERNAL", {}, UNAVAILABLE],
  ["503", 503, "UNAVAILABLE", {}, UNAVAILABLE],
  ["400", 400, "INVALID_ARGUMENT", {}, UNAVAILABLE],
];

describe("mapUpstreamError — the §4.2 table", () => {
  describe.each(rows)("%s", (_name, status, label, extra, expected) => {
    it("a thrown ApiError (message + status)", () => {
      const thrown = Object.assign(
        new Error(googleBody(status, label, extra)),
        {
          status,
        },
      );
      expect(mapUpstreamError(describeThrown(thrown))).toEqual(expected);
    });

    it("a RUN_ERROR chunk (message only, no code)", () => {
      expect(
        mapUpstreamError({ message: googleBody(status, label, extra) }),
      ).toEqual(expected);
    });
  });

  it("a RUN_ERROR whose code is the status as a string (the library's own shape)", () => {
    expect(mapUpstreamError({ message: "anything", code: "429" })).toEqual(
      MINUTE,
    );
  });

  it("a thrown error's status alone decides when the message is not Google's JSON", () => {
    const thrown = Object.assign(new Error("got status: 503"), { status: 503 });
    expect(mapUpstreamError(describeThrown(thrown))).toEqual(UNAVAILABLE);
  });

  it("an invalid API key is misconfigured, though Google answers it with 400", () => {
    // Observed against the live API on 2026-11-08 with the key "bogus":
    // 400 INVALID_ARGUMENT, reason API_KEY_INVALID. The table's 401/403 row is
    // about a key Google refuses; this is the same fault, in a 400.
    const body = googleBody(400, "INVALID_ARGUMENT", {
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "API_KEY_INVALID",
        },
      ],
    });
    expect(mapUpstreamError({ message: body })).toEqual(MISCONFIGURED);
  });

  it("finds the status when the adapter nests Google's body inside another", () => {
    // Seen from the installed adapter: {"error":{"message":"<Google's body as
    // a string>","code":429,"status":"Too Many Requests"}}.
    const nested = JSON.stringify({
      error: {
        message: googleBody(429, "RESOURCE_EXHAUSTED", PER_DAY_QUOTA),
        code: 429,
        status: "Too Many Requests",
      },
    });
    expect(mapUpstreamError({ message: nested })).toEqual(DAILY);
  });

  it.each([
    ["a message that is not an API body", { message: "fetch failed" }],
    ["no message at all", {}],
    ["a non-HTTP code", { message: "x", code: "aborted" }],
  ])("anything else → failed: %s", (_name, input) => {
    expect(mapUpstreamError(input)).toEqual(FAILED);
  });

  it("never returns any of Google's text", () => {
    const body = googleBody(429, "RESOURCE_EXHAUSTED", PER_DAY_QUOTA);
    const mapped = mapUpstreamError({ message: body });
    expect(JSON.stringify(mapped)).not.toContain("Google says");
    expect(JSON.stringify(mapped)).not.toContain("quotaId");
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Plan #309 Phase 6: Workers AI errors (D9). Inputs are what `@tanstack/ai-cloudflare` 1.2.0's OpenAI-shaped client
// produces for a Cloudflare failure (`normalizeErrorResponse` in `utils/fetch.ts`): the message is the HTTP status, a
// space and Cloudflare's text, and the `code` is Cloudflare's own error number. The numbers are gmt `worker/brains.ts`'s:
// 3036 and 4006 mean the day's allocation is gone, 3040 ("no more data centers") is a capacity blip.
// ---------------------------------------------------------------------------------------------------------------------

describe("mapUpstreamError — Workers AI", () => {
  it.each([
    ["3036 as the code", { message: "429 limit", code: "3036" }],
    [
      "4006 as the code, which arrives with no status",
      { message: "Run failed", code: "4006" },
    ],
    [
      "the documented sentence",
      {
        message:
          "429 you have used up your daily free allocation of 10,000 neurons",
      },
    ],
  ])("the daily allocation gone is the daily limit: %s", (_name, input) => {
    expect(mapUpstreamError(input)).toEqual(DAILY);
  });

  it("3040, no more data centers, is a busy moment, not the daily limit", () => {
    expect(
      mapUpstreamError({
        message: "429 3040: no more data centers",
        code: "3040",
      }),
    ).toEqual(MINUTE);
  });

  it.each([
    ["503", UNAVAILABLE],
    ["500", UNAVAILABLE],
    ["403", MISCONFIGURED],
  ])("reads the leading %s of the client's message", (status, expected) => {
    expect(mapUpstreamError({ message: `${status} upstream said no` })).toEqual(
      expected,
    );
  });

  it("does not read a bare 4006 in a Gemini error as the allocation", () => {
    expect(
      mapUpstreamError({
        message: googleBody(400, "INVALID_ARGUMENT", { detail: "4006 tokens" }),
      }),
    ).toEqual(UNAVAILABLE);
  });

  it("a walk that ran out of time is a slow-to-respond, try again", () => {
    expect(
      mapUpstreamError({ message: "x", code: "brains_timed_out" }),
    ).toEqual({
      code: "upstream_slow",
      message:
        "The assistant is slow to respond right now. Please try again in a moment.",
      retryable: true,
    });
  });

  it("an allowance spent on every brain is said in Dox's words and is not retryable", () => {
    expect(mapUpstreamError({ message: "x", code: "allowance_spent" })).toEqual(
      {
        code: "allowance_spent",
        message: "Dox has used its free allowance for today.",
        retryable: false,
      },
    );
  });
});
