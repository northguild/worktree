// The one module that imports @inquirer/prompts. Every question the CLI asks a
// human goes through here, so a non-interactive run cannot reach inquirer at a
// call site that forgot to check. See the headless agent mode plan, D2.
import { checkbox, confirm, input, Separator, select } from "@inquirer/prompts";
import { isNonInteractive } from "./interaction.js";

export { Separator };

/**
 * Names the value a prompt would have supplied and the flag, argument or config
 * key that supplies it instead. Every call site declares both.
 */
export interface PromptSite {
  /** What is being asked for, e.g. `the branch to remove`. */
  value: string;
  /** What to pass instead, e.g. `<branchName> -f`. */
  flag: string;
}

/**
 * A non-interactive run reached a question that has no default. Exits 2, the
 * code oclif gives a usage error, and `BaseCommand.catch` prints it as the one
 * line `worktree: no default for <value>; pass <flag>`.
 */
export class MissingValueError extends Error {
  /** Read by `BaseCommand.catch` for the exit code. */
  readonly oclif = { exit: 2 };

  constructor(
    readonly value: string,
    readonly flag: string,
  ) {
    super(`no default for ${value}; pass ${flag}`);
    this.name = "MissingValueError";
  }
}

function missing({ value, flag }: PromptSite) {
  return new MissingValueError(value, flag);
}

/**
 * Fails when this run may not prompt, for a caller that has to do something
 * before it would ask and must not do it in a non-interactive run.
 */
export function assertCanPrompt(site: PromptSite) {
  if (isNonInteractive()) {
    throw missing(site);
  }
}

/**
 * A yes/no question. `fallback` is the answer a non-interactive run takes;
 * leave it out when "no" would make the run a no-op, so there is no default.
 */
export async function askConfirm(
  config: Parameters<typeof confirm>[0],
  site: PromptSite & { fallback?: boolean },
) {
  if (!isNonInteractive()) {
    return confirm(config);
  }
  if (site.fallback === undefined) {
    throw missing(site);
  }
  return site.fallback;
}

/**
 * A free-text question. `fallback` is the value a non-interactive run takes,
 * validated as the prompt would have validated it; an empty one the validator
 * rejects counts as no default, and a non-empty one it rejects fails with the
 * validator's own message.
 */
export async function askInput(
  config: Parameters<typeof input>[0],
  site: PromptSite & { fallback?: string },
) {
  if (!isNonInteractive()) {
    return input(config);
  }
  if (site.fallback === undefined) {
    throw missing(site);
  }
  const verdict = (await config.validate?.(site.fallback)) ?? true;
  if (verdict !== true) {
    if (site.fallback === "") {
      throw missing(site);
    }
    throw new Error(
      typeof verdict === "string" ? verdict : `Invalid ${site.value}`,
    );
  }
  return site.fallback;
}

/** A pick from a list. There is no sensible default, so a non-interactive run fails. */
export async function askSelect<Value>(
  config: Parameters<typeof select<Value>>[0],
  site: PromptSite,
) {
  if (isNonInteractive()) {
    throw missing(site);
  }
  return select<Value>(config);
}

/** A multi-pick from a list. No default either. */
export async function askCheckbox<Value>(
  config: Parameters<typeof checkbox<Value>>[0],
  site: PromptSite,
) {
  if (isNonInteractive()) {
    throw missing(site);
  }
  return checkbox<Value>(config);
}
