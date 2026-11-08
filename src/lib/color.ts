// The one module that imports chalk. chalk 5 reads FORCE_COLOR and --no-color
// but not NO_COLOR (https://no-color.org), so every styled string in the CLI
// comes from the instance made here instead of chalk's default one.
import defaultChalk, { Chalk, type ChalkInstance } from "chalk";

/**
 * NO_COLOR set to anything but the empty string turns styling off, unless
 * FORCE_COLOR is also set: an explicit request for colour is the more specific
 * of the two, as it is in the other tools that honour both (Node among them).
 * ora draws its spinner frame with its own chalk, so progress.ts asks this too.
 */
export function isColorDisabled(env: NodeJS.ProcessEnv = process.env) {
  const noColor = env.NO_COLOR !== undefined && env.NO_COLOR !== "";
  return noColor && env.FORCE_COLOR === undefined;
}

export function createChalk(
  env: NodeJS.ProcessEnv = process.env,
): ChalkInstance {
  return isColorDisabled(env) ? new Chalk({ level: 0 }) : defaultChalk;
}

const chalk = createChalk();

export default chalk;
