import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, dirname, join } from "node:path";
import { commandExists, run, runCapturing, spawnDetached } from "./cli.js";

// src/test-setup.ts mocks ./lib/cli.js for every suite so command tests never
// execute anything. This file covers the real helper, so it opts back out.
vi.unmock("./cli.js");

// The node binary running this suite: always present, on every platform CI and
// contributors use, and reachable without a shell — which is the point here.
const node = process.execPath;

// Print argv[1], which under `node -e <script>` is the first trailing argument.
const printFirstArg = "process.stdout.write(process.argv[1])";
const printCwd = "process.stdout.write(process.cwd())";

// Outlives any timeout below by orders of magnitude, so the kill is what ends
// these children and a slow machine cannot turn one into a pass by finishing
// early. The timer keeps the event loop alive; nothing is printed.
const sleepForever = "setTimeout(() => {}, 600_000)";

let tempPath: string;
let spacedPath: string;
let spacedExecutable: string;
let originalPath: string | undefined;

beforeAll(() => {
  // realpath because macOS resolves the temp dir through a symlink, and the
  // child reports the resolved path.
  tempPath = realpathSync(mkdtempSync(join(tmpdir(), "worktree-cli-")));
  spacedPath = join(tempPath, "space demo");
  mkdirSync(spacedPath);

  // A real executable whose path contains a space, for the lookup that used to
  // be truncated at the first space.
  spacedExecutable = join(spacedPath, "my editor");
  writeFileSync(spacedExecutable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });

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

  // timeout lives on the options both helpers share, so a caller who reads the
  // interface and passes it here has to get a bounded child rather than a
  // silently ignored option.
  it("kills a child that outlives the timeout, and rejects", async () => {
    await expect(
      run(node, ["-e", sleepForever], { timeout: 200 }),
    ).rejects.toMatchObject({ killed: true, signal: "SIGTERM" });
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

  it("leaves the output untouched when trim is false", async () => {
    // A NUL-delimited stream is not a single value: `git ls-files -z` sorts a
    // path whose first component starts with a space ahead of every other, and
    // the default trim would rename it to one that does not exist.
    const stream = `process.stdout.write(' lead/.env\\0.env\\0')`;

    await expect(run(node, ["-e", stream], { trim: false })).resolves.toBe(
      " lead/.env\0.env\0",
    );
  });
});

describe("runCapturing", () => {
  it("resolves stdout and a zero exit code on success", async () => {
    const result = await runCapturing(node, [
      "-e",
      "process.stdout.write('hi')",
    ]);

    expect(result).toEqual({ stdout: "hi", stderr: "", exitCode: 0 });
  });

  it("resolves — not rejects — with stderr and the code on a non-zero exit", async () => {
    const result = await runCapturing(node, [
      "-e",
      "process.stderr.write(JSON.stringify({error:{code:'nope'}})); process.exit(1)",
    ]);

    expect(result).toEqual({
      stdout: "",
      stderr: '{"error":{"code":"nope"}}',
      exitCode: 1,
    });
  });

  it("keeps stdout and stderr apart on a failing run", async () => {
    const result = await runCapturing(node, [
      "-e",
      "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)",
    ]);

    expect(result).toEqual({ stdout: "out", stderr: "err", exitCode: 3 });
  });

  it("does not interpret an argument as shell syntax", async () => {
    const argument = "/tmp/a b/c; echo pwned > /tmp/*";

    const result = await runCapturing(node, ["-e", printFirstArg, argument]);

    expect(result.stdout).toBe(argument);
    expect(result.exitCode).toBe(0);
  });

  it("runs the command in the directory given as cwd", async () => {
    const result = await runCapturing(node, ["-e", printCwd], {
      cwd: spacedPath,
    });

    expect(result.stdout).toBe(spacedPath);
  });

  it("rejects when the file does not exist, having no exit code to report", async () => {
    await expect(
      runCapturing("northguild-worktree-no-such-executable"),
    ).rejects.toThrow();
  });

  // The whole point of bounding the Herdr calls: a child that never answers has
  // to end as a rejection. A kill reports `code: null` rather than a number, so
  // it falls through the resolve branch above — this pins that, because a Node
  // that started reporting some numeric code there would turn a hang into a
  // silently successful-looking result with an empty stdout.
  it("kills a child that outlives the timeout, and rejects rather than resolving", async () => {
    await expect(
      runCapturing(node, ["-e", sleepForever], { timeout: 200 }),
    ).rejects.toMatchObject({ killed: true, signal: "SIGTERM" });
  });

  it("leaves a child that answers within the timeout alone", async () => {
    const result = await runCapturing(
      node,
      ["-e", "process.stdout.write('quick')"],
      { timeout: 10_000 },
    );

    expect(result).toEqual({ stdout: "quick", stderr: "", exitCode: 0 });
  });

  it("does not bound the child when no timeout is given", async () => {
    // 300ms is comfortably longer than the 200ms bound the cases above use, so
    // a default that had quietly become finite would have to be shorter still
    // to let this pass.
    const result = await runCapturing(node, [
      "-e",
      "setTimeout(() => process.stdout.write('slow'), 300)",
    ]);

    expect(result).toEqual({ stdout: "slow", stderr: "", exitCode: 0 });
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
  it("looks the value up verbatim rather than to its first space", async () => {
    // A command line is never passed here — callers split first — so the whole
    // value is the program name, and one containing a space is not truncated.
    await expect(commandExists(`${nodeName} --no-warnings`)).resolves.toBe(
      false,
    );
  });

  it("resolves true for a program whose path contains a space", async () => {
    await expect(commandExists(spacedExecutable)).resolves.toBe(true);
  });
});

describe("spawnDetached", () => {
  // The child is detached and its stdio ignored, so nothing it does is visible
  // through the return value — every case here reads a file the child wrote.
  function writeMarker(markerPath: string, expression: string) {
    return `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, ${expression})`;
  }

  it("runs the command in the directory given as cwd", async () => {
    const marker = join(tempPath, "detached-cwd.txt");

    spawnDetached(node, ["-e", writeMarker(marker, "process.cwd()")], {
      cwd: spacedPath,
    });

    // The content assertion sits inside the poll: writeFileSync creates the
    // file before it writes, so a poll on existence alone could read it empty.
    await vi.waitFor(() =>
      expect(readFileSync(marker, "utf8")).toBe(spacedPath),
    );
  });

  it("passes an argument as one argument and never as shell syntax", async () => {
    const marker = join(tempPath, "detached-argv.txt");
    const sentinel = join(tempPath, "detached-pwned");
    const hostile = `x"; touch ${sentinel}; \`whoami\` $(id) #`;

    spawnDetached(node, [
      "-e",
      writeMarker(marker, "process.argv[1]"),
      hostile,
    ]);

    await vi.waitFor(() => expect(readFileSync(marker, "utf8")).toBe(hostile));
    expect(existsSync(sentinel)).toBe(false);
  });

  it("returns before the child has finished, and the child still runs", async () => {
    const marker = join(tempPath, "detached-slow.txt");

    spawnDetached(node, [
      "-e",
      `setTimeout(() => ${writeMarker(marker, '"done"')}, 200)`,
    ]);

    // Fire-and-forget: unref'd and never awaited, so the call returns while the
    // child is still working, and the child outlives the return.
    expect(existsSync(marker)).toBe(false);
    await vi.waitFor(() => expect(existsSync(marker)).toBe(true), {
      timeout: 3000,
    });
  });

  it("reports a failed launch through onError", async () => {
    const error = await new Promise<Error>((resolve) => {
      spawnDetached("worktree-no-such-binary", [], { onError: resolve });
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("worktree-no-such-binary");
  });

  it("survives a failed launch when the caller supplies no handler", async () => {
    // An "error" event with no listener throws on a ChildProcess, so dropping
    // the handler registration would crash the CLI — and would surface here as
    // an unhandled exception failing this file, not as a failed assertion.
    expect(() => spawnDetached("worktree-no-such-binary")).not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 100));
  });
});
