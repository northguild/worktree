import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { commandExists, run } from "./cli.js";

// src/test-setup.ts mocks ./lib/cli.js for every suite so command tests never
// execute anything. This file covers the real helper, so it opts back out.
vi.unmock("./cli.js");

// The node binary running this suite: always present, on every platform CI and
// contributors use, and reachable without a shell — which is the point here.
const node = process.execPath;

// Print argv[1], which under `node -e <script>` is the first trailing argument.
const printFirstArg = "process.stdout.write(process.argv[1])";
const printCwd = "process.stdout.write(process.cwd())";

let tempPath: string;
let spacedPath: string;
let originalPath: string | undefined;

beforeAll(() => {
  // realpath because macOS resolves the temp dir through a symlink, and the
  // child reports the resolved path.
  tempPath = realpathSync(mkdtempSync(join(tmpdir(), "worktree-cli-")));
  spacedPath = join(tempPath, "space demo");
  mkdirSync(spacedPath);

  // commandExists searches PATH. Put this node binary's own directory on it so
  // the lookup has a guaranteed hit however the suite was launched.
  originalPath = process.env.PATH;
  process.env.PATH = [dirname(node), originalPath]
    .filter(Boolean)
    .join(delimiter);
});

afterAll(() => {
  // Assigning undefined would leave the literal string "undefined" on PATH, so
  // an unset PATH has to be restored by deleting the key.
  if (originalPath === undefined) {
    delete process.env.PATH;
  } else {
    process.env.PATH = originalPath;
  }
  // Guarded because a throwing mkdtempSync above would leave tempPath unset, and
  // rmSync(undefined) would then report itself instead of the real failure.
  if (tempPath) {
    rmSync(tempPath, { recursive: true, force: true });
  }
});

describe("run", () => {
  it("resolves stdout with surrounding whitespace trimmed", async () => {
    await expect(
      run(node, ["-e", "process.stdout.write('  hello  \\n')"]),
    ).resolves.toBe("hello");
  });

  it("resolves an empty string when the command writes no stdout", async () => {
    await expect(run(node, ["-e", ""])).resolves.toBe("");
  });

  it("leaves stderr out of the resolved value", async () => {
    await expect(
      run(node, [
        "-e",
        "process.stderr.write('warning'); process.stdout.write('out')",
      ]),
    ).resolves.toBe("out");
  });

  it("rejects on a non-zero exit, preserving the exit code", async () => {
    const failing = run(node, ["-e", "process.exit(3)"]);

    await expect(failing).rejects.toBeInstanceOf(Error);
    // The rejection is execFile's own error, not a wrapper, so the child's exit
    // code survives. The message is not identical to the shell form's at every
    // call site — plan R7 measures where it changed, and where `code` goes from
    // a number to "ENOENT" — but the reject-with-an-Error shape is the same.
    await expect(failing).rejects.toMatchObject({ code: 3 });
  });

  it("rejects when the file does not exist", async () => {
    await expect(run("worktree-no-such-binary")).rejects.toThrow();
  });

  it("runs the command in the directory given as cwd", async () => {
    await expect(run(node, ["-e", printCwd], { cwd: tempPath })).resolves.toBe(
      tempPath,
    );
  });

  it("runs in a cwd whose path contains a space", async () => {
    // The failure this whole change exists to fix: the `cd ${path} && …` string
    // this helper replaced split on that space once a shell parsed it.
    await expect(
      run(node, ["-e", printCwd], { cwd: spacedPath }),
    ).resolves.toBe(spacedPath);
  });

  it("passes an argument containing a space as a single argument", async () => {
    await expect(run(node, ["-e", printFirstArg, "two words"])).resolves.toBe(
      "two words",
    );
  });

  it("does not interpret an argument as shell syntax", async () => {
    const sentinel = join(tempPath, "pwned");
    const hostile = `x"; touch ${sentinel}; \`whoami\` $(id) #`;

    await expect(run(node, ["-e", printFirstArg, hostile])).resolves.toBe(
      hostile,
    );
    expect(existsSync(sentinel)).toBe(false);
  });
});

describe("commandExists", () => {
  // basename because process.execPath is absolute, and the point of these cases
  // is to exercise a real PATH lookup rather than hand it a path to stat.
  const nodeName = basename(node);

  it("resolves true for a command on PATH", async () => {
    await expect(commandExists(nodeName)).resolves.toBe(true);
  });

  it("resolves false for a command that is not on PATH", async () => {
    await expect(commandExists("worktree-no-such-binary")).resolves.toBe(false);
  });

  // Only the head of the command line is looked up; the arguments after it are
  // not part of the check, and never reach the lookup as argv either.
  it("checks only the first word of a command line", async () => {
    await expect(commandExists(`${nodeName} --no-warnings`)).resolves.toBe(
      true,
    );
  });
});
