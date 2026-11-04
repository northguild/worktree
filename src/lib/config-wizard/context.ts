import { resolveJiraDeployment } from "../../integrations/jira.js";
import { gitGetConfigValue } from "../config.js";
import { askConfirm, askInput, InvalidValueError } from "../prompt.js";
import type { ConfigName } from "../types.js";

/**
 * What every wizard section shares: the keys this run is to ask, whether they
 * were named with `--names`, and where to print. `configNames` is already
 * filtered (project-file keys, hidden Herdr keys, Data Center's email), so a
 * section only asks `shouldPrompt`.
 */
export type WizardContext = {
  readonly configNames: readonly ConfigName[];
  readonly names?: string;
  readonly log: (message: string) => void;
};

export function shouldPrompt(ctx: WizardContext, name: ConfigName) {
  return ctx.configNames.includes(name);
}

/**
 * The group question. Naming keys with `--names` is asking for them (R4), so
 * it is answered yes without asking, in both modes. A bare run walks every
 * key, so it asks, and a non-interactive one has no default.
 */
export function confirmGroup(
  ctx: WizardContext,
  message: string,
  group: string,
) {
  if (ctx.names) {
    return true;
  }
  return askConfirm(
    { message },
    {
      value: `whether to configure ${group}`,
      flag: "--names <keys>",
    },
  );
}

/**
 * Whether the wizard is configuring a Data Center site (#126 D2). A hand-edited
 * value that is neither deployment is not the wizard's to reject: it asks the
 * Cloud questions, and the Jira calls that read the key refuse it by name.
 */
export async function isJiraDataCenter() {
  try {
    return (await resolveJiraDeployment()) === "datacenter";
  } catch (error) {
    if (error instanceof InvalidValueError) {
      return false;
    }
    throw error;
  }
}

export async function getInputConfig(name: ConfigName, fallback: string = "") {
  const value = await gitGetConfigValue(name);
  return {
    default: value || fallback,
    prefill: value ? "editable" : "tab",
  } as const;
}

/**
 * One config question. A non-interactive run takes what the prompt would have
 * offered as its default, and fails naming `worktree config <name> <value>`
 * where that is empty and the validator rejects empty. Keys that hold a
 * secret are asked with `askInput` directly, because an empty default there
 * would write an empty token.
 */
export async function askConfigInput(
  name: ConfigName,
  config: Parameters<typeof askInput>[0],
  defaultValue?: string,
) {
  const offered = await getInputConfig(name, defaultValue);
  return askInput(
    { ...config, ...offered },
    {
      value: name,
      flag: `worktree config ${name} <value>`,
      fallback: offered.default,
    },
  );
}
