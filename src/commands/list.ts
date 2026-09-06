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
  ];

  static override flags = {
    agents: Flags.boolean({
      char: "a",
      description: "Show the agent session living in each worktree",
    }),
  };

  public async run(): Promise<void> {
    const { flags } = await this.parse(List);
    const spinner = ora("Gathering worktree list").start();
    // The flag reaches both halves: it decides whether the session lookup
    // happens at all, and whether the result is rendered. Without it this
    // command costs exactly what it did before. See AGENT-MODE-PLAN §3 D8.
    const worktrees = await gitGetWorktreeList({
      includeCurrent: true,
      includeAgents: flags.agents,
    });
    spinner.stop();

    worktrees.forEach((wt) => {
      this.log(
        `- ${worktreeListEntryToListName(wt, "gray", { agents: flags.agents })}`,
      );
    });
  }
}
