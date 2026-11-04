import { checkbox, confirm, input, select } from "@inquirer/prompts";
import { setNonInteractive } from "./interaction.js";
import { askCheckbox, askConfirm, askInput, askSelect } from "./prompt.js";

vi.mock("@inquirer/prompts", () => ({
  checkbox: vi.fn(),
  confirm: vi.fn(),
  input: vi.fn(),
  select: vi.fn(),
  Separator: class Separator {},
}));

// Expected values come from the brief's acceptance list (Esc asks "Quit now?",
// default No; Yes quits as Ctrl+C does; No or Esc goes back to the original
// prompt; only a bare Esc counts; no listener outlives the prompt), not from
// the code. The key objects are what Node's readline emits, observed by
// feeding `readline.emitKeypressEvents` a PassThrough: a lone Esc is
// { name: "escape", sequence: "\u001b" }, Alt+Esc has sequence "\u001b\u001b",
// the Up arrow is { name: "up", sequence: "\u001b[A" }, Alt+x is
// { name: "x", meta: true, sequence: "\u001bx" }.
const ESC = { name: "escape", sequence: "\u001b", ctrl: false, meta: true };
const UP = { name: "up", sequence: "\u001b[A", ctrl: false, meta: false };
const ALT_ESC = {
  name: "escape",
  sequence: "\u001b\u001b",
  ctrl: false,
  meta: true,
};
const ALT_X = { name: "x", sequence: "\u001bx", ctrl: false, meta: true };

const site = { value: "the thing", flag: "--thing" };

const press = (key: object) =>
  process.stdin.emit("keypress", (key as { sequence: string }).sequence, key);

/** A stand-in for an inquirer prompt: pending until it is cancelled or settled. */
function pendingPrompt<T>() {
  let settle!: { resolve: (value: T) => void; reject: (e: Error) => void };
  const promise = new Promise<T>((resolve, reject) => {
    settle = { resolve, reject };
  });
  const cancelled = vi.fn();
  return Object.assign(promise, {
    cancel: () => {
      cancelled();
      const error = new Error("cancelled");
      error.name = "CancelPromptError";
      settle.reject(error);
    },
    answer: (value: T) => settle.resolve(value),
    exit: () => {
      const error = new Error("User force closed the prompt");
      error.name = "ExitPromptError";
      settle.reject(error);
    },
    cancelled,
  });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Esc in an interactive prompt", () => {
  beforeEach(() => {
    setNonInteractive(false);
    vi.mocked(confirm).mockReset();
    vi.mocked(input).mockReset();
    vi.mocked(select).mockReset();
    vi.mocked(checkbox).mockReset();
  });

  it("asks 'Quit now?' defaulting to No, then asks the original prompt again with its original config", async () => {
    const config = { message: "name", default: "prefill" };
    const first = pendingPrompt<string>();
    const second = pendingPrompt<string>();
    vi.mocked(input)
      .mockReturnValueOnce(first as never)
      .mockReturnValueOnce(second as never);
    vi.mocked(confirm).mockResolvedValueOnce(false);

    const result = askInput(config, site);
    press(ESC);
    await flush();
    second.answer("typed");

    expect(await result).toBe("typed");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith({
      message: "Quit now?",
      default: false,
    });
    expect(input).toHaveBeenCalledTimes(2);
    expect(input).toHaveBeenNthCalledWith(1, config);
    expect(input).toHaveBeenNthCalledWith(2, config);
    expect(first.cancelled).toHaveBeenCalledTimes(1);
  });

  it("quits as Ctrl+C does when the answer is yes: an ExitPromptError, no further prompt", async () => {
    const first = pendingPrompt<boolean>();
    vi.mocked(confirm)
      .mockReturnValueOnce(first as never)
      .mockResolvedValueOnce(true);

    const result = askConfirm({ message: "ok?" }, site);
    press(ESC);

    await expect(result).rejects.toMatchObject({ name: "ExitPromptError" });
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("goes back to the original prompt when Esc is pressed on the quit confirm, never opening a second confirm", async () => {
    const first = pendingPrompt<string>();
    const quit = pendingPrompt<boolean>();
    const second = pendingPrompt<string>();
    vi.mocked(select)
      .mockReturnValueOnce(first as never)
      .mockReturnValueOnce(second as never);
    vi.mocked(confirm).mockReturnValueOnce(quit as never);

    const result = askSelect({ message: "pick", choices: [] }, site);
    press(ESC);
    await flush();
    press(ESC);
    await flush();
    second.answer("a");

    expect(await result).toBe("a");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(quit.cancelled).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("asks again for a checkbox the same way", async () => {
    const first = pendingPrompt<string[]>();
    const second = pendingPrompt<string[]>();
    vi.mocked(checkbox)
      .mockReturnValueOnce(first as never)
      .mockReturnValueOnce(second as never);
    vi.mocked(confirm).mockResolvedValueOnce(false);

    const result = askCheckbox({ message: "which", choices: [] }, site);
    press(ESC);
    await flush();
    second.answer(["x"]);

    expect(await result).toEqual(["x"]);
    expect(checkbox).toHaveBeenCalledTimes(2);
  });

  it("leaves Ctrl+C as an instant quit in the original prompt, with no confirm", async () => {
    const first = pendingPrompt<string>();
    vi.mocked(input).mockReturnValueOnce(first as never);

    const result = askInput({ message: "name" }, site);
    first.exit();

    await expect(result).rejects.toMatchObject({ name: "ExitPromptError" });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("leaves Ctrl+C as an instant quit in the quit confirm, with no second prompt", async () => {
    const first = pendingPrompt<string>();
    const quit = pendingPrompt<boolean>();
    vi.mocked(input).mockReturnValueOnce(first as never);
    vi.mocked(confirm).mockReturnValueOnce(quit as never);

    const result = askInput({ message: "name" }, site);
    press(ESC);
    await flush();
    quit.exit();

    await expect(result).rejects.toMatchObject({ name: "ExitPromptError" });
    expect(input).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an arrow key", UP],
    ["Alt+Esc", ALT_ESC],
    ["Alt+x", ALT_X],
  ])("does not ask to quit on %s", async (_name, key) => {
    const first = pendingPrompt<string>();
    vi.mocked(input).mockReturnValueOnce(first as never);

    const result = askInput({ message: "name" }, site);
    press(key);
    await flush();
    first.answer("typed");

    expect(await result).toBe("typed");
    expect(first.cancelled).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("removes its listener once the prompt is answered, cancelled by Ctrl+C or fails", async () => {
    const before = process.stdin.listenerCount("keypress");
    const answered = pendingPrompt<string>();
    vi.mocked(input).mockReturnValueOnce(answered as never);
    const first = askInput({ message: "a" }, site);
    expect(process.stdin.listenerCount("keypress")).toBe(before + 1);
    answered.answer("x");
    await first;
    expect(process.stdin.listenerCount("keypress")).toBe(before);

    const exited = pendingPrompt<string>();
    vi.mocked(input).mockReturnValueOnce(exited as never);
    const second = askInput({ message: "b" }, site);
    exited.exit();
    await expect(second).rejects.toMatchObject({ name: "ExitPromptError" });
    expect(process.stdin.listenerCount("keypress")).toBe(before);

    vi.mocked(input).mockImplementationOnce(() => {
      throw new Error("boom");
    });
    await expect(askInput({ message: "c" }, site)).rejects.toThrow("boom");
    expect(process.stdin.listenerCount("keypress")).toBe(before);
  });

  it("leaves no listener after an Esc round trip", async () => {
    const before = process.stdin.listenerCount("keypress");
    const first = pendingPrompt<boolean>();
    vi.mocked(confirm)
      .mockReturnValueOnce(first as never)
      .mockResolvedValueOnce(true);
    const result = askConfirm({ message: "ok?" }, site);
    press(ESC);
    await expect(result).rejects.toMatchObject({ name: "ExitPromptError" });
    expect(process.stdin.listenerCount("keypress")).toBe(before);
  });
});

describe("Esc in a non-interactive run", () => {
  it("never asks and never listens", async () => {
    setNonInteractive(true);
    vi.mocked(confirm).mockReset();
    vi.mocked(input).mockReset();
    const before = process.stdin.listenerCount("keypress");

    expect(
      await askConfirm({ message: "ok?" }, { ...site, fallback: true }),
    ).toBe(true);
    expect(await askInput({ message: "n" }, { ...site, fallback: "v" })).toBe(
      "v",
    );
    expect(process.stdin.listenerCount("keypress")).toBe(before);
    expect(confirm).not.toHaveBeenCalled();
    expect(input).not.toHaveBeenCalled();
  });
});
