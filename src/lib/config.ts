import { run } from "./cli.js";
import { SECRET_CONFIG_NAMES } from "./constants.js";
import type { ConfigName } from "./types.js";

// This file is imported by git.ts, and user-config.ts and project-config.ts
// both reach git.ts, so it may only import them dynamically (#281 D9): a
// static import would close a loop. gitGetConfigValue stays git-only.

/** Where an answer came from; `default` means the caller's built-in applies. */
export type ConfigValueSource = "git-config" | "project" | "user" | "default";

export async function gitGetConfigValue(name: ConfigName) {
  try {
    return await run("git", ["config", `northguild.worktree.${name}`]);
  } catch {
    return "";
  }
}

// The value is an argv element, so a config value carrying quotes, backticks or
// semicolons is stored literally instead of being parsed as shell syntax.
export async function gitSetConfigValue(name: ConfigName, value: string) {
  await run("git", ["config", `northguild.worktree.${name}`, value]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * A scalar setting of a parsed config file by its dotted `ConfigName`, as the
 * text git config would hold. Lists (`postCreate`) have their own readers, so
 * they answer `undefined` here.
 */
export function fileSettingValue(
  settings: Record<string, unknown>,
  name: string,
) {
  let current: unknown = settings;
  for (const segment of name.split(".")) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return typeof current === "string" ||
    typeof current === "number" ||
    typeof current === "boolean"
    ? String(current)
    : undefined;
}

const SECRETS: readonly string[] = SECRET_CONFIG_NAMES;

/**
 * A key by #281 D2/D9, with where it came from. A secret reads git config only.
 * A team key reads git config, the project file, then the user file. Any other
 * (personal) key reads git config, then the user file. `default` (value `""`)
 * means the caller's built-in applies. The files are read only when the layers
 * above them have no answer, and a file that cannot be used throws its error
 * rather than being passed over.
 */
export async function getConfigValue(name: ConfigName): Promise<{
  value: string;
  source: ConfigValueSource;
}> {
  if (SECRETS.includes(name)) {
    const secret = await gitGetConfigValue(name);
    return secret
      ? { value: secret, source: "git-config" }
      : { value: "", source: "default" };
  }

  const { isTeamConfigKey, resolveTeamConfig } = await import(
    "./project-config.js"
  );
  if (isTeamConfigKey(name)) {
    return resolveTeamConfig(name);
  }

  const personal = await gitGetConfigValue(name);
  if (personal) {
    return { value: personal, source: "git-config" };
  }
  const { loadUserConfig } = await import("./user-config.js");
  const user = await loadUserConfig();
  const fromUser =
    user.status === "loaded" ? fileSettingValue(user.config, name) : undefined;
  return fromUser
    ? { value: fromUser, source: "user" }
    : { value: "", source: "default" };
}
