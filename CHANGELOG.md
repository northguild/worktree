# @northguild/worktree

## 3.0.0

### Major Changes

- 8ba08a6: Node 20 is no longer supported: `worktree` now needs Node.js `^22.13.0` or `>=23.5.0`. The CLI moves to oclif 5, so `npm i -g @northguild/worktree` no longer warns that `http-call@5.3.0` is deprecated.

**Upgrading from 2.x.** Beyond Node, three changes reach a setup that worked on 2.1.2:

- `worktree branch --jira` run non-interactively (`--json`, CI, an agent) now assigns the issue to the token's owner and moves it to its in-progress status. Pass `--no-assign` and `--no-start`, or set `jira.autoAssign false` and `jira.autoStart false`, to keep it read-only.
- `worktree branch --github` in a fork now reads and assigns issues in the `upstream` remote when it is a GitHub repository. Set `github.repository` to the fork's `owner/repo` to keep reading the fork's issues.
- `worktree config --list` now prints a token that holds a value as `<key>=***`. Read one with `worktree config <key>`.

### Minor Changes

- 931cbf7: `branch` no longer fails inside git when the branch name is already taken: on a terminal it offers to open the worktree that already has it, and otherwise it refuses with exit `2` (`invalid_value`) and says what to run instead. Given a brief (`--agent`, `--agent-file` or `--agent-stdin`), it asks `Open it and hand the brief to a new agent there? One may already be running in it.`, so a yes never starts a second agent without warning.
- 28634f1: `--github` now works with GitHub Enterprise Server: set `github.host` to your instance and the token comes from `gh auth login --hostname`. Remotes in every git URL form are now read, and a gh logged in only to an Enterprise host no longer sends that token to github.com.
- 45d389f: `worktree branch --linear <ID>` records the issue on the branch, and `worktree cleanup` removes a worktree whose Linear issue is canceled when its commits are all on the remote and it has no uncommitted changes. `worktree list --issues` shows each worktree's Linear issue and its state, and `--json` gains an `issue` key. This needs `linear.apiKey`; if Linear can't be reached, nothing is removed on its account.
- ece75ab: Add `worktree list --churn` to show how much each worktree has changed (files, insertions, deletions) beside `Ahead:`, and a `churn` key in `list --churn --json`.
- 93ad41d: `worktree branch --clickup <ID> --assign` assigns the ClickUp task to you, adding you alongside anyone already on it and leaving a task that is already yours alone. The new `clickup.autoAssign` config key makes it the default.
  
  With neither flag and `clickup.autoAssign` unset, a terminal run asks whether to assign, and a non-interactive one (`--json`, CI, an agent) **assigns by default**, so a script or agent that passes `--clickup` takes tasks for the token's owner. Pass `--no-assign`, or set `clickup.autoAssign false`, to keep it read-only. The token's user needs edit access to the task.
- ee9517b: `worktree branch --clickup <ID> --start` moves the ClickUp task to its List's first in-progress status once the worktree exists, leaving a task that is already started, finished or in a List with no in-progress status alone. The new `clickup.autoStart` config key makes it the default, and `started` in the `--json` document reports the outcome.
  
  With neither flag and `clickup.autoStart` unset, a terminal run asks whether to move the task, and a non-interactive one (`--json`, CI, an agent) **moves it by default**, so a script or agent that passes `--clickup` changes the task's status. Pass `--no-start`, or set `clickup.autoStart false`, to keep it read-only. The token's user needs edit access to the task.
- 230bee3: Add `worktree branch --clickup <ID>` to start a worktree from a ClickUp task, with `clickup.apiToken` and `clickup.workspaceId` config keys set by `worktree config`.
- bf07d4d: `worktree config` asks far fewer questions: one "What do you want to set up?" checklist replaces its run of yes/no gates, your opener choice decides the follow-ups, the two agent questions are now one, and the run ends by naming the keys it saved. Esc in any interactive prompt now asks "Quit now?"; flags, `--names`, `--missing` and stored values are unchanged.
- f86166e: `worktree branch --github` and `--assign` now read and assign issues in your `upstream` remote when it is a GitHub repository, so a fork no longer reads its own issue numbers. If your issues live on the fork, or on a repository neither remote points at, pin it with the new `github.repository` key (`owner/repo`, in git config or `.worktree.yml`). The output names the repository whenever it is not the one behind `origin`.
- da39197: `worktree branch --github`, `--jira` and `--linear` now accept a pasted issue URL as well as a number or key. A URL naming a different repository, Jira site or Linear workspace than the configured one is refused.
- a783b64: `worktree branch --jira <key> --assign` now assigns the Jira issue to you instead of warning that it is unsupported, and leaves an issue held by someone else alone. The new `jira.autoAssign` config key makes it the default.
  
  With neither flag and `jira.autoAssign` unset, `branch --jira` now acts where it used to do nothing: a terminal run asks whether to assign, and a non-interactive one (`--json`, CI, an agent) **assigns by default**, so a script or agent that passes `--jira` starts taking issues for the token's owner. Pass `--no-assign`, or set `jira.autoAssign false`, to keep the old behaviour.
- 2633f3a: `worktree branch --jira` now works against Jira Data Center and Server: set `jira.deployment` to `datacenter` and use a personal access token (no email) to read, start and assign issues.
- c8d7426: `worktree branch --jira <KEY> --start` now moves the Jira issue to its in-progress status once the worktree exists, leaving an issue that is already started or finished, or whose workflow offers no single in-progress move, alone. The new `jira.autoStart` config key makes it the default, and `started` in the `--json` document reports the outcome.
  
  With neither flag and `jira.autoStart` unset, a terminal run asks whether to move the issue, and a non-interactive one (`--json`, CI, an agent) **moves it by default**, so a script or agent that passes `--jira` now changes the issue's status. Pass `--no-start`, or set `jira.autoStart false`, to keep it read-only. The token's user needs the *Transition Issues* permission on the issue.
- 5c741ee: Add `worktree linear-listen`, a webhook listener that starts a worktree and a coding agent when a Linear issue is delegated to or mentions your agent app, with `linear.agentToken`, `linear.webhookSecret`, `linear.agentAllow` and `linear.agentContext` config keys. A webhook body over 1 MiB is answered with `413`, and a sender still writing after 5 seconds is cut off.
- 9901ed2: `worktree branch --linear` with no identifier lists your unstarted and started Linear issues and lets you pick one. A non-interactive run (`--json`, CI, an agent) or `--dry-run` refuses and needs an identifier.
- 4c4e02b: `worktree branch --linear <ID> --start` moves the Linear issue to its team's first started state once the worktree exists, leaving issues already started, done or in triage alone. The new `linear.autoStart` config key makes it the default, and `started` in the `--json` document reports the outcome.
  
  With neither flag and `linear.autoStart` unset, a terminal run asks whether to start the issue, and a non-interactive one (`--json`, CI, an agent) **starts it by default**, so a script or agent that passes `--linear` changes the issue's state. Pass `--no-start`, or set `linear.autoStart false`, to keep it read-only. The API key needs the Write permission.
- 5eaf88f: Add `worktree branch --linear <ID>` to start a worktree from a Linear issue, with a `linear.apiKey` config key set by `worktree config`.
- 3e16780: Add `auto` as an `opener` value: `worktree open` opens in the Herdr space or Rex session you are running inside and falls back to the editor otherwise, and `remove`, `cleanup` and `rename` close or relabel it in whichever of the two is installed.
- 23f4b74: Add a committed `.worktree.yml` for shared project conventions (prefixes, branch-type rules, Jira host, source branch, copy patterns, approved `postCreate` steps), with `worktree branch --dry-run` to preview rules and `worktree config` showing where each value comes from. The `$schema` line the CLI writes at its top points at `https://northguild.dev/worktree/schema/v1.json`.
- ff9448b: Add `worktree rename [BRANCHNAME] NEWNAME` to rename a worktree and its branch together: it moves the directory, rolls back if git refuses, and relabels the worktree's Herdr space or Rex session.
- 440c28e: Add `rex` as an opener, so a worktree opens as a Rex session (with focus and an agent brief), and `remove` and `cleanup` close it again.
- 69e734c: `.worktree.yml` takes a top-level `branchType` list shared by every provider that has no list of its own, so a team writes its branch-prefix rules once; rules can name the portable fields `Type` and `Labels` on any provider and on a real run a shared rule does not warn about a field a provider lacks. A provider's own `branchType` list wins over the shared one, and no built-in default changes. `worktree branch --dry-run` names `<provider>.branchType` beside a provider-only field, such as a Jira custom field, rather than offering it for the shared list, and `--json` gives every field the list its lines belong in as `pasteInto`.

### Patch Changes

- 7d72b13: `worktree branch` now shows control and formatting characters in text from an issue tracker as escapes such as `\x1b`: the text of a tracker error, and in this release's new output a Jira assignee's name and the state or status names printed when an issue is moved to started, in the text and in the `warnings` of the `--json` document. A name set by anyone in the workspace can no longer redraw your terminal. The same goes for the error line a failed command ends on.
- 23f4b74: `worktree branch` now fetches with `--prune` on every run, so remote-tracking branches deleted on the remote are removed locally; before, only `--source` pruned.
- 69ec0ce: Fix a branch whose name contains `<-` losing its upstream: `worktree list` showed it as untracked and counted its commits against the default branch, and `worktree cleanup` could judge it safe to remove even though its remote branch still existed.
- b1b5a46: Cut the title part of a branch name from `--jira`, and from the new `--linear`, to at most 48 characters at a word boundary, the way `--github` already does, so a long issue title no longer makes an unwieldy branch name and worktree directory.
- 617e49f: `worktree cleanup` no longer stops partway with `fatal: '<path>' is not a working tree` when a worktree's directory is already gone. It now deletes that worktree's branch and carries on to the ones after it.
- 071e937: Declare `engines.node` (`^22.13.0 || >=23.5.0`, the range every runtime dependency supports), so installing on an unsupported Node, such as 21, warns at install time instead of failing at runtime.
- a25316c: `worktree branch` and `worktree checkout` no longer stop copying files at a gitignored symlink to a directory (or to nothing) that matches an env-file name or a `copy` pattern, such as `.env.link`; it is skipped and the files after it are still copied.
- 57511a6: `worktree branch --github` no longer saves the token from `gh auth token` into git config, so a refreshed or revoked `gh` token is not shadowed by a stale copy. When GitHub refuses a token with a 401, the error now says so and names the fix; when the refused token is one stored in git config, including a `gh` token an earlier version saved, it says so and names `worktree config github.token <token>` and `git config --unset northguild.worktree.github.token`.
- fd55cd7: `worktree branch --github` now refuses a pull request number, pointing at `worktree checkout` and the pull request's branch, and warns before branching from a closed issue.
- 6041c12: `worktree config` now tells you to click "Create API token" when it walks you through making a Jira Cloud token, which is the button Atlassian's account page shows. It used to say "Create Classic API token", which matched nothing on the page and disagreed with the Jira guide.
- 6a50e96: `worktree config` now offers your stored Jira host as an editable default instead of the placeholder `example.atlassian.com`, and no longer writes that placeholder when Enter is pressed — with no host stored, an empty answer is refused.
- 188aeb8: `worktree config --list` no longer prints `github.token` or `jira.apiToken` in clear, and the new `linear.apiKey` is masked the same way: a key that holds a value is listed as `<key>=***`. `worktree config <key>` still prints the value, so scripts that read a token by name keep working.
- 5475f67: `worktree branch` and `worktree checkout` no longer fail, and now copy your env files, when the repository holds a gitignored nested git repository such as a leftover Claude Code agent worktree under `.claude/worktrees/`.
- cba7bba: Update runtime dependencies so a fresh install no longer pulls a `brace-expansion` with known denial-of-service advisories: `@oclif/core` 4.14 drops the `ejs` 3 → `jake` → `minimatch` chain that carried it.
- 23f4b74: Add `yaml` and `zod` as runtime dependencies for reading `.worktree.yml`.
- 23f4b74: Update the worktree skill for `.worktree.yml`, branch-type rules and `--dry-run`.
- b95cb57: `remove` now names a live agent session before it asks (and warns under `--force`), `cleanup --ignore-agents` names the worktrees it sweeps past, and a detached agent that fails to start is reported as failed (`agent: null`, exit `1`) instead of started.
- 48be654: `worktree config github.token "   "`, and the same for `jira.apiToken`, now refuses a value that is only whitespace with exit 2 (`invalid_value` under `--json`) and stores nothing. Before, it exited 0 and stored a token that read back as unset. The new `linear.apiKey` refuses one the same way.
- f0b579a: When GitHub refuses `worktree branch --github <n> --assign` with a 403, the warning now says what the token needs: an account with push access to the repository and, for a fine-grained token, the Issues (or Pull requests) permission set to Read and write.
- ef05190: Fix `worktree remove` and `worktree cleanup` failing on a detached worktree: they deleted its directory, then exited 1 on `git branch -D (detached HEAD)`, and `cleanup` never reached the rest of the batch. A detached worktree is now removed without a branch delete, and `remove` takes a worktree's path so each detached worktree can be named on its own.
- b081496: `worktree open` on an existing worktree no longer ends on a line saying the worktree was created. With `opener` `none` or no `codeEditor`, it says the worktree already exists — `Worktree already exists at <path>`, or `✔ Worktree already exists at <path>` with no `codeEditor` — still ending on the path. `branch` says the same when you accept its offer to open a worktree that already exists, and under `--no-open`.
- 608a39f: Fix a repository under a directory whose name starts with `.git`, such as `~/.github/proj`, being rooted at the wrong place when run from one of its worktrees.
- cb16b84: Fix `worktree list` and `worktree open` showing nothing for a repository under a path containing a space, and keep an apostrophe inside a configured command path such as `/Users/o'brien/bin/ed`.
- 22f57f7: A Linear, GitHub or Jira response whose body stalls past the 15-second limit is now reported as a timeout: the message says the call did not answer within 15s, and where that ends the command, `--json` gives the code `timeout` instead of `failed`.
- 93102ad: `worktree cleanup` and `worktree remove` now move their progress bar as git deletes a worktree, instead of sitting at 0% until it finishes, and a failed removal no longer leaves the terminal cursor hidden.
- d6aa5e4: `worktree config` no longer overwrites a stored `github.token` or `jira.apiToken` when the prompt is answered with only spaces (or, for Jira, nothing), and `worktree branch` now says why it could not save `github.autoAssign`.
- 9ebf064: Stop `worktree list` and the commands built on it from listing worktrees under a sibling directory such as `<repo>.worktrees-old`.

## 2.1.2

### Patch Changes

- 92c018e: Opening a worktree with a Herdr agent now retries the agent start for a couple of seconds when the pane's shell is not ready yet, before warning `agent_pane_busy` and leaving the agent unstarted.

## 2.1.1

### Patch Changes

- bf8adc9: `worktree remove` and `worktree cleanup` no longer fail with "is not a working tree" when another worktree's path, or the main checkout's, ends in the same name as the branch being removed — for example a checkout directory named like the branch, or branches `demo` and `x/demo` side by side.
- 81bbfe4: `worktree branch` now reports a malformed `--github` issue id or `--jira` issue key as `invalid_value` and exits 2, like any other refused value, instead of exiting 1 with `failed`. An issue that does not exist, or a failed lookup, still exits 1.
- 4d63b22: `worktree list --agents` now marks an interactive agent session as `waiting` when it has finished its turn or is blocked on a question, as it already did for background sessions. That includes the agents `worktree branch` starts through Herdr, so a coordinator polling `list --agents --json` can see a worker finish. The text list shows such a session as `[interactive, waiting]`. A session is now `waiting` only when every source agrees: one the runtime calls idle while Herdr reports it working is not, and Herdr's `done` (a finished turn nobody has looked at yet) counts as waiting.
- a3e32fb: `worktree cleanup` no longer holds back a merged worktree just because an agent session in it is idle, such as a Claude pane left open at its prompt. A session that is working, blocked or in an unknown state still holds its worktree back.
- 93afc0e: The bundled worktree skill now states that issue content only feeds the branch name, its examples no longer hand a coding agent an issue to read, and it tells a coordinating agent not to copy issue text into a worker's brief.
- 7e2f80e: `worktree cleanup` no longer removes a worktree whose agent session the runtime reports as done while its process is still running. Such a session now counts as live, so it holds the worktree back unless it is idle, and `worktree list --agents` no longer marks it `[done]`.

## 2.1.0

### Minor Changes

- 20cc8b4: `worktree config` now asks yes/no and fixed-choice settings (`herdr.focus`, `github.autoAssign`, `opener`) as prompts instead of typed words, and `--yes --names <key>` keeps the stored value instead of exiting 2. Stored values and `worktree config <key> <value>` are unchanged.
- 20cc8b4: The usage skill is now a plain Agent Skill at `skills/worktree/`, installable with `npx skills add northguild/worktree --skill worktree`. TanStack Intent support is removed: the `skills/core/` and `skills/_artifacts/` files and the `tanstack-intent` keyword are gone, so Intent no longer discovers the package.
