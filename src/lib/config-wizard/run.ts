import { EOL } from "node:os";
import chalk from "chalk";
import { configureAgentCommand } from "./agent.js";
import { configureDefaultSourceBranch, configurePostCreate } from "./basics.js";
import { configureBranchNames } from "./branch-names.js";
import type { WizardContext } from "./context.js";
import {
  configureCodeEditor,
  configureHerdr,
  configureOpener,
} from "./opening.js";
import {
  configureClickUp,
  configureGithub,
  configureJira,
  configureLinear,
} from "./trackers.js";

/** The wizard's sequence. Each section decides for itself what to ask. */
export async function runWizard(ctx: WizardContext): Promise<void> {
  await configureJira(ctx);
  await configureGithub(ctx);
  await configureLinear(ctx);
  await configureClickUp(ctx);
  await configureDefaultSourceBranch(ctx);
  await configureBranchNames(ctx);
  await configureOpener(ctx);
  await configureCodeEditor(ctx);
  await configureHerdr(ctx);
  await configureAgentCommand(ctx);
  await configurePostCreate(ctx);

  ctx.log(`${chalk.green("✔")} Configuration complete!${EOL}`);
}
