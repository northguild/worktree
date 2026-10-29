import { commandExists } from "./cli.js";
import { OPENER_KINDS } from "./constants.js";
import { gitGetLocalBranches, gitGetRemoteBranches } from "./git.js";
import { InvalidValueError } from "./prompt.js";
import { conjoin, splitCommandValue } from "./utils.js";

export function isValidEmail(value: string): true | string {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || "Invalid email address";
}

export async function isValidCommand(value: string): Promise<true | string> {
  // The head alone is the program, split the same way the value is later
  // executed (base-command.ts), so a quoted path containing a space is looked
  // up as one name rather than truncated at the first space.
  const [command] = splitCommandValue(value);

  if (!command) {
    return "Command cannot be empty";
  }

  if (!(await commandExists(command))) {
    return `Command not found: ${value}`;
  }
  return true;
}

// A command line, not a bare program name: the head is the program to launch and
// the tail is leading arguments, with quotes grouping. Split the same way the
// value is later executed (base-command.ts), so validation and execution agree.
// The error names the head rather than quoting the whole line back — with
// "claude --bg" the program is what was not found, and "Command not found:
// claude --bg" points the reader at the flag instead. See AGENT-MODE-PLAN §3 D1.
export async function isValidCommandLine(
  value: string,
): Promise<true | string> {
  const [command] = splitCommandValue(value);

  if (!command) {
    return "Command cannot be empty";
  }

  if (!(await commandExists(command))) {
    return `Command not found: ${command}`;
  }

  return true;
}

export async function isValidBranch(value: string): Promise<true | string> {
  const branches = value.startsWith("origin/")
    ? await gitGetRemoteBranches()
    : await gitGetLocalBranches();
  return branches.includes(value) || `Branch not found: ${value}`;
}

export function isValidBranchName(value: string): true | string {
  if (!value || value.trim() === "") {
    return "Branch name cannot be empty";
  }

  // Git branch naming rules
  const invalidPatterns = [
    { regex: /^\./, message: "Branch name cannot start with a dot" },
    { regex: /\.\.$/, message: "Branch name cannot end with double dots" },
    { regex: /\.\./, message: "Branch name cannot contain double dots" },
    { regex: /\s/, message: "Branch name cannot contain spaces" },
    {
      regex: /[~^:\\*?[\]@{]/,
      message: "Branch name contains invalid characters",
    },
    { regex: /\.$/, message: "Branch name cannot end with a dot" },
    { regex: /\/$/, message: "Branch name cannot end with a slash" },
    {
      regex: /\/\//,
      message: "Branch name cannot contain consecutive slashes",
    },
    { regex: /^\//, message: "Branch name cannot start with a slash" },
    { regex: /\.$/, message: "Branch name cannot end with a dot" },
    { regex: /\.lock$/, message: "Branch name cannot end with '.lock'" },
  ];

  for (const { regex, message } of invalidPatterns) {
    if (regex.test(value)) {
      return message;
    }
  }

  return true;
}

export function isValidOpener(value: string): true | string {
  return (
    OPENER_KINDS.some((kind) => kind === value) ||
    `Opener must be ${conjoin(OPENER_KINDS, "or")}`
  );
}

export function isValidBoolean(value: string): true | string {
  return value === "true" || value === "false" || "Value must be true or false";
}

/**
 * Shape only — never a list of accepted kinds (D10). The kinds live in Herdr's
 * own help text and behind `server.agent_manifests`, not in the socket schema
 * (`AgentStartParams.kind` is `{"type":"string"}`), so a copy here would rot on
 * the next Herdr release. Herdr rejects an unknown kind and the seam surfaces
 * what it said.
 */
export function isValidAgentKind(value: string): true | string {
  return (
    /^[a-z][a-z0-9-]*$/.test(value) ||
    "Agent kind must be lowercase letters, digits and dashes, for example claude"
  );
}

// A token or API key that is only whitespace authenticates nothing. The wizard
// already keeps the stored token on such an answer; a direct `worktree config
// <key> <value>` is refused instead, rather than storing it.
export function isValidToken(value: string): true | string {
  return value.trim() !== "" || "Token cannot be empty";
}

// ClickUp workspace (team) ids are numeric, and the value goes into a query
// string, so anything else is refused here.
export function isValidWorkspaceId(value: string): true | string {
  return /^\d+$/.test(value.trim()) || "Workspace id must be digits only";
}

// `owner/repo`, and nothing else, because the value goes into a
// `/repos/${owner}/${name}/...` request path. Rules, from GitHub's docs:
// - repository: "must not exceed 100 characters, and can only contain ASCII
//   letters, digits, and the characters ., -, and _"
//   https://docs.github.com/en/repositories/creating-and-managing-repositories/creating-a-new-repository
// - owner: "can only contain alphanumeric characters and dashes", "can't start
//   or end with a dash" nor hold "two consecutive dashes"; a managed user's
//   ends in "an underscore and your enterprise's shortcode" (`mona-cat_octo`),
//   and "including underscore and short code, must not exceed 39 characters"
//   https://docs.github.com/en/enterprise-cloud@latest/admin/managing-iam/iam-configuration-reference/username-considerations-for-external-authentication
// `.` and `..` are path segments and a `.git` suffix is how a clone URL ends,
// so none of them is a repository name.
const OWNER = "[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*(?:_[A-Za-z0-9]+)?";
const REPOSITORY_NAME = "[A-Za-z0-9._-]+";
const GITHUB_OWNER = new RegExp(`^${OWNER}$`);
const GITHUB_REPOSITORY_NAME = new RegExp(`^${REPOSITORY_NAME}$`);

/**
 * The characters alone, for the published JSON Schema, which cannot hold the
 * length limits or the `.`, `..` and `.git` names; isValidGitHubRepository has
 * those too.
 */
export const GITHUB_REPOSITORY_PATTERN = new RegExp(
  `^${OWNER}/${REPOSITORY_NAME}$`,
);

export function isValidGitHubRepository(value: string): true | string {
  const shape = "Repository must be owner/repo, for example acme/widgets";
  const parts = value.split("/");
  if (parts.length !== 2) {
    return shape;
  }
  const [owner, name] = parts;
  if (owner.length > 39 || !GITHUB_OWNER.test(owner)) {
    return `${shape} (the owner is letters, digits and single hyphens, optionally ending in _ and a shortcode, up to 39 characters)`;
  }
  if (
    name.length > 100 ||
    !GITHUB_REPOSITORY_NAME.test(name) ||
    name === "." ||
    name === ".." ||
    /\.git$/i.test(name)
  ) {
    return `${shape} (the name is letters, digits, ., - and _, up to 100 characters, not ending in .git)`;
  }
  return true;
}

export async function isValidConfigValue(
  configName: string,
  value: string,
): Promise<true | string> {
  switch (configName) {
    case "jira.email":
      return isValidEmail(value);
    case "defaultSourceBranch":
      return isValidBranch(value);
    case "codeEditor":
      return await isValidCommand(value);
    case "opener":
      return isValidOpener(value);
    case "github.autoAssign":
    case "jira.autoAssign":
    case "linear.autoStart":
      return isValidBoolean(value);
    case "herdr.focus":
      return isValidBoolean(value);
    case "herdr.agent":
      return isValidAgentKind(value);
    case "github.token":
    case "jira.apiToken":
    case "linear.apiKey":
    case "clickup.apiToken":
      return isValidToken(value);
    case "clickup.workspaceId":
      return isValidWorkspaceId(value);
    case "github.repository":
      return isValidGitHubRepository(value);
    case "agent.command":
    // Executed in every new worktree, so it is held to the same check as the
    // other command line: its head has to be a program that exists.
    case "postCreate":
      return await isValidCommandLine(value);
    default:
      return true;
  }
}

/**
 * A value `worktree config <name> <value>` refuses. The same refusal the
 * prompt's fallback gets, so the same exit 2 and `invalid_value`.
 */
export class InvalidConfigValueError extends InvalidValueError {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigValueError";
  }
}

export async function validateConfigValue(
  configName: string,
  value: string,
): Promise<void> {
  const validationResult = await isValidConfigValue(configName, value);
  if (validationResult !== true) {
    throw new InvalidConfigValueError(validationResult);
  }
}
