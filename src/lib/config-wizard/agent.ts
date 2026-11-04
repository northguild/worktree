import { gitGetConfigValue } from "../config.js";
import { showVisibly } from "../project-config.js";
import { askConfirm } from "../prompt.js";
import { splitCommandValue } from "../utils.js";
import { isValidAgentKind, isValidCommandLine } from "../validators.js";
import { askConfigInput, shouldPrompt, type WizardContext } from "./context.js";
import { getStoredOpener } from "./opening.js";
import { saveConfigValue } from "./written.js";

/**
 * The `agent.command` question as `--names agent.command` asks it. Empty is
 * not accepted here: it is how a script or `verifyConfig` learns the key is
 * unset, and the bare run's own question is `configureAgent`.
 */
export async function configureAgentCommand(ctx: WizardContext): Promise<void> {
  if (shouldPrompt(ctx, "agent.command")) {
    // No fallback default: the agent runtime is deliberately not named here.
    // Suggesting one would make this tool depend on a particular CLI, which
    // AGENT-MODE-PLAN §2 rules out.
    const agentCommand = await askConfigInput("agent.command", {
      message:
        "Command that `--agent` runs to start the coding agent (for example `claude --bg`)",
      validate: isValidCommandLine,
    });
    await saveConfigValue("agent.command", agentCommand);
  }
}

/**
 * The bare run's "Coding agent" item (plan #236, D4): one question for
 * `agent.command`, prefilled, where empty means no agent; then, only when
 * `opener` is `herdr`, one yes/no that decides `herdr.agent` — whether to
 * start the command's agent in every new space, or, with no command and a
 * stored kind, whether to keep starting that kind. Run after "How worktrees
 * open", so a stored `opener` is the one chosen in this run.
 */
export async function configureAgent(ctx: WizardContext): Promise<void> {
  let command = await gitGetConfigValue("agent.command");
  if (shouldPrompt(ctx, "agent.command")) {
    // No default and no suggestion: the runtime is deliberately not named
    // (AGENT-MODE-PLAN §2). The validator stays on, as `agent.command` is run
    // in every new worktree; only the empty answer is let through.
    const answer = (
      await askConfigInput("agent.command", {
        message: "Which coding agent do you use?",
        validate: (value: string) =>
          value.trim() === "" || isValidCommandLine(value),
      })
    ).trim();
    // Nothing stored and nothing given: nothing to write.
    if (answer !== "" || command !== "") {
      await saveConfigValue("agent.command", answer);
    }
    command = answer;
  }

  // The hiding rule keeps the Herdr keys out of the prompt list where Herdr
  // is not in use; `opener` being `herdr` is the opt-in, as in configureOpening.
  const herdrAgentAsked =
    shouldPrompt(ctx, "herdr.agent") || ctx.hiddenNames.has("herdr.agent");
  if (!herdrAgentAsked || (await getStoredOpener()) !== "herdr") {
    return;
  }

  const stored = (await gitGetConfigValue("herdr.agent")).trim();
  if (command === "") {
    // Without a brief `herdr.agent` alone decides (readHerdrAgentKind in
    // base-command.ts), so a stored kind still starts in every new space after
    // "no agent". Nothing stored is nothing to ask about. Yes keeps it, as D9's
    // default does where a kind is already chosen; the question names it.
    if (stored === "") {
      return;
    }
    const keep = await askConfirm(
      {
        message: `Keep starting \`${showVisibly(stored)}\` in every new Herdr space?`,
        default: true,
      },
      {
        value: "herdr.agent",
        flag: "worktree config herdr.agent <kind>",
        fallback: true,
      },
    );
    if (!keep) {
      await saveConfigValue("herdr.agent", "");
    }
    return;
  }

  // The first word, as the session listing takes it (src/lib/agent.ts). It is
  // stored only if it is a valid kind, as `worktree config herdr.agent` holds it.
  const derived = splitCommandValue(command)[0] ?? "";
  if (stored === "" && isValidAgentKind(derived) !== true) {
    ctx.log(
      "The command's first word is not a valid agent kind, so `herdr.agent` was left empty. Choose one with `worktree config herdr.agent <kind>`.",
    );
    return;
  }
  // Opt-in (D9): the default is yes only where a kind is already chosen.
  const startInSpace = await askConfirm(
    {
      message: "Start it in every new Herdr space, even without `--agent`?",
      default: stored !== "",
    },
    {
      value: "herdr.agent",
      flag: "worktree config herdr.agent <kind>",
      fallback: stored !== "",
    },
  );
  if (!startInSpace) {
    await saveConfigValue("herdr.agent", "");
  } else if (stored === "") {
    await saveConfigValue("herdr.agent", derived);
  }
}
