import * as gitConfig from "../config.js";
import * as prompt from "../prompt.js";
import type { ConfigName } from "../types.js";
import type { WizardContext } from "./context.js";
import { runWizard } from "./run.js";

// Expected values come from plan #236 D7 and phase 5's Done-when: a one-line
// heading before each ticked item that has something to ask, none for an item
// with nothing to ask or one that was not ticked, and a closing line naming
// the keys written in this run by name, never by value, and never a key whose
// stored value did not change. The wording is this phase's own choice: the
// heading is "Setting up <title>" and the closing line "Saved: <keys>", so
// both read without colour.
describe("the wizard's headings and closing summary", () => {
  let stored: Record<string, string>;
  let lines: string[];
  let events: string[];
  let set: ReturnType<typeof vi.spyOn>;

  function context(
    configNames: ConfigName[],
    overrides: Partial<WizardContext> = {},
  ): WizardContext {
    return {
      configNames,
      herdrOffered: false,
      hiddenNames: new Set(),
      log: (message) => {
        lines.push(message);
        events.push(`log:${message}`);
      },
      ...overrides,
    };
  }

  const closing = () => lines[lines.length - 1] ?? "";

  beforeEach(() => {
    stored = {};
    lines = [];
    events = [];
    vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation((name) =>
      Promise.resolve(stored[name] ?? ""),
    );
    set = vi
      .spyOn(gitConfig, "gitSetConfigValue")
      .mockImplementation(async (name, value) => {
        stored[name] = value;
      });
    vi.spyOn(prompt, "askInput").mockImplementation(async (config) => {
      events.push(`ask:${config.message}`);
      return "answer";
    });
    vi.spyOn(prompt, "askSelect").mockResolvedValue("true" as never);
    vi.spyOn(prompt, "askConfirm").mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function tick(...ids: string[]) {
    vi.spyOn(prompt, "askCheckbox").mockResolvedValue(ids as never);
  }

  describe("headings", () => {
    it("prints a heading before the first question of each ticked item", async () => {
      tick("branchPrefixes", "postCreate");

      await runWizard(
        context([
          "branchPrefix.feature",
          "branchPrefix.bugfix",
          "branchPrefix.chore",
          "postCreate",
        ]),
      );

      const at = (text: string) =>
        events.findIndex((event) => event.includes(text));
      expect(at("Setting up branch prefixes")).toBeGreaterThan(-1);
      expect(at("Setting up branch prefixes")).toBeLessThan(
        at("ask:Prefix for feature"),
      );
      expect(at("Setting up the post-create command")).toBeGreaterThan(
        at("Setting up branch prefixes"),
      );
      expect(at("Setting up the post-create command")).toBeLessThan(
        at("ask:Command to run in each new worktree"),
      );
    });

    it("prints a one-line heading made of words, not colour", async () => {
      tick("postCreate");

      await runWizard(context(["postCreate"]));

      const heading = lines.find((line) => line.includes("Setting up"));
      expect(heading).toBeDefined();
      // FORCE_COLOR=0 is pinned in vitest.config.ts: no escape code survives.
      expect(heading).not.toContain("\u001b");
      expect(heading).not.toMatch(/[\r\n]/);
    });

    it("prints no heading for an item with nothing to ask", async () => {
      // postCreate is the only key left, so the Jira item is not listed.
      tick("postCreate");

      await runWizard(context(["postCreate"]));

      expect(lines.join("\n")).not.toContain("Jira");
      expect(lines.join("\n")).toContain("Setting up the post-create command");
    });

    it("prints no heading for an item that was not ticked", async () => {
      tick("postCreate");

      await runWizard(context(["branchPrefix.feature", "postCreate"]));

      expect(lines.join("\n")).not.toContain("branch prefixes");
    });

    it("prints no heading for a run that names its keys", async () => {
      await runWizard(context(["postCreate"], { names: "postCreate" }));

      expect(lines.join("\n")).not.toContain("Setting up");
    });
  });

  describe("the closing summary", () => {
    it("names the keys the run wrote, in the order it wrote them", async () => {
      tick("branchPrefixes", "postCreate");

      await runWizard(
        context([
          "defaultSourceBranch",
          "branchPrefix.feature",
          "branchPrefix.bugfix",
          "branchPrefix.chore",
          "postCreate",
        ]),
      );

      expect(closing()).toContain(
        "Saved: defaultSourceBranch, branchPrefix.feature, branchPrefix.bugfix, branchPrefix.chore, postCreate",
      );
      expect(closing()).not.toMatch(/[\r\n]\S/);
    });

    it("does not name a key whose stored value is unchanged", async () => {
      stored.defaultSourceBranch = "answer";
      tick("postCreate");

      await runWizard(context(["defaultSourceBranch", "postCreate"]));

      // A write of the same value happened, but it changed nothing.
      expect(set).toHaveBeenCalledWith("defaultSourceBranch", "answer");
      expect(closing()).toContain("Saved: postCreate");
      expect(closing()).not.toContain("defaultSourceBranch");
    });

    it("names each key a follow-up question changed", async () => {
      stored.opener = "none";
      tick("opening");
      vi.spyOn(prompt, "askSelect").mockResolvedValue("editor" as never);

      await runWizard(
        context(["opener", "codeEditor"], { herdrOffered: false }),
      );
      // opener: none -> editor is a change; codeEditor "" -> answer too.
      expect(closing()).toContain("Saved: opener, codeEditor");
    });

    it("says nothing was changed when nothing was written", async () => {
      tick();
      stored.defaultSourceBranch = "answer";

      await runWizard(context(["defaultSourceBranch", "postCreate"]));

      expect(closing()).toContain("Nothing changed");
      expect(closing()).not.toContain("Saved");
    });

    it("never contains a value, stored or newly entered", async () => {
      stored["linear.apiKey"] = "lin_STORED_secret";
      stored.postCreate = "pnpm install";
      tick("linear", "postCreate");
      vi.spyOn(prompt, "askInput").mockImplementation(async (config) =>
        config.message === "Linear API key"
          ? "lin_NEWLY_ENTERED_secret"
          : "pnpm run setup-NEW",
      );

      await runWizard(context(["linear.apiKey", "postCreate"]));

      expect(closing()).toContain("Saved: linear.apiKey, postCreate");
      expect(lines.join("\n")).not.toContain("lin_STORED_secret");
      expect(lines.join("\n")).not.toContain("lin_NEWLY_ENTERED_secret");
      expect(lines.join("\n")).not.toContain("setup-NEW");
      expect(lines.join("\n")).not.toContain("pnpm install");
    });

    it("keeps naming no unchanged key when the stored token is re-entered", async () => {
      stored["linear.apiKey"] = "lin_same";
      tick("linear");
      vi.spyOn(prompt, "askInput").mockResolvedValue("lin_same");

      await runWizard(context(["linear.apiKey"]));

      expect(closing()).toContain("Nothing changed");
    });

    it("closes a run that names its keys the same way", async () => {
      await runWizard(context(["postCreate"], { names: "postCreate" }));

      expect(closing()).toContain("Saved: postCreate");
    });
  });
});
