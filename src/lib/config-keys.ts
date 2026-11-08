import { z } from "zod";
import { SECRET_CONFIG_NAMES } from "./constants.js";

// The key classes (#115 D3), shared by the project file's reader and the
// user file's. Kept apart from both so neither imports the other (#281 D9).

// Sections that hold team keys, and which children they may hold.
export const TEAM_SECTIONS: Record<string, readonly string[]> = {
  branchPrefix: ["feature", "bugfix", "chore"],
  jira: ["host", "deployment", "branchType"],
  github: ["repository", "host", "branchType"],
  linear: ["branchType"],
  clickup: ["workspaceId", "branchType"],
};
export const TEAM_SCALARS = new Set([
  "defaultSourceBranch",
  "branchType",
  "branchName",
  "copy",
  "postCreate",
]);
// Per-person keys: ignored in the file, with a warning that names where to set them.
export const PERSONAL_KEYS = new Set([
  "opener",
  "codeEditor",
  "herdr.focus",
  "herdr.agent",
  "rex.focus",
  "agent.command",
  "jira.email",
  "jira.autoAssign",
  "jira.autoStart",
  "github.autoAssign",
  "linear.autoStart",
  "linear.agentAllow",
  "linear.agentContext",
  "clickup.autoAssign",
  "clickup.autoStart",
]);
export const PERSONAL_SECTIONS = new Set(["herdr", "rex", "agent"]);
export const SECRET_KEYS = new Set<string>(SECRET_CONFIG_NAMES);

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

// The approval prompt prints a step as text, so one that redraws the terminal
// (\r, ESC) or reorders it (bidi overrides) would hide what runs (D16).
export const step = z
  .string()
  .refine((value) => value.trim() !== "", {
    message: "a step cannot be empty",
  })
  .refine((value) => !/[\p{Cc}\p{Cf}]/u.test(value), {
    message: "a step cannot hold control or formatting characters",
  });
