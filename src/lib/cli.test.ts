import { runCommand } from "./cli.js";

// src/test-setup.ts replaces this module for every suite in the repo. This one
// is the exception: it tests the real implementation against real processes.
vi.unmock("./cli.js");

describe("runCommand", () => {
  it("resolves stdout and a zero exit code on success", async () => {
    const result = await runCommand(process.execPath, [
      "-e",
      "process.stdout.write('hello')",
    ]);

    expect(result).toEqual({ stdout: "hello", stderr: "", exitCode: 0 });
  });

  it("resolves — not rejects — with stderr and the code on a non-zero exit", async () => {
    const result = await runCommand(process.execPath, [
      "-e",
      "process.stderr.write(JSON.stringify({error:{code:'nope'}})); process.exit(1)",
    ]);

    expect(result).toEqual({
      stdout: "",
      stderr: '{"error":{"code":"nope"}}',
      exitCode: 1,
    });
  });

  it("passes each argument verbatim, with no shell interpretation", async () => {
    const argument = "/tmp/a b/c; echo pwned > /tmp/*";

    const result = await runCommand(process.execPath, [
      "-e",
      "process.stdout.write(process.argv[1])",
      argument,
    ]);

    expect(result.stdout).toBe(argument);
    expect(result.exitCode).toBe(0);
  });

  it("rejects when the executable cannot be spawned", async () => {
    await expect(
      runCommand("northguild-worktree-no-such-executable", []),
    ).rejects.toThrow();
  });
});
