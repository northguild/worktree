// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_BUDGET,
  DEFAULT_GEMINI_CAP,
  type GuardBrain,
  measureNeurons,
  type Parsed,
  parseRunArgs,
  RunGuard,
  USAGE,
  WORST_CASE_NEURONS,
} from "./budget.ts";
import type { EvalCase } from "./cases.ts";

// Expected values come from: plan #355 D10 and D11 (the rates, the 350 worst case, the 2,500 default, the CI refusal, the
// preview and the exit rules); Cloudflare's Workers AI pricing page, read 2026-11-24 (Gemma 4 26B 9,091 Neurons per million
// input tokens and 27,273 per million output; GLM 4.7 Flash 5,500 and 36,400); and arithmetic done by hand. One measured
// answer is independent of this code: gmt's own record of a Gemma 4 26B question that used 29,238 input tokens and 33
// output tokens and cost 267 Neurons (29,238 x 9,091 / 10^6 = 265.80, 33 x 27,273 / 10^6 = 0.90, 266.70, rounded).

const GEMMA: GuardBrain = {
  id: "cf-gemma-4-26b",
  provider: "workers-ai",
  model: "@cf/google/gemma-4-26b-a4b-it",
};
const GLM: GuardBrain = {
  id: "cf-glm-4.7-flash",
  provider: "workers-ai",
  model: "@cf/zai-org/glm-4.7-flash",
};
const FLASH: GuardBrain = { id: "gemini-3.6-flash", provider: "google" };
const LITE: GuardBrain = { id: "gemini-3.5-flash-lite", provider: "google" };
const BRAINS = [GEMMA, GLM, LITE, FLASH];

const live = (id: string): EvalCase => ({
  id,
  kind: "lookup",
  question: `question ${id}`,
  live: true,
});
const CASES = [live("a"), live("b"), live("c")];
const KNOWN = { brains: BRAINS, liveCases: CASES };

function parse(
  argv: string[],
  env: Record<string, string | undefined> = {},
  committed?: Parameters<typeof parseRunArgs>[2]["committed"],
): Parsed {
  return parseRunArgs(argv, env, { ...KNOWN, ...(committed && { committed }) });
}

function asRun(parsed: Parsed) {
  if (parsed.kind !== "run") {
    throw new Error(`expected a run, got ${JSON.stringify(parsed)}`);
  }
  return parsed;
}

describe("measureNeurons", () => {
  it("prices a measured Gemma answer from its token counts (gmt's recorded 267)", () => {
    expect(
      measureNeurons(GEMMA, { inputTokens: 29_238, outputTokens: 33 }),
    ).toEqual({ neurons: 267, measured: true });
  });

  it("uses Gemma's output rate: one million output tokens is 27,273", () => {
    expect(
      measureNeurons(GEMMA, { inputTokens: 0, outputTokens: 1_000_000 }),
    ).toEqual({ neurons: 27_273, measured: true });
  });

  it("uses GLM's rates: a million in and a million out is 5,500 + 36,400", () => {
    expect(
      measureNeurons(GLM, { inputTokens: 1_000_000, outputTokens: 1_000_000 }),
    ).toEqual({ neurons: 41_900, measured: true });
  });

  it("counts an answer with no usage as the worst case and says it was not measured", () => {
    expect(measureNeurons(GEMMA, null)).toEqual({
      neurons: WORST_CASE_NEURONS,
      measured: false,
    });
  });

  it("counts a model it has no rates for as the worst case", () => {
    const unknown: GuardBrain = {
      id: "x",
      provider: "workers-ai",
      model: "@cf/x",
    };
    expect(
      measureNeurons(unknown, { inputTokens: 10, outputTokens: 10 }),
    ).toEqual({
      neurons: WORST_CASE_NEURONS,
      measured: false,
    });
  });
});

describe("the constants", () => {
  it("keep gmt's worst case of 350 and default budget of 2,500 (D10, D11)", () => {
    expect(WORST_CASE_NEURONS).toBe(350);
    expect(DEFAULT_BUDGET).toBe(2500);
  });
});

describe("parseRunArgs — the refusals that precede any request", () => {
  it("refuses under CI, for a plain run and for the all-brains preview alike", () => {
    for (const argv of [[], ["--brains", "all"], ["--only", "a"]]) {
      const parsed = parse(argv, { CI: "true" });
      expect(parsed.kind).toBe("error");
      if (parsed.kind === "error") expect(parsed.message).toMatch(/CI/);
    }
  });

  it("prints help, which makes no request, with the flags and the cost in the text", () => {
    expect(parse(["--help"]).kind).toBe("help");
    expect(parse(["-h"]).kind).toBe("help");
    for (const flag of [
      "--base",
      "--brains",
      "--confirm-spend",
      "--only",
      "--budget",
      "--gemini-cap",
      "--delay-ms",
      "--out-dir",
      "--write-baseline",
    ]) {
      expect(USAGE).toContain(flag);
    }
    expect(USAGE).toMatch(/Neurons/);
    expect(USAGE).toContain("2500");
  });

  it("rejects an unknown flag, a malformed number and an unknown brain or case", () => {
    expect(parse(["--nope"]).kind).toBe("error");
    expect(parse(["--budget", "lots"]).kind).toBe("error");
    expect(parse(["--budget", "-1"]).kind).toBe("error");
    expect(parse(["--brains", "gpt-5"]).kind).toBe("error");
    expect(parse(["--only", "zzz"]).kind).toBe("error");
  });
});

describe("parseRunArgs — what a default run is", () => {
  it("is the first brain, the live cases and the default budget", () => {
    const { options, brains, cases } = asRun(parse([]));
    expect(brains.map((b) => b.id)).toEqual(["cf-gemma-4-26b"]);
    expect(cases.map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(options.budget).toBe(DEFAULT_BUDGET);
    expect(options.geminiCap).toBe(DEFAULT_GEMINI_CAP);
    expect(options.base).toBe("http://localhost:8787");
    expect(options.writeBaseline).toBe(false);
  });

  it("strips a trailing slash from --base", () => {
    expect(asRun(parse(["--base", "http://x:1/"])).options.base).toBe(
      "http://x:1",
    );
  });

  it("re-runs only the named cases", () => {
    const { cases, options } = asRun(parse(["--only", "b,c"]));
    expect(cases.map((c) => c.id)).toEqual(["b", "c"]);
    expect(options.only).toEqual(["b", "c"]);
  });
});

describe("parseRunArgs — --brains all asks first", () => {
  it("prints its estimate and stops without --confirm-spend", () => {
    const parsed = parse(["--brains", "all"]);
    expect(parsed.kind).toBe("preview");
    if (parsed.kind !== "preview") return;
    const text = parsed.lines.join("\n");
    // 3 live cases x 350 worst case = 1,050 Neurons for each of the two Workers AI brains.
    expect(text).toContain("cf-gemma-4-26b: 3 cases, about 1050 Neurons");
    expect(text).toContain("cf-glm-4.7-flash: 3 cases, about 1050 Neurons");
    // A Gemini brain is capped at 3 requests by default, and its 3 cases fit.
    expect(text).toContain("gemini-3.6-flash: 3 cases, up to 3 requests");
    expect(text).toContain("Nothing was sent");
  });

  it("reads the committed report's figure for the estimate, and 350 for a case it lacks", () => {
    const parsed = parse(
      ["--brains", "all"],
      {},
      {
        "cf-gemma-4-26b": {
          cases: { a: { neurons: 100 }, b: { neurons: null } },
        },
      },
    );
    if (parsed.kind !== "preview") throw new Error("expected a preview");
    // a: 100 (committed), b: null so 350, c: absent so 350.
    expect(parsed.lines.join("\n")).toContain(
      "cf-gemma-4-26b: 3 cases, about 800 Neurons",
    );
  });

  it("caps a Gemini brain's estimate at the cap", () => {
    const parsed = parse(["--brains", "all", "--gemini-cap", "2"]);
    if (parsed.kind !== "preview") throw new Error("expected a preview");
    expect(parsed.lines.join("\n")).toContain("up to 2 requests");
  });

  it("runs every brain once --confirm-spend is given", () => {
    const { brains, options } = asRun(
      parse(["--brains", "all", "--confirm-spend"]),
    );
    expect(brains).toHaveLength(4);
    expect(options.all).toBe(true);
  });
});

describe("RunGuard — a run stops before overspending", () => {
  it("reserves 350 for a case the committed report lacks, and stops the case that would pass the budget", () => {
    const guard = new RunGuard({ budget: 1000, geminiCap: 3 });
    expect(guard.decide(GEMMA, "a")).toEqual({ start: true });
    guard.record(GEMMA, 350);
    expect(guard.decide(GEMMA, "b")).toEqual({ start: true });
    guard.record(GEMMA, 350);
    // 700 spent, and 700 + 350 = 1,050 is over 1,000.
    expect(guard.decide(GEMMA, "c")).toEqual({
      start: false,
      note: "budget",
      endsRun: true,
    });
  });

  it("keeps stopping every case after the first stop, even a cheap one", () => {
    const guard = new RunGuard(
      { budget: 100, geminiCap: 3 },
      { [GEMMA.id]: { cases: { cheap: { neurons: 1 } } } },
    );
    expect(guard.decide(GEMMA, "dear").start).toBe(false);
    expect(guard.decide(GEMMA, "cheap")).toEqual({
      start: false,
      note: "budget",
      endsRun: true,
    });
  });

  it("reserves the committed report's figure for a case it holds", () => {
    // Budget 120: a case committed at 100 fits, where the 350 worst case would not.
    const guard = new RunGuard(
      { budget: 120, geminiCap: 3 },
      { [GEMMA.id]: { cases: { a: { neurons: 100 } } } },
    );
    expect(guard.decide(GEMMA, "a")).toEqual({ start: true });
    guard.record(GEMMA, 100);
    // 100 spent; a case with no committed figure needs 350 more.
    expect(guard.decide(GEMMA, "b").start).toBe(false);
  });

  it("spends the measured figure, not the reservation", () => {
    const guard = new RunGuard({ budget: 400, geminiCap: 3 });
    guard.decide(GEMMA, "a");
    guard.record(GEMMA, 50);
    expect(guard.spent).toBe(50);
    // 50 + 350 = 400 is not over 400.
    expect(guard.decide(GEMMA, "b")).toEqual({ start: true });
  });

  it("counts a Gemini request against its model's cap alone, and spends no Neurons on it", () => {
    const guard = new RunGuard({ budget: 10, geminiCap: 2 });
    for (const id of ["a", "b"]) {
      expect(guard.decide(FLASH, id)).toEqual({ start: true });
      guard.record(FLASH, 0);
    }
    expect(guard.decide(FLASH, "c")).toEqual({
      start: false,
      note: "gemini cap",
      endsRun: false,
    });
    // Another Gemini model has its own count, and the Neuron budget is untouched.
    expect(guard.decide(LITE, "a")).toEqual({ start: true });
    expect(guard.spent).toBe(0);
  });
});
