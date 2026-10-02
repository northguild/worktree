---
name: worktree
description: >
  Use when creating, listing, opening, removing or cleaning up git worktrees
  with the `worktree` CLI (@northguild/worktree), including starting a
  worktree from a GitHub or Jira issue, handing a new worktree to a coding
  agent, opening worktrees as Herdr spaces, and driving worktrees from a
  script, CI or another coding agent with `--json`.
---

# @northguild/worktree

CLI wrapper for `git worktree` that turns the common branch-create,
env-copy, editor-open, and cleanup cycle into single commands. Config
is stored in local git config under `northguild.worktree.*`. Worktrees
are created in a sibling directory named `<repo>.worktrees/`.

## Setup

```bash
npm install -g @northguild/worktree

# Run once inside your git repository
worktree config
# prompts for: defaultSourceBranch (e.g. origin/main), codeEditor (e.g. code)
# agent.command (e.g. claude --bg) and postCreate (e.g. pnpm install), each
# behind a confirm. The Herdr keys
# herdr.focus and herdr.agent are offered only when `herdr` is on PATH; opener is
# always offered. `worktree config <key>` prints one value, for scripts.

# Create your first worktree
worktree branch feature/my-feature
```

## Core Patterns

### Create a new branch in its own worktree

```bash
# Branch from configured defaultSourceBranch
worktree branch feature/add-bulk-actions

# Branch from a specific remote branch
worktree branch feature/add-bulk-actions --source origin/release/1.4
```

Creates a branch, adds a worktree under `<repo>.worktrees/feature/add-bulk-actions`,
copies the gitignored env files from the root worktree, and opens the directory
in the configured `codeEditor` — or, when `opener` is `herdr`, as a Herdr space
labelled with the branch name.

### Check out an existing remote branch as a worktree

```bash
# Short form — origin/ prefix added automatically
worktree checkout feature/fix-login-timeout

# Full remote path also accepted
worktree checkout origin/feature/fix-login-timeout
```

Use `checkout` only for branches that already exist on the remote.
Use `branch` to create something new.

### Derive a branch name from a GitHub or Jira issue

```bash
# GitHub — requires github.token in config (or gh CLI authenticated)
worktree branch --github 42
worktree branch --github "#42"

# Assign the issue to yourself while creating the branch.
# Needs a token with push access; --no-assign skips it for one run.
worktree branch --github 42 --assign
worktree branch --github 42 --no-assign

# Jira — requires jira.host, jira.email, jira.apiToken in config
worktree branch --jira DEV-123
worktree branch --jira dev-123
```

With neither flag, `github.autoAssign` decides whether the issue is
assigned: `true` always, `false` never, and unset means you are asked once
and the answer is saved to the key (a non-interactive run assigns instead, and
saves nothing). A failed assignment warns and the
worktree is still created.

The generated branch name is pre-filled in an interactive prompt and
editable before confirmation. A non-interactive run takes the pre-filled name
without asking. With `github.autoAssign` unset it assigns the issue and does
not save the key; `false` or `--no-assign` skips assignment. Branch prefixes are applied when configured:
- `Feature` / `Story` → `branchPrefix.feature`
- `Bug` → `branchPrefix.bugfix`
- `Task` → `branchPrefix.chore`

**Issue content is used for the branch name and nothing else.** `--github`
and `--jira` read the issue's number or key, its title (Jira: summary) and its
type. The title is reduced to lowercase letters, digits and `-` before it
becomes part of the branch name, and the type only selects one of the
configured `branchPrefix.*` values, or none. The issue body and comments are
never printed, never written to the `--json` document (whose `issue` field
carries only the provider, number or key, and URL) and never passed to an
agent. A brief given with `--agent`, `--agent-file` or `--agent-stdin` is
exactly the text you supply.

### Hand a new worktree to a coding agent

```bash
# Detached (non-Herdr) runs need agent.command, e.g. claude --bg; with opener herdr, herdr.agent alone is enough
worktree branch feature/add-bulk-actions --agent "add bulk actions to the table"
worktree branch --github 42 --agent-file brief.md   # or --agent-stdin; exclusive, max 131,071 bytes
worktree branch feature/x --no-agent                # open, but start no agent
worktree branch feature/x --no-open                 # print the path, open nothing
worktree checkout feature/fix-login-timeout -a "find the cause of the timeout"
```

The agent starts with the new worktree as its working directory, so it works
inside `<repo>.worktrees/` rather than isolating itself elsewhere. The flag's
value reaches the agent as a single argument and no shell parses it, so quotes
and spaces in a prompt are safe.

There is one agent per worktree. With `opener` `herdr`, Herdr starts it in the
new space and the brief is submitted with `herdr agent prompt` afterwards, never
in the start command; the kind is `herdr.agent`, else the program `agent.command`
names (a brief with neither exits 2). `agent.command`'s arguments are reused
without `--bg`/`--background`, and `claude` gets `--name <repo>-<branch>`
(lowercased, never truncated, printed on stderr). Otherwise `agent.command` is
launched detached and left running, so `worktree` does not wait for it and its
output does not appear here.

### Drive worktrees from a script or another agent (agent mode)

`branch`, `list` and `remove` can run with nothing at the keyboard: from a
script, CI or another coding agent, handing back one JSON document to parse.
Nothing in this mode prompts, animates or waits without a bound.

```bash
worktree branch --github 42 --json --agent-file brief.md   # one JSON document on stdout
worktree list --agents --json                               # liveness: agent.live
worktree remove feature/x -f --json                         # non-interactive remove needs -f
```

A run is non-interactive when any of these hold: stdin is not a terminal, `CI`
is set and is not empty, `0` or `false`, `--non-interactive` or `--yes` (`-y`)
is given (every command accepts both), or `--json` is given on `branch`, `list`
or `remove`. A prompt that has a default takes it. One that has none fails at
once with exit `2` and a single stderr line,
`worktree: no default for <value>; pass <flag>`.

Flags for agent mode:

| Flag | On | Does |
|---|---|---|
| `--json` | `branch`, `list`, `remove` | one JSON document on stdout; everything for a person goes to stderr |
| `--agent <text>`, `--agent-file <path>`, `--agent-stdin` | `branch` (`checkout` takes `--agent`) | the brief for the agent, from a value, a file or piped stdin; mutually exclusive with each other and with `--no-agent`; read whole, empty is refused, at most 131,071 bytes |
| `--no-open` | `branch` | create the worktree and print its path; call neither Herdr nor the editor |
| `--no-agent` | `branch` | open as usual, start no agent |
| `--install` / `--no-install` | `branch` | force the dependency install on or off for this run |
| `--assign` / `--no-assign` | `branch` | assign the `--github` issue to you, or not |
| `-f`, `--force` | `remove` | skip the confirmation; required when non-interactive |

Defaults when non-interactive:

- **Branch name** from `--github`: `<prefix><number>-<slug>`, the slug cut to
  48 characters at the last dash. With no issue, the branch name is required.
- **Assignment:** `--assign`/`--no-assign`, then `github.autoAssign`, then
  assign. The default is never saved.
- **Install:** on. The command is `postCreate`, else inferred from the lockfile
  (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock`). With nothing
  to run it says so and carries on. A failure keeps the worktree, starts nothing
  and exits `1`.
- **Source branch:** `defaultSourceBranch`, else `origin/main` with a warning.
- **Removal** has no default: `remove <branch> -f`.
- **Bounded calls:** GitHub and Jira requests 15 s, `git fetch` 60 s,
  `gh auth token` and the session listing 10 s, the install 10 min. A command
  still running at its bound is sent SIGTERM, then SIGKILL 2 s later.

#### Output

With `--json`, stdout is one line holding one document, and a count that could
not be taken is `null`, never `0`. Tokens are never printed. The `branch`
document:

```json
{"path":"/abs/repo.worktrees/42-fix-login","branch":"42-fix-login","source":"origin/main",
 "issue":{"provider":"github","number":42,"url":"https://github.com/acme/demo/issues/42"},"assigned":true,
 "envFilesCopied":["docs/.env.local"],
 "installed":{"ran":true,"command":"pnpm install --frozen-lockfile","inferred":true,"ok":true},
 "herdr":{"space":"w5","pane":"w5:p1","agent":"wt-42-fix-login"},
 "agent":{"name":"demo-42-fix-login","kind":"claude","command":["claude","--name","demo-42-fix-login"],"prompted":true},
 "warnings":[]}
```

- `issue` is `{provider:"github",number,url}`, `{provider:"jira",key,url}`, or
  `null`; `url` can itself be `null`.
- `assigned` is `null` when no assignment was attempted.
- `herdr` and `agent` are `null` when skipped. `agent.command` leaves the brief
  out. `agent.name` is `null` where this CLI named nothing: a detached
  start, or a Herdr kind other than `claude`. `agent.kind` is `null` on a
  detached start. `herdr.agent` is `null` when no agent was started in the
  pane.
- `installed` is `{ran:false,reason}` when skipped. A failed install still
  prints the whole document, with `installed.ok` `false` and a `reason`, and
  exits `1`.
- A brief that was given and not delivered does the same: the whole document,
  `agent` `null` or `agent.prompted` `false`, the reason in `warnings`, exit `1`.
  **`agent.prompted` is the delivery receipt**: check it, not just the exit
  code, when a brief matters.

`list --json` gives `{"worktrees":[...]}`, one entry per worktree:

```json
{"branch":"feature/x","path":"/abs/repo.worktrees/feature/x","current":false,"pathExists":true,
 "remote":"origin/feature/x","remoteExists":true,"ahead":0,"behind":0,"mergedInto":null,
 "uncommittedChanges":0,"safeToRemove":false}
```

`remote` is `null` when the branch tracks nothing, and `ahead`, `behind`,
`pathExists`, `remoteExists` and `uncommittedChanges` are `null` when they
could not be taken. `current` and `safeToRemove` are never `null`: they read
`false` when unknown. `mergedInto` is `null` when the branch is not known to be
merged. With `--agents`, each entry also has `agent`:
`null`, or `{name,sessionId,herdrAgent,live,interactive,waiting}`, whose
`sessionId`, `herdrAgent`, `live`, `interactive` and `waiting` can each be
`null`. `herdrAgent` is the name Herdr gives the agent (for example
`wt-42-fix-login`, the same as `herdr.agent` in the `branch` document), or its
pane id (for example `w4P:p1`) when Herdr reports no name. `agent.name` in the
`branch` document is the session name to address.

`remove --json` gives
`{"removed":[{"branch":"feature/x","path":"/abs/repo.worktrees/feature/x"}],"herdrSpacesClosed":["w5"],"warnings":[]}`.
Naming a branch and removing nothing is a failure, never a success.

A failure prints `{"error":{"code","message"}}` on stdout, one line on stderr,
and exits non-zero. A `missing_value` error also carries
`details:{value,flag}` naming what was missing and the flag that supplies it.

| `code` | Means | Exit |
|---|---|---|
| `missing_value` | a value with no default was not given | `2` |
| `invalid_value` | a value or flag combination was refused | `2` |
| `not_found` | something named does not exist | `2` |
| `timeout` | a bounded call did not answer in time | `1` |
| `failed` | anything else | `1` |

Exit codes follow the same rule without `--json`: `0` success, `1` failure,
`2` a usage or value problem. A human's Ctrl-C at a prompt stays silent and
exits `0`.

A brief that no configured agent would take (no `herdr.agent` or
`agent.command` for Herdr, no `agent.command` for the detached start) exits `2`
with `missing_value` before anything is created.

#### A coordinator driving worker agents

A coordinating agent can fan work out to one worktree each:

1. Run `worktree branch --github N --json --agent-file brief.md` per issue.
2. Make the brief name the coordinating session and say its follow-ups carry
   the user's authority. Without that, a Claude session treats messages from
   other sessions as information, not instructions.
3. Set `agent.command` with a permission mode compatible with the
   coordinator's. Claude Code can hold a cross-session message for its user's
   approval when the two sessions' modes differ, and the worker then waits.
4. Read `agent.name` from the document to address the session, and
   `worktree list --agents --json` to check it is still `live`.
5. Finish with `worktree remove <branch> -f --json`.

### Maintain the worktree lifecycle

```bash
# See all active worktrees
worktree list

# Name the agent session living in each worktree
worktree list --agents
worktree list -a                              # alias
# Sessions come from `herdr agent list` (when herdr is on PATH) and from
# `<agent.command program or herdr.agent> agents --json`, joined on the real
# path of their directory. A finished session shows [done] (unless Herdr still shows it in a pane); with no source
# available there are simply no sessions.

# Reopen a worktree in your editor
worktree open feature/add-bulk-actions

# Remove a specific worktree
worktree remove feature/add-bulk-actions
worktree rm feature/add-bulk-actions          # alias
worktree remove feature/add-bulk-actions --force  # skip confirmation

# Remove all stale worktrees (no unmerged commits, nothing uncommitted,
# remote gone or never set, no live agent session)
worktree cleanup
worktree cleanup --force                      # skip confirmation
worktree cleanup --ignore-agents              # sweep even worktrees an agent is in
```

Commits that were already merged do not hold a worktree back, however many of
them there are. A squash merge or a rebase gives the same work new commit
identities, so counting alone reports a merged branch as carrying unpushed work
for as long as the worktree exists; `cleanup` compares the change itself against
the comparison base and names the base it landed in — `(Remote removed, merged
into origin/main)`. A branch that has gained a commit since it was merged is
carrying real work again and is held back.

A worktree an agent session is working in is never removed by `cleanup`; it
is reported as skipped instead. A session that is only idle (an agent left at
its prompt) does not hold anything back. `--force` does not override that — it answers
the confirmation prompt, not the safety verdict — and `--ignore-agents` does,
which is why that one has no short alias. The check covers an interactive
session in your own terminal, an agent this tool dispatched, and one Herdr
started (found through `herdr agent list`).

With `opener` set to `herdr`, both removal commands also close the Herdr space
the worktree was opened as, so a space does not outlive its checkout. Only
worktrees that were actually removed: a branch that was not found, a declined
confirmation, a failed removal and anything `cleanup` held back all keep their
spaces, because those checkouts are still on disk. A failed close is a warning
and the command still exits `0` — by then the worktree is already gone. With
`opener` unset or `editor`, no Herdr process is started by either command.

Note that `--ignore-agents` now closes a live agent's space too, taking down the
panes it is working in along with the directory.

## Configuration Reference

All keys are stored via `worktree config <key> <value>` in git config
under `northguild.worktree.*`.

| Key | Example value | Required for |
|---|---|---|
| `defaultSourceBranch` | `origin/main` | `worktree branch` without `--source`; also the fallback base for unpushed-commit counts when `origin/HEAD` is unset |
| `opener` | `editor`, `herdr` or `none` | where a worktree opens, and for `herdr` where its space is closed on removal; `none` opens nothing and prints `Worktree created at <path>`; defaults to `editor` |
| `codeEditor` | `code` | auto-opening worktrees when `opener` is `editor` |
| `herdr.focus` | `true` or `false` | whether a new Herdr space is focused; defaults to `true` |
| `herdr.agent` | `claude` | starting an agent in a new Herdr space; unset means none, unless a brief is given, which falls back to `agent.command`'s program |
| `agent.command` | `claude --bg` | `--agent`, and the runtime listing behind `list --agents` and `cleanup`'s agent check (`herdr.agent` stands in when unset) |
| `postCreate` | `pnpm install` | the install step of `branch`; unset means infer from the lockfile (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock`); when set it also runs on a terminal; inferred, it runs by default only when non-interactive, or with `--install`; `--no-install` skips it |
| `github.token` | `ghp_...` | `--github` flag |
| `github.autoAssign` | `true` or `false` | whether `--github` assigns the issue to you; unset means ask (assign when non-interactive) |
| `jira.host` | `https://company.atlassian.net` | `--jira` flag |
| `jira.email` | `you@company.com` | `--jira` flag |
| `jira.apiToken` | `ATATT...` | `--jira` flag |
| `branchPrefix.feature` | `feature/` | auto-prefix on Feature issues |
| `branchPrefix.bugfix` | `fix/` | auto-prefix on Bug issues |
| `branchPrefix.chore` | `chore/` | auto-prefix on Task issues |

```bash
# Configure only missing keys
worktree config --missing

# Configure specific keys
worktree config --missing --names jira.host,jira.email,jira.apiToken

# Non-interactive: takes each key's default, or fails naming the key
# (for example `worktree config github.token <token>`)
worktree config --yes --names branchPrefix.feature,branchPrefix.bugfix

# List all current values
worktree config --list
```

## Common Mistakes

### CRITICAL `worktree checkout` used to create a new branch

Wrong:

```bash
worktree checkout feature/my-brand-new-feature
```

Correct:

```bash
worktree branch feature/my-brand-new-feature
```

`checkout` only creates a worktree from an existing remote branch.
Running it with a branch name that doesn't exist on the remote will fail.

Source: `docs/commands/branch`, `docs/commands/checkout`

---

### HIGH Running commands outside a git repository

Wrong:

```bash
# In /tmp or a non-git directory
worktree branch feature/x
```

Correct:

```bash
cd /path/to/your/git/repo
worktree branch feature/x
```

`gitGetRootPath()` throws `"Unable find the root path. Are you in a git repository?"` when no git repo is found in the current directory or any parent.

Source: `src/lib/git.ts` — `gitGetRootPath()`

---

### HIGH Skipping `worktree config` before first use

Wrong:

```bash
npm install -g @northguild/worktree
worktree branch feature/x
```

Correct:

```bash
npm install -g @northguild/worktree
worktree config          # run once per repo
worktree branch feature/x
```

Without `defaultSourceBranch` set, `branch` offers to run `config` in a
terminal and uses `origin/main` when non-interactive, with a warning naming the
missing key. Without `codeEditor`, the
worktree is created but not opened — unless `opener` is `herdr`, which
ignores `codeEditor` and opens a Herdr space instead, or `none`, which opens nothing.

Source: `src/commands/branch.ts`

---

### HIGH `--jira` flag used with incomplete Jira config

Wrong:

```bash
worktree config jira.host https://company.atlassian.net
worktree branch --jira DEV-123
```

Correct:

```bash
worktree config jira.host https://company.atlassian.net
worktree config jira.email your@company.com
worktree config jira.apiToken ATATT3xFfGF...
worktree branch --jira DEV-123
```

All three Jira keys are required. Missing any one causes an authentication
error when the CLI calls the Jira API.

Source: `docs/guides/jira-integration`, `src/integrations/jira.ts`

---

### HIGH `--agent` used without `agent.command` configured

Wrong:

```bash
# Nothing set agent.command
worktree branch feature/x --agent "add bulk actions to the table"
```

Correct:

```bash
worktree config agent.command "claude --bg"
worktree branch feature/x --agent "add bulk actions to the table"
```

A brief with no agent configured to take it exits `2` before any worktree is
created, naming the missing key: `worktree config agent.command "<command>"` for
the detached start (editor or `none` opener, `--no-open`, or Herdr not installed), or
`worktree config herdr.agent <kind>` on the Herdr path, where `herdr.agent`
alone is enough (`branch` and `checkout` both). Set the key first, or check
`worktree config --list`.

The soft path remains only for a run where Herdr was the opener, had an agent
kind, and did not open: with no `agent.command` to fall back to, the worktree is
created, a `No agent configured` warning is printed, and the exit code is `1`
because the brief was not delivered.

Source: `src/lib/base-command.ts` — `dispatchAgent()`

---

### MEDIUM `--source` flag given without `origin/` prefix

Wrong:

```bash
worktree branch feature/x --source main
```

Correct:

```bash
worktree branch feature/x --source origin/main
```

A `--source` value without the `origin/` prefix triggers a `confirm()`
interactive prompt asking whether to use a local branch. A non-interactive
run does not wait for it: it exits 2 with
`worktree: no default for whether to use the local source branch main; pass --source origin/main`.

Source: `src/commands/branch.ts` — `confirmNonOriginSource()`

---

### MEDIUM `codeEditor` set to a `herdr` command instead of `opener`

Wrong:

```bash
worktree config codeEditor "herdr worktree open --focus --path"
```

Correct:

```bash
worktree config opener herdr
```

The `codeEditor` form happens to work only because the worktree path is
appended as the final argument. It cannot label the space, cannot read
what Herdr answered, and cannot start an agent. `opener` is the
supported route.

Source: `docs/guides/herdr-spaces`, `src/lib/base-command.ts` — `openWorktreePath()`

---

### MEDIUM Branch prefix configured without trailing slash

Wrong:

```bash
worktree config branchPrefix.feature feature
```

Correct:

```bash
worktree config branchPrefix.feature feature/
```

The prefix is concatenated directly with the branch slug. Without a
trailing slash, issue-derived names run together: `featuremy-thing`
instead of `feature/my-thing`.

Source: `docs/configuration`, `docs/guides/github-issue-integration`

---

### HIGH Tension: interactive prompts vs scripted use

The CLI is designed for interactive human use — confirm prompts, branch
pickers, and spinners are the default UX. A run is non-interactive when stdin
is not a TTY, `CI` is set (not `""`, `0` or `false`), or `--non-interactive`
or `--yes`/`-y` is given. It never prompts and never animates: a prompt with a
default takes it, and one without fails at once with exit 2 and a single
stderr line, `worktree: no default for <value>; pass <flag>`.

Provide explicit values so nothing is left to default or fail:

```bash
# Instead of relying on interactive pickers:
worktree branch feature/x --source origin/main
worktree remove feature/x --force
worktree cleanup --force
worktree checkout origin/feature/x   # `checkout` and `open` need the branch argument
```

Non-interactive `remove` needs `-f` and `cleanup` needs `--force`: removal has
no default. A missing GitHub token exits 2 and names
`worktree config github.token <token>` or `gh auth login`; the token is never
printed.

Source: `src/commands/branch.ts`, `src/commands/cleanup.ts`, `src/commands/remove.ts`
