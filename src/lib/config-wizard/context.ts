import { resolveJiraDeployment } from "../../integrations/jira.js";
import { getConfigValue } from "../config.js";
import { askInput, InvalidValueError } from "../prompt.js";
import type { ConfigName } from "../types.js";

/**
 * What every wizard section shares: the keys this run is to ask, whether they
 * were named with `--names`, and where to print. `configNames` is already
 * filtered (project-file keys, hidden Herdr and Rex keys, Data Center's email), so a
 * section only asks `shouldPrompt`.
 */
export type WizardContext = {
  readonly configNames: readonly ConfigName[];
  readonly names?: string;
  /**
   * Whether `herdr` is among the opener's choices: the Herdr-key hiding rule
   * would show a Herdr key (plan #236 D3). A `--names` run is always true.
   */
  readonly herdrOffered: boolean;
  /** The same for `rex`: the Rex-key hiding rule would show `rex.focus`. */
  readonly rexOffered: boolean;
  /** The Herdr and Rex keys those rules keep out of `configNames`; empty for `--names`. */
  readonly hiddenNames: ReadonlySet<ConfigName>;
  readonly log: (message: string) => void;
};

export function shouldPrompt(ctx: WizardContext, name: ConfigName) {
  return ctx.configNames.includes(name);
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
  // The resolved value (git, project file, user file): a key held only by the
  // user file must prefill, or Enter would store "" over it (#281 D11).
  const { value } = await getConfigValue(name);
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
