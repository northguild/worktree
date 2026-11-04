import { askConfigInput, shouldPrompt, type WizardContext } from "./context.js";
import { saveConfigValue } from "./written.js";

export async function configureBranchNames(ctx: WizardContext): Promise<void> {
  if (shouldPrompt(ctx, "branchPrefix.feature")) {
    const featurePrefix = await askConfigInput(
      "branchPrefix.feature",
      {
        message: "Prefix for feature branches",
      },
      "feature/",
    );
    await saveConfigValue("branchPrefix.feature", featurePrefix);
  }

  if (shouldPrompt(ctx, "branchPrefix.bugfix")) {
    const bugfixPrefix = await askConfigInput(
      "branchPrefix.bugfix",
      {
        message: "Prefix for bugfix branches",
      },
      "fix/",
    );
    await saveConfigValue("branchPrefix.bugfix", bugfixPrefix);
  }

  if (shouldPrompt(ctx, "branchPrefix.chore")) {
    const chorePrefix = await askConfigInput(
      "branchPrefix.chore",
      {
        message: "Prefix for chore branches",
      },
      "chore/",
    );
    await saveConfigValue("branchPrefix.chore", chorePrefix);
  }
}
