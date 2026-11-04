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

/**
 * A non-interactive run took a value the prompt's own validator refuses. A
 * value problem, like its sibling above, so it exits 2 and reports
 * `invalid_value` under `--json`; the message is the validator's.
 */
export class InvalidValueError extends Error {
  /** Read by `BaseCommand.catch` for the exit code. */
  readonly oclif = { exit: 2 };
  /** Read by `BaseCommand.catch` for the `--json` error code. */
  readonly code = "invalid_value";

  constructor(message: string) {
    super(message);
    this.name = "InvalidValueError";
  }
}

/**
 * What an inquirer prompt returns: a promise that also has `cancel()`, which
 * rejects it with `CancelPromptError`. Optional here only so a stand-in
 * without it type-checks; the real prompts always carry it.
 */
type Cancellable<T> = Promise<T> & { cancel?: () => void };

/** Ctrl+C's error, by name: `BaseCommand.catch` ends the run quietly on it. */
class QuitError extends Error {
  constructor() {
    super("User chose to quit at the Esc confirmation");
    this.name = "ExitPromptError";
  }
}

/**
 * A bare Esc. readline reports a lone Esc as `escape` with the sequence
 * `"\u001b"` (after its 500 ms wait for a longer sequence); Alt+Esc is
 * `"\u001b\u001b"`, and arrows, Home/End, function keys and Alt+letter come
 * through under their own names. Checking the sequence keeps Alt+Esc out.
 */
function isBareEscape(key: { name?: string; sequence?: string } | undefined) {
  return key?.name === "escape" && key.sequence === "\u001b";
}

/**
 * Runs one prompt and reports whether Esc cancelled it. The listener goes on
 * stdin after the prompt starts, since inquirer's readline is created
 * synchronously and is what makes stdin emit `keypress`; it comes off when the
 * prompt settles however it does.
 */
async function runUntilEscape<T>(
  start: () => Cancellable<T>,
): Promise<{ escaped: false; value: T } | { escaped: true }> {
  const pending = start();
  let escaped = false;
  const onKeypress = (
    _text: string | undefined,
    key?: { name?: string; sequence?: string },
  ) => {
    if (!escaped && isBareEscape(key)) {
      escaped = true;
      pending.cancel?.();
    }
  };
  process.stdin.on("keypress", onKeypress);
  try {
    return { escaped: false, value: await pending };
  } catch (error) {
    if (escaped) {
      return { escaped: true };
    }
    throw error;
  } finally {
    process.stdin.off("keypress", onKeypress);
  }
}

/**
 * Asks `start()`; Esc cancels it and asks "Quit now?" (default No). Yes ends
 * the run as Ctrl+C does; No, Enter or Esc on that confirm asks the original
 * prompt again from its default. Ctrl+C anywhere is still an instant quit.
 */
async function askUntilAnswered<T>(start: () => Cancellable<T>): Promise<T> {
  for (;;) {
    const result = await runUntilEscape(start);
    if (!result.escaped) {
      return result.value;
    }
    const quit = await runUntilEscape(() =>
      confirm({ message: "Quit now?", default: false }),
    );
    if (!quit.escaped && quit.value) {
      throw new QuitError();
    }
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
    return askUntilAnswered(() => confirm(config));
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
    return askUntilAnswered(() => input(config));
  }
  if (site.fallback === undefined) {
    throw missing(site);
  }
  const verdict = (await config.validate?.(site.fallback)) ?? true;
  if (verdict !== true) {
    if (site.fallback === "") {
      throw missing(site);
    }
    throw new InvalidValueError(
      typeof verdict === "string" ? verdict : `Invalid ${site.value}`,
    );
  }
  return site.fallback;
}

/**
 * A pick from a list. `fallback` is the value a non-interactive run takes;
 * leave it out when no choice is a sensible default, so there is none.
 */
export async function askSelect<Value>(
  config: Parameters<typeof select<Value>>[0],
  site: PromptSite & { fallback?: Value },
) {
  if (!isNonInteractive()) {
    return askUntilAnswered(() => select<Value>(config));
  }
  if (site.fallback === undefined) {
    throw missing(site);
  }
  return site.fallback;
}

/** A multi-pick from a list. No default either. */
export async function askCheckbox<Value>(
  config: Parameters<typeof checkbox<Value>>[0],
  site: PromptSite,
) {
  if (isNonInteractive()) {
    throw missing(site);
  }
  return askUntilAnswered(() => checkbox<Value>(config));
}
