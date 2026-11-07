import * as gitConfig from "../config.js";
import { HERDR_CONFIG_NAMES, REX_CONFIG_NAMES } from "../constants.js";
import * as prompt from "../prompt.js";
import type { ConfigName } from "../types.js";
import type { WizardContext } from "./context.js";
import { configureOpener, configureOpening } from "./opening.js";

// Expected values come from plan #236 D3 and phase 3's Done-when: `editor`
// asks codeEditor, `herdr` asks herdr.focus only (herdr.agent is the Coding agent item's, D4),
// `none` asks nothing; `herdr` is a choice only where `herdrOffered`.
const OPENING_KEYS: ConfigName[] = [
  "opener",
  "codeEditor",
  "herdr.focus",
  "herdr.agent",
  "rex.focus",
];

function context(overrides: Partial<WizardContext> = {}): WizardContext {
  return {
    configNames: OPENING_KEYS,
    herdrOffered: true,
    rexOffered: false,
    hiddenNames: new Set(),
    log: () => {},
    ...overrides,
  };
}

describe("the opener decides its follow-ups", () => {
  let stored: Record<string, string>;
  let set: ReturnType<typeof vi.spyOn>;
  let askSelect: ReturnType<typeof vi.spyOn>;
  let askInput: ReturnType<typeof vi.spyOn>;
  let askConfirm: ReturnType<typeof vi.spyOn>;

  function answerOpener(kind: string) {
    askSelect.mockResolvedValue(kind);
  }
  const written = () => set.mock.calls.map((call: unknown[]) => call[0]);

  beforeEach(() => {
    stored = {};
    vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation((name) =>
      Promise.resolve(stored[name] ?? ""),
    );
    set = vi.spyOn(gitConfig, "gitSetConfigValue").mockResolvedValue();
    askSelect = vi.spyOn(prompt, "askSelect");
    askInput = vi.spyOn(prompt, "askInput").mockResolvedValue("value");
    askConfirm = vi.spyOn(prompt, "askConfirm").mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("configureOpening", () => {
    it("asks codeEditor and no Herdr key for editor", async () => {
      answerOpener("editor");

      await configureOpening(context());

      expect(written()).toEqual(["opener", "codeEditor"]);
      expect(askConfirm).not.toHaveBeenCalled();
    });

    it("asks herdr.focus and not codeEditor or herdr.agent for herdr", async () => {
      answerOpener("herdr");

      await configureOpening(context());

      expect(written()).toEqual(["opener", "herdr.focus"]);
    });

    it("asks nothing after none", async () => {
      answerOpener("none");

      await configureOpening(context());

      expect(written()).toEqual(["opener"]);
      expect(askInput).not.toHaveBeenCalled();
      expect(askConfirm).not.toHaveBeenCalled();
    });

    it("asks the Herdr keys the hiding rule removed once herdr is chosen", async () => {
      // Binary missing, so the hiding rule took herdr.focus out of the list;
      // choosing herdr is the opt-in that asks it anyway (D3).
      answerOpener("herdr");

      await configureOpening(
        context({
          configNames: ["opener", "codeEditor"],
          hiddenNames: new Set<ConfigName>(["herdr.focus"]),
        }),
      );

      expect(written()).toEqual(["opener", "herdr.focus"]);
    });

    it("does not ask herdr.focus when --missing removed it", async () => {
      answerOpener("herdr");

      await configureOpening(
        context({ configNames: ["opener", "herdr.agent"] }),
      );

      expect(written()).toEqual(["opener"]);
    });

    it("lets the stored opener decide when opener itself is not asked", async () => {
      stored.opener = "none";

      await configureOpening(
        context({ configNames: ["codeEditor", "herdr.focus"] }),
      );

      expect(askSelect).not.toHaveBeenCalled();
      expect(written()).toEqual([]);
    });

    it("treats a hand-edited opener as editor when it is not asked", async () => {
      stored.opener = "vim";

      await configureOpening(context({ configNames: ["codeEditor"] }));

      expect(written()).toEqual(["codeEditor"]);
    });
  });

  describe("the rex opener", () => {
    it("asks rex.focus and not codeEditor or a Herdr key for rex", async () => {
      answerOpener("rex");

      await configureOpening(context({ rexOffered: true }));

      expect(written()).toEqual(["opener", "rex.focus"]);
      expect(askConfirm.mock.calls[0]?.[0]).toMatchObject({
        message: "Should opening a worktree focus its Rex session?",
        default: true,
      });
    });

    it("asks rex.focus once rex is chosen even where the hiding rule removed it", async () => {
      answerOpener("rex");

      await configureOpening(
        context({
          rexOffered: true,
          configNames: ["opener"],
          hiddenNames: new Set<ConfigName>(["rex.focus"]),
        }),
      );

      expect(written()).toEqual(["opener", "rex.focus"]);
    });

    it("defaults rex.focus to the stored false", async () => {
      stored["rex.focus"] = "false";
      answerOpener("rex");

      await configureOpening(context({ rexOffered: true }));

      expect(askConfirm.mock.calls[0]?.[0]).toMatchObject({ default: false });
    });
  });

  describe("the auto opener", () => {
    // D10: choosing auto asks codeEditor (the fallback needs it) and
    // herdr.focus / rex.focus for each tool that is offered.
    it("asks codeEditor and the focus key of each offered tool", async () => {
      answerOpener("auto");

      await configureOpening(
        context({
          rexOffered: true,
          configNames: [...OPENING_KEYS, "rex.focus"],
        }),
      );

      expect(written()).toEqual([
        "opener",
        "codeEditor",
        "herdr.focus",
        "rex.focus",
      ]);
    });

    it("asks no key for a tool that is not offered", async () => {
      answerOpener("auto");

      await configureOpening(
        context({ herdrOffered: false, rexOffered: true }),
      );

      expect(written()).toEqual(["opener", "codeEditor", "rex.focus"]);
    });

    it("keeps codeEditor and every key listed when opener is stored and not asked", async () => {
      stored.opener = "auto";

      await configureOpening(
        context({
          rexOffered: true,
          configNames: ["codeEditor", "herdr.focus", "rex.focus"],
        }),
      );

      expect(askSelect).not.toHaveBeenCalled();
      expect(written()).toEqual(["codeEditor", "herdr.focus", "rex.focus"]);
    });
  });

  describe("the opener's choices", () => {
    const choices = () =>
      (
        askSelect.mock.calls[0]?.[0] as { choices: { value: string }[] }
      ).choices.map((c) => c.value);

    it("offers editor, herdr, auto and none where Herdr is offered", async () => {
      answerOpener("editor");

      await configureOpener(context());

      expect(choices()).toEqual(["editor", "herdr", "auto", "none"]);
    });

    it("offers rex only where the Rex CLI is found", async () => {
      answerOpener("editor");

      await configureOpener(context({ rexOffered: true }));

      expect(choices()).toEqual(["editor", "herdr", "rex", "auto", "none"]);
    });

    it("offers auto with only Rex offered (D10: at least one of the two)", async () => {
      answerOpener("editor");

      await configureOpener(context({ herdrOffered: false, rexOffered: true }));

      expect(choices()).toEqual(["editor", "rex", "auto", "none"]);
    });

    it("offers editor and none only, no auto, where neither tool is offered", async () => {
      answerOpener("editor");

      await configureOpener(context({ herdrOffered: false }));

      expect(choices()).toEqual(["editor", "none"]);
    });

    it("never defaults to auto when nothing is stored (D10: the default is the stored value, else editor)", async () => {
      answerOpener("editor");

      await configureOpener(context({ rexOffered: true }));

      expect(askSelect.mock.calls[0]?.[0]).toMatchObject({ default: "editor" });
    });

    it("defaults to a stored auto when it is offered", async () => {
      stored.opener = "auto";
      answerOpener("auto");

      await configureOpener(context());

      expect(askSelect.mock.calls[0]?.[0]).toMatchObject({ default: "auto" });
    });

    it("keeps a stored auto offered, and the default, when neither tool is offered (D10: the default stays the stored value)", async () => {
      stored.opener = "auto";
      answerOpener("auto");

      await configureOpener(context({ herdrOffered: false }));

      expect(choices()).toEqual(["editor", "auto", "none"]);
      expect(askSelect.mock.calls[0]?.[0]).toMatchObject({ default: "auto" });
    });

    it("defaults to the stored opener when that is a choice", async () => {
      stored.opener = "none";
      answerOpener("none");

      await configureOpener(context({ herdrOffered: false }));

      expect(askSelect.mock.calls[0]?.[0]).toMatchObject({ default: "none" });
    });

    it("defaults to editor when the stored opener is not offered", async () => {
      stored.opener = "herdr";
      answerOpener("editor");

      await configureOpener(context({ herdrOffered: false }));

      expect(askSelect.mock.calls[0]?.[0]).toMatchObject({ default: "editor" });
    });

    it("returns undefined and asks nothing when opener is not in the prompt list", async () => {
      expect(await configureOpener(context({ configNames: [] }))).toBe(
        undefined,
      );
      expect(askSelect).not.toHaveBeenCalled();
    });
  });

  it("names the one Rex key the hiding rule governs", () => {
    expect([...REX_CONFIG_NAMES]).toEqual(["rex.focus"]);
  });

  it("names the same Herdr keys the hiding rule governs", () => {
    // The composer's follow-ups for herdr are the keys HERDR_CONFIG_NAMES lists.
    expect([...HERDR_CONFIG_NAMES].sort()).toEqual([
      "herdr.agent",
      "herdr.focus",
    ]);
  });
});
