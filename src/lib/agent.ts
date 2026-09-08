import path from "node:path";
import { run } from "./cli.js";
import { gitGetConfigValue } from "./git.js";
import type { AgentSession } from "./types.js";

// The only module that knows an agent runtime's session JSON exists. Nothing
// outside this file reads `kind`, `state` or `status` — the three fields that
// appear in the output but not in the runtime's own --help — so swapping
// runtimes touches one module. See AGENT-MODE-PLAN §4.

// `--all` is deliberately absent, and its absence is the primary guard against
// wedging a worktree behind a session that has already finished: the default
// listing excludes completed sessions, and --all is exactly what adds them back.
// See AGENT-MODE-PLAN §3 D4/D6.
const SESSION_ARGS = ["agents", "--json"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Read one string field, treating a wrong type the same as an absent one. The
// runtime writes `"status": null` rather than omitting it on a finished session,
// so null has to fall through to undefined here — every caller then compares
// against a known value instead of testing truthiness. See §4.1.
function readOptionalString(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

// An entry missing its identifying fields is dropped rather than patched: name
// and pid are what `list` renders and cwd is the join key, so an entry without
// them cannot match a worktree in the first place. The three optional fields are
// the ones R3 expects to be renamed one day; losing one degrades a marker, not
// the session.
function toAgentSession(entry: unknown): AgentSession | undefined {
  if (!isRecord(entry)) {
    return undefined;
  }

  const { name, pid, cwd } = entry;
  if (typeof name !== "string" || typeof pid !== "number") {
    return undefined;
  }
  if (typeof cwd !== "string" || !cwd) {
    return undefined;
  }

  return {
    name,
    pid,
    cwd,
    kind: readOptionalString(entry, "kind"),
    status: readOptionalString(entry, "status"),
    state: readOptionalString(entry, "state"),
  };
}

// One invocation per command run, joined in-process afterwards (D4). Every
// failure — no agent configured, a missing binary, a non-zero exit, output that
// is not JSON, or JSON that is not an array — yields no sessions and no error:
// this must never become a hard dependency on any particular agent runtime.
export async function getAgentSessions(): Promise<AgentSession[]> {
  const agentCommand = await gitGetConfigValue("agent.command");
  // agent.command is a dispatch command line, e.g. `claude --bg`. Only its head
  // is reused here, because listing sessions is a different subcommand of the
  // same program: appending the dispatch arguments would ask for
  // `claude --bg agents --json`.
  const [agent] = agentCommand.trim().split(/\s+/);

  if (!agent) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(await run(agent, SESSION_ARGS));
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .map(toAgentSession)
      .filter((session): session is AgentSession => session !== undefined);
  } catch {
    return [];
  }
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  if (relative === "") {
    return true;
  }
  if (path.isAbsolute(relative)) {
    return false;
  }
  // Compared segment-wise rather than by string prefix, so a sibling worktree
  // whose name merely starts with this one's does not match.
  return relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

// A session counts as living in a worktree when its cwd is the worktree itself
// or anything under it. Nesting matters for the case D5 exists to protect: this
// CLI dispatches an agent with cwd set to the worktree exactly, but a human's
// own terminal is just as likely to sit in a subdirectory of one, and deleting
// a directory somebody is working in is the failure mode to avoid.
//
// A live match wins over a finished one. Two sessions in one worktree is the
// ordinary case for `--agent`, which dispatches an agent and then opens the
// editor, and the runtime's listing order is not ours to rely on: handing back a
// finished session first would tell the caller the worktree is free while
// somebody is still working in it. D5 blocks on any session, not on the first.
export function findSessionForPath(
  sessions: AgentSession[],
  worktreePath: string,
): AgentSession | undefined {
  const isHere = (session: AgentSession) =>
    isPathInside(worktreePath, session.cwd);

  return (
    sessions.find((session) => isHere(session) && isSessionLive(session)) ??
    sessions.find(isHere)
  );
}

// Fails safe: an absent or unrecognised state counts as live, so a session whose
// shape we no longer recognise blocks removal rather than being ignored. That is
// also what makes an interactive session live, since those carry no state at
// all. See D6 and §4.1.
export function isSessionLive(session: AgentSession): boolean {
  return session.state !== "done";
}

// Live but not progressing. Only ever true for a background session: a human's
// own terminal is marked interactive, not waiting. Today an interactive entry
// carries neither field, so the kind test is redundant — it is here so the
// invariant holds by construction rather than by coincidence, should a runtime
// start attaching a status to interactive sessions. An unrecognised vocabulary
// degrades this to "no marker", which is cosmetic. See §4.1.
export function isSessionWaiting(session: AgentSession): boolean {
  if (!isSessionLive(session) || isSessionInteractive(session)) {
    return false;
  }
  return session.state === "blocked" || session.status === "idle";
}

// Keeps `kind` inside this module while still letting `list` tell a human's own
// terminal apart from an agent this CLI dispatched (D5, Q2).
export function isSessionInteractive(session: AgentSession): boolean {
  return session.kind === "interactive";
}
