import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "./cli.js";

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

beforeAll(() => {
  // realpath because macOS resolves the temp dir through a symlink, and the
  // child reports the resolved path.
  tempPath = realpathSync(mkdtempSync(join(tmpdir(), "worktree-cli-")));
  spacedPath = join(tempPath, "space demo");
  mkdirSync(spacedPath);
});

afterAll(() => {
  rmSync(tempPath, { recursive: true, force: true });
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
    // code survives — same as cmd() rejecting with exec's error today.
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
    // cmd() builds today splits on that space once a shell parses it.
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
