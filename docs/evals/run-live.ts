// The live layer of the Dox chat evals (plan #355 §4.5, D8-D12): asks the `live` cases of a running Worker, grades each
// streamed answer with code, prices it from the usage `RUN_FINISHED` carries, and compares the run with the committed report.
//
// **It spends real quota.** Workers AI models never run locally, so every case draws on the account's 10,000 Neurons for
// the day, the pool the live site answers from. `budget.ts` holds the limits and `--help` states them. Never in CI.
//
// Run from the repo root, with the Worker built and started by `worker:dev:evals` (`docs/evals/README.md` has the runbook):
//
//   pnpm --filter docs evals:live --help
//
// It never reads, logs or passes `GEMINI_API_KEY`: a Gemini run needs the key in the Worker's own `.dev.vars`, never a flag.
//
// Loaded under Node's type stripping (D8), through the `evals:live` script: erasable syntax only, and relative imports carry
// a `.ts` extension. It never imports `prepare-turn.ts` or the handler: it talks to the Worker over HTTP.
//
// Exit: 0 clean; 1 a case that passed in the committed report now fails; 2 a usage error, or no Worker to run against;
// 3 the run left cases ungraded (a 429, every brain out for the day, a lost connection, or the budget).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { convertUnixToUtc } from "@northguild/gmt/unix/convert";
import { getUnixNow } from "@northguild/gmt/unix/get";
import { z } from "zod";
import { BRAINS } from "../src/chat/lib/chat-constants.ts";
import { buildCorpus } from "../worker/build-context.mjs";
import {
  type CommittedReports,
  type GuardBrain,
  measureNeurons,
  parseRunArgs,
  RunGuard,
  USAGE,
  WORST_CASE_NEURONS,
} from "./budget.ts";
import { CASES, type EvalCase } from "./cases.ts";
import { GRADER_NAMES, type Grade, grade, indexDocs } from "./graders.ts";
import { parseStream, type StreamRecord } from "./read-stream.ts";
import {
  type CaseReport,
  caseReport,
  diffLiveReports,
  type LiveReport,
  writeReport,
} from "./report.ts";

const DOCS = resolve(fileURLToPath(new URL("..", import.meta.url)));
const REPO = resolve(DOCS, "..");
const EVALS = join(DOCS, "evals");

const reportPath = (brainId: string) => join(EVALS, `live-${brainId}.json`);

const CASE_REPORT = z.object({
  verdict: z.enum(["pass", "fail", "ungraded"]),
  checks: z.partialRecord(z.enum(GRADER_NAMES), z.boolean()),
  neurons: z.number().nullable(),
  firstTokenMs: z.number().nullable(),
  totalMs: z.number().nullable(),
});

const LIVE_REPORT = z.object({
  brain: z.string(),
  model: z.string(),
  generatedAt: z.string(),
  neurons: z.object({ spent: z.number(), budget: z.number() }),
  cases: z.record(z.string(), CASE_REPORT),
});

/** `GET /api/brains`: only what the runner reads. */
const BRAINS_RESPONSE = z.object({
  brains: z.array(
    z.looseObject({
      id: z.string(),
      provider: z.enum(["workers-ai", "google"]),
    }),
  ),
});

function readCommitted(brainId: string): LiveReport | undefined {
  const path = reportPath(brainId);
  if (!existsSync(path)) return undefined;
  const parsed = LIVE_REPORT.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    throw new Error(
      `${path} is not a live report: ${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));

function usageError(message: string): never {
  console.error(message);
  console.error("Run with --help for usage.");
  process.exit(2);
}

const argv = process.argv.slice(2);
const liveCases = CASES.filter((c) => c.live === true);
const committed: Record<string, LiveReport | undefined> = Object.fromEntries(
  BRAINS.map((brain) => [brain.id, readCommitted(brain.id)]),
);
const committedNeurons: CommittedReports = committed;

// 1. Parse the flags, `--help` included; 2. refuse under CI. Neither sends a request.
const parsed = parseRunArgs(argv, process.env, {
  brains: BRAINS,
  liveCases,
  committed: committedNeurons,
});
if (parsed.kind === "help") {
  console.log(USAGE);
  process.exit(0);
}
if (parsed.kind === "error") usageError(parsed.message);
if (parsed.kind === "preview") {
  console.log(parsed.lines.join("\n"));
  process.exit(0);
}
const { options, brains, cases } = parsed;

// 3. `GET /api/brains`: no answer is exit 2, and an asked brain that is not offered is exit 2.
async function offeredBrains(): Promise<Map<string, GuardBrain["provider"]>> {
  let response: Response;
  try {
    response = await fetch(`${options.base}/api/brains`);
  } catch (error) {
    usageError(
      `No Worker at ${options.base} (${error instanceof Error ? error.message : String(error)}). Build it and start it with \`pnpm --filter docs worker:build\` then \`pnpm --filter docs worker:dev:evals\`, and read its log for a start-up error. Nothing was spent.`,
    );
  }
  const body = BRAINS_RESPONSE.safeParse(
    response.ok ? await response.json().catch(() => null) : null,
  );
  if (!body.success) {
    usageError(
      `${options.base}/api/brains answered ${response.status}, which is not a brains list: this is not the Dox Worker. Nothing was spent.`,
    );
  }
  return new Map(body.data.brains.map((b) => [b.id, b.provider]));
}

const offered = await offeredBrains();
const missing = brains.filter((brain) => !offered.has(brain.id));
if (!options.all && missing.length > 0) {
  usageError(
    `${missing.map((b) => b.id).join(", ")} is not offered by the Worker at ${options.base} (it offers ${[...offered.keys()].join(", ") || "no brains"}). A Gemini brain needs the key in .dev.vars: start the Worker with \`worker:dev:evals:gemini\`.`,
  );
}
if (
  [...offered.values()].includes("google") &&
  brains.every((brain) => brain.provider === "workers-ai")
) {
  console.warn(
    "! Gemini brains are configured: a failing Workers AI brain may fail over onto their small daily allowance. The `brain` check flags any answer from another brain.",
  );
}

// 4. Build the corpus in process, to grade against and to catch a stale `worker/dist`.
const BUILT = buildCorpus(
  join(REPO, "docs/src/content/docs"),
  readFileSync(join(REPO, "skills/worktree/SKILL.md"), "utf8"),
);
const DOCS_INDEX = indexDocs(
  [
    ...BUILT.chunks.map((chunk) => chunk.text),
    ...BUILT.vocabulary.map((section) => section.text),
  ].join("\n"),
  BUILT.chunks.map((chunk) => chunk.url),
);

/** The wire body the client sends (`validation.ts`); the brain rides in `forwardedProps`. */
function requestBody(brainId: string, c: EvalCase): string {
  const messages = [
    ...(c.history ?? []),
    { role: "user" as const, content: c.question },
  ].map((message, i) => ({ id: `m${i}`, ...message }));
  return JSON.stringify({
    threadId: `eval-${c.id}`,
    runId: crypto.randomUUID(),
    messages,
    tools: [],
    context: [],
    forwardedProps: {
      brain: brainId,
      ...(c.page === undefined ? {} : { pageContext: c.page }),
    },
  });
}

type Asked =
  | { kind: "answer"; status: number; record: StreamRecord }
  /** `mayHaveSpent`: the request reached the model, so the answer may have been generated and billed unread. */
  | { kind: "no-answer"; reason: string; mayHaveSpent: boolean };

// 5. `POST /api/chat`, then 6. read the SSE stream.
async function ask(brainId: string, c: EvalCase): Promise<Asked> {
  let response: Response;
  try {
    response = await fetch(`${options.base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: requestBody(brainId, c),
    });
  } catch (error) {
    return {
      kind: "no-answer",
      reason: `no answer: ${error instanceof Error ? error.message : String(error)}`,
      mayHaveSpent: false,
    };
  }
  // Every answer is a 200 stream; a model's failure is a `RUN_ERROR` inside it. Anything else is the Worker's JSON error
  // (a 429, a 400 from validation, a 500), which spent nothing and is no answer to grade.
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    let error = "";
    try {
      const parsed: unknown = JSON.parse(text);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        "error" in parsed &&
        typeof parsed.error === "string"
      ) {
        error = `: ${parsed.error}`;
      }
    } catch {}
    return {
      kind: "no-answer",
      reason:
        response.status === 429
          ? "429: rate limited"
          : `HTTP ${response.status}${error}`,
      mayHaveSpent: false,
    };
  }
  // The body can fail after the headers arrived: the Worker dies or drops the socket mid-stream.
  let body: string;
  try {
    body = await response.text();
  } catch (error) {
    return {
      kind: "no-answer",
      reason: `lost connection: ${error instanceof Error ? error.message : String(error)}`,
      mayHaveSpent: true,
    };
  }
  return { kind: "answer", status: response.status, record: parseStream(body) };
}

const ungraded = (): CaseReport => ({
  verdict: "ungraded",
  checks: {},
  neurons: null,
  firstTokenMs: null,
  totalMs: null,
});

const guard = new RunGuard(options, committedNeurons);
// `convertUnixToUtc` answers "" for a time it cannot convert, never null.
const generatedAt = convertUnixToUtc(getUnixNow() ?? 0) || "unknown";
/** Some case was left `ungraded`: exit 3, whichever limit or failure left it. */
let leftUngraded = false;
/** Nothing later can be measured: no answer came, or every brain is out for the day. */
let endRun = false;
let regression = false;

for (const brain of brains) {
  if (!offered.has(brain.id)) {
    console.warn(`! ${brain.id} is not offered by this Worker; skipping`);
    continue;
  }
  const label = BRAINS.find((b) => b.id === brain.id)?.label ?? brain.id;
  const results: Record<string, CaseReport> = {};
  const full: { id: string; grade: Grade; record: StreamRecord }[] = [];
  let sent = 0;

  for (const c of cases) {
    const decision = guard.decide(brain, c.id);
    if (!decision.start) {
      results[c.id] = ungraded();
      console.log(
        `UNGRADED ${brain.id.padEnd(22)} ${c.id.padEnd(38)} stopped: ${decision.note}`,
      );
      leftUngraded = true;
      continue;
    }

    if (sent > 0) await sleep(options.delayMs);
    sent += 1;
    const asked = await ask(brain.id, c);

    if (asked.kind === "no-answer") {
      // A stream lost after the headers may have been answered and billed in full: book the worst case, so the run
      // never under-reports what it took from the shared daily pool.
      const booked =
        asked.mayHaveSpent && brain.provider === "workers-ai"
          ? WORST_CASE_NEURONS
          : 0;
      guard.record(brain, booked);
      results[c.id] = ungraded();
      console.log(
        `UNGRADED ${brain.id.padEnd(22)} ${c.id.padEnd(38)} ${asked.reason}${booked > 0 ? ` (booked as ${booked} N)` : ""}`,
      );
      console.warn(
        "! No answer; stopping, because the rest would only measure the failure.",
      );
      leftUngraded = true;
      endRun = true;
      break;
    }

    const { record } = asked;
    // 7. A trace that disagrees with the in-process corpus means a stale `worker/dist`.
    const trace = record.traces.at(-1);
    if (trace !== undefined && trace.totalChunks !== BUILT.chunks.length) {
      console.error(
        `The Worker indexes ${trace.totalChunks} chunks and the docs build ${BUILT.chunks.length}: worker/dist is stale. Run \`pnpm --filter docs worker:build\`, restart the Worker, and run again. Spent ${guard.spent} Neurons.`,
      );
      process.exit(2);
    }

    // 8. Grade, price, print.
    const graded = grade({
      case: c,
      askedBrain: label,
      docs: DOCS_INDEX,
      record,
    });
    let neurons: number | null = null;
    let note = "";
    let spent = 0;
    if (brain.provider === "workers-ai" && graded.verdict !== "ungraded") {
      const measured = measureNeurons(brain, record.usage);
      spent = measured.neurons;
      neurons = measured.measured ? measured.neurons : null;
      if (!measured.measured) {
        note = ` unmeasured (no usage: counted as ${measured.neurons})`;
      }
    }
    // A request counts once: a Gemini one against its model's cap, a Workers AI one against the budget.
    guard.record(brain, spent);
    results[c.id] = caseReport(graded, record, neurons);
    full.push({ id: c.id, grade: graded, record });

    const failed = graded.checks
      .filter((check) => !check.pass)
      .map((check) => `${check.name}: ${check.detail ?? "failed"}`);
    const detail = [
      ...(asked.status === 200 ? [] : [`HTTP ${asked.status}`]),
      ...(graded.reason === undefined ? [] : [graded.reason]),
      ...failed,
    ].join("; ");
    console.log(
      `${graded.verdict.toUpperCase().padEnd(8)} ${brain.id.padEnd(22)} ${c.id.padEnd(38)} ${String(record.traces.at(-1)?.timings?.total ?? "?").padStart(6)} ms  ${neurons ?? "?"} N${note}  ${detail}`,
    );

    if (graded.verdict === "ungraded") {
      console.warn(
        "! Every brain is out for the day; stopping, because the rest would only measure the quota.",
      );
      leftUngraded = true;
      endRun = true;
      break;
    }
  }

  if (Object.keys(results).length === 0) continue;

  // The full answers, which the report never holds, go to the gitignored cache.
  const outDir = resolve(DOCS, options.outDir);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, `${brain.id}-${generatedAt.replaceAll(":", "-")}.json`),
    JSON.stringify({ brain: brain.id, generatedAt, cases: full }, null, 2),
  );

  const before = committed[brain.id];
  const diffs = diffLiveReports(before, results);
  console.log(
    `\n${brain.id}: case, committed -> new, checks changed (latency and Neurons are never gated)`,
  );
  for (const diff of diffs) {
    console.log(
      `  ${diff.id.padEnd(38)} ${diff.before} -> ${diff.after}${diff.regression ? "  REGRESSION" : ""}  ${diff.changedChecks.join(", ")}  | ${diff.totalMs.before ?? "-"} -> ${diff.totalMs.after ?? "-"} ms, ${diff.neurons.before ?? "-"} -> ${diff.neurons.after ?? "-"} N`,
    );
  }
  if (diffs.some((diff) => diff.regression)) regression = true;

  if (options.writeBaseline) {
    const written = writeReport(reportPath(brain.id), before, {
      brain: brain.id,
      model: brain.model ?? brain.id,
      generatedAt,
      budget: options.budget,
      cases: results,
      partial: options.only.length > 0,
    });
    console.log(
      written.written
        ? `wrote ${reportPath(brain.id)}`
        : `! ${brain.id}: no report written, because only a run where every case passed may write one (${written.reason}).`,
    );
  }
  if (endRun) break;
}

console.log(`\nspent ${guard.spent} of ${options.budget} Neurons`);
process.exit(regression ? 1 : leftUngraded ? 3 : 0);
