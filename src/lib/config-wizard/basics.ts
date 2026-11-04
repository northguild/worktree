import { isValidBranch, isValidCommandLine } from "../validators.js";
import { askConfigInput, shouldPrompt, type WizardContext } from "./context.js";
import { saveConfigValue } from "./written.js";

export async function configureDefaultSourceBranch(
  ctx: WizardContext,
): Promise<void> {
  if (shouldPrompt(ctx, "defaultSourceBranch")) {
    const defaultBranchName = await askConfigInput(
      "defaultSourceBranch",
      {
        message: "Which branch should new worktrees be based on?",
        validate: isValidBranch,
      },
      "origin/main",
    );
    await saveConfigValue("defaultSourceBranch", defaultBranchName);
  }
}

export async function configurePostCreate(ctx: WizardContext): Promise<void> {
  if (shouldPrompt(ctx, "postCreate")) {
    const postCreate = await askConfigInput("postCreate", {
      message:
        "Command to run in each new worktree, for example `pnpm install` (empty to infer one from the lockfile)",
      // Empty is a valid answer, as it is for `herdr.agent`: `branch` infers
      // the command from the lockfile, so this prompt has to be the way to
      // decline a fixed one as well as to set one.
      validate: async (value: string) =>
        value.trim() === "" || (await isValidCommandLine(value.trim())),
    });
    await saveConfigValue("postCreate", postCreate.trim());
  }
}
