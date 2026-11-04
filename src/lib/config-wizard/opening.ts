import { gitGetConfigValue, gitSetConfigValue } from "../config.js";
import { OPENER_KINDS } from "../constants.js";
import { askConfirm, askSelect } from "../prompt.js";
import type { OpenerKind } from "../types.js";
import { isValidAgentKind, isValidCommand } from "../validators.js";
import {
  askConfigInput,
  confirmGroup,
  shouldPrompt,
  type WizardContext,
} from "./context.js";

export async function configureOpener(ctx: WizardContext): Promise<void> {
  if (
    shouldPrompt(ctx, "opener") &&
    (await confirmGroup(
      ctx,
      "Do you want to choose where new worktrees are opened?",
      "the opener",
    ))
  ) {
    // Select values are compared with `===`, so anything that is not one of
    // the three kinds (unset, empty, a hand-edited oddity) is normalised to
    // "editor" before it becomes the default or the non-interactive fallback.
    const storedOpener = await gitGetConfigValue("opener");
    const openerDefault =
      OPENER_KINDS.find((kind) => kind === storedOpener) ?? "editor";
    const opener = await askSelect<OpenerKind>(
      {
        message: "Which opener should new worktrees use?",
        choices: OPENER_KINDS.map((kind) => ({ name: kind, value: kind })),
        default: openerDefault,
      },
      {
        value: "opener",
        flag: "worktree config opener <editor|herdr|none>",
        fallback: openerDefault,
      },
    );
    await gitSetConfigValue("opener", opener);
  }
}

export async function configureCodeEditor(ctx: WizardContext): Promise<void> {
  if (
    shouldPrompt(ctx, "codeEditor") &&
    (await confirmGroup(
      ctx,
      "Do you want to automatically open the worktree in a code editor?",
      "the code editor",
    ))
  ) {
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

export async function configureHerdr(ctx: WizardContext): Promise<void> {
  const hasHerdrPrompt = ctx.configNames.some((name) =>
    name.startsWith("herdr."),
  );
  if (
    hasHerdrPrompt &&
    (await confirmGroup(
      ctx,
      "Do you want to configure Herdr space options?",
      "Herdr",
    ))
  ) {
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
}
