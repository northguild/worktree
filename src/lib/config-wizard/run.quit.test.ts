import * as gitConfig from "../config.js";
import * as prompt from "../prompt.js";
import type { ConfigName } from "../types.js";
import type { WizardContext } from "./context.js";
import { runWizard } from "./run.js";

// Expected values come from the brief's acceptance item 8: a quit (Esc then
// Yes, or Ctrl+C — both reach the wizard as an ExitPromptError) prints one
// line naming the keys saved so far by name only, in the closing summary's
// terms ("Saved: a, b"), or "Nothing changed.", and the error then goes on so
// the command exits quietly. The wording "Stopped. Saved: ..." is the brief's
// own example. Never a value: the token below must appear nowhere in output.
const TOKEN = "secret-token-value-123";

function exitPromptError() {
  const error = new Error("User force closed the prompt");
  error.name = "ExitPromptError";
  return error;
}

describe("the wizard when the user quits", () => {
  let stored: Record<string, string>;
  let lines: string[];

  function context(configNames: ConfigName[]): WizardContext {
    return {
      configNames,
      names: configNames.join(","),
      herdrOffered: false,
      hiddenNames: new Set(),
      log: (message) => {
        lines.push(message);
      },
    };
  }

  beforeEach(() => {
    stored = {};
    lines = [];
    vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation((name) =>
      Promise.resolve(stored[name] ?? ""),
    );
    vi.spyOn(gitConfig, "gitSetConfigValue").mockImplementation(
      async (name, value) => {
        stored[name] = value;
      },
    );
    vi.spyOn(prompt, "askSelect").mockResolvedValue("true" as never);
    vi.spyOn(prompt, "askConfirm").mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("names the keys saved before the quit, never a value, and rethrows the quit", async () => {
    let calls = 0;
    vi.spyOn(prompt, "askInput").mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        return TOKEN;
      }
      throw exitPromptError();
    });

    await expect(
      runWizard(context(["linear.apiKey", "postCreate"])),
    ).rejects.toMatchObject({ name: "ExitPromptError" });

    expect(stored["linear.apiKey"]).toBe(TOKEN);
    expect(lines.at(-1)).toBe("Stopped. Saved: linear.apiKey");
    expect(lines.join("\n")).not.toContain(TOKEN);
    expect(lines.join("\n")).not.toContain("Configuration complete");
  });

  it("says nothing changed when the quit comes before any answer", async () => {
    vi.spyOn(prompt, "askInput").mockRejectedValue(exitPromptError());

    await expect(runWizard(context(["postCreate"]))).rejects.toMatchObject({
      name: "ExitPromptError",
    });

    expect(lines.at(-1)).toBe("Stopped. Nothing changed.");
  });

  it("does not swallow a failure that is not a quit", async () => {
    vi.spyOn(prompt, "askInput").mockRejectedValue(new Error("boom"));

    await expect(runWizard(context(["postCreate"]))).rejects.toThrow("boom");

    expect(lines.join("\n")).not.toContain("Stopped.");
  });
});
