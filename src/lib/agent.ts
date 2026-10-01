import { realpath } from "node:fs/promises";
import path from "node:path";
import {
  type HerdrAgentEntry,
  isHerdrInstalled,
  listHerdrAgents,
} from "../integrations/herdr.js";
import { run } from "./cli.js";
import { gitGetConfigValue } from "./git.js";
import type { AgentSession } from "./types.js";
import { splitCommandValue } from "./utils.js";

// The only module that knows an agent runtime's session JSON exists. Nothing
// outside this file reads `kind`, `state` or `status` — the three fields that
// appear in the output but not in the runtime's own --help — so swapping
// runtimes touches one module. See AGENT-MODE-PLAN §4.
//
// Sessions come from two sources and are joined here (D14 of #70): the
// runtime's own listing, which knows names, pids and whether a session
// finished, and Herdr's `agent list`, which knows the sessions it started
// itself — including ones the runtime listing has no pid for.

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

// Only `cwd` is load-bearing: it is the join key, so an entry without one
// cannot match a worktree. `name` and `pid` are rendering fields, and dropping
// an entry over one would yield no session where one exists — the direction
// `cleanup` fails unsafe in (F-021). A background session with no pid at all is
// real: the runtime omits it for one it is not currently running a process for.
// A nameless entry is labelled by whatever identifies it instead.
//
// `kind`, `state` and `status` are the three R3 expects to be renamed one day;
// losing one degrades a marker, not the session.
function toAgentSession(entry: unknown): AgentSession | undefined {
  if (!isRecord(entry)) {
    return undefined;
  }

  const { cwd, pid } = entry;
  if (typeof cwd !== "string" || !cwd) {
    return undefined;
  }

  const sessionId = readOptionalString(entry, "sessionId");

  return {
    name:
      readOptionalString(entry, "name") ??
      readOptionalString(entry, "id") ??
      sessionId ??
      "session",
    pid: typeof pid === "number" ? pid : undefined,
    cwd,
    sessionId,
    kind: readOptionalString(entry, "kind"),
    status: readOptionalString(entry, "status"),
    state: readOptionalString(entry, "state"),
  };
}

// Both sides of every path comparison go through this (F-022). `/tmp/wt` and
// `/private/tmp/wt` are one directory on macOS, and on a case-insensitive volume
// so are `/Repo` and `/repo`; realpath settles both, because it reports the
// directory as the filesystem names it. A path that cannot be resolved — a
// worktree whose directory is gone — is compared as given: there is nothing
// better to say about it, and the miss is on a directory nobody can be in.
export async function toRealPath(candidate: string): Promise<string> {
  try {
    return await realpath(candidate);
  } catch {
    return candidate;
  }
}

// D5: a wedged agent runtime must not hang a listing; a kill rejects, which
// the catch below already turns into no sessions.
const SESSION_LIST_TIMEOUT_MS = 10_000;

// One invocation per source per command run, joined in-process afterwards (D4).
// Every failure — no agent configured, a missing binary, a non-zero exit, output
// that is not JSON, or JSON that is not an array — yields no sessions from that
// source and no error: this must never become a hard dependency on any
// particular agent runtime, or on Herdr.
async function listRuntimeSessions(): Promise<AgentSession[]> {
  const agentCommand = await gitGetConfigValue("agent.command");
  // agent.command is a dispatch command line, e.g. `claude --bg`. Only its head
  // is reused here, because listing sessions is a different subcommand of the
  // same program: appending the dispatch arguments would ask for
  // `claude --bg agents --json`. A user with only `herdr.agent` set has no
  // dispatch command, but the kind it names is the program to ask (D14).
  // Split as the dispatch and the Herdr kind split it, so a quoted program path
  // with a space in it is one program to all three.
  const [head] = splitCommandValue(agentCommand);
  const agent = head || (await gitGetConfigValue("herdr.agent")).trim();

  if (!agent) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(
      await run(agent, SESSION_ARGS, { timeout: SESSION_LIST_TIMEOUT_MS }),
    );
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

// Herdr is optional: not installed, not running, or answering nonsense is no
// entries rather than an error. The call itself is bounded by the Herdr seam.
async function listHerdrEntries(): Promise<HerdrAgentEntry[]> {
  try {
    return (await isHerdrInstalled()) ? await listHerdrAgents() : [];
  } catch {
    return [];
  }
}

// What `herdrAgent` reports: the name Herdr gave the agent (D12's "Herdr
// handle"), which `agent list` carries for the agents Herdr started. One it
// only detected has none, and the pane it runs in is then the only handle there
// is. Never empty when the entry has a pane.
function herdrHandle(entry: HerdrAgentEntry): string | undefined {
  return entry.name ?? entry.paneId;
}

// Herdr's status is deliberately not turned into `state`. Its `done` means the
// agent finished a turn and the pane has not been looked at since, not that the
// process is gone, so reading it as a finished session would call a worktree
// somebody has open free to delete. Only the runtime says a session finished.
// The status still reaches `isSessionWaiting`, where idle and blocked are
// exactly "waiting on somebody".
function herdrOnlySession(entry: HerdrAgentEntry): AgentSession {
  return {
    name: `${entry.kind}@${entry.paneId ?? "herdr"}`,
    cwd: entry.cwd,
    sessionId: entry.sessionId,
    herdrAgent: herdrHandle(entry),
    status: entry.status,
  };
}

// Joins Herdr's entries onto the runtime's by session id, and only where the
// working directory agrees as well — a session id alone has outlived a `cd`, and
// the two sources disagreeing about where it is should not be papered over. A
// joined entry is the runtime's plus the Herdr handle, except that a runtime
// `done` is dropped: Herdr still shows the session in a pane, and a live process
// has been seen reported `done` by the runtime, so the contrary evidence wins in
// the safe direction. A Herdr entry
// nothing matched stands on its own. Every cwd is already a real path.
function joinSessions(
  runtime: AgentSession[],
  herdrEntries: HerdrAgentEntry[],
): AgentSession[] {
  const unmatched = [...herdrEntries];

  const joined = runtime.map((session) => {
    const index = unmatched.findIndex(
      (entry) =>
        session.sessionId !== undefined &&
        entry.sessionId === session.sessionId &&
        entry.cwd === session.cwd,
    );
    if (index === -1) {
      return session;
    }
    const [entry] = unmatched.splice(index, 1);
    return {
      ...session,
      state: session.state === "done" ? undefined : session.state,
      herdrAgent: entry && herdrHandle(entry),
    };
  });

  return [...joined, ...unmatched.map(herdrOnlySession)];
}

export async function getAgentSessions(): Promise<AgentSession[]> {
  const [runtime, herdrEntries] = await Promise.all([
    listRuntimeSessions(),
    listHerdrEntries(),
  ]);

  const [runtimeReal, herdrReal] = await Promise.all([
    Promise.all(
      runtime.map(async (session) => ({
        ...session,
        cwd: await toRealPath(session.cwd),
      })),
    ),
    Promise.all(
      herdrEntries.map(async (entry) => ({
        ...entry,
        cwd: await toRealPath(entry.cwd),
      })),
    ),
  ]);

  return joinSessions(runtimeReal, herdrReal);
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
  return (
    session.state === "blocked" ||
    session.status === "idle" ||
    session.status === "blocked"
  );
}

// Keeps `kind` inside this module while still letting `list` tell a human's own
// terminal apart from an agent this CLI dispatched (D5, Q2).
export function isSessionInteractive(session: AgentSession): boolean {
  return session.kind === "interactive";
}
