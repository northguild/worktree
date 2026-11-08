import { EOL } from "node:os";
import chalk from "chalk";
import { getConfigValue } from "../config.js";
import { askCheckbox } from "../prompt.js";
import { configureAgent, configureAgentCommand } from "./agent.js";
import { configureDefaultSourceBranch, configurePostCreate } from "./basics.js";
import { configureBranchNames } from "./branch-names.js";
import {
  type ChecklistId,
  listChecklistItems,
  preTickedIds,
} from "./checklist.js";
import type { WizardContext } from "./context.js";
import {
  configureCodeEditor,
  configureHerdr,
  configureOpener,
  configureOpening,
  configureRexFocus,
} from "./opening.js";
import {
  configureClickUp,
  configureGithub,
  configureJira,
  configureLinear,
} from "./trackers.js";
import { recordWrittenKeys } from "./written.js";

// What a ticked item asks. Each function asks only the keys in the run's
// prompt list, so an item never asks what `--missing` or a project file removed.
const CONFIGURE: Record<ChecklistId, (ctx: WizardContext) => Promise<void>> = {
  github: configureGithub,
  jira: configureJira,
  linear: configureLinear,
  clickup: configureClickUp,
  opening: configureOpening,
  agent: configureAgent,
  branchPrefixes: configureBranchNames,
  postCreate: configurePostCreate,
};

/**
 * The wizard's sequence. Naming keys with `--names` is asking for them, so a
 * named run asks each named key directly and never shows the checklist. A bare
 * run shows it, then asks `defaultSourceBranch`, then what was ticked, in
 * checklist order. Un-ticking only means "do not ask now": nothing is cleared.
 */
export async function runWizard(ctx: WizardContext): Promise<void> {
  const written = await recordWrittenKeys(
    () => askQuestions(ctx),
    (writtenSoFar, error) => {
      // A quit is Ctrl+C, or Esc then Yes; BaseCommand.catch ends the run
      // quietly on the same name. Any other error is a failure, not reported here.
      if (error instanceof Error && error.name === "ExitPromptError") {
        ctx.log(`Stopped. ${summarize(writtenSoFar)}`);
      }
    },
  );
  ctx.log(
    `${chalk.green("✔")} Configuration complete! ${summarize(written)}${EOL}`,
  );
}

// Names only, never a value: a token must not reach a screen share or a
// pasted bug report. A key put back to what it held is not "written".
function summarize(written: readonly string[]) {
  return written.length > 0
    ? `Saved: ${written.join(", ")}`
    : "Nothing changed.";
}

async function askQuestions(ctx: WizardContext): Promise<void> {
  if (ctx.names) {
    await configureJira(ctx);
    await configureGithub(ctx);
    await configureLinear(ctx);
    await configureClickUp(ctx);
    await configureDefaultSourceBranch(ctx);
    await configureBranchNames(ctx);
    await configureOpener(ctx);
    await configureCodeEditor(ctx);
    await configureHerdr(ctx);
    await configureRexFocus(ctx);
    await configureAgentCommand(ctx);
    await configurePostCreate(ctx);
  } else {
    const items = listChecklistItems(ctx.configNames);
    let ticked: readonly ChecklistId[] = [];
    if (items.length > 0) {
      const preTicked = await preTickedIds(
        items,
        async (name) => (await getConfigValue(name)).value,
      );
      ticked = await askCheckbox<ChecklistId>(
        {
          message:
            "What do you want to set up? (space to tick or untick, enter to continue)",
          choices: items.map((item) => ({
            name: item.label,
            value: item.id,
            checked: preTicked.has(item.id),
          })),
          // The library shows 7 rows and wraps past either end by default,
          // which turns eight items into a list that scrolls without end.
          pageSize: items.length,
          loop: false,
        },
        { value: "what to set up", flag: "--names <keys>" },
      );
    }

    await configureDefaultSourceBranch(ctx);
    for (const item of items) {
      if (ticked.includes(item.id)) {
        // Words, not colour: the bold is lost under NO_COLOR and the heading
        // still reads. A listed item has a key left to ask (checklist.ts).
        ctx.log(chalk.bold(`Setting up ${item.title}`));
        await CONFIGURE[item.id](ctx);
      }
    }
  }
}
