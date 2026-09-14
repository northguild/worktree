import { Flags } from "@oclif/core";
import ora from "ora";
import { BaseCommand } from "../lib/base-command.js";
import { gitGetWorktreeList } from "../lib/git.js";
import { worktreeListEntryToListName } from "../lib/utils.js";

export default class List extends BaseCommand {
  static override description = "List worktree branches";
  static override examples = [
    "<%= config.bin %> <%= command.id %>",
    "<%= config.bin %> <%= command.id %> --agents",
    "<%= config.bin %> <%= command.id %> --churn",
  ];

  static override flags = {
    agents: Flags.boolean({
      char: "a",
      description: "Show the agent session living in each worktree",
    }),
    churn: Flags.boolean({
      char: "c",
      description:
        "Show how much each worktree has changed against its source branch (files/insertions/deletions)",
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(List);
    const spinner = ora("Gathering worktree list").start();
    // Both flags reach both halves: each decides whether its own lookup
    // happens at all, and whether the result is rendered. Without either this
    // command costs exactly what it did before. See AGENT-MODE-PLAN §3 D8 and
    // R4, and GitHub issue #39 for churn specifically.
    const worktrees = await gitGetWorktreeList({
      includeCurrent: true,
      includeAgents: flags.agents,
      includeChurn: flags.churn,
    });
    spinner.stop();

    worktrees.forEach((wt) => {
      this.log(
        `- ${worktreeListEntryToListName(wt, "gray", { agents: flags.agents, churn: flags.churn })}`,
      );
    });
  }
}
