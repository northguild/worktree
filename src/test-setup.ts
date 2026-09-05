// Global mocks for the subprocess helpers, to prevent actual command execution.
// The factory returns an explicit object, so every export of ./lib/cli.js has to
// be listed here — one that is missing is undefined at call time, and the caller
// fails with "x is not a function" rather than a useful assertion.
const mockCmd: ReturnType<typeof vi.fn> = vi.fn();
const mockRun: ReturnType<typeof vi.fn> = vi.fn();
let expectedCommands: string[] = [];

vi.mock("./lib/cli.js", () => ({
  cmd: mockCmd,
  run: mockRun,
  commandExists: vi.fn().mockResolvedValue(true),
}));

// Both helpers reduce to one declared form, so a call site moving from cmd() to
// run() stays inside the guard's field of view instead of leaving it. A run()
// call reads as its argv joined, with the cwd appended when one is given — the
// same information the `cd ${path} && …` prefix carried while these calls went
// through a shell. An element containing whitespace is quoted, so one argument
// holding a space stays distinguishable from two arguments: gitSetConfigValue
// passes a caller-supplied value straight through, and the whole point of the
// argv form is that such a value is one element however it is spelled. The
// rendering is still a diagnostic — what each call site passes is asserted by
// the tests themselves, with toHaveBeenCalledWith.
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
  const actualCalls = [
    ...mockCmd.mock.calls.map((call) => String(call[0])),
    ...mockRun.mock.calls.map(describeRunCall),
  ];
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
export { expectCommands, mockCmd, mockRun };
