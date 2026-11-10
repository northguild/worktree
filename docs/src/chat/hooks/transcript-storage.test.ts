import { afterEach, beforeEach, vi } from "vitest";
import { messageText, TRANSCRIPT_KEY_PREFIX } from "../lib/chat-history";
import type { UIMessage } from "../lib/chat-types";
import { createTranscriptStorage } from "./transcript-storage";

// Expected values: plan #257 D12 -- an invalid stored transcript is removed, not repaired; the adapter keeps
// `<keyPrefix><threadId>` as its key.

function message(role: "user" | "assistant", text: string): UIMessage {
  return {
    id: `${role}-${text}`,
    role,
    parts: [{ type: "text", content: text }],
  };
}

/** jsdom has no usable `localStorage` under this Node; this one is a Map. */
function stubLocalStorage() {
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  });
  return items;
}

describe("the transcript storage", () => {
  let items: Map<string, string>;
  beforeEach(() => {
    items = stubLocalStorage();
  });
  afterEach(() => vi.unstubAllGlobals());

  const KEY = `${TRANSCRIPT_KEY_PREFIX}docs-chat`;

  it("reads back what it wrote", async () => {
    const storage = createTranscriptStorage();

    await storage.setItem("docs-chat", { messages: [message("user", "q")] });
    const read = await storage.getItem("docs-chat");

    expect(items.has(KEY)).toBe(true);
    expect(read?.messages.map((m) => messageText(m))).toEqual(["q"]);
  });

  it("removes an invalid stored transcript rather than repairing it", async () => {
    items.set(KEY, JSON.stringify({ messages: [{ id: "x", role: "tool" }] }));
    const storage = createTranscriptStorage();

    const read = await storage.getItem("docs-chat");

    expect(read).toBeNull();
    expect(items.has(KEY)).toBe(false);
  });

  it("removes stored text that is not JSON", async () => {
    items.set(KEY, "{oops");

    const read = await createTranscriptStorage().getItem("docs-chat");

    expect(read).toBeNull();
    expect(items.has(KEY)).toBe(false);
  });

  it("is empty, not an error, when nothing is stored", async () => {
    expect(await createTranscriptStorage().getItem("docs-chat")).toBeNull();
  });
});
