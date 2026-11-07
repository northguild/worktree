/** A terminal multiplexer the CLI can open worktrees in. */
export type TerminalHost = "herdr" | "rex";

/** What a Rex shell's `REX_SESSION` starts with, e.g. `session:<uuid>`. */
const REX_SESSION_PREFIX = "session:";

/**
 * Which multiplexers the shell this process runs in sits inside, read from the
 * environment alone (#271 D2). Only the presence and shape of a value is
 * checked; no value is returned, so no pane, session or socket path can leak
 * onward.
 *
 * Editors (VS Code and its forks) are deliberately not detected (D4): an
 * editor host and no host at all both give `[]`.
 *
 * The order is fixed, Herdr then Rex (D3). Both multiplexers' variables are
 * inherited by anything started inside them, so the environment cannot say
 * which one is the inner one when both are set. Herdr first is a guess, not a
 * fact about nesting; a fixed `opener` overrides it.
 */
export function detectTerminalHosts(
  env: NodeJS.ProcessEnv = process.env,
): TerminalHost[] {
  const hosts: TerminalHost[] = [];

  if (isSet(env.HERDR_ENV) && isSet(env.HERDR_PANE_ID)) {
    hosts.push("herdr");
  }
  if (env.REX_SESSION?.startsWith(REX_SESSION_PREFIX)) {
    hosts.push("rex");
  }

  return hosts;
}

function isSet(value: string | undefined): boolean {
  return value !== undefined && value !== "";
}
