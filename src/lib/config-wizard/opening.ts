import { gitGetConfigValue, gitSetConfigValue } from "../config.js";
import { OPENER_KINDS } from "../constants.js";
import { askConfirm, askSelect } from "../prompt.js";
import type { OpenerKind } from "../types.js";
import { isValidAgentKind, isValidCommand } from "../validators.js";
import { askConfigInput, shouldPrompt, type WizardContext } from "./context.js";

/**
 * The opener the wizard works from: a stored value that is one of the three
 * kinds, else "editor". Select values are compared with `===`, so anything
 * else (unset, empty, a hand-edited oddity) is normalised before it becomes
 * the default, the non-interactive fallback or the follow-ups' deciding value.
 */
export async function getStoredOpener(): Promise<OpenerKind> {
  const storedOpener = await gitGetConfigValue("opener");
  return OPENER_KINDS.find((kind) => kind === storedOpener) ?? "editor";
}

/**
 * Asks `opener` when this run is to, and returns the answer; undefined when
 * the key is not in the run's prompt list. `herdr` is a choice only where
 * Herdr is in use (`ctx.herdrOffered`, plan #236 D3); a `--names` run offers
 * all three.
 */
export async function configureOpener(
  ctx: WizardContext,
): Promise<OpenerKind | undefined> {
  if (!shouldPrompt(ctx, "opener")) {
    return undefined;
  }
  const stored = await getStoredOpener();
  const kinds = OPENER_KINDS.filter(
    (kind) => kind !== "herdr" || ctx.herdrOffered,
  );
  // A stored `herdr` makes Herdr offered, so the default is always a choice.
  const openerDefault = kinds.find((kind) => kind === stored) ?? "editor";
  const opener = await askSelect<OpenerKind>(
    {
      message: "Which opener should new worktrees use?",
      choices: kinds.map((kind) => ({ name: kind, value: kind })),
      default: openerDefault,
    },
    {
      value: "opener",
      flag: "worktree config opener <editor|herdr|none>",
      fallback: openerDefault,
    },
  );
  await gitSetConfigValue("opener", opener);
  return opener;
}

/**
 * The bare run's "How worktrees open" item: `opener` decides what follows.
 * `editor` asks `codeEditor`, `herdr` asks `herdr.focus` (`herdr.agent` is the
 * agent item's), `none` asks
 * nothing. Where `opener` is not asked (`--missing` found it set) the stored
 * one decides.
 */
export async function configureOpening(ctx: WizardContext): Promise<void> {
  const opener = (await configureOpener(ctx)) ?? (await getStoredOpener());
  if (opener === "editor") {
    await configureCodeEditor(ctx);
  } else if (opener === "herdr") {
    // Choosing Herdr is the opt-in, so its keys are asked even where the
    // hiding rule has taken them out of the prompt list because the binary is
    // missing. Keys `--missing` or a project file removed stay removed.
    await configureHerdrFocus({
      ...ctx,
      configNames: [...ctx.configNames, ...ctx.hiddenNames],
    });
  }
}

export async function configureCodeEditor(ctx: WizardContext): Promise<void> {
  if (shouldPrompt(ctx, "codeEditor")) {
    const codeEditor = await askConfigInput(
      "codeEditor",
      {
        message: "Command to open code editor?",
        validate: isValidCommand,
      },
      "code",
    );
    await gitSetConfigValue("codeEditor", codeEditor);
  }
}

/**
 * Both Herdr keys, as `--names` asks them. The bare run asks only
 * `herdr.focus` here; `herdr.agent` belongs to its "Coding agent" item.
 */
export async function configureHerdr(ctx: WizardContext): Promise<void> {
  await configureHerdrFocus(ctx);
  await configureHerdrAgentKind(ctx);
}

export async function configureHerdrFocus(ctx: WizardContext): Promise<void> {
  if (shouldPrompt(ctx, "herdr.focus")) {
    // Only an explicit "false" means no: unset or empty is the documented
    // default of true. A non-interactive run takes that same answer.
    const focusDefault = (await gitGetConfigValue("herdr.focus")) !== "false";
    const herdrFocus = await askConfirm(
      {
        message: "Should opening a worktree focus its Herdr space?",
        default: focusDefault,
      },
      {
        value: "herdr.focus",
        flag: "worktree config herdr.focus <true|false>",
        fallback: focusDefault,
      },
    );
    await gitSetConfigValue("herdr.focus", String(herdrFocus));
  }
}

export async function configureHerdrAgentKind(
  ctx: WizardContext,
): Promise<void> {
  if (shouldPrompt(ctx, "herdr.agent")) {
    const herdrAgent = await askConfigInput("herdr.agent", {
      message:
        "Which agent kind should start in every new Herdr space? (empty: none, or with `--agent` the program `agent.command` names)",
      // Empty is not a valid kind, but it is a valid answer: the key is
      // opt-in (D9), so this prompt has to be the way to decline as well as
      // the way to choose, or a `--missing` run would force an agent on
      // someone who does not want one.
      validate: (value: string) =>
        value.trim() === "" || isValidAgentKind(value.trim()),
    });
    await gitSetConfigValue("herdr.agent", herdrAgent.trim());
  }
}
