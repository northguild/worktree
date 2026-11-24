// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Grade } from "./graders.ts";
import type { StreamRecord } from "./read-stream.ts";
import {
  type CaseReport,
  caseReport,
  diffLiveReports,
  type LiveReport,
  mergeReport,
  serialiseReport,
  writeReport,
} from "./report.ts";

// Expected values come from: plan #355 D11 (the report holds verdicts, checks, latency and Neurons and never answer text;
// it is written only by a run where every case passes; a pass that now fails is the regression, exit 1), and gmt's
// `evals/report.ts` at fccce75 for the diff's and the merge's shape. Each is a hand-built input with the output worked out
// from those rules, never read back from `report.ts`.

const pass = (neurons: number | null = 200): CaseReport => ({
  verdict: "pass",
  checks: { brain: true, links: true },
  neurons,
  firstTokenMs: 900,
  totalMs: 4000,
});
const fail = (): CaseReport => ({
  verdict: "fail",
  checks: { brain: true, links: false },
  neurons: 210,
  firstTokenMs: 950,
  totalMs: 4100,
});
const ungraded = (): CaseReport => ({
  verdict: "ungraded",
  checks: {},
  neurons: null,
  firstTokenMs: null,
  totalMs: null,
});

const committed: LiveReport = {
  brain: "cf-gemma-4-26b",
  model: "@cf/google/gemma-4-26b-a4b-it",
  generatedAt: "2026-11-24T10:00:00Z",
  neurons: { spent: 400, budget: 2500 },
  cases: { a: pass(200), b: pass(200) },
};

describe("diffLiveReports", () => {
  it("flags a pass that now fails as a regression, naming the check that moved", () => {
    const [diff] = diffLiveReports(committed, { a: fail() });
    expect(diff).toMatchObject({
      id: "a",
      before: "pass",
      after: "fail",
      regression: true,
      changedChecks: ["links: true -> false"],
    });
  });

  it("does not call a pass that is now ungraded a regression: nothing was measured", () => {
    const [diff] = diffLiveReports(committed, { a: ungraded() });
    expect(diff?.regression).toBe(false);
  });

  it("does not flag a case with no committed result, or one that still passes", () => {
    const diffs = diffLiveReports(committed, { b: pass(), z: fail() });
    expect(diffs.map((d) => [d.id, d.before, d.regression])).toEqual([
      ["b", "pass", false],
      ["z", "none", false],
    ]);
  });

  it("compares only the cases the run held, so a partial run is no regression elsewhere", () => {
    expect(diffLiveReports(committed, { b: pass() })).toHaveLength(1);
  });

  it("reports the Neurons and latency before and after, which it never gates on", () => {
    const [diff] = diffLiveReports(committed, { a: pass(260) });
    expect(diff).toMatchObject({
      neurons: { before: 200, after: 260 },
      regression: false,
    });
  });

  it("compares against nothing when no report is committed", () => {
    const [diff] = diffLiveReports(undefined, { a: pass() });
    expect(diff).toMatchObject({ before: "none", regression: false });
  });
});

describe("caseReport", () => {
  const record: StreamRecord = {
    text: "SECRET-ANSWER-TEXT: run `worktree remove` as described",
    traces: [
      { totalChunks: 1, retrievedCount: 1, chunkTitles: [], chunkUrls: [] },
      {
        totalChunks: 1,
        retrievedCount: 1,
        chunkTitles: [],
        chunkUrls: [],
        timings: {
          corpus: 1,
          search: 1,
          prompt: 1,
          firstToken: 812,
          total: 3300,
        },
      },
    ],
    progress: [],
    refusal: null,
    runError: null,
    usage: { inputTokens: 1, outputTokens: 1 },
    finishReason: "stop",
    faults: [],
  };
  const grade: Grade = {
    verdict: "fail",
    checks: [
      { name: "brain", pass: true },
      { name: "names", pass: false, detail: "missing SECRET-ANSWER-TEXT" },
    ],
  };

  it("keeps the verdict, a pass or fail per check, the latency of the last trace and the Neurons", () => {
    expect(caseReport(grade, record, 123)).toEqual({
      verdict: "fail",
      checks: { brain: true, names: false },
      neurons: 123,
      firstTokenMs: 812,
      totalMs: 3300,
    });
  });

  it("holds neither the answer text nor a check's detail, which can quote it", () => {
    const written = JSON.stringify(caseReport(grade, record, 123));
    expect(written).not.toContain("SECRET-ANSWER-TEXT");
    expect(written).not.toContain("missing");
  });

  it("reads latency as null when no trace carries it", () => {
    const bare = { ...record, traces: [] };
    expect(caseReport(grade, bare, null)).toMatchObject({
      firstTokenMs: null,
      totalMs: null,
      neurons: null,
    });
  });
});

describe("mergeReport and serialiseReport", () => {
  const run = {
    brain: "cf-gemma-4-26b",
    model: "@cf/google/gemma-4-26b-a4b-it",
    generatedAt: "2026-11-25T09:00:00Z",
    budget: 2500,
  };

  it("replaces the cases on a full run and totals the measured Neurons", () => {
    const merged = mergeReport(committed, {
      ...run,
      cases: { c: pass(100), d: pass(150) },
      partial: false,
    });
    expect(Object.keys(merged.cases)).toEqual(["c", "d"]);
    expect(merged.neurons).toEqual({ spent: 250, budget: 2500 });
  });

  it("replaces only its own entries on a partial run and adds their Neurons", () => {
    const merged = mergeReport(committed, {
      ...run,
      cases: { b: pass(90) },
      partial: true,
    });
    expect(merged.cases.a).toEqual(committed.cases.a);
    expect(merged.cases.b?.neurons).toBe(90);
    expect(merged.neurons.spent).toBe(400 + 90);
  });

  it("writes keys in sorted order at every depth, so a rewrite diffs quietly", () => {
    const text = serialiseReport(
      mergeReport(undefined, {
        ...run,
        cases: { z: pass(), a: pass() },
        partial: false,
      }),
    );
    expect(text.indexOf('"a"')).toBeLessThan(text.indexOf('"z"'));
    expect(text.indexOf('"brain"')).toBeLessThan(text.indexOf('"cases"'));
    expect(text.endsWith("}\n")).toBe(true);
  });
});

describe("writeReport — only a run where every case passed", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true });
  });
  const tmp = () => {
    const dir = mkdtempSync(join(tmpdir(), "evals-report-"));
    dirs.push(dir);
    return join(dir, "live-x.json");
  };
  const run = {
    brain: "x",
    model: "m",
    generatedAt: "2026-11-25T09:00:00Z",
    budget: 2500,
    partial: false,
  };

  it("refuses a run with a failed case, names it, and writes nothing", () => {
    const path = tmp();
    const result = writeReport(path, undefined, {
      ...run,
      cases: { a: pass(), b: fail() },
    });
    expect(result).toEqual({ written: false, reason: "failed: b" });
    expect(existsSync(path)).toBe(false);
  });

  it("refuses a run with an ungraded case: it was never measured", () => {
    const path = tmp();
    const result = writeReport(path, undefined, {
      ...run,
      cases: { a: pass(), c: ungraded() },
    });
    expect(result).toEqual({ written: false, reason: "ungraded: c" });
    expect(existsSync(path)).toBe(false);
  });

  it("refuses an empty run", () => {
    const result = writeReport(tmp(), undefined, { ...run, cases: {} });
    expect(result.written).toBe(false);
  });

  it("writes an all-passing run, formatted by the injected formatter, with no answer text", () => {
    const path = tmp();
    const formatted: string[] = [];
    const result = writeReport(
      path,
      undefined,
      { ...run, cases: { a: pass(), b: pass() } },
      (file) => formatted.push(file),
    );
    expect(result).toEqual({ written: true });
    expect(formatted).toEqual([path]);
    const written = JSON.parse(readFileSync(path, "utf8")) as LiveReport;
    expect(Object.keys(written.cases)).toEqual(["a", "b"]);
    expect(readFileSync(path, "utf8")).not.toMatch(/text|answer/i);
  });
});
