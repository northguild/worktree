/**
 * Everything that can make a run non-interactive, as plain data, so the rule
 * is testable without a terminal. See the headless agent mode plan, D1.
 */
export interface InteractionInputs {
  /** `process.stdin.isTTY`; `undefined` when stdin is not a terminal. */
  stdinIsTTY: boolean | undefined;
  /** The environment, for `CI`. */
  env: Record<string, string | undefined>;
  /** `--non-interactive`. */
  nonInteractiveFlag?: boolean;
  /** `--yes` / `-y`. */
  yesFlag?: boolean;
  /** `--json`. inquirer writes to stdout, so a JSON run cannot prompt. */
  json?: boolean;
}

/**
 * `CI` is set and is not `""`, `0` or `false` — what most CI providers do and
 * what people reach for to switch it off. Compared case-insensitively.
 */
function isCiSet(value: string | undefined) {
  if (value === undefined) {
    return false;
  }

  return !["", "0", "false"].includes(value.trim().toLowerCase());
}

/**
 * D1: non-interactive when stdin is not a TTY, `CI` is on, `--non-interactive`
 * or `--yes` was given, or the run is `--json`. Keyed on stdin and never on
 * stdout: a human piping the output still answers prompts at the terminal.
 */
export function resolveNonInteractive(inputs: InteractionInputs) {
  return (
    !inputs.stdinIsTTY ||
    isCiSet(inputs.env.CI) ||
    inputs.nonInteractiveFlag === true ||
    inputs.yesFlag === true ||
    inputs.json === true
  );
}

/** The inputs the process itself supplies; flags are added by the caller. */
export function readProcessInteractionInputs(): InteractionInputs {
  return { stdinIsTTY: process.stdin.isTTY, env: process.env };
}

// The mode is resolved once per run by BaseCommand.init() and read by the lib
// seams (progress) that have no command to ask. Module state is deliberate:
// the alternative is threading a parameter through every git helper that draws
// a spinner. `undefined` means "not resolved yet".
let resolvedNonInteractive: boolean | undefined;

/** Records the run's mode. Called by `BaseCommand.init()` and by tests. */
export function setNonInteractive(value: boolean | undefined) {
  resolvedNonInteractive = value;
}

/**
 * Whether this run must never prompt or animate. Before `init()` has resolved
 * it, answers from the process alone, so a seam reached early still fails safe.
 */
export function isNonInteractive() {
  return (
    resolvedNonInteractive ??
    resolveNonInteractive(readProcessInteractionInputs())
  );
}
