import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { redactSecrets } from "../lib/redact.js";
import {
  type AgentSessionEvent,
  isAllowedCreator,
  type SessionLedger,
} from "./linear-agent.js";
import type { AgentActivityContent } from "./linear-agent-api.js";

/**
 * Turning an accepted `AgentSessionEvent` into work (#115, D3-D5, D7, D8, D11):
 * team filter, de-duplication, creator allowlist, then
 * `thought` -> one `worktree branch` child -> `response` | `error`.
 *
 * Nothing here throws to the caller, and no error object is ever logged or
 * stringified: Phase 3's errors carry an unredacted `cause`, so only a message
 * that went through `clean()` leaves this module.
 */

/** Same shape as `IDENTIFIER_PATTERN` in linear-agent.ts (not exported there); D4 re-checks before argv. */
const IDENTIFIER_PATTERN = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

/**
 * Wall-clock limit for the child. Its own bounds sum to more than ten minutes
 * (the install alone is 10 min, SKILL.md "Bounded calls"), so 15 minutes lets a
 * slow install finish and still stops a wedged child.
 */
export const CHILD_TIMEOUT_MS = 15 * 60_000;

/** A body past this is cut; an activity is a status line, not a log. */
const MAX_DETAIL_CHARS = 500;

/**
 * Milliseconds a child has to exit after SIGTERM before SIGKILL; the same two as
 * `KILL_GRACE_MS` in `lib/cli.ts`, which the global test setup replaces with a
 * mock that omits it, so it is not imported.
 */
const KILL_GRACE_MS = 2_000;

/** The child's `--json` document is one line; anything past 1 MiB is not one. */
const MAX_STDOUT_BYTES = 1024 * 1024;

export interface SpawnRequest {
  argv: string[];
  stdin: string;
  timeoutMs: number;
}

/** Stderr is deliberately absent: it is never captured, so it cannot reach an activity. */
export interface ChildResult {
  /** Null when the child was killed. */
  exitCode: number | null;
  stdout: string;
  timedOut: boolean;
}

export type SpawnChild = (request: SpawnRequest) => Promise<ChildResult>;

export interface DispatchDeps {
  /** The agent's OAuth token; used for the activity client and masked out of every body. */
  token: string;
  /** Linear user ids that may start an agent (D5). */
  allowedCreators: readonly string[];
  /** Only sessions of this team are served (D3); unset serves every team. */
  teamKey?: string;
  ledger: SessionLedger;
  createActivity: (
    token: string,
    sessionId: string,
    content: AgentActivityContent,
  ) => Promise<void>;
  spawnChild: SpawnChild;
  timeoutMs?: number;
  /** Structured, redacted, one entry per event; never carries an error object. */
  log?: (entry: { event: string; sessionId: string; detail?: string }) => void;
}

/** The fixed brief (D8): the identifier and nothing an issue's author wrote. */
function buildBrief(identifier: string): string {
  return `Work on Linear issue ${identifier}. Read the repository's own conventions first.`;
}

function buildArgv(identifier: string): string[] {
  return ["branch", "--linear", identifier, "--agent-stdin", "--json", "--yes"];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseDocument(stdout: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

type Outcome = AgentActivityContent;

function interpret(result: ChildResult, timeoutMs: number): Outcome {
  if (result.timedOut) {
    return {
      type: "error",
      body: `The worktree command timed out after ${Math.round(timeoutMs / 60_000)} minutes and was stopped.`,
    };
  }

  const doc = parseDocument(result.stdout);
  const failure = doc && isRecord(doc.error) ? doc.error : null;
  const path = doc && typeof doc.path === "string" ? doc.path : null;
  const branch = doc && typeof doc.branch === "string" ? doc.branch : null;

  if (failure) {
    const code = typeof failure.code === "string" ? failure.code : "failed";
    const message = typeof failure.message === "string" ? failure.message : "";
    // D7: the CLI refuses a taken branch name with `invalid_value` and a
    // message saying "already" (branch.ts:518-535). Another `invalid_value`
    // is a real refusal and stays an error.
    if (code === "invalid_value" && /\balready\b/i.test(message)) {
      return {
        type: "response",
        body: `That branch already exists, so nothing new was created. ${message}`,
      };
    }
    return {
      type: "error",
      body: `The worktree command failed (${code}): ${message}`,
    };
  }

  if (path === null) {
    return {
      type: "error",
      body:
        result.exitCode === 0
          ? "The worktree command finished but printed no usable result."
          : `The worktree command exited with code ${result.exitCode} and printed no usable result.`,
    };
  }

  const where = `branch ${branch ?? "(unknown)"} at ${path}`;
  const agent = doc && isRecord(doc.agent) ? doc.agent : null;

  // `agent.prompted` is the delivery receipt (SKILL.md, "Output").
  if (agent === null || agent.prompted !== true) {
    return {
      type: "error",
      body: `The worktree was created (${where}) but the agent was not prompted, so nothing is working on the issue.`,
    };
  }
  if (result.exitCode !== 0) {
    return {
      type: "error",
      body: `The worktree was created (${where}) and the agent was prompted, but the command exited with code ${result.exitCode}.`,
    };
  }
  return {
    type: "response",
    body: `Started ${where}. The agent has been given the issue identifier.`,
  };
}

export async function handleSession(
  event: AgentSessionEvent,
  deps: DispatchDeps,
): Promise<void> {
  // Masks the token by value too: an OAuth token has no shape redactSecrets knows.
  const clean = (text: string) => {
    const masked = redactSecrets(text).split(deps.token).join("***");
    return masked.length > MAX_DETAIL_CHARS * 2
      ? `${masked.slice(0, MAX_DETAIL_CHARS * 2)}...`
      : masked;
  };
  const note = (name: string, detail?: string) =>
    deps.log?.({
      event: name,
      sessionId: event.sessionId,
      ...(detail === undefined ? {} : { detail: clean(detail) }),
    });
  const say = async (content: AgentActivityContent) => {
    try {
      await deps.createActivity(deps.token, event.sessionId, {
        type: content.type,
        body: clean(content.body),
      });
    } catch (error) {
      // Message only: the error's `cause` is not redacted.
      note(
        "activity.failed",
        `${content.type}: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  };

  // D3: another listener may own a session of another team.
  if (deps.teamKey !== undefined && event.teamKey !== deps.teamKey) {
    note("session.ignored", "other team");
    return;
  }

  // D11: a follow-up is acknowledged, never relayed. It is not de-duplicated:
  // it shares the created event's session id by design.
  if (event.action === "prompted") {
    await say({
      type: "response",
      body: "Follow-up messages are not delivered to a running agent yet. The agent started from the original delegation keeps working on it.",
    });
    return;
  }

  if (deps.ledger.seen(event.sessionId)) {
    note("session.ignored", "repeat session id");
    return;
  }

  if (!isAllowedCreator(event.creatorId, deps.allowedCreators)) {
    note("session.refused", "creator not allowed");
    await say({
      type: "error",
      body: "You are not on this listener's list of people who may start an agent, so no worktree was created.",
    });
    return;
  }

  if (!IDENTIFIER_PATTERN.test(event.issueIdentifier)) {
    note("session.refused", "identifier failed validation");
    await say({
      type: "error",
      body: "The issue identifier is not one this listener will pass to a command, so no worktree was created.",
    });
    return;
  }

  await say({
    type: "thought",
    body: `Starting a worktree for ${event.issueIdentifier}.`,
  });

  const timeoutMs = deps.timeoutMs ?? CHILD_TIMEOUT_MS;
  let outcome: Outcome;
  try {
    const result = await deps.spawnChild({
      argv: buildArgv(event.issueIdentifier),
      stdin: buildBrief(event.issueIdentifier),
      timeoutMs,
    });
    outcome = interpret(result, timeoutMs);
  } catch (error) {
    note(
      "child.failed",
      error instanceof Error ? error.message : "could not start",
    );
    outcome = {
      type: "error",
      body: "The worktree command could not be started.",
    };
  }
  note("session.done", outcome.type);
  await say(outcome);
}

/** `bin/run.js` sits two levels above both `src/integrations` and `dist/integrations`. */
const DEFAULT_CLI_ENTRY = fileURLToPath(
  new URL("../../bin/run.js", import.meta.url),
);

/**
 * The real spawner (D4): this package's own CLI, run with the Node that runs
 * the listener (`process.execPath` + entry), so it needs no `worktree` on PATH
 * and always matches the listener's version. An argv array, no shell; the brief
 * goes to stdin; stderr is discarded; SIGTERM at the limit, SIGKILL
 * `KILL_GRACE_MS` later (as `cli.ts` does for its own bounded calls).
 */
export function createCliSpawner(entry = DEFAULT_CLI_ENTRY): SpawnChild {
  return ({ argv, stdin, timeoutMs }) =>
    new Promise<ChildResult>((resolve, reject) => {
      const child = spawn(process.execPath, [entry, ...argv], {
        stdio: ["pipe", "pipe", "ignore"],
      });
      const chunks: Buffer[] = [];
      let bytes = 0;
      let timedOut = false;

      const term = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs);
      const kill = setTimeout(
        () => child.kill("SIGKILL"),
        timeoutMs + KILL_GRACE_MS,
      );
      const disarm = () => {
        clearTimeout(term);
        clearTimeout(kill);
      };

      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes <= MAX_STDOUT_BYTES) {
          chunks.push(chunk);
        }
      });
      // A child that exits before reading its brief closes the pipe.
      child.stdin.on("error", () => {});
      child.stdin.end(stdin);

      child.on("error", (error) => {
        disarm();
        reject(error);
      });
      child.on("close", (exitCode) => {
        disarm();
        resolve({
          exitCode,
          stdout:
            bytes <= MAX_STDOUT_BYTES ? Buffer.concat(chunks).toString() : "",
          timedOut,
        });
      });
    });
}
