import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as cli from "../lib/cli.js";
import {
  closeRexSession,
  findRexExecutable,
  findRexSessions,
  isRexInstalled,
  locateRexExecutable,
  openRexSession,
  RexError,
  selectRexSession,
} from "./rex.js";

const mockRunCapturing = vi.mocked(cli.runCapturing);

// Every answer below was captured from Rex Beta 0.1.0 (1829) on 2026-11-06
// (`rex ls --json`, `rex new … --json`, `rex block ls -s … --json`,
// `rex block call … process` and `… pwd`), shortened only in the paths. They
// are the source of the expected values: a reader is right when it recovers the
// ids and directories those captures hold.
const SESSION_A = "session:01a1b152-c3f1-7d71-9bef-ae9886e0e5f4";
const SESSION_B = "session:01a1b153-48cf-7c9e-a367-f6452bdbb911";
const BLOCK_A = "block:01a1b152-c3f2-702a-ac14-be18e959f4ea";
const BLOCK_B = "block:01a1b153-48d0-7c9e-a367-f6452bdbb912";

const newAnswer = JSON.stringify({
  session_id: SESSION_A,
  initial_windows: [
    {
      window_id: "window:01a1b152-c415-7981-8a79-bc691da30cc1",
      block_ids: [BLOCK_A],
      revision: 1,
    },
  ],
});

function sessionsAnswer(...ids: string[]): string {
  return JSON.stringify({
    sessions: ids.map((id, index) => ({
      session_id: id,
      label: `label-${index}`,
    })),
  });
}

function blocksAnswer(...ids: string[]): string {
  return JSON.stringify({
    blocks: ids.map((id) => ({
      block_id: id,
      label: "shell",
      creator_name: "com.superlogical.terminal",
      flavor: "com.superlogical.terminal.shell",
      host_id: "245ca23e-8ca2-4e51-80f0-3e3359141363",
      placement: "placed",
      window_id: "window:01a1b152-c415-7981-8a79-bc691da30cc1",
      owner: "client:01a1b152-c3f0-7124-a136-b88cd79b71cc",
    })),
  });
}

function processAnswer(cwd: string | undefined): string {
  return JSON.stringify({
    last_exit: null,
    child: { pid: 13589, user: "root", name: "login", path: "/usr/bin/login" },
    ...(cwd === undefined
      ? {}
      : {
          foreground: {
            pid: 13596,
            user: "baldur",
            name: "zsh",
            path: "/bin/zsh",
            argv0: "-zsh",
            cwd,
          },
        }),
    ancestors: [],
    home: "/Users/baldur",
  });
}

function pwdAnswer(path: string): string {
  return JSON.stringify({
    pwd: `file://Baldurs-MacBook-Pro.local${path}`,
    owner: { pid: 13596, name: "zsh" },
  });
}

function ok(stdout: string) {
  return { stdout, stderr: "", exitCode: 0 };
}

function fail(exitCode: number, stderr: string) {
  return { stdout: "", stderr, exitCode };
}

/** The error `runCapturing` rejects with when its timeout kills the child. */
function killedByTimeout() {
  return Object.assign(
    new Error(`Command failed: rex new x -- claude ${BRIEF}`),
    {
      cmd: `rex new x -- claude ${BRIEF}`,
      killed: true,
      code: null,
      signal: "SIGTERM",
    },
  );
}

let binDir: string;
let rexPath: string;

function makeExecutable(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "rex");
  writeFileSync(file, "#!/bin/sh\n");
  chmodSync(file, 0o755);
  return file;
}

beforeAll(() => {
  // The first call caches its answer for the process, so the environment is set
  // before any test reaches it: an empty PATH and a REX_BIN_DIR holding a fake,
  // which keeps the machine's own Rex out of the suite.
  binDir = mkdtempSync(join(tmpdir(), "rex-bin-"));
  rexPath = makeExecutable(binDir);
  process.env.PATH = mkdtempSync(join(tmpdir(), "rex-empty-path-"));
  process.env.REX_BIN_DIR = binDir;
});

// Inside a Rex terminal these are set, and `selectRexSession` reads the first.
// A test that wants one sets it itself.
beforeEach(() => {
  delete process.env.REX_CLIENT;
  delete process.env.REX_SESSION;
});

const BRIEF = `Don't "quote" $HOME \`id\`\nsecond line ${"x".repeat(5000)}`;

describe("locateRexExecutable (D3)", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "rex-locate-"));
  });

  const bundleRelative =
    "Rex Beta.app/Contents/Helpers/Rex Server.rex/Contents/MacOS";

  it("prefers rex on PATH over REX_BIN_DIR and the app bundle", async () => {
    const onPath = makeExecutable(join(root, "path"));
    makeExecutable(join(root, "bindir"));
    makeExecutable(join(root, "apps", bundleRelative));

    await expect(
      locateRexExecutable({
        env: { PATH: join(root, "path"), REX_BIN_DIR: join(root, "bindir") },
        applicationsDir: join(root, "apps"),
      }),
    ).resolves.toBe(onPath);
  });

  it("falls back to REX_BIN_DIR when PATH has none", async () => {
    const inBinDir = makeExecutable(join(root, "bindir"));
    makeExecutable(join(root, "apps", bundleRelative));

    await expect(
      locateRexExecutable({
        env: { PATH: join(root, "nowhere"), REX_BIN_DIR: join(root, "bindir") },
        applicationsDir: join(root, "apps"),
      }),
    ).resolves.toBe(inBinDir);
  });

  it("falls back to the app bundle by glob when neither names one", async () => {
    const inBundle = makeExecutable(join(root, "apps", bundleRelative));
    makeExecutable(join(root, "apps", "Other.app/Contents/MacOS"));

    await expect(
      locateRexExecutable({
        env: { PATH: join(root, "nowhere") },
        applicationsDir: join(root, "apps"),
      }),
    ).resolves.toBe(inBundle);
  });

  it("answers undefined when nothing is found, and skips a file that is not executable", async () => {
    const dir = join(root, "path");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "rex"), "not executable");
    // A directory called `rex` is not a program either.
    mkdirSync(join(root, "bindir", "rex"), { recursive: true });

    await expect(
      locateRexExecutable({
        env: { PATH: dir, REX_BIN_DIR: join(root, "bindir") },
        applicationsDir: join(root, "apps"),
      }),
    ).resolves.toBeUndefined();
  });
});

describe("findRexExecutable and isRexInstalled", () => {
  it("answers once per process", () => {
    expect(findRexExecutable()).toBe(findRexExecutable());
  });

  it("reports installed when the CLI is found", async () => {
    await expect(findRexExecutable()).resolves.toBe(rexPath);
    await expect(isRexInstalled()).resolves.toBe(true);
  });
});

describe("openRexSession (D4, D7)", () => {
  it("creates the session with the label and directory and reads the ids", async () => {
    mockRunCapturing.mockResolvedValue(ok(newAnswer));

    await expect(
      openRexSession({ path: "/a/foo", label: "feature/x" }),
    ).resolves.toEqual({ sessionId: SESSION_A, blockId: BLOCK_A });

    expect(mockRunCapturing).toHaveBeenCalledTimes(1);
    expect(mockRunCapturing).toHaveBeenCalledWith(
      rexPath,
      ["new", "feature/x", "-c", "/a/foo", "--json"],
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it("passes the command and the brief as the argv after --, one element each", async () => {
    mockRunCapturing.mockResolvedValue(ok(newAnswer));

    await openRexSession({
      path: "/a/foo",
      label: "x",
      command: ["claude", "--model", "opus", BRIEF],
    });

    expect(mockRunCapturing.mock.calls[0]?.[1]).toEqual([
      "new",
      "x",
      "-c",
      "/a/foo",
      "--json",
      "--",
      "claude",
      "--model",
      "opus",
      BRIEF,
    ]);
  });

  it.each([
    ["an empty label", ""],
    ["a label that would read as an option", "-rf"],
  ])("refuses %s before running anything", async (_name, label) => {
    await expect(openRexSession({ path: "/a/foo", label })).rejects.toThrow(
      /label/,
    );
    expect(mockRunCapturing).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON", "oops"],
    ["a JSON array", "[]"],
    ["no session_id", JSON.stringify({ initial_windows: [] })],
    ["a non-string session_id", JSON.stringify({ session_id: 7 })],
    ["no initial_windows", JSON.stringify({ session_id: SESSION_A })],
    [
      "an empty initial_windows",
      JSON.stringify({ session_id: SESSION_A, initial_windows: [] }),
    ],
    [
      "no block_ids",
      JSON.stringify({ session_id: SESSION_A, initial_windows: [{}] }),
    ],
    [
      "an empty block_ids",
      JSON.stringify({
        session_id: SESSION_A,
        initial_windows: [{ block_ids: [] }],
      }),
    ],
    [
      "a non-string block id",
      JSON.stringify({
        session_id: SESSION_A,
        initial_windows: [{ block_ids: [3] }],
      }),
    ],
  ])("rejects an answer with %s", async (_name, stdout) => {
    mockRunCapturing.mockResolvedValue(ok(stdout));

    await expect(
      openRexSession({ path: "/a/foo", label: "x" }),
    ).rejects.toThrow(/Rex:/);
  });

  it("ignores fields it does not read", async () => {
    mockRunCapturing.mockResolvedValue(
      ok(
        JSON.stringify({
          session_id: SESSION_A,
          surprise: true,
          initial_windows: [{ block_ids: [BLOCK_A], extra: {} }],
        }),
      ),
    );

    await expect(
      openRexSession({ path: "/a/foo", label: "x" }),
    ).resolves.toEqual({ sessionId: SESSION_A, blockId: BLOCK_A });
  });

  it("rewords a timed-out call, without its argv, and does not retry it", async () => {
    mockRunCapturing.mockRejectedValue(killedByTimeout());

    const error = await openRexSession({
      path: "/a/foo",
      label: "x",
      command: ["claude", BRIEF],
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RexError);
    expect((error as RexError).timedOut).toBe(true);
    expect((error as Error).message).toMatch(/did not answer within \d+s/);
    expect((error as Error).message).not.toContain("second line");
    expect((error as Error).message).not.toContain(BRIEF);
    // Node's execFile error carries the argv in its message and `.cmd`, so it
    // must not ride along as the cause either.
    expect((error as Error).cause).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain("second line");
    // D4: Rex's guide says the command may have succeeded, so it is never sent
    // again blind.
    expect(mockRunCapturing).toHaveBeenCalledTimes(1);
  });

  it("never prints the brief when Rex fails, even if it echoes the argument", async () => {
    mockRunCapturing.mockResolvedValue(fail(1, `Error: cannot run "${BRIEF}"`));

    const error = await openRexSession({
      path: "/a/foo",
      label: "x",
      command: ["claude", BRIEF],
    }).catch((caught: unknown) => caught);

    const message = (error as Error).message;
    expect(message).toMatch(/exited with code 1/);
    expect(message).not.toContain("second line");
    expect(message).not.toContain(BRIEF);
    expect(message).toMatch(/claude/);
  });

  it("never prints the brief when the child dies on a signal", async () => {
    mockRunCapturing.mockRejectedValue(
      Object.assign(new Error(`Command failed: rex new x -- ${BRIEF}`), {
        killed: false,
        code: null,
        signal: "SIGKILL",
      }),
    );

    const error = await openRexSession({
      path: "/a/foo",
      label: "x",
      command: ["claude", BRIEF],
    }).catch((caught: unknown) => caught);

    expect((error as Error).message).toMatch(/killed by SIGKILL/);
    expect((error as Error).message).not.toContain("second line");
    expect((error as Error).cause).toBeUndefined();
  });

  it("does not pass Node's argv-bearing error through for a spawn failure", async () => {
    mockRunCapturing.mockRejectedValue(
      Object.assign(new Error(`spawn rex ENOENT ${BRIEF}`), {
        code: "ENOENT",
        cmd: `rex new x -- claude ${BRIEF}`,
      }),
    );

    const error = await openRexSession({
      path: "/a/foo",
      label: "x",
      command: ["claude", BRIEF],
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RexError);
    expect((error as Error).message).toMatch(/ENOENT/);
    expect((error as Error).message).not.toContain("second line");
    expect((error as Error).cause).toBeUndefined();
  });

  it("passes Rex's own refusal through with its exit code", async () => {
    mockRunCapturing.mockResolvedValue(
      fail(
        1,
        "Error: control message too large: encoded request is 129312 bytes, limit is 65536",
      ),
    );

    const error = await openRexSession({
      path: "/a/foo",
      label: "x",
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RexError);
    expect((error as RexError).exitCode).toBe(1);
    expect((error as Error).message).toContain("control message too large");
  });
});

describe("selectRexSession", () => {
  it("asks the app to show the session", async () => {
    await selectRexSession(SESSION_A);

    expect(mockRunCapturing).toHaveBeenCalledWith(
      rexPath,
      ["do", "session.select", `session_id=${SESSION_A}`],
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  describe("REX_CLIENT (D5)", () => {
    afterEach(() => {
      delete process.env.REX_CLIENT;
    });

    it("targets the client REX_CLIENT names", async () => {
      process.env.REX_CLIENT = "client:abc";

      await selectRexSession(SESSION_A);

      expect(mockRunCapturing.mock.calls[0]?.[1]).toEqual([
        "-C",
        "client:abc",
        "do",
        "session.select",
        `session_id=${SESSION_A}`,
      ]);
    });

    it("passes no -C when REX_CLIENT is unset or empty", async () => {
      process.env.REX_CLIENT = "";

      await selectRexSession(SESSION_A);

      expect(mockRunCapturing.mock.calls[0]?.[1]).toEqual([
        "do",
        "session.select",
        `session_id=${SESSION_A}`,
      ]);
    });
  });

  it("rejects with Rex's message when the call is refused", async () => {
    mockRunCapturing.mockResolvedValue(fail(1, "Error: no client"));

    await expect(selectRexSession(SESSION_A)).rejects.toThrow(/no client/);
  });
});

describe("closeRexSession (D8)", () => {
  it("kills the session by id", async () => {
    await closeRexSession(SESSION_A);

    expect(mockRunCapturing).toHaveBeenCalledWith(
      rexPath,
      ["kill", SESSION_A],
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it("rejects when Rex cannot find the session", async () => {
    mockRunCapturing.mockResolvedValue(
      fail(3, `Error: session target "${SESSION_A}" not found`),
    );

    const error = await closeRexSession(SESSION_A).catch(
      (caught: unknown) => caught,
    );

    expect((error as RexError).exitCode).toBe(3);
    expect((error as Error).message).toMatch(/not found/);
  });

  it("refuses an id that would read as an option", async () => {
    await expect(closeRexSession("--all")).rejects.toThrow(/session id/);
    expect(mockRunCapturing).not.toHaveBeenCalled();
  });
});

/**
 * Answers each `rex` call from a table keyed by the argv after the executable,
 * so a test describes the server rather than the order of the calls.
 */
function serve(answers: Record<string, string | ReturnType<typeof fail>>) {
  mockRunCapturing.mockImplementation(async (_file, args = []) => {
    const answer = answers[args.join(" ")];
    if (answer === undefined) {
      throw new Error(`unscripted rex call: ${args.join(" ")}`);
    }
    return typeof answer === "string" ? ok(answer) : answer;
  });
}

const LS = "ls --json";
const blocksOf = (session: string) => `block ls -s ${session} --json`;
const processOf = (session: string, block: string) =>
  `block call -s ${session} -b ${block} process`;
const pwdOf = (session: string, block: string) =>
  `block call -s ${session} -b ${block} pwd`;

describe("findRexSessions (D6)", () => {
  it("answers an empty map without calling Rex when there is nothing to look for", async () => {
    await expect(findRexSessions({ paths: [] })).resolves.toEqual(new Map());
    expect(mockRunCapturing).not.toHaveBeenCalled();
  });

  it("maps a worktree to the session whose shell is inside it", async () => {
    serve({
      [LS]: sessionsAnswer(SESSION_A, SESSION_B),
      [blocksOf(SESSION_A)]: blocksAnswer(BLOCK_A),
      [processOf(SESSION_A, BLOCK_A)]: processAnswer("/a/foo/src"),
      [blocksOf(SESSION_B)]: blocksAnswer(BLOCK_B),
      [processOf(SESSION_B, BLOCK_B)]: processAnswer("/elsewhere"),
    });

    await expect(findRexSessions({ paths: ["/a/foo"] })).resolves.toEqual(
      new Map([["/a/foo", SESSION_A]]),
    );
  });

  // The prefix case: a session in /a/foo-bar must never be taken for /a/foo's.
  // Decided by what a path is, not by how it is spelled: foo-bar is a sibling
  // directory, so it is inside neither /a/foo nor anything else asked about.
  it("does not take /a/foo-bar for a directory inside /a/foo", async () => {
    serve({
      [LS]: sessionsAnswer(SESSION_A, SESSION_B),
      [blocksOf(SESSION_A)]: blocksAnswer(BLOCK_A),
      [processOf(SESSION_A, BLOCK_A)]: processAnswer("/a/foo-bar"),
      [blocksOf(SESSION_B)]: blocksAnswer(BLOCK_B),
      [processOf(SESSION_B, BLOCK_B)]: processAnswer("/a/foo"),
    });

    await expect(findRexSessions({ paths: ["/a/foo"] })).resolves.toEqual(
      new Map([["/a/foo", SESSION_B]]),
    );
  });

  it("keeps /a/foo and /a/foo-bar apart when both are asked about", async () => {
    serve({
      [LS]: sessionsAnswer(SESSION_A, SESSION_B),
      [blocksOf(SESSION_A)]: blocksAnswer(BLOCK_A),
      [processOf(SESSION_A, BLOCK_A)]: processAnswer("/a/foo-bar/lib"),
      [blocksOf(SESSION_B)]: blocksAnswer(BLOCK_B),
      [processOf(SESSION_B, BLOCK_B)]: processAnswer("/a/foo"),
    });

    await expect(
      findRexSessions({ paths: ["/a/foo", "/a/foo-bar"] }),
    ).resolves.toEqual(
      new Map([
        ["/a/foo", SESSION_B],
        ["/a/foo-bar", SESSION_A],
      ]),
    );
  });

  it("reads the shell's directory from pwd when the foreground process has none", async () => {
    serve({
      [LS]: sessionsAnswer(SESSION_A),
      [blocksOf(SESSION_A)]: blocksAnswer(BLOCK_A),
      [processOf(SESSION_A, BLOCK_A)]: processAnswer(undefined),
      [pwdOf(SESSION_A, BLOCK_A)]: pwdAnswer("/a/my%20foo/sub"),
    });

    await expect(findRexSessions({ paths: ["/a/my foo"] })).resolves.toEqual(
      new Map([["/a/my foo", SESSION_A]]),
    );
  });

  it("matches through a symlink: a shell's real directory is inside the worktree's real path", async () => {
    const real = mkdtempSync(join(tmpdir(), "rex-real-"));
    const linkParent = mkdtempSync(join(tmpdir(), "rex-link-"));
    const link = join(linkParent, "tree");
    const { symlinkSync, realpathSync } = await import("node:fs");
    symlinkSync(real, link);
    serve({
      [LS]: sessionsAnswer(SESSION_A),
      [blocksOf(SESSION_A)]: blocksAnswer(BLOCK_A),
      [processOf(SESSION_A, BLOCK_A)]: processAnswer(realpathSync(real)),
    });

    await expect(findRexSessions({ paths: [link] })).resolves.toEqual(
      new Map([[link, SESSION_A]]),
    );
  });

  it("leaves a session alone whose shells all moved elsewhere", async () => {
    serve({
      [LS]: sessionsAnswer(SESSION_A),
      [blocksOf(SESSION_A)]: blocksAnswer(BLOCK_A),
      [processOf(SESSION_A, BLOCK_A)]: processAnswer("/home/baldur"),
    });

    await expect(findRexSessions({ paths: ["/a/foo"] })).resolves.toEqual(
      new Map(),
    );
  });

  it("leaves out a session with shells in two different worktrees, since closing it would take both", async () => {
    serve({
      [LS]: sessionsAnswer(SESSION_A),
      [blocksOf(SESSION_A)]: blocksAnswer(BLOCK_A, BLOCK_B),
      [processOf(SESSION_A, BLOCK_A)]: processAnswer("/a/foo"),
      [processOf(SESSION_A, BLOCK_B)]: processAnswer("/a/bar"),
    });

    await expect(
      findRexSessions({ paths: ["/a/foo", "/a/bar"] }),
    ).resolves.toEqual(new Map());
  });

  it("still finds a session that has one shell in the worktree and one elsewhere", async () => {
    serve({
      [LS]: sessionsAnswer(SESSION_A),
      [blocksOf(SESSION_A)]: blocksAnswer(BLOCK_A, BLOCK_B),
      [processOf(SESSION_A, BLOCK_A)]: processAnswer("/a/foo"),
      [processOf(SESSION_A, BLOCK_B)]: processAnswer("/home/baldur"),
    });

    await expect(findRexSessions({ paths: ["/a/foo"] })).resolves.toEqual(
      new Map([["/a/foo", SESSION_A]]),
    );
  });

  it("keeps the first session when two are open in the same worktree", async () => {
    serve({
      [LS]: sessionsAnswer(SESSION_A, SESSION_B),
      [blocksOf(SESSION_A)]: blocksAnswer(BLOCK_A),
      [processOf(SESSION_A, BLOCK_A)]: processAnswer("/a/foo"),
      [blocksOf(SESSION_B)]: blocksAnswer(BLOCK_B),
      [processOf(SESSION_B, BLOCK_B)]: processAnswer("/a/foo"),
    });

    await expect(findRexSessions({ paths: ["/a/foo"] })).resolves.toEqual(
      new Map([["/a/foo", SESSION_A]]),
    );
  });

  it("does not ask about a block that is not a terminal", async () => {
    serve({
      [LS]: sessionsAnswer(SESSION_A),
      [blocksOf(SESSION_A)]: JSON.stringify({
        blocks: [
          { block_id: BLOCK_B, creator_name: "com.example.browser" },
          { block_id: BLOCK_A, creator_name: "com.superlogical.terminal" },
        ],
      }),
      [processOf(SESSION_A, BLOCK_A)]: processAnswer("/a/foo"),
    });

    await expect(findRexSessions({ paths: ["/a/foo"] })).resolves.toEqual(
      new Map([["/a/foo", SESSION_A]]),
    );
  });

  it("skips a session or block that vanished between the calls", async () => {
    serve({
      [LS]: sessionsAnswer(SESSION_A, SESSION_B),
      [blocksOf(SESSION_A)]: fail(
        3,
        `Error: session target "${SESSION_A}" not found`,
      ),
      [blocksOf(SESSION_B)]: blocksAnswer(BLOCK_A, BLOCK_B),
      [processOf(SESSION_B, BLOCK_A)]: fail(3, "Error: block target not found"),
      [processOf(SESSION_B, BLOCK_B)]: processAnswer("/a/foo"),
    });

    await expect(findRexSessions({ paths: ["/a/foo"] })).resolves.toEqual(
      new Map([["/a/foo", SESSION_B]]),
    );
  });

  it("rejects when Rex stops answering rather than reporting nothing found", async () => {
    mockRunCapturing.mockRejectedValue(killedByTimeout());

    const error = await findRexSessions({ paths: ["/a/foo"] }).catch(
      (caught: unknown) => caught,
    );

    expect((error as RexError).timedOut).toBe(true);
  });

  it("calls the sessions in parallel, but never more than a few at a time", async () => {
    const ids = Array.from(
      { length: 12 },
      (_, index) => `session:0000000${index}`,
    );
    let inFlight = 0;
    let peak = 0;
    mockRunCapturing.mockImplementation(async (_file, args = []) => {
      const line = args.join(" ");
      if (line === LS) {
        return ok(sessionsAnswer(...ids));
      }
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return ok(blocksAnswer());
    });

    await findRexSessions({ paths: ["/a/foo"] });

    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
  });

  describe("rejects a malformed answer", () => {
    it.each([
      ["ls is not JSON", { [LS]: "nope" }],
      ["ls has no sessions array", { [LS]: JSON.stringify({}) }],
      ["ls has a session that is not an object", { [LS]: '{"sessions":[1]}' }],
      [
        "ls has a session with no id",
        { [LS]: JSON.stringify({ sessions: [{ label: "x" }] }) },
      ],
      [
        "block ls has no blocks array",
        {
          [LS]: sessionsAnswer(SESSION_A),
          [blocksOf(SESSION_A)]: JSON.stringify({ sessions: [] }),
        },
      ],
      [
        "block ls has a block with no id",
        {
          [LS]: sessionsAnswer(SESSION_A),
          [blocksOf(SESSION_A)]: JSON.stringify({
            blocks: [{ creator_name: "com.superlogical.terminal" }],
          }),
        },
      ],
      [
        "process is not an object",
        {
          [LS]: sessionsAnswer(SESSION_A),
          [blocksOf(SESSION_A)]: blocksAnswer(BLOCK_A),
          [processOf(SESSION_A, BLOCK_A)]: "[]",
        },
      ],
      [
        "pwd has no pwd string",
        {
          [LS]: sessionsAnswer(SESSION_A),
          [blocksOf(SESSION_A)]: blocksAnswer(BLOCK_A),
          [processOf(SESSION_A, BLOCK_A)]: processAnswer(undefined),
          [pwdOf(SESSION_A, BLOCK_A)]: JSON.stringify({ owner: {} }),
        },
      ],
      [
        "pwd is not a file URL",
        {
          [LS]: sessionsAnswer(SESSION_A),
          [blocksOf(SESSION_A)]: blocksAnswer(BLOCK_A),
          [processOf(SESSION_A, BLOCK_A)]: processAnswer(undefined),
          [pwdOf(SESSION_A, BLOCK_A)]: JSON.stringify({ pwd: "/a/foo" }),
        },
      ],
    ])("when %s", async (_name, answers) => {
      serve(answers);

      await expect(findRexSessions({ paths: ["/a/foo"] })).rejects.toThrow(
        /Rex:/,
      );
    });
  });
});
