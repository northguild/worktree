import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isMap, LineCounter, parseDocument } from "yaml";
import { z } from "zod";
import {
  PERSONAL_KEYS,
  SECRET_KEYS,
  showVisibly,
  step,
  TEAM_SECTIONS,
} from "./config-keys.js";
import { CONFIG_NAMES, JIRA_DEPLOYMENTS, OPENER_KINDS } from "./constants.js";
import { InvalidValueError } from "./prompt.js";
import {
  GITHUB_HOST_PATTERN,
  GITHUB_REPOSITORY_PATTERN,
  isValidGitHubHost,
  isValidGitHubRepository,
} from "./validators.js";

// Imports nothing from project-config.ts (#281 D9): the key tables both files
// share live in config-keys.ts, so the two readers never close a loop.

export const USER_CONFIG_DIR = "worktree";
export const USER_CONFIG_FILE = "config.yml";
/** Reads this file instead of the default location (#281 D4). */
export const USER_CONFIG_OVERRIDE_ENV = "WORKTREE_USER_CONFIG";

// ---------------------------------------------------------------------------
// Which keys the file may hold (#281 D5, D6)
// ---------------------------------------------------------------------------

// Team keys the user file may hold as a personal fallback: they apply when the
// project file and git config set nothing. `branchType`, `branchName` and
// `copy` stay team-only, so they are not here.
const TEAM_FALLBACK_KEYS = [
  "defaultSourceBranch",
  "branchPrefix.feature",
  "branchPrefix.bugfix",
  "branchPrefix.chore",
  "jira.host",
  "jira.deployment",
  "clickup.workspaceId",
  "github.repository",
  "github.host",
  "postCreate",
] as const;

const GITHUB_HOST_MESSAGE =
  "host must be a bare hostname, for example ghe.example.com (no scheme, port or path), and not a subdomain of github.com";

const text = z.string().min(1);

// One schema per accepted key; the nesting is built from the dotted names, so
// the key tables stay the one list of what the file may hold.
const VALUE_SCHEMAS: Record<string, z.ZodType> = {
  opener: z.enum(OPENER_KINDS),
  codeEditor: text,
  "herdr.focus": z.boolean(),
  "herdr.agent": text,
  "rex.focus": z.boolean(),
  "agent.command": text,
  "jira.email": text,
  "jira.autoAssign": z.boolean(),
  "jira.autoStart": z.boolean(),
  "github.autoAssign": z.boolean(),
  "linear.autoStart": z.boolean(),
  "linear.agentAllow": text,
  "linear.agentContext": z.boolean(),
  "clickup.autoAssign": z.boolean(),
  "clickup.autoStart": z.boolean(),
  defaultSourceBranch: text,
  "branchPrefix.feature": z.string(),
  "branchPrefix.bugfix": z.string(),
  "branchPrefix.chore": z.string(),
  "jira.host": text,
  "jira.deployment": z.enum(JIRA_DEPLOYMENTS),
  "clickup.workspaceId": z
    .union([z.string(), z.number()])
    .refine((id) => /^\d+$/.test(String(id)), {
      message: "workspace id must be digits only",
    }),
  "github.repository": z
    .string()
    .regex(GITHUB_REPOSITORY_PATTERN, {
      message: "repository must be owner/repo, for example acme/widgets",
      abort: true,
    })
    .refine((value) => isValidGitHubRepository(value) === true, {
      message: "repository must be owner/repo, for example acme/widgets",
    }),
  "github.host": z
    .string()
    .regex(GITHUB_HOST_PATTERN, { message: GITHUB_HOST_MESSAGE, abort: true })
    .refine((value) => isValidGitHubHost(value) === true, {
      message: GITHUB_HOST_MESSAGE,
    }),
  postCreate: z.array(step),
};

const ACCEPTED_KEYS = new Set<string>([
  ...PERSONAL_KEYS,
  ...TEAM_FALLBACK_KEYS,
]);

// Every section the file may open: the ones the key tables name, whether or not
// they hold an accepted child, so a stray `jira.branchType` warns by name.
const SECTIONS = new Set<string>([
  ...Object.keys(TEAM_SECTIONS),
  ...[...ACCEPTED_KEYS]
    .filter((key) => key.includes("."))
    .map((key) => key.split(".")[0] ?? key),
]);

function buildSchema() {
  const top: Record<string, z.ZodType> = {};
  const sections: Record<string, Record<string, z.ZodType>> = {};
  for (const key of ACCEPTED_KEYS) {
    const schema = VALUE_SCHEMAS[key];
    if (schema === undefined) {
      throw new Error(`user-config: no value schema for ${key}`);
    }
    const [head, child] = key.split(".");
    if (head === undefined) {
      continue;
    }
    if (child === undefined) {
      top[key] = schema.optional();
    } else {
      const group = sections[head] ?? {};
      group[child] = schema.optional();
      sections[head] = group;
    }
  }
  for (const [head, children] of Object.entries(sections)) {
    top[head] = z.object(children).optional();
  }
  return z.object(top);
}

const userConfigSchema = buildSchema();

export type UserConfig = z.infer<typeof userConfigSchema>;

// ---------------------------------------------------------------------------
// Result and error types
// ---------------------------------------------------------------------------

export type NoUserConfigReason = "no-file" | "empty-file" | "unusable";

export type UserConfigResult =
  | {
      status: "none";
      reason: NoUserConfigReason;
      /** Where it looked. */
      path: string;
      /** Said on stderr by the caller, once per run. */
      warnings: string[];
    }
  | {
      status: "loaded";
      path: string;
      config: UserConfig;
      warnings: string[];
    };

/** A file that must stop the run: exit 2, `invalid_value` (#281 D6). */
export class UserConfigError extends InvalidValueError {
  constructor(message: string, options?: ErrorOptions) {
    super(message);
    this.name = "UserConfigError";
    this.cause = options?.cause;
  }
}

// ---------------------------------------------------------------------------
// Location (#281 D3, D4)
// ---------------------------------------------------------------------------

/**
 * `$WORKTREE_USER_CONFIG`, else `$XDG_CONFIG_HOME/worktree/config.yml`, else
 * `~/.config/worktree/config.yml`. Per the XDG Base Directory Specification a
 * `XDG_CONFIG_HOME` that is empty or not absolute is ignored.
 */
export function userConfigPath(
  env: Record<string, string | undefined> = process.env,
  home: string = os.homedir(),
) {
  const override = env[USER_CONFIG_OVERRIDE_ENV];
  if (override) {
    return { path: path.resolve(override), explicit: true };
  }
  const xdg = env.XDG_CONFIG_HOME;
  const base = xdg && path.isAbsolute(xdg) ? xdg : path.join(home, ".config");
  return {
    path: path.join(base, USER_CONFIG_DIR, USER_CONFIG_FILE),
    explicit: false,
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatKeyPath(keyPath: readonly PropertyKey[]) {
  return keyPath.reduce<string>((joined, segment) => {
    if (typeof segment === "number") {
      return `${joined}[${segment}]`;
    }
    return joined === "" ? String(segment) : `${joined}.${String(segment)}`;
  }, "");
}

function readFile(file: string, explicit: boolean) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    // No file at the default location is the ordinary case; a file asked for by
    // name, or one that exists and cannot be read, is not.
    if (
      !explicit &&
      error instanceof Error &&
      "code" in error &&
      (error.code === "ENOENT" || error.code === "ENOTDIR")
    ) {
      return undefined;
    }
    throw new UserConfigError(
      `Cannot read ${showVisibly(file)}: ${showVisibly(error instanceof Error ? error.message : String(error))}`,
      { cause: error },
    );
  }
}

/**
 * Reads, parses and validates the user config. A file that cannot be used
 * throws `UserConfigError`; "no file" is a result, not an error, and says
 * nothing.
 */
export async function readUserConfig(
  env: Record<string, string | undefined> = process.env,
  home: string = os.homedir(),
): Promise<UserConfigResult> {
  const { path: file, explicit } = userConfigPath(env, home);
  const content = readFile(file, explicit);
  if (content === undefined) {
    return { status: "none", reason: "no-file", path: file, warnings: [] };
  }

  const warnings: string[] = [];
  const config = parseUserConfig(content, file, warnings);
  if (config === undefined) {
    return { status: "none", reason: "empty-file", path: file, warnings };
  }
  return { status: "loaded", path: file, config, warnings };
}

let cached: Promise<UserConfigResult> | undefined;

/** The per-run result: one read however many callers ask. */
export function loadUserConfig() {
  cached ??= readUserConfig();
  return cached;
}

export function resetUserConfigCache() {
  cached = undefined;
}

/**
 * The read for `worktree config`, the command that repairs a bad file (#281
 * §2). A file that cannot be used comes back as `error` for the caller to say,
 * and is treated as absent for the rest of the run, so every reader after this
 * one (the wizard's, the layered reader's) sees no file instead of throwing.
 */
export async function loadUserConfigForRepair(): Promise<{
  result: UserConfigResult;
  error?: UserConfigError;
}> {
  try {
    return { result: await loadUserConfig() };
  } catch (error) {
    if (!(error instanceof UserConfigError)) {
      throw error;
    }
    const result: UserConfigResult = {
      status: "none",
      reason: "unusable",
      path: userConfigPath().path,
      warnings: [],
    };
    cached = Promise.resolve(result);
    return { result, error };
  }
}

/** The file's path as a person would write it: under the home directory, `~/…`. */
export function userConfigLabel(file: string, home: string = os.homedir()) {
  const prefix = home.endsWith(path.sep) ? home : `${home}${path.sep}`;
  return file.startsWith(prefix)
    ? `~${path.sep}${file.slice(prefix.length)}`
    : file;
}

/** The settings of a loaded file as text, by dotted name; a step list is its steps joined. */
export function userFileValue(config: UserConfig, name: string) {
  let current: unknown = config;
  for (const segment of name.split(".")) {
    if (!isPlainObject(current)) {
      return undefined;
    }
    current = current[segment];
  }
  if (Array.isArray(current)) {
    return current.join("; ");
  }
  return typeof current === "string" ||
    typeof current === "number" ||
    typeof current === "boolean"
    ? String(current)
    : undefined;
}

// ---------------------------------------------------------------------------
// Parsing and validation
// ---------------------------------------------------------------------------

/** `undefined` when the file holds no settings at all. */
function parseUserConfig(
  content: string,
  file: string,
  warnings: string[],
): UserConfig | undefined {
  const label = showVisibly(file);
  const lineCounter = new LineCounter();
  const document = parseDocument(content, { lineCounter });
  const fail = (message: string): never => {
    throw new UserConfigError(`Invalid ${label}: ${message}`);
  };

  const [yamlError] = document.errors;
  if (yamlError) {
    const line = yamlError.linePos?.[0].line;
    const where = line === undefined ? "" : ` (line ${line})`;
    return fail(
      `${showVisibly(yamlError.message.split("\n")[0] ?? "")}${where}`,
    );
  }

  const lineOf = (keyPath: readonly PropertyKey[]) => {
    for (let depth = keyPath.length; depth >= 0; depth--) {
      const node = document.getIn(keyPath.slice(0, depth), true);
      const offset =
        typeof node === "object" && node !== null && "range" in node
          ? (node.range as [number, number, number] | null | undefined)?.[0]
          : undefined;
      if (offset !== undefined) {
        return lineCounter.linePos(offset).line;
      }
    }
    return 1;
  };
  const at = (keyPath: readonly PropertyKey[]) =>
    `${showVisibly(formatKeyPath(keyPath))} (line ${lineOf(keyPath)})`;

  const raw: unknown = document.toJS();
  if (raw === null || raw === undefined) {
    return undefined;
  }
  if (!isPlainObject(raw)) {
    return fail("the file must be a mapping of keys to values");
  }

  const settings = classifyKeys(raw, at, label, fail, warnings);
  const parsed = userConfigSchema.safeParse(settings);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => {
      const where =
        issue.path.length === 0 ? `(line ${lineOf([])})` : at(issue.path);
      return `${where}: ${showVisibly(issue.message)}`;
    });
    return fail(`\n  ${problems.join("\n  ")}`);
  }
  return parsed.data;
}

// Splits the raw mapping into what zod validates and what is refused or
// ignored. Secrets stop the run (D6); unknown keys warn and are dropped.
function classifyKeys(
  raw: Record<string, unknown>,
  at: (keyPath: readonly PropertyKey[]) => string,
  label: string,
  fail: (message: string) => never,
  warnings: string[],
) {
  const settings: Record<string, unknown> = {};
  const secrets: string[] = [];

  const warnUnknown = (key: string, keyPath: readonly PropertyKey[]) =>
    warnings.push(
      `${label}: ${at(keyPath)}: unknown key \`${showVisibly(key)}\` is ignored. A newer version of worktree may know it.`,
    );

  for (const [key, value] of Object.entries(raw)) {
    if (SECRET_KEYS.has(key)) {
      secrets.push(at([key]));
    } else if (ACCEPTED_KEYS.has(key) && !key.includes(".")) {
      // A dotted name written flat is not nested into its section, so it would
      // be dropped silently; it falls through to the unknown-key warning.
      settings[key] = value;
    } else if (SECTIONS.has(key)) {
      if (!isPlainObject(value)) {
        settings[key] = value;
        continue;
      }
      const kept: Record<string, unknown> = {};
      for (const [child, childValue] of Object.entries(value)) {
        const dotted = `${key}.${child}`;
        if (SECRET_KEYS.has(dotted)) {
          secrets.push(at([key, child]));
        } else if (ACCEPTED_KEYS.has(dotted)) {
          kept[child] = childValue;
        } else {
          warnUnknown(dotted, [key, child]);
        }
      }
      settings[key] = kept;
    } else {
      warnUnknown(key, [key]);
    }
  }

  if (secrets.length > 0) {
    // Never the value: it is the thing that leaked.
    fail(
      `${showVisibly(secrets.join(", "))} is a secret and does not belong in this file. Remove it and keep it in your own git config with \`worktree config <key>\`.`,
    );
  }
  return settings;
}

// ---------------------------------------------------------------------------
// Writing (#281 D8)
// ---------------------------------------------------------------------------

/** A file key's value as the file holds it: a boolean, a list or text. */
function typedValue(name: string, raw: string): unknown {
  const schema = VALUE_SCHEMAS[name];
  if (schema instanceof z.ZodBoolean) {
    if (raw !== "true" && raw !== "false") {
      throw new UserConfigError(`${name} must be true or false`);
    }
    return raw === "true";
  }
  // A single command, as git config holds it, is a list of one step.
  return name === "postCreate" ? [raw] : raw;
}

function headerComment(file: string, home: string) {
  return [
    ` ${userConfigLabel(file, home)}: personal defaults for every repository.`,
    " Never put a token here; keep secrets in git config with `worktree config <key>`.",
  ].join("\n");
}

/** Where a file that already exists really lives, so a symlink is written through. */
function realTarget(file: string) {
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
}

/**
 * Atomic: a sibling temp file, created `0600` and renamed over the target, so a
 * reader never sees half a file. The directory is created `0700` when missing;
 * one that exists keeps its mode. The rename gives an existing file `0600` too.
 */
function writeAtomically(file: string, content: string) {
  const target = realTarget(file);
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const fd = fs.openSync(temp, "wx", 0o600);
    try {
      // The creation mode is masked by the umask; this is not.
      fs.fchmodSync(fd, 0o600);
      fs.writeFileSync(fd, content);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, target);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw new UserConfigError(
      `Cannot write ${showVisibly(target)}: ${showVisibly(error instanceof Error ? error.message : String(error))}`,
      { cause: error },
    );
  }
}

/**
 * Refuses a secret (D6) and a key the file cannot hold, with exit 2 naming the
 * key and never a value, and returns the key's value schema. Called before the
 * value is validated, so a rejected token is never echoed by a validator.
 */
export function assertUserFileKey(name: string) {
  if (SECRET_KEYS.has(name)) {
    throw new UserConfigError(
      `${name} is a secret and cannot be set in the user config file. Keep it in git config with \`worktree config ${name} <value>\`.`,
    );
  }
  const schema = VALUE_SCHEMAS[name];
  if (!ACCEPTED_KEYS.has(name) || schema === undefined) {
    throw new UserConfigError(
      `${name} cannot be set in the user config file. It is read from git config only: use \`worktree config ${name} <value>\`.`,
    );
  }
  return schema;
}

/** The accepted keys a loaded file sets, in `CONFIG_NAMES` order. */
export function userFileKeys(config: UserConfig) {
  return CONFIG_NAMES.filter(
    (name) =>
      ACCEPTED_KEYS.has(name) && userFileValue(config, name) !== undefined,
  );
}

/**
 * `worktree config --user <key> <value>`: sets one key in the user file,
 * keeping its comments and key order. Refuses a secret and a key the file
 * cannot hold (exit 2, naming the key and never the value), and never rewrites
 * a file that does not parse. A value the file already holds changes nothing.
 * The caller validates the value with `validateConfigValue`.
 */
export function writeUserConfigValue(
  name: string,
  raw: string,
  env: Record<string, string | undefined> = process.env,
  home: string = os.homedir(),
): { path: string; changed: boolean } {
  const schema = assertUserFileKey(name);
  const value = typedValue(name, raw);
  const checked = schema.safeParse(value);
  if (!checked.success) {
    throw new UserConfigError(
      `Invalid value for ${name}: ${checked.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }

  const { path: file } = userConfigPath(env, home);
  const label = showVisibly(file);
  const existing = readFile(realTarget(file), false);
  const document = parseDocument(existing ?? "");
  const [yamlError] = document.errors;
  if (yamlError) {
    throw new UserConfigError(
      `${label} is not valid YAML, so it was left as it is: ${showVisibly(yamlError.message.split("\n")[0] ?? "")}. Fix it by hand, then run this again.`,
    );
  }
  if (document.contents !== null && !isMap(document.contents)) {
    throw new UserConfigError(
      `${label} must be a mapping of keys to values, so it was left as it is.`,
    );
  }

  const keyPath = name.split(".");
  if (JSON.stringify(document.getIn(keyPath)) === JSON.stringify(value)) {
    return { path: file, changed: false };
  }
  try {
    document.setIn(
      keyPath,
      Array.isArray(value) ? document.createNode(value) : value,
    );
  } catch {
    throw new UserConfigError(
      `Cannot set ${name} in ${label}: ${keyPath[0]} is not a section there. The file was left as it is.`,
    );
  }
  if (existing === undefined || existing.trim() === "") {
    // On the mapping, not the document: a document comment is followed by a
    // blank line, and the header sits directly above the keys (§4).
    if (isMap(document.contents)) {
      document.contents.commentBefore = headerComment(file, home);
    }
  }
  writeAtomically(file, document.toString());
  resetUserConfigCache();
  return { path: file, changed: true };
}
