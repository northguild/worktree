import { checkbox, confirm, input, select } from "@inquirer/prompts";
import { setNonInteractive } from "./interaction.js";
import {
  askCheckbox,
  askConfirm,
  askInput,
  askSelect,
  assertCanPrompt,
  InvalidValueError,
  MissingValueError,
} from "./prompt.js";

vi.mock("@inquirer/prompts", () => ({
  checkbox: vi.fn(),
  confirm: vi.fn(),
  input: vi.fn(),
  select: vi.fn(),
  Separator: class Separator {},
}));

const site = { value: "the thing", flag: "--thing" };

describe("prompt seam, interactive", () => {
  it("asks inquirer with exactly the config it was given", async () => {
    vi.mocked(confirm).mockResolvedValue(true);
    vi.mocked(input).mockResolvedValue("typed");

    expect(await askConfirm({ message: "ok?" }, site)).toBe(true);
    expect(await askInput({ message: "name" }, site)).toBe("typed");
    expect(confirm).toHaveBeenCalledWith({ message: "ok?" });
    expect(input).toHaveBeenCalledWith({ message: "name" });
  });

  it("does not throw from assertCanPrompt", () => {
    expect(() => assertCanPrompt(site)).not.toThrow();
  });
});

describe("prompt seam, non-interactive", () => {
  beforeEach(() => {
    setNonInteractive(true);
  });

  it("takes a confirm's fallback without asking", async () => {
    expect(
      await askConfirm({ message: "ok?" }, { ...site, fallback: false }),
    ).toBe(false);
    expect(
      await askConfirm({ message: "ok?" }, { ...site, fallback: true }),
    ).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("fails a confirm with no fallback, naming the value and the flag", async () => {
    await expect(askConfirm({ message: "ok?" }, site)).rejects.toThrow(
      new MissingValueError("the thing", "--thing"),
    );
    await expect(askConfirm({ message: "ok?" }, site)).rejects.toMatchObject({
      message: "no default for the thing; pass --thing",
      oclif: { exit: 2 },
    });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("takes an input's fallback when the validator accepts it", async () => {
    const validate = vi.fn().mockReturnValue(true);

    expect(
      await askInput({ message: "name", validate }, { ...site, fallback: "x" }),
    ).toBe("x");
    expect(validate).toHaveBeenCalledWith("x");
    expect(input).not.toHaveBeenCalled();
  });

  it("fails an input with no fallback, or an empty one the validator rejects", async () => {
    await expect(askInput({ message: "name" }, site)).rejects.toBeInstanceOf(
      MissingValueError,
    );
    await expect(
      askInput(
        { message: "name", validate: () => "Required" },
        { ...site, fallback: "" },
      ),
    ).rejects.toBeInstanceOf(MissingValueError);
    expect(input).not.toHaveBeenCalled();
  });

  it("accepts an empty fallback the validator allows", async () => {
    expect(
      await askInput(
        { message: "name", validate: () => true },
        { ...site, fallback: "" },
      ),
    ).toBe("");
  });

  it("reports the validator's own message for a bad non-empty fallback", async () => {
    await expect(
      askInput(
        { message: "name", validate: () => "Bad name" },
        { ...site, fallback: "x" },
      ),
    ).rejects.toThrow("Bad name");
  });

  // A value problem exits 2, like the missing value beside it — not the exit 1
  // of a plain failure (`worktree config --yes --names codeEditor` with no
  // `code` on PATH is the one that reaches this).
  it("fails a bad non-empty fallback as an invalid value, exit 2", async () => {
    const failing = askInput(
      { message: "name", validate: () => "Bad name" },
      { ...site, fallback: "x" },
    );

    await expect(failing).rejects.toBeInstanceOf(InvalidValueError);
    await expect(failing).rejects.toMatchObject({
      code: "invalid_value",
      oclif: { exit: 2 },
    });
  });

  it("fails a select and a checkbox, which have no default", async () => {
    await expect(
      askSelect({ message: "pick", choices: [{ value: 1 }] }, site),
    ).rejects.toBeInstanceOf(MissingValueError);
    await expect(
      askCheckbox({ message: "pick", choices: [{ value: 1 }] }, site),
    ).rejects.toBeInstanceOf(MissingValueError);
    expect(select).not.toHaveBeenCalled();
    expect(checkbox).not.toHaveBeenCalled();
  });

  it("fails assertCanPrompt", () => {
    expect(() => assertCanPrompt(site)).toThrow(MissingValueError);
  });
});
