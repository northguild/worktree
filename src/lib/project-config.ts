import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { LineCounter, parseDocument } from "yaml";
import { z } from "zod";
import { run } from "./cli.js";
import { SECRET_CONFIG_NAMES } from "./constants.js";
import {
  gitGetConfigValue,
  gitGetTopLevelPath,
  gitHasOriginRemote,
  gitReadBlobAtRef,
  gitResolveOriginHead,
} from "./git.js";
import { isNonInteractive } from "./interaction.js";
import { askConfirm, InvalidValueError, MissingValueError } from "./prompt.js";
import type { ConfigName } from "./types.js";

// Imports git.ts and is never imported by it (or by agent.ts): git.ts and
// agent.ts already import each other (#59), and this file must not close
// another loop.

export const PROJECT_CONFIG_FILE = ".worktree.yml";
export const PROJECT_CONFIG_SCHEMA_URL =
  "https://northguild.github.io/worktree/schema/v1.json";
/** Reads this file instead of the ref, to test an edit before it merges (D1). */
const OVERRIDE_ENV = "WORKTREE_PROJECT_CONFIG";

// ---------------------------------------------------------------------------
// The schema (D3, D8, D9, D12, D14, D15). Defined once; the types and the
// published JSON Schema both come from it.
// ---------------------------------------------------------------------------

export const BRANCH_KINDS = ["feature", "bugfix", "chore"] as const;

const BRANCH_NAME_PLACEHOLDERS = new Set(["{prefix}", "{id}", "{slug}"]);

// A field value is a name or an id. YAML turns an unquoted 10301 into a
// number, so both spellings are accepted here and compared as text later.
const scalar = z.union([z.string(), z.number()]);
const idRef = z.strictObject({ id: scalar });
const fieldValue = z.union([scalar, idRef]);
const fieldMatch = z.union([fieldValue, z.array(fieldValue).min(1)]);

const conditionalRule = z.strictObject({
  when: z
    .record(z.string(), fieldMatch)
    .refine((when) => Object.keys(when).length > 0, {
      message: "when must name at least one field",
    })
    .meta({
      description:
        "Field name or id mapped to the value, id object or list of either that must match. Every field must match.",
    }),
  type: z.enum(BRANCH_KINDS),
});

const otherwiseRule = z.strictObject({ otherwise: z.enum(BRANCH_KINDS) });

const branchTypeRules = z
  .array(z.union([conditionalRule, otherwiseRule]))
  .superRefine((rules, ctx) => {
    const otherwiseAt = rules.flatMap((rule, index) =>
      "otherwise" in rule ? [index] : [],
    );
    const lastIndex = rules.length - 1;
    if (
      otherwiseAt.length > 1 ||
      (otherwiseAt.length === 1 && otherwiseAt[0] !== lastIndex)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "`otherwise` may appear once, and only as the last rule",
      });
    }
  })
  .meta({
    description:
      "Ordered rules; the first match wins. `- otherwise: <kind>` sets the kind for an issue no rule matched.",
  });

const branchType = z.object({ branchType: branchTypeRules.optional() });

const branchNameTemplate = z.string().superRefine((template, ctx) => {
  for (const [token] of template.matchAll(/\{[^{}]*\}/g)) {
    if (!BRANCH_NAME_PLACEHOLDERS.has(token)) {
      ctx.addIssue({
        code: "custom",
        message: `${token} is not a placeholder; use {prefix}, {id} or {slug}`,
      });
    }
  }
});

const copyPattern = z
  .string()
  .refine(
    (pattern) =>
      pattern.trim() !== "" &&
      !pattern.startsWith("/") &&
      !pattern.startsWith(":") &&
      !pattern.split(/[\\/]/).includes(".."),
    {
      message:
        "a copy pattern is a relative glob: no leading / or :, and no .. segment",
    },
  );

// The approval prompt prints a step as text, so one that redraws the terminal
// (\r, ESC) or reorders it (bidi overrides) would hide what runs (D16).
const step = z
  .string()
  .refine((value) => value.trim() !== "", {
    message: "a step cannot be empty",
  })
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), {
    message: "a step cannot hold control or formatting characters",
  });

export const projectConfigSchema = z
  .object({
    defaultSourceBranch: z.string().min(1).optional(),
    branchPrefix: z
      .object({
        feature: z.string().optional(),
        bugfix: z.string().optional(),
        chore: z.string().optional(),
      })
      .optional(),
    jira: branchType.extend({ host: z.string().min(1).optional() }).optional(),
    github: branchType.optional(),
    linear: branchType.optional(),
    clickup: branchType
      .extend({
        workspaceId: scalar
          .refine((id) => /^\d+$/.test(String(id)), {
            message: "workspace id must be digits only",
          })
          .optional(),
      })
      .optional(),
    branchName: branchNameTemplate.optional(),
    copy: z.array(copyPattern).optional(),
    postCreate: z.array(step).optional(),
  })
  .meta({
    title: ".worktree.yml",
    description:
      "Team configuration for @northguild/worktree, read from the repository's default branch.",
  });

export type ProjectConfig = z.infer<typeof projectConfigSchema>;
export type BranchKind = (typeof BRANCH_KINDS)[number];
export type BranchTypeRule = z.infer<typeof branchTypeRules>[number];

/** What the editor's `$schema` comment points at; committed under docs/public. */
export function projectConfigJsonSchema() {
  return {
    ...z.toJSONSchema(projectConfigSchema, {
      target: "draft-2020-12",
      io: "input",
    }),
    $id: PROJECT_CONFIG_SCHEMA_URL,
  };
}

// ---------------------------------------------------------------------------
// Key classes (D3)
// ---------------------------------------------------------------------------

// Sections that hold team keys, and which children they may hold.
const TEAM_SECTIONS: Record<string, readonly string[]> = {
  branchPrefix: ["feature", "bugfix", "chore"],
  jira: ["host", "branchType"],
  github: ["branchType"],
  linear: ["branchType"],
  clickup: ["workspaceId", "branchType"],
};
const TEAM_SCALARS = new Set([
  "defaultSourceBranch",
  "branchName",
  "copy",
  "postCreate",
]);
// Per-person keys: ignored in the file, with a warning that names where to set them.
const PERSONAL_KEYS = new Set([
  "opener",
  "codeEditor",
  "herdr.focus",
  "herdr.agent",
  "agent.command",
  "jira.email",
  "jira.autoAssign",
  "github.autoAssign",
]);
const PERSONAL_SECTIONS = new Set(["herdr", "agent"]);
const SECRET_KEYS = new Set<string>(SECRET_CONFIG_NAMES);

// ---------------------------------------------------------------------------
// Result and error types
// ---------------------------------------------------------------------------

export type ProjectConfigSource =
  | { kind: "ref"; ref: string }
  | { kind: "path"; path: string };

export type NoProjectConfigReason = "no-ref" | "no-file" | "empty-file";

export type ProjectConfigResult =
  | {
      status: "none";
      reason: NoProjectConfigReason;
      source?: ProjectConfigSource;
      /** Said on stderr by the caller, once per run. */
      warnings: string[];
    }
  | {
      status: "loaded";
      source: ProjectConfigSource;
      config: ProjectConfig;
      warnings: string[];
    };

/** A file that must stop the run: exit 2, `invalid_value` (D4). */
export class ProjectConfigError extends InvalidValueError {
  constructor(message: string, options?: ErrorOptions) {
    super(message);
    this.name = "ProjectConfigError";
    this.cause = options?.cause;
  }
}

// ---------------------------------------------------------------------------
// Reading (D1)
// ---------------------------------------------------------------------------

async function readOverride(file: string) {
  const resolved = path.resolve(file);
  try {
    return { resolved, content: fs.readFileSync(resolved, "utf8") };
  } catch (error) {
    throw new ProjectConfigError(
      `Cannot read ${OVERRIDE_ENV}=${resolved}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

// The ref project config is read from: origin/HEAD, else the personal
// defaultSourceBranch. Never the file's own value, which would be circular.
async function resolveRef() {
  return (
    (await gitResolveOriginHead()) ||
    (await gitGetConfigValue("defaultSourceBranch"))
  );
}

async function workingCopyWarning(ref: string, content: string) {
  const working = path.join(await gitGetTopLevelPath(), PROJECT_CONFIG_FILE);
  let workingContent: string;
  try {
    workingContent = fs.readFileSync(working, "utf8");
  } catch {
    // No copy of its own in this worktree: nothing to disagree with.
    return [];
  }
  if (workingContent.trim() === content.trim()) {
    return [];
  }
  return [
    `${working} differs from ${PROJECT_CONFIG_FILE} at ${ref}, which is the copy in use. Only the merged copy applies; use ${OVERRIDE_ENV}=${working} to try your edit.`,
  ];
}

/**
 * Reads, parses and validates the project config. A file that cannot be used
 * throws `ProjectConfigError` before the caller creates anything; "no config"
 * is a result, not an error.
 */
export async function readProjectConfig(
  env: Record<string, string | undefined> = process.env,
): Promise<ProjectConfigResult> {
  const warnings: string[] = [];
  const override = env[OVERRIDE_ENV];

  let source: ProjectConfigSource;
  let content: string;
  let label: string;

  if (override) {
    const { resolved, content: text } = await readOverride(override);
    source = { kind: "path", path: resolved };
    content = text;
    label = resolved;
    warnings.push(
      `Reading project config from ${resolved} (${OVERRIDE_ENV}), not from the repository.`,
    );
  } else {
    const ref = await resolveRef();
    if (!ref) {
      if (await gitHasOriginRemote()) {
        warnings.push(
          `No default branch is known, so ${PROJECT_CONFIG_FILE} was not read. Run \`git remote set-head origin --auto\`.`,
        );
      }
      return { status: "none", reason: "no-ref", warnings };
    }
    const blob = await gitReadBlobAtRef(ref, PROJECT_CONFIG_FILE);
    if (blob.status === "absent-ref") {
      if (await gitHasOriginRemote()) {
        warnings.push(
          `${ref} does not resolve, so ${PROJECT_CONFIG_FILE} was not read. Run \`git remote set-head origin --auto\`.`,
        );
      }
      return { status: "none", reason: "no-ref", warnings };
    }
    source = { kind: "ref", ref };
    if (blob.status === "absent-path") {
      return { status: "none", reason: "no-file", source, warnings };
    }
    content = blob.content;
    label = `${PROJECT_CONFIG_FILE} at ${ref}`;
    warnings.push(...(await workingCopyWarning(ref, content)));
  }

  const config = parseProjectConfig(content, label, source, warnings);
  if (config === undefined) {
    return { status: "none", reason: "empty-file", source, warnings };
  }
  return { status: "loaded", source, config, warnings };
}

let cached: Promise<ProjectConfigResult> | undefined;

/** The per-run result: one read however many callers ask. */
export function loadProjectConfig() {
  cached ??= readProjectConfig();
  return cached;
}

export function resetProjectConfigCache() {
  cached = undefined;
}

// ---------------------------------------------------------------------------
// Precedence (D2)
// ---------------------------------------------------------------------------

// The team keys whose file form is a single value. `postCreate` is a team key
// too, but the file holds a list of steps and has its own reader.
const TEAM_CONFIG_KEYS = [
  "defaultSourceBranch",
  "branchPrefix.feature",
  "branchPrefix.bugfix",
  "branchPrefix.chore",
  "jira.host",
  "clickup.workspaceId",
] as const satisfies readonly ConfigName[];

export type TeamConfigKey = (typeof TEAM_CONFIG_KEYS)[number];
/** Where an answer came from; `default` means the caller's built-in applies. */
export type ConfigValueSource = "git-config" | "project" | "default";

export function isTeamConfigKey(name: string): name is TeamConfigKey {
  return (TEAM_CONFIG_KEYS as readonly string[]).includes(name);
}

function projectValue(config: ProjectConfig, key: TeamConfigKey) {
  switch (key) {
    case "defaultSourceBranch":
      return config.defaultSourceBranch;
    case "branchPrefix.feature":
      return config.branchPrefix?.feature;
    case "branchPrefix.bugfix":
      return config.branchPrefix?.bugfix;
    case "branchPrefix.chore":
      return config.branchPrefix?.chore;
    case "jira.host":
      return config.jira?.host;
    case "clickup.workspaceId":
      // YAML reads an unquoted 9001234 as a number; git config holds text.
      return config.clickup?.workspaceId === undefined
        ? undefined
        : String(config.clickup.workspaceId);
  }
}

/**
 * A team key by D2: git config (any scope) first, then the project file, then
 * `""` with source `default` for the caller's built-in. The file is not read
 * when git config answers. A file that cannot be used throws
 * `ProjectConfigError`, as `loadProjectConfig` does.
 */
export async function resolveTeamConfig(name: TeamConfigKey): Promise<{
  value: string;
  source: ConfigValueSource;
}> {
  const personal = await gitGetConfigValue(name);
  if (personal) {
    return { value: personal, source: "git-config" };
  }
  const result = await loadProjectConfig();
  const fromFile =
    result.status === "loaded" ? projectValue(result.config, name) : undefined;
  return fromFile
    ? { value: fromFile, source: "project" }
    : { value: "", source: "default" };
}

export async function getTeamConfigValue(name: TeamConfigKey) {
  return (await resolveTeamConfig(name)).value;
}

// ---------------------------------------------------------------------------
// What the issue integrations share (D8, D12)
// ---------------------------------------------------------------------------

/** `<provider>.branchType` from the project file, when it sets one. */
export async function getBranchTypeRules(
  provider: "github" | "linear" | "clickup",
) {
  const project = await loadProjectConfig();
  return project.status === "loaded"
    ? project.config[provider]?.branchType
    : undefined;
}

/** The configured prefix for a kind; no kind is no prefix (D8). */
export async function getBranchPrefix(kind: BranchKind | undefined) {
  return kind === undefined
    ? ""
    : ((await getTeamConfigValue(`branchPrefix.${kind}`)) ?? "");
}

const DEFAULT_BRANCH_NAME = "{prefix}{id}-{slug}";

/**
 * The name for an issue (D12). The default template is today's name for every
 * provider. One pass, so a `{id}` inside a slug is not expanded. The caller
 * still validates the result; a positional name never comes through here.
 */
export async function renderBranchName(parts: {
  prefix: string;
  id: string;
  slug: string;
}) {
  const project = await loadProjectConfig();
  const template =
    (project.status === "loaded" ? project.config.branchName : undefined) ??
    DEFAULT_BRANCH_NAME;
  return template.replace(
    /\{(prefix|id|slug)\}/g,
    (_token, key: keyof typeof parts) => parts[key],
  );
}

// ---------------------------------------------------------------------------
// Parsing and validation (D3, D4)
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Text from the file, made safe to print: every control (`\p{Cc}`) and
 * formatting (`\p{Cf}`) character becomes a visible escape such as `\x1b` or
 * `\u{202e}`, so a key or value cannot redraw the terminal or reorder what a
 * warning, an error or the approval prompt shows (D16).
 */
export function showVisibly(text: string) {
  return text.replace(/[\p{Cc}\p{Cf}]/gu, (char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x100
      ? `\\x${code.toString(16).padStart(2, "0")}`
      : `\\u{${code.toString(16)}}`;
  });
}

function formatKeyPath(keyPath: readonly PropertyKey[]) {
  return keyPath.reduce<string>((text, segment) => {
    if (typeof segment === "number") {
      return `${text}[${segment}]`;
    }
    return text === "" ? String(segment) : `${text}.${String(segment)}`;
  }, "");
}

// zod reports a failed union as one issue naming no field. The branch with the
// fewest problems is the one the author was aiming at, so its issues are the
// useful ones.
function flattenIssues(issues: readonly z.core.$ZodIssue[]) {
  const flat: z.core.$ZodIssue[] = [];
  for (const issue of issues) {
    if (issue.code === "invalid_union" && issue.errors.length > 0) {
      const closest = issue.errors.reduce((best, candidate) =>
        candidate.length < best.length ? candidate : best,
      );
      flat.push(
        ...flattenIssues(closest).map((inner) => ({
          ...inner,
          path: [...issue.path, ...inner.path],
        })),
      );
    } else {
      flat.push(issue);
    }
  }
  return flat;
}

/** `undefined` when the file holds no settings at all. */
function parseProjectConfig(
  content: string,
  label: string,
  source: ProjectConfigSource,
  warnings: string[],
): ProjectConfig | undefined {
  const lineCounter = new LineCounter();
  const document = parseDocument(content, { lineCounter });
  const fail = (message: string): never => {
    throw new ProjectConfigError(`Invalid ${label}: ${message}`);
  };

  const [yamlError] = document.errors;
  if (yamlError) {
    const line = yamlError.linePos?.[0].line;
    const where = line === undefined ? "" : ` (line ${line})`;
    return fail(
      `${showVisibly(yamlError.message.split("\n")[0] ?? "")}${where}`,
    );
  }

  // The nearest node that exists: a missing required key still has a parent.
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

  const settings = classifyKeys(raw, at, source, label, fail, warnings);
  const parsed = projectConfigSchema.safeParse(settings);
  if (!parsed.success) {
    const problems = flattenIssues(parsed.error.issues).map((issue) => {
      const keyPath = issue.path;
      const message =
        issue.code === "unrecognized_keys"
          ? `${showVisibly(issue.message)} (${showVisibly(issue.keys.join(", "))})`
          : showVisibly(issue.message);
      return `${keyPath.length === 0 ? `(line ${lineOf(keyPath)})` : at(keyPath)}: ${message}`;
    });
    return fail(`\n  ${problems.join("\n  ")}`);
  }
  return parsed.data;
}

// Splits the raw mapping into what zod validates and what is refused or
// ignored. Secrets stop the run; personal and unknown keys warn and are dropped.
function classifyKeys(
  raw: Record<string, unknown>,
  at: (keyPath: readonly PropertyKey[]) => string,
  source: ProjectConfigSource,
  label: string,
  fail: (message: string) => never,
  warnings: string[],
) {
  const settings: Record<string, unknown> = {};
  const secrets: string[] = [];

  const warnPersonal = (key: string, keyPath: readonly PropertyKey[]) =>
    warnings.push(
      `${label}: ${at(keyPath)}: \`${showVisibly(key)}\` is a personal setting and is ignored here. Set it with \`worktree config ${showVisibly(key)}\`.`,
    );
  const warnUnknown = (key: string, keyPath: readonly PropertyKey[]) =>
    warnings.push(
      `${label}: ${at(keyPath)}: unknown key \`${showVisibly(key)}\` is ignored. A newer version of worktree may know it.`,
    );

  for (const [key, value] of Object.entries(raw)) {
    if (SECRET_KEYS.has(key)) {
      secrets.push(at([key]));
    } else if (TEAM_SCALARS.has(key)) {
      settings[key] = value;
    } else if (Object.hasOwn(TEAM_SECTIONS, key)) {
      if (!isPlainObject(value)) {
        settings[key] = value;
        continue;
      }
      const kept: Record<string, unknown> = {};
      for (const [child, childValue] of Object.entries(value)) {
        const dotted = `${key}.${child}`;
        if (SECRET_KEYS.has(dotted)) {
          secrets.push(at([key, child]));
        } else if (PERSONAL_KEYS.has(dotted)) {
          warnPersonal(dotted, [key, child]);
        } else if (TEAM_SECTIONS[key]?.includes(child)) {
          kept[child] = childValue;
        } else {
          warnUnknown(dotted, [key, child]);
        }
      }
      if (Object.keys(kept).length > 0 || Object.keys(value).length === 0) {
        settings[key] = kept;
      }
    } else if (PERSONAL_KEYS.has(key)) {
      warnPersonal(key, [key]);
    } else if (PERSONAL_SECTIONS.has(key)) {
      if (!isPlainObject(value)) {
        warnPersonal(key, [key]);
        continue;
      }
      for (const child of Object.keys(value)) {
        const dotted = `${key}.${child}`;
        if (PERSONAL_KEYS.has(dotted)) {
          warnPersonal(dotted, [key, child]);
        } else {
          warnUnknown(dotted, [key, child]);
        }
      }
    } else {
      warnUnknown(key, [key]);
    }
  }

  if (secrets.length > 0) {
    // Never the value: it is the thing that leaked.
    const names = showVisibly(secrets.join(", "));
    const where =
      source.kind === "ref"
        ? `${names} is a secret and does not belong in a committed file. It is now in the repository's history and must be rotated.`
        : `${names} is a secret and does not belong in a project file. If this file was ever committed, the value is in the history and must be rotated.`;
    fail(
      `${where} Remove it and keep it in your own git config with \`worktree config <key>\`.`,
    );
  }
  return settings;
}

// ---------------------------------------------------------------------------
// Approval of the file's postCreate steps (D16, D22)
// ---------------------------------------------------------------------------

/**
 * Where a person's approval is kept: their local git config, under the
 * `northguild.worktree.` namespace, and deliberately not in `CONFIG_NAMES`
 * (D22). `--list` never shows it and `worktree config <key> <value>` cannot set
 * it, so nothing that can only type a key name can approve its own steps.
 */
export const POST_CREATE_APPROVAL_KEY =
  "northguild.worktree.postCreateApproval";

/** SHA-256 over the UTF-8 bytes of the JSON array of the trimmed steps (D16). */
export function postCreateApprovalHash(steps: readonly string[]) {
  return createHash("sha256")
    .update(JSON.stringify(steps.map((step) => step.trim())), "utf8")
    .digest("hex");
}

/** The file's steps, trimmed; none when there is no file or it has no steps. */
export async function getProjectPostCreateSteps() {
  const project = await loadProjectConfig();
  return project.status === "loaded"
    ? (project.config.postCreate ?? []).map((step) => step.trim())
    : [];
}

async function readApproval() {
  try {
    return (
      await run("git", ["config", "--local", POST_CREATE_APPROVAL_KEY])
    ).trim();
  } catch {
    return "";
  }
}

async function storeApproval(steps: readonly string[]) {
  await run("git", [
    "config",
    "--local",
    POST_CREATE_APPROVAL_KEY,
    postCreateApprovalHash(steps),
  ]);
}

/** A person said no to running the file's steps: exit 1, nothing created. */
export class PostCreateDeclinedError extends Error {
  /** Read by `BaseCommand.catch` for the exit code. */
  readonly oclif = { exit: 1 };

  constructor() {
    super(
      "The project's postCreate steps were not approved, so nothing was created. Pass --no-install to skip them.",
    );
    this.name = "PostCreateDeclinedError";
  }
}

// The hash is never part of a message: a script that could read it from an
// error could store it and approve the steps without a person (D16).
function approvalRequired() {
  return new MissingValueError(
    "approval of this project's postCreate steps from .worktree.yml",
    "`--no-install` to skip them, or approve them once in a terminal with `worktree config --approve`",
  );
}

function showSteps(steps: readonly string[]) {
  console.error("This project's .worktree.yml runs these steps, in order:");
  steps.forEach((step, index) => {
    console.error(`  ${index + 1}. ${step}`);
  });
}

async function askToApprove(steps: readonly string[]) {
  showSteps(steps);
  const approved = await askConfirm(
    { message: "Run these steps in new worktrees on this machine?" },
    approvalRequired(),
  );
  if (approved) {
    await storeApproval(steps);
  }
  return approved;
}

/**
 * The check `branch` makes before anything is created (D16). Nothing to do for
 * `--no-install`, a personal `postCreate` (the person set it; D2), a file with
 * no steps, or steps whose hash this person already approved. Otherwise an
 * interactive run lists every step and asks, and a non-interactive one fails
 * closed with a missing value.
 */
export async function ensurePostCreateApproved(options: { install?: boolean }) {
  if (options.install === false) {
    return;
  }
  if (await gitGetConfigValue("postCreate")) {
    return;
  }
  const steps = await getProjectPostCreateSteps();
  if (steps.length === 0) {
    return;
  }
  if ((await readApproval()) === postCreateApprovalHash(steps)) {
    return;
  }
  if (isNonInteractive()) {
    throw approvalRequired();
  }
  if (!(await askToApprove(steps))) {
    throw new PostCreateDeclinedError();
  }
}

/**
 * `worktree config --approve`: shows the current steps and asks. A refusal to
 * run unattended, since an approval nobody saw is no approval.
 */
export async function approvePostCreate() {
  if (isNonInteractive()) {
    throw approvalRequired();
  }
  const steps = await getProjectPostCreateSteps();
  if (steps.length === 0) {
    console.error("This project's .worktree.yml has no postCreate steps.");
    return false;
  }
  return askToApprove(steps);
}
