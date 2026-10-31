import { run } from "./cli.js";
import type { ConfigName } from "./types.js";

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
