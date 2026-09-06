// Global mock for the subprocess helper, to prevent actual command execution.
// The factory returns an explicit object, so every export of ./lib/cli.js has to
// be listed here — one that is missing is undefined at call time, and the caller
// fails with "x is not a function" rather than a useful assertion.
const mockRun: ReturnType<typeof vi.fn> = vi.fn();
const mockSpawnDetached: ReturnType<typeof vi.fn> = vi.fn();
let expectedCommands: string[] = [];

vi.mock("./lib/cli.js", () => ({
  run: mockRun,
  spawnDetached: mockSpawnDetached,
  commandExists: vi.fn().mockResolvedValue(true),
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

// Export the mocks and helper for use in tests
export { expectCommands, mockRun, mockSpawnDetached };
