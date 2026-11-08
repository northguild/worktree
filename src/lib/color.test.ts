import defaultChalk from "chalk";
import { describe, expect, it } from "vitest";
import { createChalk, isColorDisabled } from "./color.js";

// vitest.config.ts pins FORCE_COLOR=0, so chalk's own level is 0 here and the
// cases that keep colour are told apart by which instance comes back.
describe("createChalk", () => {
  it("styles nothing when NO_COLOR is set", () => {
    const chalk = createChalk({ NO_COLOR: "1" });
    expect(chalk).not.toBe(defaultChalk);
    expect(chalk.level).toBe(0);
    expect(chalk.green("✔")).toBe("✔");
    expect(chalk.bold("Setting up Jira")).toBe("Setting up Jira");
  });

  it("ignores an empty NO_COLOR, as no-color.org says", () => {
    expect(createChalk({ NO_COLOR: "" })).toBe(defaultChalk);
  });

  it("lets an explicit FORCE_COLOR win over NO_COLOR", () => {
    expect(createChalk({ NO_COLOR: "1", FORCE_COLOR: "1" })).toBe(defaultChalk);
  });

  it("leaves chalk alone when NO_COLOR is unset", () => {
    expect(createChalk({})).toBe(defaultChalk);
  });
});

describe("isColorDisabled", () => {
  it.each([
    [{ NO_COLOR: "1" }, true],
    [{ NO_COLOR: "" }, false],
    [{ NO_COLOR: "1", FORCE_COLOR: "1" }, false],
    [{}, false],
  ])("reads %o as %s", (env, expected) => {
    expect(isColorDisabled(env)).toBe(expected);
  });
});
