import { PassThrough } from "node:stream";
import { createSpinner, isProgressEnabled } from "./progress.js";

const tty = { isTTY: true, columns: 80 };

describe("isProgressEnabled", () => {
  it("is on for an interactive run on a TTY with a width", () => {
    expect(isProgressEnabled({ nonInteractive: false, stream: tty })).toBe(
      true,
    );
  });

  it("is off when the run is non-interactive", () => {
    expect(isProgressEnabled({ nonInteractive: true, stream: tty })).toBe(
      false,
    );
  });

  it("is off when stderr is not a TTY", () => {
    expect(
      isProgressEnabled({
        nonInteractive: false,
        stream: { isTTY: false, columns: 80 },
      }),
    ).toBe(false);
    expect(isProgressEnabled({ nonInteractive: false, stream: {} })).toBe(
      false,
    );
  });

  it.each([0, undefined])("is off when columns is %s", (columns) => {
    expect(
      isProgressEnabled({
        nonInteractive: false,
        stream: { isTTY: true, columns },
      }),
    ).toBe(false);
  });
});

describe("createSpinner against real ora", () => {
  // E2: a pseudo-TTY reports isTTY true and columns 0, and an enabled ora loops
  // forever in clear(). Bounded, so a regression fails instead of hanging.
  it("finishes on a TTY stream with columns 0", { timeout: 5000 }, async () => {
    const stream = Object.assign(new PassThrough(), {
      isTTY: true,
      columns: 0,
    });
    let output = "";
    stream.on("data", (chunk) => {
      output += chunk.toString();
    });

    const spinner = createSpinner("Working", {
      nonInteractive: false,
      stream,
    }).start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    spinner.succeed("Done");

    expect(spinner.isSpinning).toBe(false);
    expect(output).toContain("Working");
    expect(output).toContain("Done");
    expect(output).not.toContain("\u001B[1A");
  });

  it("finishes without animating when the run is non-interactive", async () => {
    const stream = Object.assign(new PassThrough(), {
      isTTY: true,
      columns: 80,
    });
    let output = "";
    stream.on("data", (chunk) => {
      output += chunk.toString();
    });

    const spinner = createSpinner("Working", {
      nonInteractive: true,
      stream,
    }).start();
    spinner.succeed("Done");

    expect(output).not.toContain("\u001B[1A");
    expect(output).toContain("Done");
  });
});
