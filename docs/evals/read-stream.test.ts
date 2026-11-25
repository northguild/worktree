// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseStream } from "./read-stream.ts";

// The fixtures are real `createChatHandler` output over `fakeText` (`README.md` says how they were recorded). Every expected
// value below is what the recording was told to say or what the recorded bytes hold, read by hand from the .sse file:
// - the answer text is the string the recording gave `fakeText` (`ANSWER`), not something the reader produced;
// - the usage is the `RUN_FINISHED` line of `answer.sse` (`"inputTokens":5225,"outputTokens":30`);
// - the traces, progress lines, refusal and error are the `data:` lines of the file, in order.

const FIXTURES = join(fileURLToPath(new URL(".", import.meta.url)), "fixtures");
const fixture = (name: string) =>
  readFileSync(join(FIXTURES, `${name}.sse`), "utf8");

const ANSWER =
  "To remove a worktree, run `worktree remove <branch> --force`. See [the remove command](/commands/remove/) for details.";

describe("parseStream — the recorded streams", () => {
  it("an answer: the deltas joined, both traces, the progress line, the usage and the finish reason", () => {
    const record = parseStream(fixture("answer"));

    expect(record.text).toBe(ANSWER);
    expect(record.traces).toHaveLength(2);
    expect(record.traces[0]?.brainLabel).toBeUndefined();
    expect(record.traces[1]?.brainLabel).toBe("Gemma 4 26B");
    expect(record.traces[1]?.chunkUrls).toEqual([
      "/commands/remove/",
      "/commands/cleanup/",
      "/faq/",
    ]);
    expect(record.traces[1]?.totalChunks).toBe(210);
    expect(record.progress).toEqual(["Asking Gemma 4 26B…"]);
    expect(record.usage).toEqual({ inputTokens: 5225, outputTokens: 30 });
    expect(record.finishReason).toBe("stop");
    expect(record.refusal).toBeNull();
    expect(record.runError).toBeNull();
    expect(record.faults).toEqual([]);
  });

  it("a refusal answer: the documented sentence, quiet retrieval", () => {
    const record = parseStream(fixture("refusal"));

    expect(record.text).toBe("The Worktree documentation does not cover this.");
    expect(record.traces.map((t) => t.retrievedCount)).toEqual([0, 0]);
    expect(record.usage).toEqual({ inputTokens: 559, outputTokens: 12 });
    expect(record.faults).toEqual([]);
  });

  it("a curated RUN_ERROR: no text, one trace, no finish reason", () => {
    const record = parseStream(fixture("run-error"));

    expect(record.runError).toEqual({
      message: "The assistant's model is unavailable right now.",
      code: "upstream_unavailable",
    });
    expect(record.text).toBe("");
    expect(record.traces).toHaveLength(1);
    expect(record.usage).toBeNull();
    expect(record.finishReason).toBeNull();
    expect(record.faults).toEqual([]);
  });

  it("a spent allowance: the dox-refusal, its RUN_ERROR twin and the walk's eight lines", () => {
    const record = parseStream(fixture("spent"));

    expect(record.refusal).toEqual({
      status: 429,
      payload: {
        error: "Dox has used its free allowance for today.",
        retryable: false,
        resetsAt: "2023-11-15T00:00:00Z",
      },
    });
    expect(record.runError?.code).toBe("allowance_spent");
    expect(record.progress).toHaveLength(8);
    expect(record.progress[0]).toBe("Asking Gemma 4 26B…");
    expect(record.progress[7]).toBe(
      "3.5 Flash is out for today — trying the next model…",
    );
    expect(record.faults).toEqual([]);
  });

  it("a length finish: the cut text and the reason", () => {
    const record = parseStream(fixture("truncated"));

    expect(record.finishReason).toBe("length");
    expect(record.text).toBe(ANSWER.slice(0, 60));
    expect(record.faults).toEqual([]);
  });
});

describe("parseStream — faults", () => {
  const lines = fixture("answer")
    .split("\n\n")
    .filter((frame) => frame !== "");

  it("a line that is not JSON is a fault, and the rest is still read", () => {
    const broken = [...lines.slice(0, 3), "data: {not json", ...lines.slice(3)];

    const record = parseStream(`${broken.join("\n\n")}\n\n`);

    expect(record.faults).toHaveLength(1);
    expect(record.faults[0]).toContain("event 4");
    expect(record.text).toBe(ANSWER);
  });

  it("an event of a known type with the wrong shape is a fault, not a throw", () => {
    const bad =
      'data: {"type":"TEXT_MESSAGE_CONTENT","messageId":"m","delta":42}';

    const record = parseStream(`${bad}\n\n${lines.join("\n\n")}\n\n`);

    expect(record.faults).toHaveLength(1);
    expect(record.faults[0]).toContain("TEXT_MESSAGE_CONTENT");
    expect(record.text).toBe(ANSWER);
  });

  it("a trace missing a field is a fault and is not kept", () => {
    const bad =
      'data: {"type":"CUSTOM","name":"dox-retrieval","value":{"totalChunks":1}}';

    const record = parseStream(`${bad}\n\n`);

    expect(record.traces).toEqual([]);
    expect(record.faults[0]).toContain("dox-retrieval");
  });

  it("a stream that ends with neither RUN_FINISHED nor RUN_ERROR says so", () => {
    const record = parseStream(`${lines.slice(0, 5).join("\n\n")}\n\n`);

    expect(record.faults).toEqual([
      "the stream ended with neither RUN_FINISHED nor RUN_ERROR",
    ]);
  });

  it("comments, blank lines, [DONE] and events it has no use for are not faults", () => {
    const text = `: keep-alive\n\ndata: [DONE]\n\ndata: {"type":"STEP_STARTED","stepName":"x"}\n\n${fixture("answer")}`;

    expect(parseStream(text).faults).toEqual([]);
  });

  it("an empty body is a fault, not an empty pass", () => {
    expect(parseStream("").faults).toEqual([
      "the stream ended with neither RUN_FINISHED nor RUN_ERROR",
    ]);
  });
});
