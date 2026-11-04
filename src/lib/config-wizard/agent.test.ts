import * as gitConfig from "../config.js";
import * as prompt from "../prompt.js";
import type { ConfigName } from "../types.js";
import * as validators from "../validators.js";
import { configureAgent } from "./agent.js";
import type { WizardContext } from "./context.js";

// Expected values come from plan #236 D4 and phase 4's Done-when: one
// agent.command question (empty is accepted), then, only when `opener` is
// `herdr` and a command exists, a yes/no that sets herdr.agent to the
// command's first word only if it is empty (yes), keeps a set one (yes), or
// writes empty (no).
const CONFIRM_MESSAGE =
  "Start it in every new Herdr space, even without `--agent`?";

function context(overrides: Partial<WizardContext> = {}): WizardContext {
  return {
    configNames: ["agent.command", "herdr.agent"],
    herdrOffered: true,
    hiddenNames: new Set(),
    log: () => {},
    ...overrides,
  };
}

describe("the Coding agent item", () => {
  let stored: Record<string, string>;
  let set: ReturnType<typeof vi.spyOn>;
  let askInput: ReturnType<typeof vi.spyOn>;
  let askConfirm: ReturnType<typeof vi.spyOn>;

  const writes = () =>
    set.mock.calls.map((call: unknown[]) => [call[0], call[1]]);

  beforeEach(() => {
    stored = {};
    vi.spyOn(gitConfig, "gitGetConfigValue").mockImplementation((name) =>
      Promise.resolve(stored[name] ?? ""),
    );
    set = vi.spyOn(gitConfig, "gitSetConfigValue").mockResolvedValue();
    askInput = vi.spyOn(prompt, "askInput").mockResolvedValue("mytool --bg");
    askConfirm = vi.spyOn(prompt, "askConfirm").mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("asks one command question and no confirm when opener is not herdr", async () => {
    stored.opener = "editor";

    await configureAgent(context());

    expect(askInput).toHaveBeenCalledTimes(1);
    expect(askInput.mock.calls[0]?.[0].message).toBe(
      "Which coding agent do you use?",
    );
    expect(askConfirm).not.toHaveBeenCalled();
    expect(writes()).toEqual([["agent.command", "mytool --bg"]]);
  });

  it("prefills the stored command", async () => {
    stored["agent.command"] = "mytool -q";

    await configureAgent(context());

    expect(askInput.mock.calls[0]?.[0]).toMatchObject({
      default: "mytool -q",
      prefill: "editable",
    });
  });

  it("stores the first word on yes when herdr.agent is empty", async () => {
    stored.opener = "herdr";

    await configureAgent(context());

    expect(askConfirm.mock.calls[0]?.[0].message).toBe(CONFIRM_MESSAGE);
    expect(writes()).toEqual([
      ["agent.command", "mytool --bg"],
      ["herdr.agent", "mytool"],
    ]);
  });

  it("keeps a set herdr.agent on yes", async () => {
    stored.opener = "herdr";
    stored["herdr.agent"] = "other";

    await configureAgent(context());

    expect(askConfirm).toHaveBeenCalledTimes(1);
    expect(writes()).toEqual([["agent.command", "mytool --bg"]]);
  });

  it("writes herdr.agent empty on no", async () => {
    stored.opener = "herdr";
    stored["herdr.agent"] = "other";
    askConfirm.mockResolvedValue(false);

    await configureAgent(context());

    expect(writes()).toEqual([
      ["agent.command", "mytool --bg"],
      ["herdr.agent", ""],
    ]);
  });

  it("asks the confirm for a stored herdr opener the run did not ask, using the stored command", async () => {
    stored.opener = "herdr";
    stored["agent.command"] = "mytool --bg";

    await configureAgent(context({ configNames: ["herdr.agent"] }));

    expect(askInput).not.toHaveBeenCalled();
    expect(askConfirm).toHaveBeenCalledTimes(1);
    expect(writes()).toEqual([["herdr.agent", "mytool"]]);
  });

  it("asks the confirm where the hiding rule removed herdr.agent but herdr is the opener", async () => {
    stored.opener = "herdr";

    await configureAgent(
      context({
        configNames: ["agent.command"],
        hiddenNames: new Set<ConfigName>(["herdr.agent"]),
      }),
    );

    expect(askConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not ask the confirm for a herdr.agent that --missing removed", async () => {
    stored.opener = "herdr";

    await configureAgent(context({ configNames: ["agent.command"] }));

    expect(askConfirm).not.toHaveBeenCalled();
  });

  // isValidAgentKind's contract is /^[a-z][a-z0-9-]*$/: a path head or a word
  // with uppercase is not a kind, so nothing is derived from it.
  it("stores a valid bare first word on yes", async () => {
    stored.opener = "herdr";
    askInput.mockResolvedValue("my-tool2 --bg");

    await configureAgent(context());

    expect(writes()).toEqual([
      ["agent.command", "my-tool2 --bg"],
      ["herdr.agent", "my-tool2"],
    ]);
  });

  it("asks no confirm, writes no herdr.agent and prints a hint for a path head", async () => {
    stored.opener = "herdr";
    askInput.mockResolvedValue("/usr/local/bin/foo --bg");
    const log = vi.fn();

    await configureAgent(context({ log }));

    expect(askConfirm).not.toHaveBeenCalled();
    expect(writes()).toEqual([["agent.command", "/usr/local/bin/foo --bg"]]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toContain(
      "worktree config herdr.agent <kind>",
    );
    expect(log.mock.calls[0]?.[0]).not.toContain("/usr/local/bin/foo");
  });

  it("treats a quoted program path with a space as one word that is not a kind", async () => {
    stored.opener = "herdr";
    askInput.mockResolvedValue('"/opt/my tool/run" --bg');
    const log = vi.fn();

    await configureAgent(context({ log }));

    expect(askConfirm).not.toHaveBeenCalled();
    expect(writes()).toEqual([["agent.command", '"/opt/my tool/run" --bg']]);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("still asks the confirm, and keeps the stored kind on yes, when the derived word is not a kind", async () => {
    stored.opener = "herdr";
    stored["herdr.agent"] = "other";
    askInput.mockResolvedValue("/usr/local/bin/foo --bg");
    const log = vi.fn();

    await configureAgent(context({ log }));

    expect(askConfirm).toHaveBeenCalledTimes(1);
    expect(writes()).toEqual([["agent.command", "/usr/local/bin/foo --bg"]]);
    expect(log).not.toHaveBeenCalled();
  });

  it("writes nothing for an empty answer with nothing stored, and asks no confirm", async () => {
    stored.opener = "herdr";
    askInput.mockResolvedValue("");

    await configureAgent(context());

    expect(writes()).toEqual([]);
    expect(askConfirm).not.toHaveBeenCalled();
  });

  it("clears a stored command on an empty answer, and asks no confirm", async () => {
    stored.opener = "herdr";
    stored["agent.command"] = "mytool";
    askInput.mockResolvedValue("");

    await configureAgent(context());

    expect(writes()).toEqual([["agent.command", ""]]);
    expect(askConfirm).not.toHaveBeenCalled();
  });

  it("accepts an empty answer but still validates a non-empty one", async () => {
    vi.spyOn(validators, "isValidCommandLine").mockResolvedValue(
      "Command not found: nope",
    );

    await configureAgent(context());

    const validate = askInput.mock.calls[0]?.[0].validate as (
      value: string,
    ) => Promise<true | string> | true;
    expect(await validate("")).toBe(true);
    expect(await validate("nope")).toBe("Command not found: nope");
  });
});
