import fs from "node:fs";
import { expectCommands, mockRun } from "../test-setup.js";
import { copyEnvFilesFromRootPath } from "./env.js";

// copyEnvFilesFromRootPath draws one spinner, over the lookup only. Mock it so
// the suite neither writes to the terminal nor depends on a TTY.
const spinnerMocks = vi.hoisted(() => {
  const fail = vi.fn();
  const stop = vi.fn();
  const start = vi.fn().mockReturnValue({ fail, stop });
  const oraFactory = vi.fn().mockReturnValue({ start });

  return { fail, stop, start, oraFactory };
});

vi.mock("ora", () => ({
  default: spinnerMocks.oraFactory,
}));

const rootPath = "/repo";
const worktreePath = "/repo.worktrees/feature/test";

// The argv the selection is expected to assemble, asserted in full by the first
// test and reused by the rest to declare the call to the global run() mock.
const selectionArgv = [
  "ls-files",
  "--others",
  "--ignored",
  "--exclude-standard",
  "-z",
  "--",
  ":(glob)**/.env*",
  ":(glob)**/.dev.vars*",
  ":(glob)**/.envrc",
  ":(glob,exclude)**/node_modules/**",
];

// git -z separates paths with NUL and terminates the last one, so the stdout a
// real run() returns ends in a separator rather than sitting flush.
function nulTerminated(...paths: string[]) {
  return paths.map((filePath) => `${filePath}\0`).join("");
}

// gitGetRootPath's first call, then the selection.
function mockGitResponses(listing: string) {
  mockRun.mockResolvedValueOnce(rootPath).mockResolvedValueOnce(listing);
}

let copyFileSync: ReturnType<typeof vi.spyOn>;
let mkdirSync: ReturnType<typeof vi.spyOn>;
let log: ReturnType<typeof vi.spyOn>;

// The printed list is the feature here, so it is captured rather than silenced:
// vitest.config.ts pins FORCE_COLOR=0, which is what makes these assertions
// match in an interactive shell as well as in CI.
function loggedLines(): string[] {
  return log.mock.calls.map((call: unknown[]) => String(call[0]));
}

beforeEach(() => {
  copyFileSync = vi.spyOn(fs, "copyFileSync").mockImplementation(() => {});
  mkdirSync = vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  expectCommands(
    "git rev-parse --show-toplevel",
    `git ${selectionArgv.join(" ")} (cwd: ${rootPath})`,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("copyEnvFilesFromRootPath", () => {
  it("asks git for every env-shaped path it is not carrying, node_modules excluded", async () => {
    mockGitResponses("");

    await copyEnvFilesFromRootPath(worktreePath);

    expect(mockRun).toHaveBeenNthCalledWith(2, "git", selectionArgv, {
      cwd: rootPath,
      trim: false,
    });
    expect(copyFileSync).not.toHaveBeenCalled();
  });

  it("copies the framework variants and tool files the two old names missed", async () => {
    mockGitResponses(
      nulTerminated(
        ".env",
        ".env.local",
        ".env.development",
        ".env.production.local",
        ".envrc",
        "docs/.env.local",
        "docs/worker/.dev.vars",
      ),
    );

    await copyEnvFilesFromRootPath(worktreePath);

    expect(copyFileSync.mock.calls).toEqual([
      ["/repo/.env", `${worktreePath}/.env`],
      ["/repo/.env.local", `${worktreePath}/.env.local`],
      ["/repo/.env.development", `${worktreePath}/.env.development`],
      ["/repo/.env.production.local", `${worktreePath}/.env.production.local`],
      ["/repo/.envrc", `${worktreePath}/.envrc`],
      ["/repo/docs/.env.local", `${worktreePath}/docs/.env.local`],
      ["/repo/docs/worker/.dev.vars", `${worktreePath}/docs/worker/.dev.vars`],
    ]);
  });

  it("creates the destination directory first, so a wholly ignored directory does not throw ENOENT", async () => {
    mockGitResponses(nulTerminated("tmp/local/.env"));

    await copyEnvFilesFromRootPath(worktreePath);

    expect(mkdirSync).toHaveBeenCalledWith(`${worktreePath}/tmp/local`, {
      recursive: true,
    });
    expect(mkdirSync.mock.invocationCallOrder[0]).toBeLessThan(
      copyFileSync.mock.invocationCallOrder[0],
    );
  });

  // git sorts bytewise, so a path whose first component begins with a space
  // (0x20) comes back ahead of every other. run()'s default trim would strip
  // that space and name a file that does not exist — an ENOENT thrown into a
  // worktree that already exists, which is the failure this change removes.
  it("keeps a leading space on the first path, which sorts first", async () => {
    mockGitResponses(nulTerminated(" lead/.env", ".env"));

    await copyEnvFilesFromRootPath(worktreePath);

    expect(copyFileSync.mock.calls).toEqual([
      ["/repo/ lead/.env", `${worktreePath}/ lead/.env`],
      ["/repo/.env", `${worktreePath}/.env`],
    ]);
  });

  it("copies nothing when git lists nothing, and says so", async () => {
    mockGitResponses("");

    await copyEnvFilesFromRootPath(worktreePath);

    expect(copyFileSync).not.toHaveBeenCalled();
    // Silence here would be indistinguishable from a copy step that never ran.
    expect(loggedLines()).toEqual([`No env files to copy from ${rootPath}`]);
  });

  // The whole point of the listing: a human scanning this output is the only
  // check on an env file nobody knew the repository had.
  it("prints every copied path, relative to the repository root", async () => {
    mockGitResponses(
      nulTerminated(".env", "docs/worker/.dev.vars", "tmp/backup/.env.old"),
    );

    await copyEnvFilesFromRootPath(worktreePath);

    // One array, so the heading is pinned to the front of the listing rather
    // than merely pinned to have happened.
    expect(loggedLines()).toEqual([
      `Copying 3 env files from ${rootPath}:`,
      "  ✔ .env",
      "  ✔ docs/worker/.dev.vars",
      "  ✔ tmp/backup/.env.old",
    ]);
  });

  // A path that misrepresents itself in the listing defeats the listing's whole
  // purpose. Ordinary paths stay bare so the common case reads cleanly.
  it("quotes a path whose rendering would otherwise lie, and leaves the rest bare", async () => {
    mockGitResponses(nulTerminated(" lead/.env", "two\nlines/.env", ".env"));

    await copyEnvFilesFromRootPath(worktreePath);

    expect(loggedLines().slice(1)).toEqual([
      '  ✔ " lead/.env"',
      '  ✔ "two\\nlines/.env"',
      "  ✔ .env",
    ]);
  });

  // The lookup is the one await between start() and the first output; without a
  // fail() here the spinner ticks on while the error surfaces past it.
  it("fails the spinner when the lookup itself throws", async () => {
    const cause = new Error("not a git repository");
    mockRun.mockResolvedValueOnce(rootPath).mockRejectedValueOnce(cause);

    await expect(copyEnvFilesFromRootPath(worktreePath)).rejects.toBe(cause);

    expect(spinnerMocks.fail).toHaveBeenCalledWith(
      "Could not look for env files to copy",
    );
    expect(loggedLines()).toEqual([]);
  });

  it("counts one file in the singular", async () => {
    mockGitResponses(nulTerminated(".env"));

    await copyEnvFilesFromRootPath(worktreePath);

    expect(loggedLines()[0]).toBe(`Copying 1 env file from ${rootPath}:`);
  });

  // The worktree is already on disk when a copy fails, so the message has to
  // name the file, name the tree, and keep the original error as the cause.
  it("names the file and the created worktree when a copy fails", async () => {
    mockGitResponses(nulTerminated("docs/.env.local"));
    const cause = new Error("EACCES: permission denied");
    copyFileSync.mockImplementation(() => {
      throw cause;
    });

    // then(onFulfilled, onRejected) rather than catch(): it narrows to
    // `Error | undefined` instead of a union with the resolved `void`.
    const thrown = await copyEnvFilesFromRootPath(worktreePath).then(
      () => undefined,
      (error: Error) => error,
    );

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown?.message).toBe(
      `Could not copy docs/.env.local into the new worktree at ${worktreePath}. The worktree was created — copy the file across by hand.`,
    );
    expect(thrown?.cause).toBe(cause);
  });

  // A failure part-way through leaves the lines for what did land, so a human
  // can see exactly how far the copy got.
  it("keeps the lines already printed when a later copy fails", async () => {
    mockGitResponses(nulTerminated(".env", "docs/.env.local"));
    copyFileSync
      .mockImplementationOnce(() => {})
      .mockImplementationOnce(() => {
        throw new Error("EACCES: permission denied");
      });

    await expect(copyEnvFilesFromRootPath(worktreePath)).rejects.toThrow();

    expect(loggedLines()).toEqual([
      `Copying 2 env files from ${rootPath}:`,
      "  ✔ .env",
    ]);
  });
});
