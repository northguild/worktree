import fs from "node:fs";
import path from "node:path";
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

export async function copyEnvFilesFromRootPath(
  destinationWorktreePath: string,
) {
  const gitRootPath = await gitGetRootPath();
  const envFiles = await gitListIgnoredEnvFiles(gitRootPath);

  for (const envFile of envFiles) {
    const sourceFile = path.join(gitRootPath, envFile);
    const destinationFile = path.join(destinationWorktreePath, envFile);
    const spinner = ora(`Copying ${sourceFile} to worktree`).start();
    // A directory holding nothing but ignored files is absent from a fresh
    // worktree, so the parent is created before the copy rather than letting
    // copyFileSync throw ENOENT into a tree that already exists.
    fs.mkdirSync(path.dirname(destinationFile), { recursive: true });
    fs.copyFileSync(sourceFile, destinationFile);
    spinner.succeed();
  }
}
