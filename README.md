# Worktree

`worktree` is a CLI for people who use Git worktrees as part of their daily development flow and do not want to keep typing the same setup, cleanup, and editor-opening commands over and over.

![Worktree](https://media1.giphy.com/media/v1.Y2lkPTc5MGI3NjExNW51dHJlNHRzYnRwd3c3ZWZ0dzllZTB1d3VnaGQxd2s4eDJlbDhnaiZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/lqT2GstnDBVJE6qfkK/giphy.gif)

It wraps the most common worktree tasks into a small workflow-oriented tool:

- create a new worktree from your default base branch
- check out an existing remote branch into its own worktree
- copy local env files into the new worktree
- open the result in your editor automatically
- hand the new worktree straight to a coding agent
- list, reopen, remove, and clean up worktrees later

This README focuses on the fast path. The documentation website will cover deeper examples, advanced workflows, integrations, and troubleshooting.

Docs: https://northguild.github.io/worktree

## Why This Exists

Git worktrees are great when you want multiple branches checked out at once, but the raw commands are still a bit awkward for everyday use. In practice, teams usually want a repeatable flow like this:

1. branch off `origin/main`
2. create a sibling worktree directory
3. copy `.env` files
4. open it in the editor
5. clean up stale worktrees later

`worktree` turns that into a few commands with sensible prompts.

By default, worktrees are created in a sibling folder named `<repo>.worktrees`, so your main repository stays clean while related worktrees stay easy to find.

## Context Switching Without The Tax

One of the biggest wins with worktrees is how fast context switching becomes.

Instead of juggling one checkout and constantly doing this dance:

1. stash current changes
2. switch branches
3. do quick fix
4. switch back
5. unstash and resolve surprises

you keep each task in its own directory and jump between them directly.

That means:

- fewer stash/unstash cycles
- less risk of stash conflicts or forgotten stashes
- less accidental cross-branch contamination
- faster interrupts, reviews, and hotfixes

In short: stop paying a context-switching penalty and stop stashing just to move between tasks.

## Install

```bash
npm install -g @northguild/worktree
```

Or run it without a global install:

```bash
npx @northguild/worktree --help
```

## Quick Start

Run the initial configuration once inside a Git repository:

```bash
worktree config
```

The setup flow can configure:

- `defaultSourceBranch` for new worktrees, such as `origin/main`
- `codeEditor` for automatically opening a worktree, such as `code`
- `opener` for where a worktree opens — `editor` (default) or `herdr`
- `agent.command` for handing a worktree to a coding agent, such as `claude --bg`

Then create your first worktree:

```bash
worktree branch feature/improve-readme
```

That will:

1. create a new branch from your configured source branch
2. add a Git worktree under `<repo>.worktrees/feature/improve-readme`
3. copy the gitignored env files from the main repository — `.env*`, `.dev.vars*` and `.envrc`
4. open the new worktree in your configured editor, if one is set — or as a Herdr space when `opener` is `herdr`

## Common Workflows

### Start a new branch in its own worktree

```bash
worktree branch feature/add-bulk-actions
```

Create from a different source branch:

```bash
worktree branch feature/add-bulk-actions --source origin/release/1.4
```

### Check out an existing remote branch

```bash
worktree checkout feature/fix-login-timeout
```

You can also pass the full remote name:

```bash
worktree checkout origin/feature/fix-login-timeout
```

This creates a local tracking branch in a dedicated worktree.

### Hand a new worktree to a coding agent

```bash
worktree branch feature/add-bulk-actions --agent "add bulk actions to the table"
```

The agent starts with the new worktree as its working directory and the flag's value as its prompt, so it works inside `<repo>.worktrees` alongside everything else. `worktree checkout` takes the same flag.

This is independent of the editor: with `codeEditor` set as well, the worktree still opens there. It needs `agent.command` configured — without it the worktree is created and opened as usual and only the agent is skipped.

### See what worktrees already exist

```bash
worktree list
```

To name the agent session living in each worktree:

```bash
worktree list --agents
```

### Reopen a worktree in your editor

```bash
worktree open feature/add-bulk-actions
```

If you omit the branch name, the CLI shows an interactive picker.

### Remove a worktree

```bash
worktree remove feature/add-bulk-actions
```

Force removal when you already know what you are doing:

```bash
worktree remove feature/add-bulk-actions --force
```

Aliases are also available:

```bash
worktree rm feature/add-bulk-actions
```

### Clean up stale worktrees

```bash
worktree cleanup
```

The cleanup command targets worktrees that are considered safe to remove, for example branches whose remote no longer exists, and local worktrees with no tracked remote. Either way the worktree has to be carrying nothing — no uncommitted changes, and no commits that have not been pushed. A commit count that could not be taken is never read as a zero, so a worktree whose directory still exists is held back rather than swept when it cannot be checked.

A worktree that an agent session is living in is held back and reported as skipped. `--force` does not override that, because it answers the confirmation prompt rather than the safety verdict; `--ignore-agents` is the flag that does.

## Commands

| Command                             | What it does                                        |
| ----------------------------------- | --------------------------------------------------- |
| `worktree config`                   | Configure defaults like source branch and editor    |
| `worktree branch <name>`            | Create a new branch in a new worktree               |
| `worktree checkout <remote-branch>` | Check out an existing remote branch into a worktree |
| `worktree list`                     | List known worktrees                                |
| `worktree open [branch]`            | Open an existing worktree in your editor            |
| `worktree remove [branch]`          | Remove one or more worktrees                        |
| `worktree cleanup`                  | Remove stale worktrees that are safe to delete      |

For command help at any time:

```bash
worktree help
worktree help branch
```

## Configuration

Configuration is stored in local Git config under the `northguild.worktree.*` namespace.

Examples:

```bash
worktree config defaultSourceBranch origin/main
worktree config codeEditor code
worktree config opener herdr
worktree config agent.command "claude --bg"
worktree config --list
worktree config --missing
```

`codeEditor` is the executable plus any arguments, run without a shell — quotes group, but `~` and
`$VAR` are not expanded. Set `opener` to `herdr` to open worktrees as
[Herdr](https://herdr.dev) spaces instead of editor windows; `herdr.focus` and `herdr.agent` tune
that. See the [configuration docs](https://northguild.github.io/worktree/docs/configuration).

## What The README Covers

The README is intentionally optimized for onboarding and everyday usage.

The documentation website should be the place for:

- in-depth walkthroughs
- team conventions and naming strategies
- integration guides
- edge cases and troubleshooting
- richer examples for different repository layouts

## Requirements

- Git installed and available on your `PATH`
- Node.js available to run the CLI
- an existing Git repository where you want to manage worktrees
- macOS or Linux — Windows is not supported

If you want automatic editor launching, make sure your editor command is available on your `PATH`, for example `code` for Visual Studio Code.

If you want worktrees to open as Herdr spaces, make sure the `herdr` CLI is on your `PATH` and its server is running.

## License

MIT

## TODO

- [x] Add `config` command to configure everything needed
- [x] Add `branch` command to create new worktrees
- [x] Add `remove` command to delete worktrees
- [x] Add `checkout` command to create worktree from a remote branch
- [x] Add `list` command to list all worktrees
- [x] Add `open` command to open a worktree in a code editor
- [x] Add `cleanup` command to cleanup stale worktrees
- [x] Integrate with GitHub for automated branch naming
- [x] Integrate with JIRA for automated branch naming
- [ ] Integrate with ClickUp for automated branch naming
