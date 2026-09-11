import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import ora from "ora";
import { run } from "./cli.js";
import { gitGetRootPath } from "./git.js";

/**
 * Env-shaped filenames, widened past the two this tool used to name. `.env` and
 * `.env.local` miss every framework variant — `.env.development`,
 * `.env.production`, `.env.test`, `.env.staging` and the `.env.*.local`
 * override layer Next.js documents — plus wrangler's `.dev.vars` and direnv's
 * `.envrc`.
 *
 * These are git pathspecs rather than a glob library's patterns because the
 * selection below is made by git. A leading `**` matches zero or more
 * directories, so each one matches at the repository root as well as nested.
 */
const ENV_FILE_PATHSPECS = [
  ":(glob)**/.env*",
  ":(glob)**/.dev.vars*",
  ":(glob)**/.envrc",
];

/**
 * `node_modules` is itself gitignored, so every env file a dependency ships
 * would otherwise qualify below. It is excluded explicitly rather than left to
 * that coincidence: those files are not the user's, and a worktree that has
 * never been installed has no directory to copy them into.
 */
const NODE_MODULES_PATHSPEC = ":(glob,exclude)**/node_modules/**";

/**
 * What git is not carrying into the new worktree, of the shapes above.
 *
 * `--others --ignored --exclude-standard` is the selection: untracked *and*
 * ignored. A committed `.env.local.example` is carried by the checkout already,
 * so it is not listed and not copied twice; a filename nobody thought to name
 * is listed as long as it is env-shaped and gitignored.
 *
 * `-z` because a path may contain a newline, which git would otherwise quote,
 * and `trim: false` because the answer is a NUL-delimited stream rather than a
 * single value: git sorts bytewise, so a path whose first component starts with
 * a space comes back first, and a trim would rename it to one that is not there.
 */
async function gitListIgnoredEnvFiles(gitRootPath: string) {
  const result = await run(
    "git",
    [
      "ls-files",
      "--others",
      "--ignored",
      "--exclude-standard",
      "-z",
      "--",
      ...ENV_FILE_PATHSPECS,
      NODE_MODULES_PATHSPEC,
    ],
    { cwd: gitRootPath, trim: false },
  );

  return result.split("\0").filter(Boolean);
}

/**
 * A path is printed bare when it reads back as itself, and JSON-quoted when it
 * does not. This listing exists so a human can spot a file that should not be
 * there, and a path that misrepresents itself defeats exactly that: a leading
 * space shows only as a misaligned column, and a path containing a newline —
 * which is why the listing above is read with `-z` — would print across two
 * lines and read as two separate files.
 */
function renderPath(envFile: string) {
  const quoted = JSON.stringify(envFile);
  // Two separate tells. JSON escaping catches a newline, a tab or a quote; it
  // does not touch a plain leading or trailing space, which is the likelier
  // case and the one that shows as nothing at all.
  const misleads =
    quoted.slice(1, -1) !== envFile || envFile.trim() !== envFile;
  return misleads ? quoted : envFile;
}

/**
 * Every copied path is printed, one per line, because this list is the only
 * moment a human is shown what their repository is actually handing over.
 * Selection is by name shape and ignore rules, not by a list anyone curated, so
 * it legitimately picks up whatever is lying around — a `.env.backup` someone
 * dumped years ago, a colleague's `.env.production` — and those are exactly the
 * files worth noticing before an agent or an editor opens the new worktree.
 *
 * The paths are relative to the repository root rather than absolute: the
 * interesting part of `docs/worker/.dev.vars` is `docs/worker`, and an absolute
 * prefix repeated down the column is what buries it.
 *
 * The whole report goes to stdout, heading included. The spinner covers only
 * the lookup, and is stopped rather than resolved into the heading, because ora
 * writes to stderr: a heading there and its rows here would split the report in
 * two under any redirection, which is the one situation where someone is
 * reading this list rather than glancing at it.
 */
export async function copyEnvFilesFromRootPath(
  destinationWorktreePath: string,
) {
  const gitRootPath = await gitGetRootPath();
  const spinner = ora("Looking for env files to copy").start();

  let envFiles: string[];
  try {
    envFiles = await gitListIgnoredEnvFiles(gitRootPath);
  } catch (error) {
    // Without this the spinner keeps ticking while the error surfaces past it,
    // and ora's stream hook is never uninstalled.
    spinner.fail("Could not look for env files to copy");
    throw error;
  }
  spinner.stop();

  // Said out loud rather than passed over in silence. A worktree missing the
  // env file someone expected looks identical to one that never needed any, and
  // this line is what separates "none found" from "the copy never ran".
  if (envFiles.length === 0) {
    console.log(`No env files to copy from ${gitRootPath}`);
    return;
  }

  console.log(
    `Copying ${chalk.bold(envFiles.length)} env ${envFiles.length === 1 ? "file" : "files"} from ${gitRootPath}:`,
  );

  for (const envFile of envFiles) {
    const sourceFile = path.join(gitRootPath, envFile);
    const destinationFile = path.join(destinationWorktreePath, envFile);
    try {
      // A directory holding nothing but ignored files is absent from a fresh
      // worktree, so the parent is created before the copy rather than letting
      // copyFileSync throw ENOENT into a tree that already exists.
      fs.mkdirSync(path.dirname(destinationFile), { recursive: true });
      fs.copyFileSync(sourceFile, destinationFile);
    } catch (error) {
      // The worktree is already on disk by the time this runs, so the failure
      // has to say that: the tree is not rolled back, and the remedy is one
      // copy by hand rather than re-running the command.
      throw new Error(
        `Could not copy ${renderPath(envFile)} into the new worktree at ${destinationWorktreePath}. The worktree was created — copy the file across by hand.`,
        { cause: error },
      );
    }
    console.log(`  ${chalk.green("✔")} ${renderPath(envFile)}`);
  }
}
