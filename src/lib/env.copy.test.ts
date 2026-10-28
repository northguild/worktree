import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { copyEnvFilesFromRootPath } from "./env.js";

// The selection is git's, so these cases run it for real in a temporary
// repository instead of asserting on a mocked `ls-files`. The suite-wide mock of
// ./cli.js (test-setup.ts) is replaced with the real module for this file only.
vi.mock("./cli.js", async (importOriginal) => await importOriginal());

const gitRoot = vi.hoisted(() => ({ value: "" }));
vi.mock("./git.js", () => ({
  gitGetRootPath: () => Promise.resolve(gitRoot.value),
}));

vi.mock("ora", () => ({
  default: vi.fn().mockReturnValue({
    start: vi.fn().mockReturnValue({ fail: vi.fn(), stop: vi.fn() }),
  }),
}));

let repo: string;
let destination: string;

function git(...args: string[]) {
  execFileSync("git", args, { cwd: repo, stdio: "pipe" });
}

function write(root: string, file: string, content = "secret") {
  const full = path.join(root, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

beforeEach(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wt-copy-")));
  destination = fs.mkdtempSync(path.join(os.tmpdir(), "wt-copy-dest-"));
  gitRoot.value = repo;
  // The machine's global and system git config (signing, a global excludes
  // file) must not leak into the selection under test.
  vi.stubEnv("GIT_CONFIG_GLOBAL", os.devNull);
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  // With core.excludesFile unset git reads $XDG_CONFIG_HOME/git/ignore, then
  // $HOME/.config/git/ignore; neither stub above disables that fallback.
  git("config", "core.excludesFile", os.devNull);
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(repo, { recursive: true, force: true });
  fs.rmSync(destination, { recursive: true, force: true });
});

// The #181 example file lists `config/master.key`; the Phase 6 Done-when says
// it is copied when listed and gitignored, and not otherwise.
describe("copyEnvFilesFromRootPath — copy patterns, against a real repository", () => {
  it("copies a gitignored config/master.key when it is listed, and reports it", async () => {
    write(repo, ".gitignore", "config/master.key\n");
    write(repo, "config/master.key", "abc123");

    const copied = await copyEnvFilesFromRootPath(destination, {
      copy: ["config/master.key"],
    });

    expect(copied).toEqual(["config/master.key"]);
    expect(
      fs.readFileSync(path.join(destination, "config/master.key"), "utf8"),
    ).toBe("abc123");
  });

  it("does not copy that file when no pattern lists it", async () => {
    write(repo, ".gitignore", "config/master.key\n");
    write(repo, "config/master.key");

    expect(await copyEnvFilesFromRootPath(destination)).toEqual([]);
    expect(fs.existsSync(path.join(destination, "config"))).toBe(false);
  });

  it("does not copy a tracked file that matches a pattern", async () => {
    write(repo, "config/master.key");
    git("add", "config/master.key");
    git("commit", "-q", "-m", "track it");

    expect(
      await copyEnvFilesFromRootPath(destination, {
        copy: ["config/master.key"],
      }),
    ).toEqual([]);
    expect(fs.existsSync(path.join(destination, "config/master.key"))).toBe(
      false,
    );
  });

  it("does not copy an untracked file that is not gitignored", async () => {
    write(repo, "config/master.key");

    expect(
      await copyEnvFilesFromRootPath(destination, {
        copy: ["config/master.key"],
      }),
    ).toEqual([]);
  });

  it("matches a glob, nested, alongside the env files", async () => {
    write(repo, ".gitignore", "*.pem\n.env\n");
    write(repo, "certs/dev/a.pem");
    write(repo, "certs/b.pem");
    write(repo, ".env");

    const copied = await copyEnvFilesFromRootPath(destination, {
      copy: ["certs/**/*.pem"],
    });

    expect(copied.sort()).toEqual([".env", "certs/b.pem", "certs/dev/a.pem"]);
  });

  it("keeps the node_modules exclusion for a pattern that would match inside it", async () => {
    write(repo, ".gitignore", "node_modules/\n*.key\n");
    write(repo, "node_modules/dep/x.key");
    write(repo, "config/master.key");

    const copied = await copyEnvFilesFromRootPath(destination, {
      copy: ["**/*.key"],
    });

    expect(copied).toEqual(["config/master.key"]);
  });
});
