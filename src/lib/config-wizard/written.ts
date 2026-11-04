import { gitGetConfigValue, gitSetConfigValue } from "../config.js";
import type { ConfigName } from "../types.js";

// What the current run stored: each key's value before its first write in the
// run, and the value after its latest one. A key is "written" only if the two
// differ, so a question answered with what was already stored is not reported.
type Change = { readonly before: string; after: string };
let changes: Map<ConfigName, Change> | undefined;

/**
 * The wizard's one way to store an answer: `gitSetConfigValue`, remembering
 * what the run changed so the closing summary can name it.
 */
export async function saveConfigValue(name: ConfigName, value: string) {
  const change = changes?.get(name);
  if (changes && !change) {
    changes.set(name, { before: await gitGetConfigValue(name), after: value });
  } else if (change) {
    change.after = value;
  }
  await gitSetConfigValue(name, value);
}

/**
 * Runs `work` and returns the keys whose stored value ended up different, in
 * the order they were first written. Names only: no value leaves this module.
 * If `work` throws, `onThrow` sees the keys written so far, and the error, before it
 * goes on.
 */
export async function recordWrittenKeys(
  work: () => Promise<void>,
  onThrow?: (written: ConfigName[], error: unknown) => void,
): Promise<ConfigName[]> {
  const previous = changes;
  const current = new Map<ConfigName, Change>();
  changes = current;
  const writtenKeys = () =>
    [...current]
      .filter(([, change]) => change.before !== change.after)
      .map(([name]) => name);
  try {
    await work();
  } catch (error) {
    onThrow?.(writtenKeys(), error);
    throw error;
  } finally {
    changes = previous;
  }
  return writtenKeys();
}
