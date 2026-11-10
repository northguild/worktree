// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { RetrievalChunk } from "../../src/chat/lib/chat-types";
import {
  fitChunks,
  MAX_PROMPT_CHUNK_CHARS,
  MAX_PROMPT_CHUNKS,
} from "./fit-chunks";

// Expected values: plan #309 D8 (gmt's caps: 10 chunks and 24,000 characters), and gmt's rule, written out in its
// `fit-chunks.ts` header: best first, the best chunk always goes in, a chunk that does not fit is skipped and a later
// smaller one may still go in. Sizes are title plus text.

function chunk(id: string, size: number): RetrievalChunk {
  return {
    id,
    url: `/${id}/`,
    namespace: "x",
    title: "t",
    text: "x".repeat(size - 1),
  };
}

describe("fitChunks", () => {
  it("has gmt's caps", () => {
    expect(MAX_PROMPT_CHUNKS).toBe(10);
    expect(MAX_PROMPT_CHUNK_CHARS).toBe(24_000);
  });

  it("keeps at most 10 chunks, the best ten", () => {
    const retrieved = Array.from({ length: 15 }, (_, i) => chunk(`c${i}`, 100));

    expect(fitChunks(retrieved).map((c) => c.id)).toEqual(
      retrieved.slice(0, 10).map((c) => c.id),
    );
  });

  it("keeps chunks up to 24,000 characters in total", () => {
    const retrieved = [
      chunk("a", 10_000),
      chunk("b", 10_000),
      chunk("c", 4_000),
    ];

    expect(fitChunks(retrieved).map((c) => c.id)).toEqual(["a", "b", "c"]);
  });

  it("skips a chunk that would pass 24,000 and takes a later one that fits", () => {
    const retrieved = [
      chunk("a", 10_000),
      chunk("b", 10_000),
      chunk("big", 5_000),
      chunk("small", 100),
    ];

    expect(fitChunks(retrieved).map((c) => c.id)).toEqual(["a", "b", "small"]);
  });

  it("always keeps the first chunk, however large", () => {
    const retrieved = [chunk("huge", 60_000), chunk("small", 100)];

    expect(fitChunks(retrieved).map((c) => c.id)).toEqual(["huge"]);
  });

  it("keeps nothing from nothing", () => {
    expect(fitChunks([])).toEqual([]);
  });

  it("takes the caps from its options", () => {
    const retrieved = [chunk("a", 100), chunk("b", 100), chunk("c", 100)];

    expect(fitChunks(retrieved, { maxChunks: 2 }).map((c) => c.id)).toEqual([
      "a",
      "b",
    ]);
    expect(fitChunks(retrieved, { maxChars: 150 }).map((c) => c.id)).toEqual([
      "a",
    ]);
  });
});
