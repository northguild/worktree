import { gitSetConfigValue } from "../config.js";
import {
  askConfigInput,
  confirmGroup,
  shouldPrompt,
  type WizardContext,
} from "./context.js";

export async function configureBranchNames(ctx: WizardContext): Promise<void> {
  const hasBranchPrefixPrompt = ctx.configNames.some((name) =>
    name.startsWith("branchPrefix"),
  );
  if (
    hasBranchPrefixPrompt &&
    (await confirmGroup(
      ctx,
      "Do you want to configure branch name prefixes?",
      "branch name prefixes",
    ))
  ) {
    if (shouldPrompt(ctx, "branchPrefix.feature")) {
      const featurePrefix = await askConfigInput(
        "branchPrefix.feature",
        {
          message: "Prefix for feature branches",
        },
        "feature/",
      );
      await gitSetConfigValue("branchPrefix.feature", featurePrefix);
    }

    if (shouldPrompt(ctx, "branchPrefix.bugfix")) {
      const bugfixPrefix = await askConfigInput(
        "branchPrefix.bugfix",
        {
          message: "Prefix for bugfix branches",
        },
        "fix/",
      );
      await gitSetConfigValue("branchPrefix.bugfix", bugfixPrefix);
    }

    if (shouldPrompt(ctx, "branchPrefix.chore")) {
      const chorePrefix = await askConfigInput(
        "branchPrefix.chore",
        {
          message: "Prefix for chore branches",
        },
        "chore/",
      );
      await gitSetConfigValue("branchPrefix.chore", chorePrefix);
    }
  }
}
