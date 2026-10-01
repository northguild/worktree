import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { inspect } from "node:util";
import { Command, Flags, ux } from "@oclif/core";
import type { CommandError, OclifError } from "@oclif/core/interfaces";
import chalk from "chalk";
// `lib/` importing `integrations/` inverts the layering in
// context/standards/architecture/dependency-boundaries.md. It is a deliberate
// deviation, recorded in §4.2 of the plan: BaseCommand is the composition point
// every command inherits — it already reaches for `./git.js` and
// `./prompt.js` — not a leaf utility. Satisfying the boundary strictly
// means moving this file out of `lib/`, a wider refactor than this feature buys.
import {
  closeHerdrWorkspace,
  isHerdrInstalled,
  listHerdrWorktrees,
  openHerdrWorktree,
  promptHerdrAgent,
  startHerdrAgent,
  toAgentSessionName,
  toHerdrAgentName,
} from "../integrations/herdr.js";
import { run, spawnDetached } from "./cli.js";
import {
  gitGetAbsoluteWorktreesPath,
  gitGetConfigValue,
  gitGetRootPath,
} from "./git.js";
import {
  isNonInteractive,
  readProcessInteractionInputs,
  resolveNonInteractive,
  setNonInteractive,
} from "./interaction.js";
import { createSpinner } from "./progress.js";
import { askConfirm, MissingValueError } from "./prompt.js";
import type {
  ConfigName,
  JsonErrorCode,
  JsonErrorDocument,
  OpenerKind,
} from "./types.js";
import { splitCommandValue } from "./utils.js";

/**
 * Closes the Herdr spaces of the worktrees whose paths it is given, and answers
 * with the ids of the ones it closed.
 *
 * The seam hands one of these back rather than exposing a close method,
 * because the lookup it closes over has to happen *before* the worktrees are
 * removed and the closing has to happen after. A closure makes that ordering
 * structural — there is no way to reach the close without having resolved
 * first — where two methods would leave a caller free to get it backwards and
 * find the spaces already gone from Herdr's listing.
 */
type SpaceCloser = (worktreePaths: string[]) => Promise<string[]>;

/** Does nothing, for every path where there is nothing to close. */
async function closeNothing(): Promise<string[]> {
  return [];
}

const JSON_ERROR_CODES: readonly JsonErrorCode[] = [
  "missing_value",
  "invalid_value",
  "not_found",
  "timeout",
  "failed",
];

// The timeout messages this CLI writes — github.ts, jira.ts, git.ts, herdr.ts
// and cli.ts all say "<what> did not answer|finish within <n>s".
const TIMEOUT_MESSAGE = /did not (?:answer|finish) within \d+s/;

// A secret has no place in any output (security/secrets.md), and some messages
// come from places that echo what they were given: a remote URL with
// credentials in it is the realistic one (github.ts quotes the origin it could
// not parse). Redacted at the point of output, so every route to stdout or
// stderr is covered by one rule instead of each message being checked.
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi;
const TOKEN_SHAPES =
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g;

export function redactSecrets(text: string): string {
  return text.replace(URL_CREDENTIALS, "$1***@").replace(TOKEN_SHAPES, "***");
}

function isJsonErrorCode(code: unknown): code is JsonErrorCode {
  return JSON_ERROR_CODES.includes(code as JsonErrorCode);
}

/**
 * The machine-readable code for a failure. An explicit `code` — `this.error(…,
 * { code })` — wins; then the typed missing value and the bounded-call messages;
 * then oclif's exit 2, which is how a usage error is raised. Anything else is
 * `failed`.
 */
function toErrorCode(error: Error): JsonErrorCode {
  if (error instanceof MissingValueError) {
    return "missing_value";
  }
  const { code, oclif } = error as Partial<OclifError> & { code?: unknown };
  if (isJsonErrorCode(code)) {
    return code;
  }
  if (TIMEOUT_MESSAGE.test(error.message)) {
    return "timeout";
  }
  return oclif?.exit === 2 ? "invalid_value" : "failed";
}

function toErrorDocument(error: Error, message: string): JsonErrorDocument {
  return {
    error: {
      code: toErrorCode(error),
      message,
      ...(error instanceof MissingValueError
        ? { details: { value: error.value, flag: error.flag } }
        : {}),
    },
  };
}

/**
 * The label Herdr puts on the space, which is the branch name recovered from
 * the worktree's own path — every caller's path sits under
 * `<root>.worktrees/`, and what follows that prefix is the branch, slashes
 * and all, because `feature/thing` is a directory here. `basename` covers a
 * path laid out some other way: an unlabelled space is unusable in Herdr's
 * sidebar (opener plan D7), so this never answers with an empty string.
 *
 * Takes the root rather than looking it up, so the closer can label a whole set
 * of worktrees from one `gitGetAbsoluteWorktreesPath` call instead of one per
 * space.
 */
function toSpaceLabel(worktreePath: string, worktreesRootPath: string) {
  return worktreePath.startsWith(worktreesRootPath)
    ? worktreePath.slice(worktreesRootPath.length)
    : basename(worktreePath);
}

/**
 * The most a brief may be, in bytes (D13). It becomes one argv element of
 * `herdr agent prompt`, so it is bounded where argv is.
 */
export const AGENT_BRIEF_MAX_BYTES = 256 * 1024;

export interface AgentBriefSources {
  agent?: string;
  agentFile?: string;
  agentStdin?: boolean;
}

/** The part of a stream `readAgentBrief` reads from; `process.stdin` by default. */
export interface BriefStdin extends AsyncIterable<Buffer | string> {
  isTTY?: boolean;
}

function checkBrief(brief: string, source: string): string {
  if (brief.trim() === "") {
    throw new Error(`The agent brief from ${source} is empty.`);
  }

  if (Buffer.byteLength(brief, "utf8") > AGENT_BRIEF_MAX_BYTES) {
    throw new Error(
      `The agent brief from ${source} is over ${AGENT_BRIEF_MAX_BYTES / 1024} KB.`,
    );
  }

  return brief;
}

async function readBriefFile(path: string): Promise<string> {
  let stats: Awaited<ReturnType<typeof stat>>;

  try {
    stats = await stat(path);
  } catch {
    throw new Error(`--agent-file ${path} does not exist or is not readable.`);
  }

  if (!stats.isFile()) {
    throw new Error(`--agent-file ${path} is not a regular file.`);
  }

  // Size first, so a huge file is refused without being read into memory.
  if (stats.size > AGENT_BRIEF_MAX_BYTES) {
    throw new Error(
      `The agent brief from --agent-file is over ${AGENT_BRIEF_MAX_BYTES / 1024} KB.`,
    );
  }

  return checkBrief(await readFile(path, "utf8"), "--agent-file");
}

async function readBriefStdin(stdin: BriefStdin): Promise<string> {
  // Reading a terminal would wait for a person who was never told to type.
  if (stdin.isTTY) {
    throw new Error(
      "--agent-stdin needs the brief piped in, but stdin is a terminal.",
    );
  }

  const chunks: Buffer[] = [];
  let bytes = 0;

  for await (const chunk of stdin) {
    const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    bytes += buffer.length;

    // Stops at the cap rather than buffering what will be refused anyway.
    if (bytes > AGENT_BRIEF_MAX_BYTES) {
      throw new Error(
        `The agent brief from --agent-stdin is over ${AGENT_BRIEF_MAX_BYTES / 1024} KB.`,
      );
    }

    chunks.push(buffer);
  }

  return checkBrief(Buffer.concat(chunks).toString("utf8"), "--agent-stdin");
}

/**
 * Reads the brief from whichever of `--agent`, `--agent-file` and
 * `--agent-stdin` was given — the flags are mutually exclusive, so at most one
 * was. Whole and unchanged, because it is delivered verbatim (D13). Returns
 * `undefined` when none was given; throws on an empty or oversized brief.
 */
export async function readAgentBrief(
  { agent, agentFile, agentStdin }: AgentBriefSources,
  stdin: BriefStdin = process.stdin,
): Promise<string | undefined> {
  if (agentFile !== undefined) {
    return readBriefFile(agentFile);
  }

  if (agentStdin) {
    return readBriefStdin(stdin);
  }

  return agent === undefined ? undefined : checkBrief(agent, "--agent");
}

export interface OpenWorktreeOptions {
  /** `false` for `--no-open`: no Herdr or editor call, as with `opener=none`. */
  open?: boolean;
  /** `false` for `--no-agent`: open, but start no agent. */
  agent?: boolean;
  /** The kickoff brief, delivered to the one agent this run starts (D11). */
  brief?: string;
}

/** The agent a run started, as the later `--json` document reports it. */
export interface OpenedAgent {
  /** The runtime session name; `null` where this CLI named nothing (D12). */
  name: string | null;
  kind: string | null;
  /** The command, without the brief. */
  command: string[];
  /** Whether a brief went to it. */
  prompted: boolean;
}

export interface OpenOutcome {
  opener: OpenerKind;
  herdr?: {
    space: string;
    pane: string;
    /** The Herdr handle, `null` when no agent was started in the pane. */
    agent: string | null;
  };
  agent?: OpenedAgent;
}

interface HerdrAgentPlan {
  kind: string;
  args: string[];
  sessionName: string | null;
}

/** The kind that `--name` is known to mean a session name for (D11). */
const NAMEABLE_AGENT_KIND = "claude";

/** Background flags would detach the agent from the pane Herdr watches. */
const BACKGROUND_FLAGS = ["--bg", "--background"];

export abstract class BaseCommand extends Command {
  /** On every command; `init()` below turns them into the run's mode. */
  static override baseFlags = {
    "non-interactive": Flags.boolean({
      description: "Never prompt or animate; take defaults or fail",
    }),
    yes: Flags.boolean({
      char: "y",
      description: "Non-interactive: accept defaults instead of prompting",
    }),
  };

  /** Resolved once in `init()`; see `lib/interaction.ts` (D1). */
  protected nonInteractive = false;

  /**
   * Everything this run warned about, for the `warnings` array of a `--json`
   * document. Redacted on the way in, so a document built from it needs no
   * second pass.
   */
  protected warnings: string[] = [];

  /**
   * Under `--json` oclif drops `log` entirely, which would lose the human text
   * the run still has to say. It goes to stderr instead, so stdout carries the
   * document and nothing else (D6).
   */
  override log(message = "", ...args: string[]) {
    if (this.jsonEnabled()) {
      this.logToStderr(message, ...args);
      return;
    }
    super.log(message, ...args);
  }

  /** oclif suppresses this under `--json` too; it is the one stream left to talk on. */
  override logToStderr(message: unknown = "", ...args: string[]) {
    ux.stderr(
      typeof message === "string" ? message : inspect(message),
      ...args,
    );
  }

  /**
   * One line of compact JSON, uncoloured: a contract a script parses does not
   * change with `FORCE_COLOR` or the terminal, and oclif's own printer pretty-
   * prints and colours.
   */
  override logJson(json: unknown) {
    ux.stdout(JSON.stringify(json));
  }

  /**
   * oclif prints nothing for a warning under `--json`, so it goes to stderr
   * here, and every warning is kept for the document.
   */
  override warn(input: string | Error): string | Error {
    const message = redactSecrets(
      input instanceof Error ? input.message : input,
    );
    this.recordWarning(message);
    if (this.jsonEnabled()) {
      this.logToStderr(`Warning: ${message}`);
    } else {
      super.warn(message);
    }
    return input;
  }

  /**
   * For a warning already printed another way — a spinner's `warn` — that the
   * document should still carry.
   */
  protected recordWarning(message: string) {
    this.warnings.push(redactSecrets(message));
  }

  async init() {
    await super.init();
    const { flags } = await this.parse();
    const mode = resolveNonInteractive({
      ...readProcessInteractionInputs(),
      nonInteractiveFlag: flags["non-interactive"],
      yesFlag: flags.yes,
      json: this.jsonEnabled(),
    });
    this.nonInteractive = mode;
    setNonInteractive(mode);
  }

  // Non-interactive runs take "no" here: the offer is skipped, and
  // `verifyConfig` names what is missing instead of asking.
  private confirmFirstTimeConfig() {
    const message =
      "Looks like this is your first time running the CLI. Do you want to run the config command now?";
    return askConfirm(
      { message },
      {
        value: "the first-time config offer",
        flag: "`worktree config`",
        fallback: false,
      },
    );
  }

  private confirmMissingConfig() {
    const message =
      "Some required configuration values are missing. Do you want to run the config command now?";
    return askConfirm(
      { message },
      {
        value: "the missing-config offer",
        flag: "`worktree config`",
        fallback: false,
      },
    );
  }

  protected async verifyConfig(configNames: ConfigName[] = []) {
    if ((await gitGetConfigValue("has-called-config")) !== "true") {
      if (await this.confirmFirstTimeConfig()) {
        await this.config.runCommand("config");
        return;
      }
    }

    const missingNames: ConfigName[] = [];
    for (const name of configNames) {
      if (!(await gitGetConfigValue(name))) {
        missingNames.push(name);
      }
    }

    if (missingNames.length === 0) {
      return;
    }

    // Offering `config` would prompt, so a non-interactive run says what is
    // missing and carries on: whatever needs a value fails naming its own key,
    // and what has a fallback (`defaultSourceBranch`) uses it.
    if (isNonInteractive()) {
      this.warn(
        `Missing config: ${missingNames.join(", ")}. Set one with \`worktree config <name> <value>\`.`,
      );
      return;
    }

    if (await this.confirmMissingConfig()) {
      // `--names` alone means "ask these" (config.ts), so there is no `--yes`:
      // that flag now means non-interactive.
      await this.config.runCommand("config", [
        "--missing",
        "--names",
        configNames.join(","),
      ]);
    }
  }

  protected async openWorktreePath(
    path: string,
    { open = true, agent = true, brief }: OpenWorktreeOptions = {},
  ): Promise<OpenOutcome> {
    const configured = await gitGetConfigValue("opener");
    const opener: OpenerKind =
      !open || configured === "none"
        ? "none"
        : configured === "herdr"
          ? "herdr"
          : "editor";
    const handoff = agent ? brief : undefined;

    if (opener === "herdr") {
      const { herdr, opened, startedAgent } = await this.openHerdrSpace(
        path,
        agent,
        handoff,
      );

      // The detached dispatch is for a run where Herdr did not open (D11): a
      // second agent beside the one Herdr started would be two in one tree.
      if (!opened && handoff !== undefined) {
        return { opener, agent: await this.dispatchAgent(path, handoff) };
      }

      if (opened && handoff !== undefined && !startedAgent) {
        this.warn(
          "The brief was not delivered: no agent was started in this Herdr space.",
        );
      }

      return { opener, herdr, agent: startedAgent };
    }

    // Before the opener, so the editor's line stays the last one printed.
    const dispatched =
      handoff !== undefined
        ? await this.dispatchAgent(path, handoff)
        : undefined;

    // Nothing is opened and nothing is launched: the path is the whole result.
    // Plain text, no glyph, so a script can take the last word of the line.
    if (opener === "none") {
      this.log(`Worktree created at ${path}`);
    } else {
      await this.openCodeEditor(path);
    }

    return { opener, agent: dispatched };
  }

  /** One worktree's label, for the open. `toSpaceLabel` holds the rule. */
  private async resolveSpaceLabel(worktreePath: string) {
    return toSpaceLabel(
      worktreePath,
      `${await gitGetAbsoluteWorktreesPath()}/`,
    );
  }

  /**
   * Reads which Herdr space each of this repository's worktrees is open in, and
   * answers with the function that closes them once they have been removed.
   *
   * **Call this before removing anything.** The listing is derived from git's
   * own worktrees, so `git worktree remove` and `git worktree prune` take the
   * entry out of Herdr's answer too — look it up afterwards and every space is
   * already unfindable (D2). One call answers for a whole run, because
   * `cleanup` removes a set and a lookup per worktree would be N subprocesses
   * where one does.
   *
   * Everything that means "there is nothing to close" answers with the same
   * no-op, and none of them spawns a Herdr process: an `opener` that is not
   * `herdr`, no `herdr` on PATH, or a repository with no open spaces. The
   * second of those is deliberately silent rather than a warning — someone
   * whose `opener` says `herdr` but who has no Herdr installed was already told
   * so, loudly, when the open failed, and a warning on every `remove`
   * afterwards is noise about something they cannot act on here.
   */
  protected async resolveSpaceCloser(): Promise<SpaceCloser> {
    if ((await gitGetConfigValue("opener")) !== "herdr") {
      return closeNothing;
    }

    if (!(await isHerdrInstalled())) {
      return closeNothing;
    }

    const spinner = createSpinner("Finding Herdr spaces").start();
    let spaces: Map<string, string>;
    let worktreesRootPath: string;

    try {
      const [{ worktrees, sourceWorkspaceId }, worktreesPath] =
        await Promise.all([
          listHerdrWorktrees({ gitRootPath: await gitGetRootPath() }),
          gitGetAbsoluteWorktreesPath(),
        ]);

      worktreesRootPath = `${worktreesPath}/`;
      // flatMap rather than filter-then-map so the narrowing is the compiler's:
      // `workspaceId` is `string | undefined`, and inside this branch it is a
      // string. A filter needs an assertion to say the same thing, and an
      // assertion keeps compiling if the first guard below is ever dropped —
      // which is exactly the regression these two guards exist to prevent.
      spaces = new Map(
        worktrees.flatMap((worktree) =>
          // #52 D9 — a worktree with no space open is not an error and is
          // nothing to close.
          worktree.workspaceId !== undefined &&
          // #52 D7 — the repository's own checkout is in this listing like any
          // other, and closing it would take down the window the user is
          // sitting in. Both removal paths already exclude the current
          // worktree, so this guards a future caller rather than a live defect.
          worktree.workspaceId !== sourceWorkspaceId
            ? [[worktree.path, worktree.workspaceId] as const]
            : [],
        ),
      );
      spinner.stop();
    } catch (error) {
      // Deliberately wider than the Herdr call: the two git lookups above share
      // this catch, so nothing this seam needs can cost the user the removal
      // they actually asked for. Every message it can print names its own
      // source — Herdr's are prefixed `Herdr: `, and gitGetRootPath's says it
      // cannot find the root — so the breadth costs no diagnostic detail.
      //
      // The lookup itself is all-or-nothing by construction: without it there
      // is no path-to-space mapping, so there is nothing any number of closes
      // could act on. Decided here deliberately rather than inherited (F-056) —
      // the run continues and the removals still happen, because by the time a
      // caller holds this closure the user has already asked for them.
      const message = error instanceof Error ? error.message : String(error);
      spinner.warn(message);
      this.recordWarning(message);
      return closeNothing;
    }

    if (spaces.size === 0) {
      return closeNothing;
    }

    return async (worktreePaths: string[]) => {
      const closed: string[] = [];

      for (const worktreePath of worktreePaths) {
        const workspaceId = spaces.get(worktreePath);

        // Three ways to get here, and none of them says anything. Two were
        // settled when the map was built: the worktree had no space open (D9),
        // or it is one this run must not touch (D7). The third is a path Herdr
        // never listed, or listed in a different string form — which is the
        // orphan this feature exists to prevent, passing silently. Both sides
        // of the comparison come from git's own worktree records and were
        // verified byte-identical, so it stays silent rather than warning on
        // every worktree that legitimately has no space.
        if (!workspaceId) {
          continue;
        }

        if (
          await this.closeSpace(
            workspaceId,
            toSpaceLabel(worktreePath, worktreesRootPath),
          )
        ) {
          closed.push(workspaceId);
        }
      }

      return closed;
    };
  }

  /**
   * Closes one space, and never lets that failure reach the command.
   *
   * By the time this runs the worktree is deleted, the branch is gone and
   * `git worktree prune` has run — there is nothing left to retry and nothing
   * the user can do about it, so a non-zero exit would misreport what actually
   * happened (D5). Each space gets its own `catch` so one failure does not take
   * the rest of the run with it.
   */
  private async closeSpace(workspaceId: string, label: string) {
    const spinner = createSpinner(`Closing Herdr space ${label}`).start();

    try {
      await closeHerdrWorkspace(workspaceId);
      spinner.succeed(`Closed Herdr space ${label}`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      spinner.warn(message);
      this.recordWarning(message);
      return false;
    }
  }

  /**
   * Awaited, unlike the editor branch: the open answers with the pane the space
   * was built around, which is what an agent start hangs off later.
   *
   * `opened` is whether a Herdr space exists for the path afterwards, which is
   * what decides that no detached agent is dispatched beside it.
   */
  private async openHerdrSpace(
    path: string,
    wantsAgent: boolean,
    brief: string | undefined,
  ): Promise<{
    herdr?: OpenOutcome["herdr"];
    opened: boolean;
    startedAgent?: OpenedAgent;
  }> {
    const spinner = createSpinner("Opening in Herdr").start();

    try {
      if (!(await isHerdrInstalled())) {
        throw new Error("Herdr: `herdr` was not found on your PATH.");
      }

      const [gitRootPath, label, focus] = await Promise.all([
        gitGetRootPath(),
        this.resolveSpaceLabel(path),
        gitGetConfigValue("herdr.focus"),
      ]);

      // Before the open, so a brief with no agent kind to take it fails before
      // a space exists rather than after.
      const plan = wantsAgent
        ? await this.resolveHerdrAgentPlan(gitRootPath, label, brief)
        : undefined;

      const { alreadyOpen, paneId, workspaceId } = await openHerdrWorktree({
        path,
        gitRootPath,
        label,
        // Focus is on unless it is turned off: all three callers are someone
        // asking to be taken to this worktree, so a space that does not come to
        // the front reads as a failed open (D6).
        focus: focus !== "false",
      });

      spinner.succeed(
        alreadyOpen
          ? `Herdr space ${label} was already open`
          : `Opened Herdr space ${label}`,
      );

      // Only for a space this command just built. Re-opening a worktree is how
      // someone returns to work already in progress, and the agent they left
      // running is still in that pane — a second start would collide with it.
      const startedAgent =
        plan && !alreadyOpen
          ? await this.startConfiguredAgent(label, paneId, plan, brief)
          : undefined;

      return {
        opened: true,
        startedAgent,
        herdr: {
          space: workspaceId,
          pane: paneId,
          agent: startedAgent ? toHerdrAgentName(label) : null,
        },
      };
    } catch (error) {
      if (error instanceof MissingValueError) {
        spinner.stop();
        throw error;
      }

      // D5 — no editor as a consolation prize. Someone who set `opener=herdr`
      // gets told what Herdr said and where the worktree is, and that is all.
      // The command still exits 0: by the time the opener runs the worktree
      // exists and its env files are copied, so failing here would misreport
      // what actually happened.
      const message = error instanceof Error ? error.message : String(error);
      spinner.fail(message);
      this.recordWarning(message);
      this.log(`The worktree is at ${path}`);
      return { opened: false };
    }
  }

  /**
   * Which agent Herdr starts, and with what (D11). `undefined` means none.
   *
   * The kind is `herdr.agent`; with a brief it falls back to the program
   * `agent.command` names, so a user with only `agent.command` is not told to
   * configure the same thing twice. With a brief and neither, there is nothing to hand it to: that is a missing value and the
   * run says so, where without a brief it is simply no agent (D9 of #52).
   */
  private async resolveHerdrAgentPlan(
    gitRootPath: string,
    label: string,
    brief: string | undefined,
  ): Promise<HerdrAgentPlan | undefined> {
    const [head, ...tail] = splitCommandValue(
      await gitGetConfigValue("agent.command"),
    );
    // The `agent.command` fallback is for a brief only: without one,
    // `herdr.agent` alone decides, so someone who set `agent.command` for
    // `--agent` is not given an agent in every plain open they never asked for.
    const kind =
      (await gitGetConfigValue("herdr.agent")) ||
      (brief !== undefined ? basename(head ?? "") : "");

    if (!kind) {
      if (brief !== undefined) {
        throw new MissingValueError(
          "the agent kind",
          "`worktree config herdr.agent <kind>`",
        );
      }
      return undefined;
    }

    // The tail belongs to the program `agent.command` names, so it is only
    // reused when that is the kind being started.
    const reusable = head !== undefined && basename(head) === kind ? tail : [];
    const args = reusable.filter((arg) => !BACKGROUND_FLAGS.includes(arg));

    if (args.length < reusable.length) {
      this.logToStderr(
        `Dropped ${BACKGROUND_FLAGS.join("/")} from agent.command: Herdr runs the agent in the pane.`,
      );
    }

    if (kind !== NAMEABLE_AGENT_KIND) {
      return { kind, args, sessionName: null };
    }

    const sessionName = toAgentSessionName(basename(gitRootPath), label);
    return { kind, args: [...args, "--name", sessionName], sessionName };
  }

  /**
   * Starts the planned agent in the pane the new space was built around, then
   * delivers the brief. Opt-in, and no kind means no agent at all (D9 of #52):
   * there are 22 kinds and no canonical one, and `agent start` blocks until the
   * agent answers, so nobody pays for this who did not ask for it.
   *
   * The brief never goes in `agent start`'s arguments (D11): Herdr types those
   * into the pane's shell, so it goes through `agent prompt` once the agent is
   * ready — `agent start` has already waited, bounded, for that.
   *
   * Never throws. By the time it runs the space is open and correct, so a name
   * that collides with a live agent from another repo, or an agent that does not
   * reach its prompt in time, is a warning about the agent and not a failure of
   * the open (§5).
   */
  private async startConfiguredAgent(
    label: string,
    paneId: string,
    { kind, args, sessionName }: HerdrAgentPlan,
    brief: string | undefined,
  ): Promise<OpenedAgent | undefined> {
    const name = toHerdrAgentName(label);
    const spinner = createSpinner(`Starting ${kind} in ${label}`).start();

    try {
      await startHerdrAgent({ name, kind, paneId, args });
      spinner.succeed(`Started ${kind} as ${name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      spinner.warn(message);
      this.recordWarning(message);
      return undefined;
    }

    if (sessionName) {
      this.logToStderr(`Agent session name: ${sessionName}`);
    }

    let prompted = false;

    if (brief !== undefined) {
      try {
        await promptHerdrAgent({ paneId, text: brief });
        prompted = true;
      } catch (error) {
        this.warn(
          `${kind} started, but the brief was not delivered. ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return { name: sessionName, kind, command: [kind, ...args], prompted };
  }

  private async openCodeEditor(path: string) {
    const codeEditor = await gitGetConfigValue("codeEditor");
    // codeEditor is a command line, not a bare program name: the head is the
    // file to launch and the tail is leading arguments, with the worktree path
    // passed last as one argument however many spaces it contains. This is the
    // contract commandExists already validates by — it looks up the head alone
    // (cli.ts) — so validation and execution now agree. No shell parses this
    // value; quotes group an argument that contains spaces and are not passed
    // through, so `~` and `$VAR` still reach the program unexpanded.
    const [editor, ...editorArgs] = splitCommandValue(codeEditor);

    // Unset, whitespace-only and quote-only are the same fact: nothing to
    // launch. The head is what execFile would receive, so it is what decides.
    if (editor) {
      const spinner = createSpinner(`Opening in ${codeEditor}`).start();
      // Deliberately not awaited, exactly as the exec callback was not: the
      // editor outlives this command, and the spinner settles when it exits.
      run(editor, [...editorArgs, path]).then(
        () => spinner.succeed(),
        (error: Error) => spinner.fail(error.message),
      );
    } else {
      this.log(`${chalk.green("✔")} Worktree created in ${path}`);
    }
  }

  /**
   * The detached launch, for a run where Herdr did not open (D11). Returns what
   * it started, or `undefined` when there was nothing to run. `name` is `null`:
   * this CLI names no session on this path.
   */
  protected async dispatchAgent(
    path: string,
    prompt: string,
  ): Promise<OpenedAgent | undefined> {
    const agentCommand = await gitGetConfigValue("agent.command");
    // Split exactly as openWorktreePath splits codeEditor: the head is the
    // program to launch and the tail is leading arguments, with quotes grouping
    // an argument that contains spaces. The prompt is appended as one argument
    // however many quotes or spaces it contains — no shell parses any of this,
    // which is what keeps arbitrary prompt text out of command position.
    // See AGENT-MODE-PLAN §3 D2.
    const [agent, ...agentArgs] = splitCommandValue(agentCommand);

    // Unset and whitespace-only are the same fact: no agent to run. The head is
    // what spawn would receive, so it is what decides — an empty one makes spawn
    // throw synchronously, which would take the editor launch down with it. The
    // command named here has to be one that works: `worktree config <name>` with
    // no value reads the key and discards the result (config.ts:273-274).
    if (!agent) {
      this.log(
        `No agent configured. Run ${chalk.cyan('worktree config agent.command "<command>"')} to set one.`,
      );
      this.recordWarning(
        'No agent configured, so the brief was not delivered. Run `worktree config agent.command "<command>"` to set one.',
      );
      return undefined;
    }

    // Fire-and-forget: the agent outlives this command, so there is no exit
    // status to report and no spinner that could ever settle.
    spawnDetached(agent, [...agentArgs, prompt], {
      cwd: path,
      onError: (error: Error) => this.log(chalk.red(`Error: ${error.message}`)),
    });
    this.log(`${chalk.green("✔")} Agent started in ${path}`);

    return {
      name: null,
      kind: null,
      command: [agent, ...agentArgs],
      prompted: true,
    };
  }

  protected async catch(error: CommandError) {
    if (error instanceof Error) {
      if (error.name === "ExitPromptError") {
        // Silently exit
        return;
      }
      // stderr and a non-zero exit, so a script can tell a failure from a
      // success. `this.error(...)` carries its code on `oclif.exit` (2 by
      // default); anything else is a plain failure.
      // One line in the plan's D2 shape; its own exit code rides on `oclif.exit`.
      const message = redactSecrets(error.message);
      console.error(
        error instanceof MissingValueError
          ? `worktree: ${message}`
          : chalk.red(`Error: ${message}`),
      );
      process.exitCode = (error as Partial<OclifError>).oclif?.exit ?? 1;
      // Under `--json` stdout carries the failure as the one document (D6), so
      // a script reads the same channel whether the run worked or not.
      if (this.jsonEnabled()) {
        this.logJson(toErrorDocument(error, message));
      }
      return;
    }
    return super.catch(error);
  }
}
