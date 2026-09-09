import { commandExists } from "./cli.js";
import { OPENER_KINDS } from "./constants.js";
import { gitGetLocalBranches, gitGetRemoteBranches } from "./git.js";
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
      return isValidBoolean(value);
    case "herdr.focus":
      return isValidBoolean(value);
    case "herdr.agent":
      return isValidAgentKind(value);
    case "agent.command":
      return await isValidCommandLine(value);
    default:
      return true;
  }
}

export class InvalidConfigValueError extends Error {}

export async function validateConfigValue(
  configName: string,
  value: string,
): Promise<void> {
  const validationResult = await isValidConfigValue(configName, value);
  if (validationResult !== true) {
    throw new InvalidConfigValueError(validationResult);
  }
}
