// The one module that imports ora. Everything that draws a spinner goes
// through `createSpinner`, so the E2 fix below cannot be missed at a call site.
import ora, { type Ora } from "ora";
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

/**
 * `warn`, `fail` and the rest of the settling methods print their text to
 * stderr through ora's `stopAndPersist`, disabled spinner or not, and so are a
 * route to the terminal that `BaseCommand.warn` never sees. Redacting at that
 * one method covers every call site at once, the same way `createSpinner`
 * covers the E2 fix — a message that echoes what it was given (a remote URL
 * with credentials) is masked before it is printed (#76).
 */
function redactPersistedText(spinner: Ora) {
  // Optional only because the suites replace ora with objects that lack it;
  // the real one always has it.
  const original = spinner.stopAndPersist?.bind(spinner);

  if (original) {
    spinner.stopAndPersist = (options = {}) =>
      original({
        ...options,
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

  redactPersistedText(spinner);

  return spinner;
}
