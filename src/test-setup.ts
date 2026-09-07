// Global mock for the cmd function to prevent actual shell command execution
const mockCmd: ReturnType<typeof vi.fn> = vi.fn();
const mockRunCommand: ReturnType<typeof vi.fn> = vi.fn();
let expectedCommands: string[] = [];

// This factory replaces the whole module, so anything cli.js exports has to be
// listed here or it is undefined in every suite in the repo.
vi.mock("./lib/cli.js", () => ({
  cmd: mockCmd,
  commandExists: vi.fn().mockResolvedValue(true),
  runCommand: mockRunCommand,
}));

beforeEach(() => {
  // Clear all mocks before each test
  vi.clearAllMocks();
  // A successful, silent run is the benign default. Without it a suite that
  // reaches runCommand without mocking it gets undefined back rather than a
  // promise, and fails somewhere unrelated to what it is testing.
  mockRunCommand.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
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
export { expectCommands, mockCmd, mockRunCommand };
