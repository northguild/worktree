import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Config } from "@oclif/core";
import { setNonInteractive } from "./lib/interaction.js";

// Global mock for the subprocess helper, to prevent actual command execution.
// The factory returns an explicit object, so every export of ./lib/cli.js has to
// be listed here — one that is missing is undefined at call time, and the caller
// fails with "x is not a function" rather than a useful assertion.
const mockRun: ReturnType<typeof vi.fn> = vi.fn();
const mockRunCapturing: ReturnType<typeof vi.fn> = vi.fn();
const mockSpawnDetached: ReturnType<typeof vi.fn> = vi.fn();
const mockRunStreaming: ReturnType<typeof vi.fn> = vi.fn();
const mockIsProcessRunning: ReturnType<typeof vi.fn> = vi.fn();
let expectedCommands: string[] = [];

// This factory replaces the whole module, so anything cli.js exports has to be
// listed here or it is undefined in every suite in the repo.
vi.mock("./lib/cli.js", () => ({
  run: mockRun,
  spawnDetached: mockSpawnDetached,
  commandExists: vi.fn().mockResolvedValue(true),
  runCapturing: mockRunCapturing,
  runStreaming: mockRunStreaming,
  isProcessRunning: mockIsProcessRunning,
}));

// A run() call reads as its argv joined, with the cwd appended when one is
// given. An element containing whitespace is quoted, so one argument holding a
// space stays distinguishable from two arguments: gitSetConfigValue passes a
// caller-supplied value straight through, and the whole point of the argv form
// is that such a value is one element however it is spelled. The rendering is
// still a diagnostic — what each call site passes is asserted by the tests
// themselves, with toHaveBeenCalledWith.
function describeRunCall(call: unknown[]): string {
  const [file, args = [], options] = call as [
    string,
    string[]?,
    { cwd?: string }?,
  ];
  const argv = [file, ...args]
    .map((part) => (/\s/.test(part) ? `"${part}"` : part))
    .join(" ");
  return options?.cwd ? `${argv} (cwd: ${options.cwd})` : argv;
}

beforeEach(() => {
  // Clear all mocks before each test
  vi.clearAllMocks();
  // vitest's stdin is not a TTY, so the run would resolve as non-interactive and
  // every prompt would take its default. The suites that assert a prompt is
  // asked are the human path; the ones for the other mode say so themselves.
  setNonInteractive(false);
  // A successful, silent run is the benign default. Without it a suite that
  // reaches runCapturing without mocking it gets undefined back rather than a
  // promise, and fails somewhere unrelated to what it is testing.
  mockRunCapturing.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
  mockRunStreaming.mockResolvedValue({ exitCode: 0 });
  // No pid is running unless a test says so. The fixtures carry arbitrary pids
  // such as 9187, and whether one is alive on the machine running the suite must
  // never change a result, so the real process table is never consulted.
  mockIsProcessRunning.mockReturnValue(false);
  expectedCommands = [];
});

afterEach(() => {
  // Assert that no unexpected commands were called
  const actualCalls = mockRun.mock.calls.map(describeRunCall);
  const unexpectedCalls = actualCalls.filter(
    (call) => !expectedCommands.includes(call),
  );

  if (unexpectedCalls.length > 0) {
    console.warn(
      `Unexpected subprocess calls detected:\n${unexpectedCalls
        .map((call) => `  - ${call}`)
        .join("\n")}`,
    );
  }
});

// Helper function for tests to declare expected commands
function expectCommands(...commands: string[]) {
  expectedCommands.push(...commands);
}

// What a `--json` run wrote, per stream, for the suites that assert stdout is
// exactly one document. Spies on the process streams
// and on `console`, which oclif's `ux` and `BaseCommand.catch` print through.
// `restore()` puts them back; call it in `afterEach`, because a
// stream left spied would swallow the runner's own output.
function captureOutput() {
  const out: string[] = [];
  const err: string[] = [];
  const spies = [
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      out.push(String(chunk));
      return true;
    }),
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      err.push(String(chunk));
      return true;
    }),
    // oclif's `ux.stdout` and `ux.stderr` are `console.log` and `console.error`.
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      out.push(`${args.join(" ")}\n`);
    }),
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      err.push(`${args.join(" ")}\n`);
    }),
  ];

  return {
    restore: () => {
      for (const spy of spies) {
        spy.mockRestore();
      }
    },
    stdout: () => out.join(""),
    stderr: () => err.join(""),
    /** The whole of stdout as one document: throws if it is anything else. */
    document: () => JSON.parse(out.join("")) as Record<string, unknown>,
  };
}

// A real oclif Config, for the suites that go through `init` or `_run`. vitest
// sets NODE_ENV to "test", which oclif reads as development: it points command
// discovery at src/commands and imports each .ts natively, where their .js
// specifiers cannot resolve, so `Config.load(process.cwd())` warned
// MODULE_NOT_FOUND once per command. No suite needs the command list, so the
// root plugin is loaded without a `commands` target and discovers none.
async function loadConfig(): Promise<Config> {
  const root = process.cwd();
  const pjson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const oclif = { ...pjson.oclif };
  delete oclif.commands;
  return Config.load({ root, pjson: { ...pjson, oclif } });
}

// Export the mocks and helper for use in tests
export {
  captureOutput,
  expectCommands,
  loadConfig,
  mockIsProcessRunning,
  mockRun,
  mockRunCapturing,
  mockRunStreaming,
  mockSpawnDetached,
};
