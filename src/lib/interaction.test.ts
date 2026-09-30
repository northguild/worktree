import {
  type InteractionInputs,
  isNonInteractive,
  resolveNonInteractive,
  setNonInteractive,
} from "./interaction.js";

const human: InteractionInputs = { stdinIsTTY: true, env: {} };

describe("resolveNonInteractive", () => {
  it("is interactive for a human at a terminal", () => {
    expect(resolveNonInteractive(human)).toBe(false);
  });

  it("is non-interactive when stdin is not a TTY", () => {
    expect(resolveNonInteractive({ ...human, stdinIsTTY: undefined })).toBe(
      true,
    );
    expect(resolveNonInteractive({ ...human, stdinIsTTY: false })).toBe(true);
  });

  it.each([
    "true",
    "1",
    "yes",
    "github",
  ])("treats CI=%s as non-interactive", (ci) => {
    expect(resolveNonInteractive({ ...human, env: { CI: ci } })).toBe(true);
  });

  it.each(["", "0", "false", "FALSE"])("treats CI=%j as interactive", (ci) => {
    expect(resolveNonInteractive({ ...human, env: { CI: ci } })).toBe(false);
  });

  it("is non-interactive with --non-interactive", () => {
    expect(resolveNonInteractive({ ...human, nonInteractiveFlag: true })).toBe(
      true,
    );
  });

  it("is non-interactive with --yes", () => {
    expect(resolveNonInteractive({ ...human, yesFlag: true })).toBe(true);
  });

  it("is non-interactive with --json", () => {
    expect(resolveNonInteractive({ ...human, json: true })).toBe(true);
  });

  it("stays interactive when every flag is explicitly off", () => {
    expect(
      resolveNonInteractive({
        ...human,
        nonInteractiveFlag: false,
        yesFlag: false,
        json: false,
      }),
    ).toBe(false);
  });
});

describe("isNonInteractive", () => {
  afterEach(() => setNonInteractive(undefined));

  it("answers with the mode the run resolved", () => {
    setNonInteractive(true);
    expect(isNonInteractive()).toBe(true);
    setNonInteractive(false);
    expect(isNonInteractive()).toBe(false);
  });
});
