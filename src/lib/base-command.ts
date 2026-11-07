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
  isHerdrInstalled,
  openHerdrWorktree,
  promptHerdrAgent,
  startHerdrAgent,
  toAgentSessionName,
  toHerdrAgentName,
} from "../integrations/herdr.js";
import { herdrMultiplexer } from "../integrations/herdr-multiplexer.js";
import {
  openRexSession as createRexSession,
  findRexSessions,
  isRexInstalled,
  RexError,
  selectRexSession,
} from "../integrations/rex.js";
import { rexMultiplexer } from "../integrations/rex-multiplexer.js";
import { run, spawnDetached } from "./cli.js";
import { gitGetConfigValue } from "./config.js";
import { gitGetAbsoluteWorktreesPath, gitGetRootPath } from "./git.js";
import {
  isNonInteractive,
  readProcessInteractionInputs,
  resolveNonInteractive,
  setNonInteractive,
} from "./interaction.js";
import type { Multiplexer } from "./multiplexer.js";
import { createSpinner } from "./progress.js";
import {
  getTeamConfigValue,
  isTeamConfigKey,
  showLinesVisibly,
} from "./project-config.js";
import { askConfirm, InvalidValueError, MissingValueError } from "./prompt.js";
import { redactSecrets } from "./redact.js";
import { detectTerminalHosts } from "./terminal-host.js";
import type {
  ClosedSpaces,
  ConfigName,
  JsonErrorCode,
  JsonErrorDocument,
  OpenedAgent,
  OpenOutcome,
  RenamedSpaces,
  ResolvedOpener,
} from "./types.js";
import { splitCommandValue } from "./utils.js";

/**
 * Closes the Herdr spaces and Rex sessions of the worktrees whose paths it is
 * given, and answers with the ids of the ones it closed.
 *
 * The seam hands one of these back rather than exposing a close method,
 * because the lookup it closes over has to happen *before* the worktrees are
 * removed and the closing has to happen after. A closure makes that ordering
 * structural — there is no way to reach the close without having resolved
 * first — where two methods would leave a caller free to get it backwards and
 * find the spaces already gone from Herdr's listing.
 */
type SpaceCloser = (worktreePaths: string[]) => Promise<ClosedSpaces>;

/**
 * What `opener auto` opens in (#271 D5): the first multiplexer the shell sits
 * in whose CLI is installed, else the editor. A detected tool that cannot be
 * run is skipped, not an error: `auto` is a guess, and a guess that cannot be
 * acted on must not cost the open. Order is the detector's, Herdr then Rex.
 */
async function detectInstalledTerminalHost(): Promise<ResolvedOpener> {
  for (const host of detectTerminalHosts()) {
    if (host === "herdr" ? await isHerdrInstalled() : await isRexInstalled()) {
      return host;
    }
  }

  return "editor";
}

interface ToolToClose {
  key: keyof ClosedSpaces;
  multiplexer: Multiplexer;
}

/**
 * Which tools the closer may ask for a configured `opener`. A fixed value names
 * its own tool (#270 D9), `auto` names both (#271 D7), and anything else names
 * none — `editor`, `none` and unset spawn nothing.
 */
function toolsToClose(opener: string): ToolToClose[] {
  const herdr: ToolToClose = { key: "herdr", multiplexer: herdrMultiplexer };
  const rex: ToolToClose = { key: "rex", multiplexer: rexMultiplexer };

  if (opener === "herdr") {
    return [herdr];
  }

  if (opener === "rex") {
    return [rex];
  }

  return opener === "auto" ? [herdr, rex] : [];
}

/**
 * Relabels the space open in a worktree that has just moved, and answers with
 * the ids it relabelled. The mirror of `SpaceCloser`, and resolved before the
 * move for the same reason: the lookup reads git's worktrees, and once the
 * directory has moved the old path is no longer in them (#272 D12).
 */
type SpaceRenamer = (
  fromPath: string,
  toPath: string,
) => Promise<RenamedSpaces>;

/** Does nothing, for every path where there is nothing to close. */
async function closeNothing(): Promise<ClosedSpaces> {
  return { herdr: [], rex: [] };
}

/** Does nothing, for every path where there is nothing to relabel. */
async function renameNothing(): Promise<RenamedSpaces> {
  return { herdr: [], rex: [] };
}

const JSON_ERROR_CODES: readonly JsonErrorCode[] = [
  "missing_value",
  "invalid_value",
  "not_found",
  "timeout",
  "failed",
];

// The timeout messages this CLI writes — github.ts, jira.ts, linear.ts, clickup.ts, git.ts, herdr.ts
// and cli.ts all say "<what> did not answer|finish within <n>s".
const TIMEOUT_MESSAGE = /did not (?:answer|finish) within \d+s/;

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
 * `herdr agent prompt`, so it is bounded where argv is: Linux caps a single
 * argument at `MAX_ARG_STRLEN`, 131,072 bytes *including* the terminating NUL.
 * The largest string that can be spawned is therefore 131,071 bytes, and a
 * brief that passes validation must always be one that spawns.
 */
export const AGENT_BRIEF_MAX_BYTES = 128 * 1024 - 1;

/**
 * What Rex accepts in one request: it refuses anything over 65,536 encoded
 * bytes ("control message too large", live probe of 2026-11-06, commit
 * aa9d59d), and does so before it makes a session.
 */
export const REX_REQUEST_LIMIT_BYTES = 65_536;

/**
 * What a request carries besides the argv. The probe measured ≈1.3 KB for a
 * `rex new` (103,675 encoded bytes for one 102,400-byte argument); 2,048
 * leaves room for a label, a path and an `agent.command` longer than the
 * probe's, none of which is known before the worktree exists.
 */
const REX_ENVELOPE_BYTES = 2_048;

/**
 * Rex encodes its requests as Go's `json.Marshal` does, measured live on
 * 2026-11-06 (one character repeated 10,000 times in an argument): 6 bytes for
 * `<`, `>`, `&`, U+2028/U+2029 and other control characters; 2 for `"`, `\`,
 * newline and tab; 1 for DEL and other ASCII; other non-ASCII as its raw UTF-8
 * (2 to 4 bytes). It is not JSON.stringify, which leaves `<`, `>` and `&` alone,
 * and it does not write non-ASCII as `\uXXXX`. The 2% on top is a safety
 * margin, not a correction: against the probe's 60,000- and 108,088-byte texts
 * this model is within a few bytes of what Rex reported.
 */
const REX_ENCODING_SLACK = 1.02;

/** Bytes one argv element takes once Rex has encoded it, quotes and comma included. */
function encodedRexElementBytes(text: string): number {
  let bytes = 3;

  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);

    if (unit === 0x22 || unit === 0x5c || unit === 0x0a || unit === 0x09) {
      bytes += 2; // \" \\ \n \t
    } else if (
      unit < 0x20 ||
      unit === 0x3c ||
      unit === 0x3e ||
      unit === 0x26 ||
      unit === 0x2028 ||
      unit === 0x2029
    ) {
      bytes += 6; // \u00XX style: controls, <, >, &, U+2028, U+2029
    } else if (unit < 0x80) {
      bytes += 1;
    } else if (unit < 0x800) {
      bytes += 2;
    } else if (unit >= 0xd800 && unit <= 0xdfff) {
      bytes += 2; // half of a surrogate pair, whose UTF-8 is 4 bytes
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

/**
 * An upper estimate of the request `rex new … -- <argv>` makes, for D10's
 * refusal before a worktree exists. It must never be lower than what Rex
 * measures, so every term rounds up.
 */
export function estimateRexRequestBytes(argv: readonly string[]): number {
  const encoded = argv.reduce(
    (total, element) => total + encodedRexElementBytes(element),
    0,
  );

  return Math.ceil(encoded * REX_ENCODING_SLACK) + REX_ENVELOPE_BYTES;
}

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
      `The agent brief from ${source} is over ${AGENT_BRIEF_MAX_BYTES} bytes.`,
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
      `The agent brief from --agent-file is over ${AGENT_BRIEF_MAX_BYTES} bytes.`,
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
        `The agent brief from --agent-stdin is over ${AGENT_BRIEF_MAX_BYTES} bytes.`,
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
  /**
   * `true` when the tree already existed and this run only opens it (#254). It
   * changes nothing but the closing line, which must not claim a creation.
   */
  reopened?: boolean;
}

interface HerdrAgentPlan {
  kind: string;
  args: string[];
  sessionName: string | null;
}

function missingAgentKind(): MissingValueError {
  return new MissingValueError(
    "the agent kind",
    "`worktree config herdr.agent <kind>`",
  );
}

function missingAgentCommand(): MissingValueError {
  return new MissingValueError(
    "the agent command",
    '`worktree config agent.command "<command>"`',
  );
}

/**
 * D10: names the limit and the brief's size, never its text (#72). Exit 2 and
 * `invalid_value`, like the other values that are wrong before anything exists.
 */
function briefTooLargeForRex(briefBytes: number): InvalidValueError {
  return new InvalidValueError(
    `The agent brief is ${briefBytes} bytes, more than Rex takes: it refuses a request over ${REX_REQUEST_LIMIT_BYTES} bytes once encoded. Shorten the brief, or use another opener.`,
  );
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
        await this.config.runCommand("config", ["--skip-offers"]);
        return;
      }
    }

    const missingNames: ConfigName[] = [];
    for (const name of configNames) {
      // A team key the project file supplies is not missing (D2, D3).
      const value = isTeamConfigKey(name)
        ? await getTeamConfigValue(name)
        : await gitGetConfigValue(name);
      if (!value) {
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
        "--skip-offers",
      ]);
    }
  }

  /**
   * `auto`'s answer, kept for the run (#271 D6): `assertBriefHasAnAgent`
   * decides before the tree exists and `openWithHandoff` acts after it, and
   * two detections could disagree.
   */
  private autoOpener: ResolvedOpener | undefined;

  /** The opener this run uses: the flag first, then the `opener` key. */
  private async resolveOpener(open: boolean): Promise<ResolvedOpener> {
    const configured = await gitGetConfigValue("opener");

    if (!open || configured === "none") {
      return "none";
    }
    if (configured === "herdr" || configured === "rex") {
      return configured;
    }
    if (configured === "auto") {
      this.autoOpener ??= await detectInstalledTerminalHost();
      return this.autoOpener;
    }

    return "editor";
  }

  /**
   * Fails a brief that nothing would take, before anything is created (#75).
   * Found out afterwards, it leaves a tree with no agent in it: an exit 0 a
   * coordinator reads as "working", or under `--json` an error document with
   * no `path` for a tree that is there.
   *
   * Who takes a brief is a matter of config, so it is knowable here. Herdr
   * starts its kind when it will open the tree — Herdr the opener and
   * installed. Rex starts the program `agent.command` names, so with Rex the
   * opener and its CLI found a brief needs that command (and, D10, must fit
   * the request Rex accepts); every other run, Herdr or Rex not installed
   * included, falls to the detached dispatch, which needs `agent.command`.
   * Neither is a missing value naming its key. A run without a brief, or with `--no-agent`, hands nothing
   * over.
   *
   * What can only fail once the tree exists — Herdr not opening, a space
   * already open, an agent that does not start — is `openWorktreePath`'s to
   * report, and it exits 1 for it.
   */
  protected async assertBriefHasAnAgent({
    open = true,
    agent = true,
    brief,
  }: OpenWorktreeOptions): Promise<void> {
    if (!agent || brief === undefined) {
      return;
    }

    if (
      (await this.resolveOpener(open)) === "herdr" &&
      (await isHerdrInstalled())
    ) {
      const { kind } = await this.readHerdrAgentKind(brief);

      if (!kind) {
        throw missingAgentKind();
      }
      return;
    }

    const [head, ...tail] = splitCommandValue(
      await gitGetConfigValue("agent.command"),
    );

    if (!head) {
      throw missingAgentCommand();
    }

    if (
      (await this.resolveOpener(open)) === "rex" &&
      (await isRexInstalled()) &&
      estimateRexRequestBytes([head, ...tail, brief]) > REX_REQUEST_LIMIT_BYTES
    ) {
      throw briefTooLargeForRex(Buffer.byteLength(brief, "utf8"));
    }
  }

  /**
   * The kind Herdr starts, and the `agent.command` it may have come from — the
   * one place the fallback rule lives, for the preflight and the plan both.
   */
  private async readHerdrAgentKind(brief: string | undefined) {
    const [head, ...tail] = splitCommandValue(
      await gitGetConfigValue("agent.command"),
    );
    // The `agent.command` fallback is for a brief only: without one,
    // `herdr.agent` alone decides, so someone who set `agent.command` for
    // `--agent` is not given an agent in every plain open they never asked for.
    const kind =
      (await gitGetConfigValue("herdr.agent")) ||
      (brief !== undefined ? basename(head ?? "") : "");

    return { kind, head, tail };
  }

  /**
   * Opens the tree and hands over the brief, if there is one.
   *
   * A brief that reached no agent exits 1, though nothing throws: the tree
   * exists and the outcome reports it, as a failed install does in `branch`.
   * The warning on the way says why, and `agent.prompted` is the receipt — an
   * exit 0 with `agent: null` would tell a coordinator the work had started.
   */
  protected async openWorktreePath(
    path: string,
    {
      open = true,
      agent = true,
      brief,
      reopened = false,
    }: OpenWorktreeOptions = {},
  ): Promise<OpenOutcome> {
    const handoff = agent ? brief : undefined;
    const outcome = await this.openWithHandoff(
      path,
      open,
      agent,
      handoff,
      reopened,
    );

    if (handoff !== undefined && !outcome.agent?.prompted) {
      process.exitCode = 1;
    }

    return outcome;
  }

  private async openWithHandoff(
    path: string,
    open: boolean,
    agent: boolean,
    handoff: string | undefined,
    reopened: boolean,
  ): Promise<OpenOutcome> {
    const opener = await this.resolveOpener(open);

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

    if (opener === "rex") {
      const { rex, opened, mayExist, startedAgent } = await this.openRexSession(
        path,
        agent,
        handoff,
      );

      // As for Herdr, a run where Rex did not open falls to the detached
      // dispatch, except when a timed-out `rex new` may have made the session:
      // an agent beside one that is already running is two in one tree.
      if (!opened && !mayExist && handoff !== undefined) {
        return { opener, agent: await this.dispatchAgent(path, handoff) };
      }

      if (opened && handoff !== undefined && !startedAgent) {
        this.warn(
          "The brief was not delivered: no agent was started in this Rex session.",
        );
      }

      return { opener, rex, agent: startedAgent };
    }

    // Before the opener, so the editor's line stays the last one printed.
    const dispatched =
      handoff !== undefined
        ? await this.dispatchAgent(path, handoff)
        : undefined;

    // Nothing is opened and nothing is launched: the path is the whole result.
    // Plain text, no glyph, so a script can take the last word of the line —
    // the path stays last whichever verb the line carries.
    if (opener === "none") {
      this.log(
        `${reopened ? "Worktree already exists at" : "Worktree created at"} ${path}`,
      );
    } else {
      await this.openCodeEditor(path, reopened);
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
   * Reads which Herdr space or Rex session each of this repository's worktrees is open in, and
   * answers with the function that closes them once they have been removed.
   *
   * **Call this before removing anything.** The listing is derived from git's
   * own worktrees, so `git worktree remove` and `git worktree prune` take the
   * entry out of Herdr's answer too — look it up afterwards and every space is
   * already unfindable (D2). One call answers for a whole run, because
   * `cleanup` removes a set and a lookup per worktree would be N subprocesses
   * where one does.
   *
   * A fixed `herdr` or `rex` consults that tool only (#270 D9). `auto` consults
   * every installed tool, not the detected one (#271 D7): a worktree Herdr
   * opened must still close when `remove` runs from a plain terminal or from
   * Rex. The lookups run concurrently and one failing is a warning that leaves
   * the other's result intact (D8).
   *
   * Everything that means "there is nothing to close" answers with the same
   * no-op, and none of them spawns a Herdr or Rex process: an `opener` that is
   * none of `herdr`, `rex` and `auto`, a tool not on PATH, or a repository
   * with no open spaces. The second of those is deliberately silent rather than a warning — someone
   * whose `opener` says `herdr` but who has no Herdr installed was already told
   * so, loudly, when the open failed, and a warning on every `remove`
   * afterwards is noise about something they cannot act on here.
   */
  protected async resolveSpaceCloser(): Promise<SpaceCloser> {
    const lookup = await this.findOpenSpaces();

    if (!lookup) {
      return closeNothing;
    }

    const { found, worktreesRootPath } = lookup;

    return async (worktreePaths: string[]) => {
      const closed: ClosedSpaces = { herdr: [], rex: [] };

      for (const worktreePath of worktreePaths) {
        for (const { tool, spaces } of found) {
          const workspaceId = spaces.get(worktreePath);

          // Three ways to get here, and none of them says anything. Two were
          // settled when the map was built: the worktree had no space open
          // (D9), or it is one this run must not touch (D7). The third is a
          // path the tool never listed, or listed in a different string form —
          // which is the orphan this feature exists to prevent, passing
          // silently. Both sides of the comparison come from git's own
          // worktree records and were verified byte-identical, so it stays
          // silent rather than warning on every worktree that legitimately has
          // no space.
          if (!workspaceId) {
            continue;
          }

          if (
            await this.closeSpace(
              tool.multiplexer,
              workspaceId,
              toSpaceLabel(worktreePath, worktreesRootPath),
            )
          ) {
            closed[tool.key].push(workspaceId);
          }
        }
      }

      return closed;
    };
  }

  /**
   * The lookup both `resolveSpaceCloser` and `resolveSpaceRenamer` start from:
   * every tool the configured opener names (one for `herdr` or `rex`, both for
   * `auto`, #271 D7) that is installed, each with the id of the space open in
   * each of this repository's worktrees. `undefined` is every way of having
   * nothing to act on — see `resolveSpaceCloser` for the list. A failed lookup
   * is a recorded warning, never a throw, and costs only its own tool (D8).
   */
  private async findOpenSpaces(): Promise<
    | {
        found: { tool: ToolToClose; spaces: Map<string, string> }[];
        worktreesRootPath: string;
      }
    | undefined
  > {
    const opener = await gitGetConfigValue("opener");
    const tools = toolsToClose(opener);

    if (tools.length === 0) {
      return undefined;
    }

    const installed = (
      await Promise.all(
        tools.map(async (tool) =>
          (await tool.multiplexer.isInstalled()) ? tool : undefined,
        ),
      )
    ).filter((tool) => tool !== undefined);

    if (installed.length === 0) {
      return undefined;
    }

    const spinner = createSpinner(
      `Finding ${installed
        .map(
          ({ multiplexer }) =>
            `${multiplexer.displayName} ${multiplexer.spaceNoun}s`,
        )
        .join(" and ")}`,
    ).start();
    let lookups: PromiseSettledResult<Map<string, string>>[];
    let worktreesRootPath: string;

    try {
      const [settled, worktreesPath] = await Promise.all([
        (async () => {
          const gitRootPath = await gitGetRootPath();

          return Promise.allSettled(
            installed.map(({ multiplexer }) =>
              multiplexer.findSpaces(gitRootPath),
            ),
          );
        })(),
        gitGetAbsoluteWorktreesPath(),
      ]);

      worktreesRootPath = `${worktreesPath}/`;
      lookups = settled;
    } catch (error) {
      // Deliberately wider than the tool calls: the two git lookups above are
      // shared by every tool, so nothing this seam needs can cost the user the
      // removal they actually asked for. Every message it can print names its
      // own source — Herdr's are prefixed `Herdr: `, and gitGetRootPath's says
      // it cannot find the root — so the breadth costs no diagnostic detail.
      //
      // Each lookup is all-or-nothing by construction: without it there is no
      // path-to-space mapping, so there is nothing any number of closes could
      // act on. Decided here deliberately rather than inherited (F-056) — the
      // run continues and the removals still happen, because by the time a
      // caller holds this closure the user has already asked for them.
      const message = error instanceof Error ? error.message : String(error);
      spinner.warn(message);
      this.recordWarning(message);
      return undefined;
    }

    // One spinner covers both lookups, because two live spinners would fight
    // over the same line. The first failure uses it; any other is a plain
    // warning, so every failure is still printed and recorded (D8).
    const found: { tool: ToolToClose; spaces: Map<string, string> }[] = [];
    let spinnerSettled = false;

    lookups.forEach((lookup, index) => {
      if (lookup.status === "fulfilled") {
        if (lookup.value.size > 0) {
          found.push({ tool: installed[index], spaces: lookup.value });
        }
        return;
      }

      const message =
        lookup.reason instanceof Error
          ? lookup.reason.message
          : String(lookup.reason);

      if (spinnerSettled) {
        this.warn(message);
        return;
      }

      spinnerSettled = true;
      spinner.warn(message);
      this.recordWarning(message);
    });

    if (!spinnerSettled) {
      spinner.stop();
    }

    if (found.length === 0) {
      return undefined;
    }

    return { found, worktreesRootPath };
  }

  /**
   * Reads which space is open in each worktree and answers with the function
   * that relabels it once its worktree has moved (#272 D12).
   *
   * **Call this before moving anything**, for the reason `resolveSpaceCloser`
   * gives: the listing is derived from git's worktrees. The tools asked are the
   * closer's — the configured opener's (#270 D9), or every installed one under
   * `auto` (#271 D7) — and everything that means "nothing to relabel" answers
   * with a no-op that spawns nothing. A failed lookup or relabel is a recorded
   * warning and never a throw: by the time the closure runs the rename has
   * succeeded and cannot be undone.
   */
  protected async resolveSpaceRenamer(): Promise<SpaceRenamer> {
    const lookup = await this.findOpenSpaces();

    if (!lookup) {
      return renameNothing;
    }

    const { found, worktreesRootPath } = lookup;

    return async (fromPath, toPath) => {
      const renamed: RenamedSpaces = { herdr: [], rex: [] };
      const from = toSpaceLabel(fromPath, worktreesRootPath);
      const to = toSpaceLabel(toPath, worktreesRootPath);

      for (const { tool, spaces } of found) {
        const { multiplexer } = tool;
        const spaceId = spaces.get(fromPath);
        const { renameSpace } = multiplexer;

        // No space open in the worktree is not an error and is not worth a
        // line, and a tool that cannot relabel is left as it is.
        if (!spaceId || !renameSpace) {
          continue;
        }

        const { displayName, spaceNoun } = multiplexer;
        const spinner = createSpinner(
          `Renaming ${displayName} ${spaceNoun} ${from} to ${to}`,
        ).start();

        try {
          await renameSpace.call(multiplexer, spaceId, to);
          spinner.succeed(
            `Renamed ${displayName} ${spaceNoun} ${from} to ${to}`,
          );
          renamed[tool.key].push(spaceId);
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          spinner.warn(message);
          this.recordWarning(message);
        }
      }

      return renamed;
    };
  }

  /**
   * Closes one space, and never lets that failure reach the command.
   *
   * By the time this runs the worktree is deleted, the branch is gone and git
   * no longer records the worktree — there is nothing left to retry and nothing
   * the user can do about it, so a non-zero exit would misreport what actually
   * happened (D5). Each space gets its own `catch` so one failure does not take
   * the rest of the run with it.
   */
  private async closeSpace(
    multiplexer: Multiplexer,
    workspaceId: string,
    label: string,
  ) {
    const { displayName, spaceNoun } = multiplexer;
    const spinner = createSpinner(
      `Closing ${displayName} ${spaceNoun} ${label}`,
    ).start();

    try {
      await multiplexer.closeSpace(workspaceId);
      spinner.succeed(`Closed ${displayName} ${spaceNoun} ${label}`);
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
    const { kind, head, tail } = await this.readHerdrAgentKind(brief);

    if (!kind) {
      if (brief !== undefined) {
        throw missingAgentKind();
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

  /**
   * Opens the worktree as a Rex session, in the skeleton of `openHerdrSpace`:
   * a spinner, the installed check, a label, and a failure that warns and
   * leaves the worktree where it is.
   *
   * The lookup comes first (D6): `rex new` with a label in use makes a second
   * session, so a worktree that is already open is selected, not opened again,
   * and no agent starts in it. A lookup that fails is a failed open and not a
   * guess, for the same reason.
   *
   * `opened` is whether a Rex session exists for the path afterwards, and
   * `mayExist` that a failed lookup, or a timed-out `rex new`, left it unknown.
   */
  private async openRexSession(
    path: string,
    wantsAgent: boolean,
    brief: string | undefined,
  ): Promise<{
    rex?: OpenOutcome["rex"];
    opened: boolean;
    mayExist?: boolean;
    startedAgent?: OpenedAgent;
  }> {
    const spinner = createSpinner("Opening in Rex").start();
    let mayExist = false;

    try {
      if (!(await isRexInstalled())) {
        throw new Error("Rex: the `rex` CLI was not found.");
      }

      const [label, focus] = await Promise.all([
        this.resolveSpaceLabel(path),
        gitGetConfigValue("rex.focus"),
      ]);

      // Before the lookup and the open, so a brief with no program to take it
      // fails before a session exists.
      const command =
        wantsAgent && brief !== undefined
          ? await this.resolveRexAgentCommand(brief)
          : undefined;

      // Unknown until the lookup answers: a failed one leaves a session, and an
      // agent in it, possible, so no detached agent may start beside it.
      mayExist = true;
      const existing = (await findRexSessions({ paths: [path] })).get(path);
      mayExist = false;

      if (existing) {
        spinner.succeed(`Rex session ${label} was already open`);
        await this.focusRexSession(existing, focus);
        return { opened: true, rex: { session: existing, block: null } };
      }

      let session: string;
      let block: string | null = null;

      try {
        const created = await createRexSession({ path, label, command });
        session = created.sessionId;
        block = created.blockId;
      } catch (error) {
        if (!(error instanceof RexError && error.timedOut)) {
          throw error;
        }

        // Rex's guide says a timed-out `new` may have succeeded (D4).
        const found = await findRexSessions({ paths: [path] }).catch(
          () => new Map<string, string>(),
        );
        const late = found.get(path);

        if (!late) {
          mayExist = true;
          throw error;
        }
        // Found by the lookup, which reads shells: `block` stays null, as for a
        // session that was already open.
        session = late;
      }

      spinner.succeed(`Opened Rex session ${label}`);
      await this.focusRexSession(session, focus);

      return {
        opened: true,
        rex: { session, block },
        // Created with the command: Rex reports nothing that says the agent
        // read the brief, and `prompted` documents that.
        startedAgent: command
          ? {
              name: null,
              kind: null,
              command: command.slice(0, -1),
              prompted: true,
            }
          : undefined,
      };
    } catch (error) {
      if (error instanceof MissingValueError) {
        spinner.stop();
        throw error;
      }

      // As Herdr's D5: no editor as a consolation prize, exit 0, the path.
      const message = error instanceof Error ? error.message : String(error);
      spinner.fail(message);
      this.recordWarning(message);
      this.log(`The worktree is at ${path}`);
      return { opened: false, mayExist };
    }
  }

  /**
   * The argv of a Rex agent session (D7): the program `agent.command` names,
   * its leading arguments, then the brief as the last element. A background
   * flag is dropped, because a program that detaches would end the session's
   * only process.
   */
  private async resolveRexAgentCommand(brief: string): Promise<string[]> {
    const [head, ...tail] = splitCommandValue(
      await gitGetConfigValue("agent.command"),
    );

    if (!head) {
      throw missingAgentCommand();
    }

    const args = tail.filter((arg) => !BACKGROUND_FLAGS.includes(arg));

    if (args.length < tail.length) {
      this.logToStderr(
        `Dropped ${BACKGROUND_FLAGS.join("/")} from agent.command: Rex runs the agent in the session.`,
      );
    }

    return [head, ...args, brief];
  }

  /**
   * Best effort (D5): the session exists whether or not the app comes to it,
   * so a refusal — Remote Control off, several apps, none open — is a warning.
   * Focus is on unless `rex.focus` is `false`.
   */
  private async focusRexSession(sessionId: string, focus: string) {
    if (focus === "false") {
      return;
    }

    try {
      await selectRexSession(sessionId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.warn(`The Rex session is open but was not focused. ${message}`);
    }
  }

  private async openCodeEditor(path: string, reopened: boolean) {
    const codeEditor = await gitGetConfigValue("codeEditor");
    // codeEditor is a command line, not a bare program name: the head is the
    // file to launch and the tail is leading arguments, with the worktree path
    // passed last as one argument however many spaces it contains. This is the
    // contract commandExists already validates by — it looks up the head alone
    // (cli.ts) — so validation and execution now agree. No shell parses this
    // value; quotes group an argument that contains spaces and are not passed
    // through (except an apostrophe between two letters or digits, which is
    // kept), so `~` and `$VAR` still reach the program unexpanded.
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
      this.log(
        `${chalk.green("✔")} ${reopened ? "Worktree already exists at" : "Worktree created in"} ${path}`,
      );
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
    // command named here has to set the key: `worktree config <name>` with no
    // value only prints it (`Config.run`). `assertBriefHasAnAgent` fails this
    // case before the tree exists; it is still reached when Herdr was the
    // opener, had a kind, and did not open.
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
    // status to report and no spinner that could ever settle. Whether it
    // started is known now, though (D7), so the success line waits for that.
    const failure = spawnDetached(agent, [...agentArgs, prompt], {
      cwd: path,
      onError: (error: Error) => this.log(chalk.red(`Error: ${error.message}`)),
    });
    if (failure) {
      this.warn(
        `The agent could not be started (${failure.message}), so the brief was not delivered.`,
      );
      return undefined;
    }
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
      // Escaped after redacting, never before: `redactSecrets` anchors its
      // token shapes on `\b`, which an escape's trailing word character hides.
      const shown = showLinesVisibly(message);
      console.error(
        error instanceof MissingValueError
          ? `worktree: ${shown}`
          : chalk.red(`Error: ${shown}`),
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
