import { commandExists } from "./cli.js";
import { OPENER_KINDS } from "./constants.js";
import { gitGetLocalBranches, gitGetRemoteBranches } from "./git.js";
import { conjoin } from "./utils.js";

export function isValidEmail(value: string): true | string {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || "Invalid email address";
}

export async function isValidCommand(value: string): Promise<true | string> {
  if (!(await commandExists(value))) {
    return `Command not found: ${value}`;
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
    case "herdr.focus":
      return isValidBoolean(value);
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
