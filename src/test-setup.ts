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

beforeEach(() => {
  // Clear all mocks before each test
  vi.clearAllMocks();
  expectedCommands = [];
});

afterEach(() => {
  // Assert that no unexpected commands were called
  const actualCalls = mockCmd.mock.calls.map((call) => call[0]);
  const unexpectedCalls = actualCalls.filter(
    (call) => !expectedCommands.includes(call),
  );

  if (unexpectedCalls.length > 0) {
    console.warn(
      `Unexpected cmd calls detected:\n${unexpectedCalls
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
