import { describe, expect, it } from "vitest";
import { MAX_MESSAGE_LENGTH } from "./chat-constants";
import {
  checkUserText,
  conversationLength,
  sanitizeUserText,
} from "./chat-sanitize";

const at = (codePoint: number) => String.fromCodePoint(codePoint);
const hidden = (codePoint: number) => `a${at(codePoint)}b`;

// Every expected value below comes from the Unicode code charts (the code
// point's block and general category), not from the sanitiser: Basic Latin
// (C0 controls, DEL), Latin-1 Supplement (C1), General Punctuation (U+2000
// block: U+200B-U+200F, U+202A-U+202E, U+2060-U+2064, U+2066-U+2069), Arabic
// Presentation Forms-B (U+FEFF) and Tags (U+E0000-U+E007F).
describe("sanitizeUserText strips each invisible range (D8)", () => {
  it.each([
    ["C0 control, first (U+0001 START OF HEADING)", 0x0001],
    ["C0 control (U+0008 BACKSPACE)", 0x0008],
    ["C0 control (U+000B LINE TABULATION)", 0x000b],
    ["C0 control (U+000C FORM FEED)", 0x000c],
    ["C0 control (U+000D CARRIAGE RETURN)", 0x000d],
    ["C0 control, last (U+001F INFORMATION SEPARATOR ONE)", 0x001f],
    ["DEL (U+007F)", 0x007f],
    ["C1 control, first (U+0080)", 0x0080],
    ["C1 control (U+0085 NEXT LINE)", 0x0085],
    ["C1 control, last (U+009F)", 0x009f],
    ["ZERO WIDTH SPACE (U+200B)", 0x200b],
    ["LEFT-TO-RIGHT MARK (U+200E)", 0x200e],
    ["RIGHT-TO-LEFT MARK (U+200F)", 0x200f],
    ["LEFT-TO-RIGHT EMBEDDING (U+202A)", 0x202a],
    ["RIGHT-TO-LEFT OVERRIDE (U+202E)", 0x202e],
    ["WORD JOINER (U+2060)", 0x2060],
    ["INVISIBLE PLUS (U+2064)", 0x2064],
    ["LEFT-TO-RIGHT ISOLATE (U+2066)", 0x2066],
    ["POP DIRECTIONAL ISOLATE (U+2069)", 0x2069],
    ["ZERO WIDTH NO-BREAK SPACE / BOM (U+FEFF)", 0xfeff],
    ["tag block, first (U+E0000)", 0xe0000],
    ["TAG LATIN CAPITAL LETTER A (U+E0041)", 0xe0041],
    ["tag block, last (U+E007F CANCEL TAG)", 0xe007f],
  ])("removes %s", (_name, codePoint) => {
    expect(sanitizeUserText(hidden(codePoint))).toBe("ab");
  });

  it.each([
    ["ZERO WIDTH NON-JOINER (U+200C), required in Persian", 0x200c],
    ["ZERO WIDTH JOINER (U+200D), joins emoji and Indic conjuncts", 0x200d],
    ["CHARACTER TABULATION (U+0009)", 0x0009],
    ["LINE FEED (U+000A)", 0x000a],
    ["SOFT HYPHEN (U+00AD)", 0x00ad],
  ])("keeps %s", (_name, codePoint) => {
    expect(sanitizeUserText(hidden(codePoint))).toBe(hidden(codePoint));
  });

  it("keeps a ZWJ emoji sequence whole", () => {
    // U+1F469 WOMAN, ZWJ, U+1F4BB PERSONAL COMPUTER = "woman technologist".
    const technologist = `${at(0x1f469)}${at(0x200d)}${at(0x1f4bb)}`;
    expect(sanitizeUserText(technologist)).toBe(technologist);
  });
});

describe("sanitizeUserText normalises and tidies", () => {
  it("composes a decomposed letter (NFC)", () => {
    // U+0065 + U+0301 canonically composes to U+00E9 (UnicodeData.txt).
    expect(sanitizeUserText("é")).toBe("é");
  });

  it("collapses three or more newlines to two", () => {
    expect(sanitizeUserText("a\n\n\n\n\nb")).toBe("a\n\nb");
  });

  it("leaves a single blank line alone", () => {
    expect(sanitizeUserText("a\n\nb")).toBe("a\n\nb");
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeUserText("  \n hello \t\n")).toBe("hello");
  });
});

describe("checkUserText", () => {
  it("accepts a plain question and returns the cleaned text", () => {
    expect(checkUserText("  How do I list worktrees?  ")).toEqual({
      ok: true,
      text: "How do I list worktrees?",
    });
  });

  it.each([
    ["an empty string", ""],
    ["only whitespace", " \n\t "],
    ["only tag characters", `${at(0xe0041)}${at(0xe0042)}${at(0xe007f)}`],
  ])("says the message is empty for %s", (_name, raw) => {
    expect(checkUserText(raw)).toEqual({
      ok: false,
      reason: "Message is empty.",
    });
  });

  it("measures composed and decomposed é the same, as 1 character", () => {
    const composed = checkUserText("é");
    const decomposed = checkUserText("é");
    expect(composed).toEqual({ ok: true, text: "é" });
    expect(decomposed).toEqual({ ok: true, text: "é" });
  });

  it("accepts exactly the cap in visible characters", () => {
    const result = checkUserText("a".repeat(MAX_MESSAGE_LENGTH));
    expect(result.ok).toBe(true);
  });

  it("does not count invisible padding against the cap", () => {
    const padded = `${"a".repeat(MAX_MESSAGE_LENGTH)}${at(0x200b).repeat(500)}`;
    const result = checkUserText(padded);
    expect(result.ok && result.text.length).toBe(20_000);
  });

  it("refuses one character over the cap, naming both numbers", () => {
    expect(checkUserText("a".repeat(20_001))).toEqual({
      ok: false,
      reason: "Message is too long — 20,001 characters, limit 20,000.",
    });
  });
});

describe("conversationLength", () => {
  it("sums the characters of every text", () => {
    expect(conversationLength(["abc", "de", ""])).toBe(5);
  });

  it("is 0 for no texts", () => {
    expect(conversationLength([])).toBe(0);
  });
});
