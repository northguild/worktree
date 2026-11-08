// The one module that imports ora. Everything that draws a spinner goes
// through `createSpinner`, so the E2 fix below cannot be missed at a call site.
import { stripVTControlCharacters } from "node:util";
import ora, { type Ora } from "ora";
import { isColorDisabled } from "./color.js";
import { isNonInteractive } from "./interaction.js";
import { redactSecrets } from "./redact.js";

/** The part of a stream the decision reads. */
export interface ProgressStream {
  isTTY?: boolean;
  columns?: number;
}

export interface ProgressOptions {
  /** Defaults to the run's resolved mode. */
  nonInteractive?: boolean;
  /**
   * Defaults to `process.stderr`. Given explicitly, it is also handed to ora,
   * which is how tests drive a spinner on a fake terminal.
   */
  stream?: ProgressStream & NodeJS.WritableStream;
}

/**
 * Animated output is on only for a human at a terminal that can say how wide
 * it is. A pseudo-TTY with no window size reports `isTTY` true and `columns`
 * 0; ora divides by `columns ?? 80`, so 0 gives an infinite line count and its
 * `clear()` loop never returns (E2). Falsy `columns` therefore disables it.
 */
export function isProgressEnabled(
  options: Pick<ProgressOptions, "nonInteractive"> & {
    stream?: ProgressStream;
  } = {},
) {
  const stream = options.stream ?? process.stderr;
  const nonInteractive = options.nonInteractive ?? isNonInteractive();

  return !nonInteractive && stream.isTTY === true && Boolean(stream.columns);
}

/** FORCE_COLOR asks for colour unless it is empty, `0` or `false`. */
function isColorForced(env: NodeJS.ProcessEnv = process.env) {
  const force = env.FORCE_COLOR;
  return force !== undefined && !["", "0", "false"].includes(force);
}

/**
 * `warn`, `fail` and the rest of the settling methods print their text to
 * stderr through ora's `stopAndPersist`, disabled spinner or not, and so are a
 * route to the terminal that `BaseCommand.warn` never sees. Redacting at that
 * one method covers every call site at once, the same way `createSpinner`
 * covers the E2 fix — a message that echoes what it was given (a remote URL
 * with credentials) is masked before it is printed (#76). The same wrapper
 * strips colour from the symbol when the stream is not a terminal (#321).
 */
function redactPersistedText(spinner: Ora, stream: ProgressStream) {
  // Optional only because the suites replace ora with objects that lack it;
  // the real one always has it.
  const original = spinner.stopAndPersist?.bind(spinner);

  if (original) {
    spinner.stopAndPersist = (options = {}) =>
      original({
        ...options,
        // ora draws ✔ ✖ ⚠ with log-symbols, which colours from the
        // environment and never from the stream it is written to, so a
        // redirected stderr would otherwise hold escape codes (#321).
        symbol:
          stream.isTTY === true ||
          isColorForced() ||
          options.symbol === undefined
            ? options.symbol
            : stripVTControlCharacters(options.symbol),
        text: redactSecrets(options.text ?? spinner.text),
      });
  }
}

/**
 * ora, with animation turned off where `isProgressEnabled` says so. A disabled
 * ora prints plain `- text` lines to stderr instead.
 *
 * `ora(text)` is called with the bare string unless a stream is injected, and
 * `isEnabled` is set afterwards, so a human TTY run constructs exactly what it
 * always did.
 */
export function createSpinner(text: string, options: ProgressOptions = {}) {
  const spinner: Ora = options.stream
    ? ora({ text, stream: options.stream })
    : ora(text);

  if (!isProgressEnabled(options)) {
    // ora 9 has this setter (index.js:293) but its typings mark the option
    // readonly; progress.test.ts pins the behaviour against the real ora.
    Object.assign(spinner, { isEnabled: false });
  }

  // ora colours the frame with its own chalk, which ignores NO_COLOR (#292);
  // its tick and cross already honour it.
  if (isColorDisabled()) {
    spinner.color = false;
  }

  redactPersistedText(spinner, options.stream ?? process.stderr);

  return spinner;
}
