import fs from "node:fs";
import { expectCommands, mockRun } from "../test-setup.js";
import { copyEnvFilesFromRootPath } from "./env.js";

// copyEnvFilesFromRootPath draws a spinner per file. Mock it so the suite
// neither writes to the terminal nor depends on a TTY.
const spinnerMocks = vi.hoisted(() => {
  const succeed = vi.fn();
  const fail = vi.fn();
  const start = vi.fn().mockReturnValue({ succeed, fail });
  const oraFactory = vi.fn().mockReturnValue({ start });

  return { succeed, fail, start, oraFactory };
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

beforeEach(() => {
  copyFileSync = vi.spyOn(fs, "copyFileSync").mockImplementation(() => {});
  mkdirSync = vi.spyOn(fs, "mkdirSync").mockImplementation(() => undefined);
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

  it("copies nothing when git lists nothing", async () => {
    mockGitResponses("");

    await copyEnvFilesFromRootPath(worktreePath);

    expect(copyFileSync).not.toHaveBeenCalled();
    expect(spinnerMocks.start).not.toHaveBeenCalled();
  });
});
