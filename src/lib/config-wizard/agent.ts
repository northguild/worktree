import { gitSetConfigValue } from "../config.js";
import { isValidCommandLine } from "../validators.js";
import { askConfigInput, shouldPrompt, type WizardContext } from "./context.js";

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
    await gitSetConfigValue("agent.command", agentCommand);
  }
}
