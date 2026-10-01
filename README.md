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
- `opener` for where a worktree opens — `editor` (default), `herdr` or `none`
- `agent.command` for handing a worktree to a coding agent, such as `claude --bg`
- `postCreate` for a command to run in each new worktree, such as `pnpm install` (otherwise inferred from the lockfile)

Then create your first worktree:

```bash
worktree branch feature/improve-readme
```

That will:

1. create a new branch from your configured source branch
2. add a Git worktree under `<repo>.worktrees/feature/improve-readme`
3. copy the gitignored env files from the main repository — `.env*`, `.dev.vars*` and `.envrc`
4. install dependencies — by default when non-interactive, and on a terminal when `postCreate` is set or `--install` is given (`--no-install` skips it); the command is `postCreate`, else inferred from the lockfile (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock`), and a failure keeps the worktree, opens nothing and exits `1`
5. open the new worktree in your configured editor, if one is set — or as a Herdr space when `opener` is `herdr`

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

The agent starts with the new worktree as its working directory and the flag's value as its prompt, so it works inside `<repo>.worktrees` alongside everything else. `worktree checkout` takes `--agent` too.

There is one agent per worktree. With `opener` set to `herdr`, Herdr starts it in the new space and the prompt is submitted to it afterwards (a `claude` agent is named `<repo>-<branch>`, printed on stderr); the kind is `herdr.agent`, or the program `agent.command` names. Otherwise `agent.command` is launched detached, and without it the worktree is created and opened as usual and only the agent is skipped.

For a long prompt, `--agent-file <path>` or `--agent-stdin` reads it whole (at most 256 KB; the three are mutually exclusive). `--no-agent` opens the worktree without an agent, and `--no-open` creates it and prints its path without opening anything.

### See what worktrees already exist

```bash
worktree list
```

To name the agent session living in each worktree:

```bash
worktree list --agents
```

Sessions are found from two places, joined on the directory they run in: `herdr agent list` when `herdr` is installed, and the runtime's own `<program> agents --json`, where the program is `agent.command`'s first word or else `herdr.agent`. A finished session shows `[done]`, unless Herdr still shows it in a pane. With neither source available the list simply shows no sessions.

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

With `opener` set to `herdr`, removing a worktree also closes the Herdr space it was opened as.

### Clean up stale worktrees

```bash
worktree cleanup
```

The cleanup command targets worktrees that are considered safe to remove, for example branches whose remote no longer exists, and local worktrees with no tracked remote. Either way the worktree has to be carrying nothing — no uncommitted changes, and no commits that have not been pushed. A commit count that could not be taken is never read as a zero, so a worktree whose directory still exists is held back rather than swept when it cannot be checked.

A worktree that an agent session is living in is held back and reported as skipped. That includes a session Herdr started for you, found through `herdr agent list`, as well as one in your own terminal. `--force` does not override that, because it answers the confirmation prompt rather than the safety verdict; `--ignore-agents` is the flag that does.

With `opener` set to `herdr`, every worktree removed here also has its Herdr space closed. The ones held back keep theirs — `cleanup` closes what it deleted, not what it looked at. Note that `--ignore-agents` therefore also closes a live agent's space, taking its panes down with the directory.

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
`$VAR` are not expanded. Set `opener` to `none` to open nothing — `branch` then prints
`Worktree created at <path>` and stops, which suits scripts and agents. `worktree config <key>` with no
value prints the stored value. Set `opener` to `herdr` to open worktrees as
[Herdr](https://herdr.dev) spaces instead of editor windows — and to close those spaces again when
`remove` or `cleanup` deletes the worktree; `herdr.focus` and `herdr.agent` tune that. See the
[configuration docs](https://northguild.github.io/worktree/docs/configuration).

## Agent mode

`branch`, `list` and `remove` can run with nothing at the keyboard — from a script, CI, or another coding
agent — and hand back one JSON document to parse. Nothing in this mode prompts, animates or waits without a
bound. A run on a terminal behaves exactly as described above.

### What triggers it

A run is non-interactive when any of these hold:

- stdin is not a terminal
- `CI` is set and is not empty, `0` or `false`
- `--non-interactive` or `--yes` (`-y`) is given — every command accepts both
- `--json` is given, on `branch`, `list` or `remove`

A prompt that has a default takes it. One that has none fails at once with exit `2` and a single stderr
line, `worktree: no default for <value>; pass <flag>`.

### Flags

| Flag | On | Does |
| --- | --- | --- |
| `--json` | `branch`, `list`, `remove` | one JSON document on stdout; everything for a person goes to stderr |
| `--agent <text>`, `--agent-file <path>`, `--agent-stdin` | `branch` (`checkout` takes `--agent`) | the brief for the agent, from a value, a file or piped stdin; mutually exclusive with each other and with `--no-agent`, read whole, empty is refused, at most 256 KB |
| `--no-open` | `branch` | create the worktree and print its path; call neither Herdr nor the editor |
| `--no-agent` | `branch` | open as usual, start no agent |
| `--install` / `--no-install` | `branch` | force the dependency install on or off for this run |
| `--assign` / `--no-assign` | `branch` | assign the `--github` issue to you, or not |
| `-f`, `--force` | `remove` | skip the confirmation; required when non-interactive |

### Defaults when non-interactive

- **Branch name** from `--github`: `<prefix><number>-<slug>`, the slug cut to 48 characters at the last dash.
  With no issue, the name is required.
- **Assignment:** `--assign`/`--no-assign`, then `github.autoAssign`, then assign. The default is never saved.
- **Install:** on. The command is `postCreate`, else inferred from the lockfile (`pnpm-lock.yaml`,
  `package-lock.json`, `yarn.lock`, `bun.lock`). With nothing to run it says so and carries on. A failure keeps
  the worktree, starts nothing and exits `1`.
- **Source branch:** `defaultSourceBranch`, else `origin/main` with a warning.
- **Removal** has no default: `remove <branch> -f`.
- **Bounded calls:** GitHub and Jira requests 15 s, `git fetch` 60 s, `gh auth token` and the session listing
  10 s, the install 10 min.

### Output

With `--json`, stdout is one line holding one document, and a count that could not be taken is `null`, never
`0`. Tokens are never printed.

```bash
worktree branch --github 42 --json --agent-file brief.md
```

```json
{"path":"/abs/repo.worktrees/42-fix-login","branch":"42-fix-login","source":"origin/main",
 "issue":{"provider":"github","number":42,"url":"https://github.com/acme/demo/issues/42"},"assigned":true,
 "envFilesCopied":["docs/.env.local"],
 "installed":{"ran":true,"command":"pnpm install --frozen-lockfile","inferred":true,"ok":true},
 "herdr":{"space":"w5","pane":"w5:p1","agent":"wt-42-fix-login"},
 "agent":{"name":"demo-42-fix-login","kind":"claude","command":["claude","--name","demo-42-fix-login"],"prompted":true},
 "warnings":[]}
```

- `issue` is `{provider:"github",number,url}`, `{provider:"jira",key,url}`, or `null`.
- `assigned` is `null` when no assignment was attempted. `herdr` and `agent` are `null` when skipped, and
  `agent.command` leaves the brief out. `agent.name` is `null` where this CLI named nothing (a detached start).
- `installed` is `{ran:false,reason}` when skipped. A failed install still prints the whole document, with
  `installed.ok` `false`, and exits `1`.

`list --json` gives `{"worktrees":[{branch,path,current,pathExists,remote,remoteExists,ahead,behind,mergedInto,uncommittedChanges,safeToRemove}]}`.
With `--agents`, each entry also has `agent`: `null`, or `{name,sessionId,herdrAgent,live,interactive,waiting}`.
`herdrAgent` is currently Herdr's pane id (for example `w4P:p1`), not an agent name.

`remove --json` gives `{"removed":[{branch,path}],"herdrSpacesClosed":[…],"warnings":[]}`. Nothing removed is
never reported as a success.

A failure prints `{"error":{"code","message",…}}` on stdout, one line on stderr, and exits non-zero:

| `code` | Means | Exit |
| --- | --- | --- |
| `missing_value` | a value with no default was not given | `2` |
| `invalid_value` | a value or flag combination was refused | `2` |
| `not_found` | something named does not exist | `2` |
| `timeout` | a bounded call did not answer in time | `1` |
| `failed` | anything else | `1` |

Exit codes follow the same rule without `--json`: `0` success, `1` failure, `2` a usage or value problem.
A human's Ctrl-C at a prompt stays silent and exits `0`.

### One agent per worktree

With `opener` `herdr`, Herdr starts the agent in the new space and the brief is submitted afterwards with
`herdr agent prompt`, never inside the start command, so no shell sees it. The agent kind is `herdr.agent`;
when a brief is given and that is unset, the program `agent.command` names. `agent.command`'s arguments are
reused without `--bg`, and a `claude` agent gets `--name <repo>-<branch>`, lowercased and never truncated.
Otherwise `agent.command` is launched detached. `--no-open` and
`opener` `none` open nothing and still start the detached agent when a brief is given.

### How agents are detected

`list --agents` asks two sources, and either may be missing:

1. `herdr agent list`, when `herdr` is on `PATH`.
2. The runtime's own `<program> agents --json`, where the program is `agent.command`'s first word, else `herdr.agent`.

They are joined on the directory each session runs in, compared as real paths, and a Herdr entry is named by
the runtime session with the same session id. A session without a `pid` is kept. `live` is `false` for a
session the runtime reports as finished (`[done]` in the text list), unless Herdr still shows it in a pane. With
neither source, the result is no agents and no error. `cleanup` holds a worktree back for any session that is still `live`; a finished one does not hold it back.

### A coordinator driving worker agents

A coordinating agent — Claude Code, say — can fan work out to one worktree each:

1. Run `worktree branch --github N --json --agent-file brief.md` per issue.
2. Make the brief name the coordinating session and say its follow-ups carry the user's authority. Without
   that, a Claude session treats messages from other sessions as information, not instructions.
3. Set `agent.command` with a permission mode compatible with the coordinator's. A session in a different
   mode holds cross-session messages until its user approves them.
4. Read `agent.name` from the document to address the session, and `worktree list --agents --json` to check it
   is still `live`.
5. Finish with `worktree remove <branch> -f --json`.

### Checked from a tool call

Run on 2026-10-01 from Claude Code's Bash tool (no TTY, stdin closed) against this repository and a
disposable issue, with `opener` `herdr`, `herdr.agent` `claude`, Herdr 0.9.0, Claude Code 2.1.286, Node 24.19.0
on macOS:

| Command | Exit | Time |
| --- | --- | --- |
| `worktree branch --github <issue> --json --agent-file brief.md` | `0` | 18.6 s, 6.8 s of it the install |
| `worktree list --agents --json` | `0` | 3.6 s |
| `worktree branch --json` (no name) | `2` | 0.4 s |
| `worktree remove <branch> -f --json` | `0` | 12.4 s |

The first created the tree, installed, opened a Herdr space and started `claude`, which received the brief and
replied; the last removed the tree, the branch, the space and the session. The third printed
`{"error":{"code":"missing_value",…}}` and exactly one stderr line. Nothing prompted and nothing hung.

The per-command pages have the detail: [`branch`](https://northguild.github.io/worktree/docs/commands/branch),
[`list`](https://northguild.github.io/worktree/docs/commands/list),
[`remove`](https://northguild.github.io/worktree/docs/commands/remove) and
[Herdr spaces](https://northguild.github.io/worktree/docs/guides/herdr-spaces).

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
