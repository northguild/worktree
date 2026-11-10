import { afterEach, beforeEach, vi } from "vitest";
import {
  createdAtDate,
  createdAtMs,
  deserializeTranscript,
  LEGACY_HISTORY_KEYS,
  messageText,
  removeLegacyHistory,
  sendableHistory,
  serializeTranscript,
} from "./chat-history";
import type { UIMessage } from "./chat-types";

// Expected values: plan #257 D11 (sendableHistory drops assistant turns with no text, only those), D12 (the codec
// refuses anything that is not messages of text parts; an invalid transcript is removed, not repaired; the three
// docs_chat_history_<model> keys are removed), D17 (createdAt as a Date, a number or an ISO string). The
// timestamps are checked by hand: 1_757_500_000 s after the epoch is 2025-09-10T10:26:40Z, and
// 2026-11-08T12:00:00Z is 1_794_139_200 s (day 311 of 2026 is 26_870_400 s after 2026-01-01 = 1_767_225_600, plus 12 h).

function message(
  role: "user" | "assistant",
  text: string,
  extra: Partial<UIMessage> = {},
): UIMessage {
  return {
    id: `${role}-${text || "empty"}`,
    role,
    parts: text === "" ? [] : [{ type: "text", content: text }],
    ...extra,
  };
}

describe("messageText", () => {
  it("joins the text parts and ignores the others", () => {
    const mixed = {
      id: "a",
      role: "assistant",
      parts: [
        { type: "text", content: "Hello, " },
        { type: "thinking", content: "hidden thought" },
        { type: "text", content: "world." },
      ],
    } as UIMessage;
    expect(messageText(mixed)).toBe("Hello, world.");
  });

  it("is empty for a message with no parts", () => {
    expect(messageText(message("assistant", ""))).toBe("");
  });
});

describe("sendableHistory", () => {
  it("drops assistant turns with no text and nothing else", () => {
    const history = [
      message("user", "first"),
      message("assistant", ""),
      message("user", "second"),
      message("assistant", "   "),
      message("assistant", "an answer"),
      message("user", ""),
    ];

    const kept = sendableHistory(history, messageText).map((m) => m.id);

    expect(kept).toEqual([
      "user-first",
      "user-second",
      "assistant-an answer",
      "user-empty",
    ]);
  });
});

describe("createdAtMs", () => {
  it.each([
    ["a Date", createdAtDate(1_757_500_000_000), 1_757_500_000_000],
    ["a number of milliseconds", 1_757_500_000_000, 1_757_500_000_000],
    ["an ISO string", "2025-09-10T10:26:40.000Z", 1_757_500_000_000],
    ["an ISO string in 2026", "2026-11-08T12:00:00.000Z", 1_794_139_200_000],
  ])("reads %s", (_name, value, expected) => {
    expect(createdAtMs(value)).toBe(expected);
  });

  it.each([
    ["nothing", undefined],
    ["a string that is not a date", "yesterday"],
    ["NaN", Number.NaN],
    ["an object", {}],
  ])("has no time for %s", (_name, value) => {
    expect(createdAtMs(value)).toBeUndefined();
  });
});

describe("the transcript codec", () => {
  it("round-trips text messages, restoring createdAt as a Date", () => {
    const stored = serializeTranscript({
      messages: [
        message("user", "How do I clean up?", {
          createdAt: createdAtDate(1_757_500_000_000),
        }),
        message("assistant", "Run `worktree cleanup`."),
      ],
    });

    const restored = deserializeTranscript(stored);

    expect(restored.messages).toHaveLength(2);
    expect(restored.messages[0]?.createdAt).toEqual(
      createdAtDate(1_757_500_000_000),
    );
    expect(messageText(restored.messages[1] as UIMessage)).toBe(
      "Run `worktree cleanup`.",
    );
  });

  it("does not store a resume pointer, an empty assistant turn or a non-text part", () => {
    const stored = serializeTranscript({
      messages: [
        message("user", "q"),
        message("assistant", ""),
        {
          id: "a",
          role: "assistant",
          parts: [
            { type: "thinking", content: "t" },
            { type: "text", content: "answer" },
          ],
        } as UIMessage,
      ],
      resume: { threadId: "docs-chat", runId: "r1" },
    } as never);

    const parsed = JSON.parse(stored) as Record<string, unknown>;

    expect(Object.keys(parsed)).toEqual(["messages"]);
    expect(JSON.stringify(parsed)).not.toContain("thinking");
    expect((parsed.messages as unknown[]).length).toBe(2);
  });

  it.each([
    ["not JSON", "{oops"],
    ["not an object", JSON.stringify("hi")],
    ["the 0.x bare array", JSON.stringify([{ role: "user", content: "x" }])],
    ["messages that are not a list", JSON.stringify({ messages: "x" })],
    [
      "a system message",
      JSON.stringify({
        messages: [
          { id: "s", role: "system", parts: [{ type: "text", content: "x" }] },
        ],
      }),
    ],
    [
      "a part that is not text",
      JSON.stringify({
        messages: [
          {
            id: "a",
            role: "assistant",
            parts: [{ type: "tool-call", id: "t", name: "n", arguments: "{}" }],
          },
        ],
      }),
    ],
    [
      "a text part whose content is not a string",
      JSON.stringify({
        messages: [
          { id: "a", role: "user", parts: [{ type: "text", content: 5 }] },
        ],
      }),
    ],
  ])("refuses %s", (_name, raw) => {
    expect(() => deserializeTranscript(raw)).toThrow();
  });

  it("keeps a message whose createdAt is garbage, without a time", () => {
    const restored = deserializeTranscript(
      JSON.stringify({
        messages: [
          {
            id: "u",
            role: "user",
            parts: [{ type: "text", content: "q" }],
            createdAt: "garbage",
          },
        ],
      }),
    );
    expect(restored.messages[0]?.createdAt).toBeUndefined();
  });
});

/** jsdom has no usable `localStorage` under this Node; this one is a Map. */
function stubLocalStorage() {
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  });
}

describe("removeLegacyHistory", () => {
  beforeEach(() => {
    stubLocalStorage();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("removes the three per-model transcripts and nothing else", () => {
    // The keys the retired client wrote: `docs_chat_history_` + each of its three model ids
    // (the old constants.ts ALLOWED_MODELS).
    const old = [
      "docs_chat_history_gemini-2.5-flash",
      "docs_chat_history_gemini-2.5-flash-lite",
      "docs_chat_history_gemini-3-flash-preview",
    ];
    for (const key of old) localStorage.setItem(key, "[]");
    localStorage.setItem("docs_chat_model", '"gemini-3.5-flash-lite"');

    expect([...LEGACY_HISTORY_KEYS]).toEqual(old);
    removeLegacyHistory();

    for (const key of old) expect(localStorage.getItem(key)).toBeNull();
    expect(localStorage.getItem("docs_chat_model")).not.toBeNull();
  });
});
