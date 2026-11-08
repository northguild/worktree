---
name: worktree
description: >
  Use when creating, listing, opening, renaming, removing or cleaning up git worktrees
  with the `worktree` CLI (@northguild/worktree), including starting a
  worktree from a GitHub, Jira or Linear issue or a ClickUp task, handing a new worktree to a coding
  agent, opening worktrees as Herdr spaces or Rex sessions, and driving worktrees from a
  script, CI or another coding agent with `--json`.
---

# @northguild/worktree

CLI wrapper for `git worktree` that turns the common branch-create,
env-copy, editor-open, and cleanup cycle into single commands. Config
is stored in git config under `northguild.worktree.*`; a committed `.worktree.yml`
can supply the team keys and a user config file your personal defaults (see
Configuration Reference). Worktrees
are created in a sibling directory named `<repo>.worktrees/`.

## Setup

```bash
npm install -g @northguild/worktree

# Run once inside your git repository
worktree config
# opens with one checklist, "What do you want to set up?" (GitHub, Jira, Linear,
# ClickUp, how worktrees open, the --agent command, branch prefixes, the
# post-create command), then asks defaultSourceBranch (e.g. origin/main) and
# the questions of each ticked item. Items already set up start ticked; unticking
# clears nothing. `--names <keys>` skips the checklist. A ticked "how worktrees
# open" asks opener, and its answer decides what follows: editor asks codeEditor,
# herdr asks herdr.focus, rex asks rex.focus, auto asks codeEditor and the focus
# key of each offered tool, none asks nothing. A ticked coding agent asks
# agent.command once (empty: no agent) and, with opener herdr, one yes/no that
# sets herdr.agent from the command's first word. The Herdr keys, and
# herdr as an opener answer, are offered only when `herdr` is on PATH (or opener
# is already herdr, or a Herdr key holds a value); opener itself is always
# offered, and `--names opener` offers all five answers. auto is offered where
# herdr or rex is, and never preselected unless already stored. rex.focus, and rex as an
# opener answer, follow the same rule for the `rex` CLI (found on PATH, in
# $REX_BIN_DIR or in the Rex app bundle).
# `worktree config <key>` prints one value, for scripts.
# It skips any key the project's .worktree.yml or your user config file sets and says which.

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
copies the gitignored env files from the root worktree (plus any gitignored
file the project's `.worktree.yml` lists under `copy`, which `checkout` copies
too), and opens the directory
in the configured `codeEditor` — or, when `opener` is `herdr`, as a Herdr space,
or, when it is `rex`, as a Rex session, labelled with the branch name. With
`opener` `auto` it opens in the Herdr or Rex the command runs inside (Herdr
first if both, and only when that CLI is installed), else in `codeEditor`.

### Check out an existing remote branch as a worktree

```bash
# Short form — origin/ prefix added automatically
worktree checkout feature/fix-login-timeout

# Full remote path also accepted
worktree checkout origin/feature/fix-login-timeout
```

Use `checkout` only for branches that already exist on the remote.
Use `branch` to create something new.

### Derive a branch name from a GitHub, Jira or Linear issue or a ClickUp task

```bash
# GitHub — requires github.token in config (or gh CLI authenticated). On a
# GitHub Enterprise host (github.host) only `gh auth token --hostname <host>`
# supplies the token; github.token is never read or sent there.
# Reads the repository named by github.repository (git config, then
# .worktree.yml), else the `upstream` remote when it is on github.host
# (github.com unless set), else `origin`. When that is not origin's, the output says so, e.g.
# "Fetching GitHub issue #42 from acme/widgets (upstream)". If a fork's issues
# are on the fork, pin it: worktree config github.repository <owner/repo>
worktree branch --github 42
worktree branch --github "#42"

# Assign the issue to yourself while creating the branch.
# Needs push access, and Issues: Read and write on a fine-grained token;
# --no-assign skips it for one run.
worktree branch --github 42 --assign
worktree branch --github 42 --no-assign

# Jira — requires jira.host, jira.email, jira.apiToken in config on Jira Cloud;
# on Jira Data Center (jira.deployment datacenter) jira.host and a personal
# access token in jira.apiToken, no jira.email
worktree branch --jira DEV-123
worktree branch --jira dev-123

# Assign a Jira issue to yourself; one held by someone else is left alone
# (a warning names them, `assigned` is false), and so is one whose assignee
# Jira does not show (a warning says so). Needs Browse Projects and
# Assign Issues on the project. --no-assign skips it for one run.
worktree branch --jira DEV-123 --assign

# Assign a ClickUp task to yourself; the task keeps its other assignees.
# Needs permission to edit the task. --no-assign skips it for one run.
worktree branch --clickup 9hx --assign

# Move a To Do Jira issue to its in-progress status once the worktree exists.
# Needs Transition Issues on the project. --no-start skips it for one run.
worktree branch --jira DEV-123 --start

# Linear — requires linear.apiKey in config
worktree branch --linear ENG-123
worktree branch --linear eng-123

# Linear — no identifier: a person picks one of their own unstarted or started
# issues at the terminal. A non-interactive run (--json, --yes, CI, no TTY) and
# --dry-run exit 2 with missing_value before any request, so an agent must pass
# the identifier.
worktree branch --linear

# Linear — move the issue to its team's started state once the worktree exists
# (needs a key with the Write permission). --no-start skips it for one run.
worktree branch --linear ENG-123 --start
worktree branch --linear ENG-123 --no-start

# ClickUp — requires clickup.apiToken in config; a custom id (DEV-123) also
# needs clickup.workspaceId. A short id is typed without CU- (CU-9hx is refused)
worktree branch --clickup 9hx
worktree branch --clickup DEV-123

# ClickUp — move an open-status task to the List's first in-progress status once
# the worktree exists (needs edit access to the task). --no-start skips it for one run.
worktree branch --clickup 9hx --start
worktree branch --clickup 9hx --no-start
```

`--github`, `--jira`, `--linear` and `--clickup` are mutually exclusive. `--assign` and
`--no-assign` need one of the four; `--assign --linear` skips the assignment
with a warning, because assignment is not supported for Linear yet. `--linear`
alone warns nothing about assignment.

`--start` and `--no-start` also need one of the four (exit `2` otherwise), and `--linear`,
`--clickup` and `--jira` act on them: `--start` with `--github` warns that it is not supported
and the run carries on. `--no-start` never warns. With neither flag,
`linear.autoStart` decides whether a `--linear` issue is moved to its team's started
state: `true` always, `false` never, and unset means you are asked once ("Move this
issue to started?") and the answer is saved to the key. A non-interactive run starts and
saves nothing. Only an issue in a backlog or unstarted state moves. One in triage,
completed, canceled or duplicate, or on a team with no started state, is left where it is
and a warning names the state. One that is already started is reported as it is, with
`started: true` and no warning. The move happens after the worktree exists, never on a dry run or
when an existing worktree is reopened, and a failure (a key without the Write
permission, say) warns and never changes the exit code.

`--clickup` follows the same order with `clickup.autoStart` as its key: `true` always, `false`
never, unset asks once and saves the answer, and a non-interactive run moves the task and saves
nothing. Only a task whose status type is `open` moves, to the List's first `custom` status by
position. One already in a `custom` status (In Progress, In Review) is reported as it is, with
`started: true` and no warning. One in a `done` or `closed` status or any other type, or in a List
with no `custom` status, is left where it is, a warning names its status and `started` is `false`.
It needs edit access to the task, and happens at the same point as the Linear move.

`--jira` follows the same order with `jira.autoStart` as its key: `true` always, `false` never,
unset asks once and saves the answer, and a non-interactive run moves the issue and saves nothing
(a script that passes `--jira` must use `--no-start` or `false` to leave the status alone). Only an
issue whose status category is To Do moves, through the transition that leads to an
in-progress status; where several statuses are offered, the one named "In Progress" (any
capitalisation) is taken, and no other name is matched. One already in progress is reported as it
is, with `started: true` and no warning. One that is done, or whose workflow offers no
in-progress transition or several statuses with none (or more than one) named "In Progress", is
left where it is, a warning says why and `started` is `false`. Needs the Transition Issues permission, and happens at the same point as the
Linear move.

With neither flag, `github.autoAssign` (for `--github`), `jira.autoAssign`
(for `--jira`) or `clickup.autoAssign` (for `--clickup`) decides whether the issue is assigned: `true` always, `false`
never, and unset means you are asked once and the answer is saved to the key
(a non-interactive run assigns instead, and saves nothing). A failed
assignment warns and the worktree is still created. A Jira issue that
someone else holds is never reassigned, even with `--assign`; a ClickUp task
keeps its other assignees and you are added.

The generated branch name is pre-filled in an interactive prompt and
editable before confirmation. A non-interactive run takes the pre-filled name
without asking. With `github.autoAssign`, `jira.autoAssign` or `clickup.autoAssign` unset it assigns the issue and does
not save the key; `false` or `--no-assign` skips assignment. With `jira.autoStart` unset a `--jira`
run also moves the issue to in progress, and `--no-start` or `false` skips that. Branch prefixes are applied when configured:
- `Feature` / `Story` → `branchPrefix.feature`
- `Bug` → `branchPrefix.bugfix`
- `Task` → `branchPrefix.chore`

That is the built-in Jira mapping, and it applies only when no rules are set (neither `jira.branchType` nor the shared `branchType`).
A `jira.branchType` list in `.worktree.yml` replaces it: ordered rules, the first
match wins, each `when:` names fields (by id, such as `customfield_10359`, or by
name, case-insensitively) and values (by name or `{ id: "10301" }`), every field
in a `when` must match, and `type:` is `feature`, `bugfix` or `chore`. `- otherwise:
<kind>` closes the list; without it an unmatched issue gets no prefix. A rule
naming a field the issue lacks warns (in `warnings` under `--json`) and does not
match; a rule in the shared list does not warn on a real run, but a dry run still prints the warning so a misspelt field shows up. Prefer ids in a provider's own list; in the shared list match `Type` and `Labels` by name. `github`, `linear` and `clickup` take a `branchType` list of the same
shape and replace their built-in mapping the same way: GitHub rules match `Type` and `Labels`, Linear
`Labels` (by name or id), ClickUp `Tags` (by name only; a tag has no id). `Type` and `Labels` are
portable: Jira also answers to `Type` (its issue type, beside `issuetype`) and `Labels` (beside `labels`, which a localized Jira does not display as "Labels") and ClickUp to `Labels` (its tags,
beside `Tags`), so one shared list reads the same everywhere. A top-level `branchType` list is
shared by every provider that has no list of its own; per run the order is the provider's own list, then the
shared list, then the provider's built-in mapping, and a shared list replaces the built-in mapping (no
fall-through on no match, so a list set for one provider's sake turns it off for the others unless it ends
in `otherwise`). GitHub's built-in gives an issue with no type no prefix; `- otherwise: feature` in
`github.branchType` or in the shared `branchType` opts in. `branchName: "{prefix}{id}-{slug}"`
in the file sets the shape of an issue-derived name (default as shown, today's names); a template that makes
an invalid branch name is refused, and a name typed as the argument is never templated.
To write rules against a real issue, run `worktree branch --<provider> <id> --dry-run`: it prints the name,
the rule that chose the prefix and each non-empty field with its id and a paste-ready `- when: { … }` line (by name for `Type` and `Labels` when the shared list decided; any other field is marked with `<provider>.branchType`, the list it belongs in; `--json` gives every field its list as `pasteInto`), and
creates, assigns, saves and asks nothing (`--json` prints its own document, with `match` and `fields`). A bare `--linear` is refused there with exit `2`, because choosing an issue is a question: pass the identifier.

Linear has no issue type, so its labels decide, compared case-insensitively
and by exact name: a `bug` label → `branchPrefix.bugfix`; else a `chore` or
`maintenance` label → `branchPrefix.chore`; otherwise (`Feature`,
`Improvement`, no label) `branchPrefix.feature`. A bug label wins over the
others. That is the built-in Linear mapping and applies only when no `linear.branchType` (or shared `branchType`) rules are set.
The name is the prefix, the upper-cased identifier and the slugged title, such as `fix/ENG-123-fix-login`.

ClickUp's tags decide the same way, with the same `bug`, `chore` and
`maintenance` rule (a guess carried over from Linear, not confirmed against a
live Workspace), unless `clickup.branchType` rules (or the shared `branchType`) are set. A short id such as `9hx` becomes `CU-9hx` in the name
(`feature/CU-9hx-fix-login`); a custom id is upper-cased in the name only, and sent to ClickUp as typed
(`fix/DEV-123-fix-login`).

**Issue content is used for the branch name and nothing else, with two exceptions: the Linear menu and the opt-in Linear listener context.** A bare `--linear` shows the identifier, title and state name of the person's own unstarted and started issues to them at the terminal (escaped), never in `--json`, never to an agent; a non-interactive run cannot reach it. `--github`,
`--jira`, `--linear` and `--clickup` read the issue's number or key (`--github`, `--jira` and `--linear` also accept a pasted issue URL, refused with exit `2` if it names another repository, GitHub host, Jira site (its base: the host and any context path) or Linear workspace), its title (Jira:
summary) and its type (GitHub: its type and labels; Linear: its labels; ClickUp: its tags); `--linear` with a start also reads the issue's
workflow state and its team's started states (names, types and positions, never the description); `--clickup` with a start also reads the task's status and its List's statuses (never the description or comments); `--clickup` with an assignment also reads the authorized user's id and username and the ids of the task's assignees; `--jira` with a start also reads the issue's status and the transitions Jira offers from it (never the description or comments); `--github` also reads whether the
issue is closed and whether the number is a pull request. A pull request is
refused, naming `worktree checkout <branch>` when its branch is on `origin`
and its name is only letters, digits, `_`, `.`, `/` and `-`, and a closed issue warns (interactively, it asks first). The title is reduced to lowercase letters, digits and `-` before it
becomes part of the branch name, and the type only selects one of the
configured `branchPrefix.*` values, or none. The issue body and comments are
never printed, never written to the `--json` document (whose `issue` field
carries only the provider, number or key, and URL) and never passed to an
agent by `worktree` itself. A brief given with `--agent`, `--agent-file` or `--agent-stdin` is
exactly the text you supply. The second exception is `worktree linear-listen`: only with
`linear.agentContext` set to `true` (unset or `false` means off, and only the owner of the
machine can set it, never a `.worktree.yml`) does it add the delegated issue's `promptContext` text to the brief it
supplies, inside a fence labelled as untrusted issue content, cut at 32 KiB and never written to the
`--json` document, a Linear activity or a log line. An issue's text and comments are writable by everyone with
access to the issue, so with the key on, anyone who can edit or comment on a delegated issue can steer the agent;
leave it off for a shared workspace.

### Hand a new worktree to a coding agent

```bash
# Detached (non-Herdr) runs need agent.command, e.g. claude --bg; with opener herdr, herdr.agent alone is enough; opener rex needs agent.command; opener auto follows whichever it resolves to
worktree branch feature/add-bulk-actions --agent "add bulk actions to the table"
worktree branch --github 42 --agent-file brief.md   # or --agent-stdin; exclusive, max 131,071 bytes
worktree branch feature/x --no-agent                # open, but start no agent
worktree branch feature/x --no-open                 # print the path, open nothing
worktree branch --jira DEV-123 --dry-run            # show the name, the matching rule and the fields; create nothing
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
(lowercased, never truncated, printed on stderr). With `opener` `rex`, the Rex
session is created with the program `agent.command` names as its command and the
brief as that command's last argument (`--bg`/`--background` dropped); there is
no ready signal, so `agent.prompted` there means the session was created with the
brief, not that the agent read it, and a worktree whose session is already open
gets no second agent (exit `1`, brief not delivered). A brief too long for Rex (it
refuses a request over 65,536 encoded bytes; about 62,000 bytes of plain text,
less with quotes, backslashes, newlines, `<`, `>` or `&`) exits `2` before anything is created.
With `opener` `auto` the tool it resolves to takes the brief as above. Otherwise `agent.command` is
launched detached and left running, so `worktree` does not wait for it and its
output does not appear here. That output is discarded, not kept, so name an agent
that keeps its own session record: `claude --bg` (see `claude agents`), or
`codex exec` unless `--ephemeral` is passed.

### Drive worktrees from a script or another agent (agent mode)

`branch`, `list`, `remove` and `rename` can run with nothing at the keyboard: from a
script, CI or another coding agent, handing back one JSON document to parse.
Nothing in this mode prompts, animates or waits without a bound.

```bash
worktree branch --github 42 --json --agent-file brief.md   # one JSON document on stdout
worktree list --agents --json                               # liveness: agent.live
worktree remove feature/x -f --json                         # non-interactive remove needs -f
worktree rename feature/x bugfix/y --json                   # worktree and branch, together
```

A run is non-interactive when any of these hold: stdin is not a terminal, `CI`
is set and is not empty, `0` or `false`, `--non-interactive` or `--yes` (`-y`)
is given (every command accepts both), or `--json` is given on `branch`, `list`,
`remove` or `rename`. A prompt that has a default takes it. One that has none fails at
once with exit `2` and a single stderr line,
`worktree: no default for <value>; pass <flag>`.

Flags for agent mode:

| Flag | On | Does |
|---|---|---|
| `--json` | `branch`, `list`, `remove`, `rename` | one JSON document on stdout; everything for a person goes to stderr |
| `--agent <text>`, `--agent-file <path>`, `--agent-stdin` | `branch` (`checkout` takes `--agent`) | the brief for the agent, from a value, a file or piped stdin; mutually exclusive with each other and with `--no-agent`; read whole, empty is refused, at most 131,071 bytes |
| `--no-open` | `branch` | create the worktree and print its path; call none of Herdr, Rex or the editor |
| `--no-agent` | `branch` | open as usual, start no agent |
| `--install` / `--no-install` | `branch` | force the dependency install on or off for this run |
| `--assign` / `--no-assign` | `branch` | assign the `--github`, `--jira` or `--clickup` issue to you, or not |
| `--start` / `--no-start` | `branch` | move the `--linear` issue to its team's started state, the `--clickup` task to its List's first in-progress status, or the `--jira` issue through its workflow's in-progress transition (the one to the status named In Progress where there are several), once the worktree exists, or not; only a backlog or unstarted issue (Linear), an open-status task (ClickUp) or a To Do-category issue (Jira) moves, and a `--start` with no issue flag exits `2` |
| `--dry-run` | `branch` | with an issue flag (a `--linear` needs its identifier): print the branch name, the rule behind its prefix and the issue's fields with ids and paste-ready `when:` lines, and create, assign, move, save and ask nothing; `--json` prints its own document (`dryRun`, `branch`, `issue`, `kind`, `match`, `fields`, `warnings`) |
| `-f`, `--force` | `remove` | skip the confirmation; required when non-interactive |

Defaults when non-interactive:

- **Branch name** from `--github`: by default `<prefix><number>-<slug>` (a `branchName` template in `.worktree.yml` changes the shape), the slug cut to
  48 characters at the last dash. With no issue, the branch name is required.
- **Assignment:** `--assign`/`--no-assign`, then `github.autoAssign`,
  `jira.autoAssign` or `clickup.autoAssign`, then assign. The default is never saved.
- **Start (Linear, ClickUp, Jira):** `--start`/`--no-start`, then `linear.autoStart`,
  `clickup.autoStart` or `jira.autoStart`, then start: a non-interactive `--linear` run moves a
  backlog or unstarted issue to started, a non-interactive `--clickup` run moves an open-status task
  to the List's first in-progress status, and a non-interactive `--jira` run moves a To Do issue to
  its in-progress status, unless `--no-start` or the key is `false`. The default is never saved, and a failed
  move warns and changes no exit code.
- **Install:** on. The command is your `postCreate`, else the steps under
  `postCreate` in `.worktree.yml` (run in order, the first failure stops the
  rest), else the `postCreate` steps in the user config file (no approval), else inferred from the lockfile (`pnpm-lock.yaml`, `package-lock.json`,
  `yarn.lock`, `bun.lock`). With nothing to run it says so and carries on. A
  failure keeps the worktree, starts nothing and exits `1`.
- **Approval of the file's steps:** checked before anything is created. A
  non-interactive run (script, CI, `--json`, `--yes`) that has not approved them
  exits `2` with `missing_value`, naming `worktree config --approve` and
  `--no-install`; the message never contains a value to approve with. Do not try
  to approve for the person: run `branch --no-install`, or tell them to run
  `worktree config --approve` in a terminal. A personal `postCreate` and
  `--dry-run` need no approval.
- **Source branch:** `defaultSourceBranch` (git config, else `.worktree.yml`, else your user config file), else `origin/main` with a warning.
- **A branch name that is already taken** (a re-run of `branch`) is refused: exit
  `2`, `invalid_value`, naming the existing worktree's path and
  `worktree open <branch>`. A branch with no worktree, one checked out outside
  `<repo>.worktrees/`, and a worktree whose directory was deleted are refused
  the same way. On a terminal the first case asks whether to open it instead.
- **Removal** has no default: `remove <branch> -f`.
- **Bounded calls:** GitHub, Jira, Linear and ClickUp requests 15 s, `git fetch` 60 s,
  `gh auth token` and the session listing 10 s, the install 10 min. A command
  still running at its bound is sent SIGTERM, then SIGKILL 2 s later.

#### Output

With `--json`, stdout is one line holding one document, and a count that could
not be taken is `null`, never `0`. Tokens are never printed. The `branch`
document:

```json
{"path":"/abs/repo.worktrees/42-fix-login","branch":"42-fix-login","source":"origin/main",
 "issue":{"provider":"github","number":42,"url":"https://github.com/acme/demo/issues/42"},"assigned":true,"started":null,
 "envFilesCopied":["docs/.env.local"],
 "installed":{"ran":true,"command":"pnpm install --frozen-lockfile","steps":["pnpm install --frozen-lockfile"],"from":"lockfile","inferred":true,"ok":true},
 "herdr":{"space":"w5","pane":"w5:p1","agent":"wt-42-fix-login"},
 "rex":null,
 "agent":{"name":"demo-42-fix-login","kind":"claude","command":["claude","--name","demo-42-fix-login"],"prompted":true},
 "warnings":[]}
```

- `issue` is `{provider:"github",number,url}`, `{provider:"jira",key,url}`, `{provider:"linear",key,url}`,
  `{provider:"clickup",key,url}`, or `null`; `url` can itself be `null`.
- `assigned` is `true` when the issue is yours after the run, `false` when it is not (the attempt failed, a Jira issue is held by someone else, or Jira does not show a Jira issue's assignee), `null` when no assignment was attempted.
- `started` is `true` when the `--linear` issue, `--clickup` task or `--jira` issue is in a started state after the run (moved, or already there), `false` when it is not (left alone, no started state to move to, or the attempt failed), `null` when none was attempted.
- `herdr`, `rex` and `agent` are `null` when skipped. `rex` is `{session,block}`
  for the Rex session that was opened, `block` `null` when the session was
  found rather than reported by `rex new` (already open, or a timed-out `new`
  that turned up after); `agent` says whether an agent started.
  `agent.command` leaves the brief
  out. `agent.name` is `null` where this CLI named nothing: a detached
  start, or a Herdr kind other than `claude`. `agent.kind` is `null` on a
  detached start. `herdr.agent` is `null` when no agent was started in the
  pane.
- `installed` is `{ran:false,reason}` when skipped. `steps` are the commands
  that ran, in order; `command` is the one that failed, else the last that ran;
  `from` is `"git-config"`, `"project"`, `"user"` or `"lockfile"`. A failed install still
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
`false` when unknown. `safeToRemove` is the verdict `cleanup` acts on only with
`--agents` and `--issues`, and never for the current worktree; without them `list` does not weigh agent sessions or
canceled Linear issues.
With `--issues`, each entry also has `issue`: `null` when no Linear issue is
recorded, else `{provider,key,state}`, where `state` is the issue's state type
(`canceled`, `started`, ...) or `null` when it could not be read (one warning on
stderr; stdout is still one document). It asks Linear, and runs `git ls-remote`
when an issue is canceled, so use it only when you want that. `mergedInto` is `null` when the branch is not known to be
merged. With `--churn`, each entry also has `churn`:
`{files,insertions,deletions}` for its committed work, or `null` (never `0`) when
it could not be taken. With `--agents`, each entry also has `agent`:
`null`, or `{name,sessionId,herdrAgent,live,interactive,waiting}`, whose
`sessionId`, `herdrAgent`, `live`, `interactive` and `waiting` can each be
`null`. `waiting` is `true` for a live session that is idle between turns or
blocked on a question, interactive or not. `herdrAgent` is the name Herdr gives the agent (for example
`wt-42-fix-login`, the same as `herdr.agent` in the `branch` document), or its
pane id (for example `w4P:p1`) when Herdr reports no name. `agent.name` in the
`branch` document is the session name to address.

`remove --json` gives
`{"removed":[{"branch":"feature/x","path":"/abs/repo.worktrees/feature/x"}],"herdrSpacesClosed":["w5"],"rexSessionsClosed":[],"warnings":[]}`.
Naming a branch and removing nothing is a failure, never a success.

`rename --json` gives
`{"from":{"branch":"feature/x","path":"/abs/repo.worktrees/feature/x"},"to":{"branch":"bugfix/y","path":"/abs/repo.worktrees/bugfix/y"},"upstream":"origin/feature/x","herdrSpacesRenamed":["w5"],"rexSessionsRenamed":[],"warnings":[]}`.
`upstream` is `null` when the branch tracks nothing. The `*Renamed` keys list the ids of a Herdr space or Rex session
(whichever `opener` names; under `auto`, either installed tool's) that was relabelled to follow the rename; a failed relabel is a warning, not an error. A non-interactive run needs the new name, and `-f` when an
agent session is working in the worktree (without it, exit `2` with `missing_value`).

A failure prints `{"error":{"code","message"}}` on stdout, one line on stderr,
and exits non-zero. A `missing_value` error also carries
`details:{value,flag}` naming what was missing and the flag that supplies it.

| `code` | Means | Exit |
|---|---|---|
| `missing_value` | a value with no default was not given | `2` |
| `invalid_value` | a value or flag combination was refused, including a `branch` name that is already taken | `2` |
| `not_found` | something named does not exist | `2` |
| `timeout` | a bounded call did not answer in time | `1` |
| `failed` | anything else | `1` |

Exit codes follow the same rule without `--json`: `0` success, `1` failure,
`2` a usage or value problem. A human's Ctrl-C at a prompt, or Esc answered Yes to "Quit now?", stays silent and
exits `0`.

A brief that no configured agent would take (no `herdr.agent` or
`agent.command` for Herdr, no `agent.command` for Rex or the detached start)
exits `2` with `missing_value` before anything is created, and a brief over what
Rex accepts exits `2` with `invalid_value`.

#### A coordinator driving worker agents

A coordinating agent can fan work out to one worktree each:

1. Run `worktree branch --github N --json --agent-file brief.md` per issue.
   Write each brief in your own words. Do not copy the issue's body or
   comments into it as instructions: an outsider may have written them, and
   the worker acts on the brief with the user's authority (step 2).
2. Make the brief name the coordinating session and say its follow-ups carry
   the user's authority. Without that, a Claude session treats messages from
   other sessions as information, not instructions.
3. Set `agent.command` with a permission mode compatible with the
   coordinator's. Claude Code can hold a cross-session message for its user's
   approval when the two sessions' modes differ, and the worker then waits.
4. Read `agent.name` from the document to address the session, and
   `worktree list --agents --json` to check it is still `live`. `waiting` turns
   `true` when the worker finishes its turn or stops on a question: poll it.
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
# path of their directory. A finished session shows [done] (unless Herdr still shows it in a pane or its process is still running,
# when it is weighed like any live session: [waiting] if idle or blocked on a question); with no source
# available there are simply no sessions.

# See how much each worktree has changed (committed work only)
worktree list --churn
# Adds `Churn: +120 -8, 5 files` beside `Ahead:`: lines added, lines removed,
# files touched, against the same base `Ahead:` counts from. One more git call
# per worktree, so off by default; left out where it could not be taken.

# Show each worktree's Linear issue and whether it is canceled
worktree list --issues
# Reads the `branch.<name>.worktreeIssue` records `branch --linear` makes, asks
# Linear for the state types (needs linear.apiKey; one request per 50 branches),
# and, where an issue is canceled, asks the branch's remote with `git ls-remote`
# before calling it safeToRemove. With records and no key it warns once. Without
# the flag `list` reads no record, sends no request and runs no `ls-remote`.

# Reopen a worktree in your editor
worktree open feature/add-bulk-actions

# Rename a worktree and its branch together (the directory follows the branch name)
worktree rename feature/add-bulk-actions feature/bulk-actions
worktree rename feature/bulk-actions            # one argument: rename the worktree you are in, then `cd` to the new path
# Local only: the remote branch is left alone, and the branch still tracks it under its old name
# (`git push origin HEAD:<old name>` updates it). Needs git 2.9 or newer. A running editor or
# shell keeps the old path, and anything with absolute paths baked in (a Python venv) has to be recreated.

# Remove a specific worktree
worktree remove feature/add-bulk-actions
worktree rm feature/add-bulk-actions          # alias
worktree remove feature/add-bulk-actions --force  # skip confirmation

# Remove all stale worktrees (no unmerged commits, nothing uncommitted,
# no live agent session; and either the remote gone or never set, or a
# canceled Linear issue whose commits are all on the remote)
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

A branch made with `branch --linear` carries a record of its issue in git config
(`branch.<name>.worktreeIssue`). When `linear.apiKey` is set, `cleanup` reads those
issues' state types from Linear on every run, and a worktree tracking a live remote
branch is removed when the issue is `canceled` (no other state counts), it has no
uncommitted changes and no live agent, it is not ahead of its tracking ref, and the
remote confirms the branch's tip (`git ls-remote`, once per remote). It is listed as
`Linear issue ENG-123 canceled, no unpushed commits`. A canceled branch that fails the
unpushed or confirmation test is reported under `Skipped … whose Linear issue is
canceled but whose commits are not confirmed on …` and kept. A failed Linear lookup is one
warning, and the run decides as it did without the signal. A remote that cannot be asked is
one warning too: the canceled branches on that remote are kept, and those on a remote that
answered are still judged. The branch has to track its
remote (push with `-u`); with no key or no record `cleanup` makes no request.

A worktree an agent session is working in is never removed by `cleanup`; it
is reported as skipped instead. A session that is only idle (an agent left at
its prompt) does not hold anything back. `--force` does not override that — it answers
the confirmation prompt, not the safety verdict — and `--ignore-agents` does,
which is why that one has no short alias. The check covers an interactive
session in your own terminal, an agent this tool dispatched, and one Herdr
started (found through `herdr agent list`).

With `opener` set to `herdr`, both removal commands also close the Herdr space
the worktree was opened as, so a space does not outlive its checkout. With
`rex` they kill its Rex session instead, but only one whose every shell is in
that worktree: a shell in the main checkout, the current worktree or another
worktree leaves it open, and so does the session the CLI runs in
(`REX_SESSION`). With `auto` they ask every installed tool, not only the one
that would open now, so a space or session closes wherever it lives; the two
lookups run at once, and one tool failing to answer is a warning that does not
stop the other. `remove --json` lists the killed ids as `rexSessionsClosed`. Only
worktrees that were actually removed: a branch that was not found, a declined
confirmation, a failed removal and anything `cleanup` held back all keep their
spaces and sessions, because those checkouts are still on disk. A failed close is a warning
and the command still exits `0` — by then the worktree is already gone. With
`opener` unset, `editor` or `none`, no Herdr or Rex process is started by either command, and a fixed `herdr` or `rex` asks that tool only.

`rename` does not close a space: with `opener` `herdr`, `rex` or `auto` (asking the same tools `remove`
asks) it relabels the one open in the worktree to the new name (`herdr workspace rename`, `rex session rename`), looked up before the move and applied
only after the move and the branch rename both succeed. A failed lookup or relabel is a warning and the
command still exits `0`; `rename --json` lists the ids as `herdrSpacesRenamed` and `rexSessionsRenamed`. The Herdr
agent name and a Claude `--name` session keep the old branch name. The Rex relabel is unverified against a live Rex.

Note that `--ignore-agents` now closes a live agent's space or session too, taking down the
panes it is working in along with the directory.

### Start worktrees from Linear agent delegations (`linear-listen`)

```bash
# Run inside the repository to serve; stays in the foreground until Ctrl-C
worktree linear-listen
worktree linear-listen --port 9100 --path /hooks/linear --team ENG
```

Needs `linear.agentToken`, `linear.webhookSecret` and `linear.apiKey`, and a public HTTPS address that reaches the
listener: it binds `127.0.0.1` only (default port `8733`, not `8787`), so a tunnel or reverse proxy is the user's
step, not shipped. An unset key exits `2` with `missing_value` before it listens; a token Linear rejects, or a port
in use, exits `1`.

- Each delivery is checked in order: `POST` only (`405`), path (`404`), 1 MiB cap (`413`), the `Linear-Signature`
  HMAC-SHA256 of the raw body (`401`), JSON (`400`); a signed body that is not an agent session event it acts on
  gets `200` and is ignored; then the body's signed `webhookTimestamp` within a minute (`401`). Then `200` goes
  out before any work.
- Only the owner of `linear.apiKey` may start an agent, unless `linear.agentAllow` lists user ids. `--team <KEY>`
  ignores sessions of other teams.
- For an accepted session it writes a `thought` to the Linear session, runs
  `worktree branch --linear <KEY> --agent-stdin --json --yes`, and writes a `response` or an `error`. The brief
  names only the issue identifier, unless `linear.agentContext` is `true` (see "Issue content" above).
- Sessions run one at a time, so two `worktree branch` children never share the repository. A follow-up message is
  answered only on a session whose agent this listener prompted.
- `kill -TERM <pid>` waits for the session in flight; sessions still waiting their turn are not started. A terminal `Ctrl-C` also interrupts the running `worktree branch`, which may leave a half-made worktree. A second signal exits `130` at once.

## Configuration Reference

All keys are stored via `worktree config <key> <value>` in git config
under `northguild.worktree.*`.

A repository can commit a `.worktree.yml` at its root that supplies the team keys:
`defaultSourceBranch`, `branchPrefix.feature|bugfix|chore`, `jira.host`, `jira.deployment`,
`clickup.workspaceId`, `github.repository` and `github.host` (written nested: `jira: { host: ... }`). Precedence per key:
flag, then git config (any scope), then the file, then the user config file (below),
then the built-in default; the user file ranks below the team file. The
file is read from `origin/HEAD` (`git show`), never the working copy, and
`branch` fetches once before reading it; `WORKTREE_PROJECT_CONFIG=<path>` reads
that file instead and says so on stderr. A personal key (`opener`, `codeEditor`,
`herdr.*`, `rex.focus`, `agent.command`, `jira.email`, `*.autoAssign`,
`linear.autoStart`, `linear.agentAllow`, `linear.agentContext`, `clickup.autoStart`, `jira.autoStart`) in the file is ignored
with a warning; a secret key (`jira.apiToken`, `linear.apiKey`,
`linear.agentToken`, `linear.webhookSecret`, `clickup.apiToken`, `github.token`) or an invalid file stops `branch` with exit
`2` (`invalid_value`) before anything is created. An unknown key only warns. A
file's `jira.host` receives every teammate's Jira credentials, so treat a change
to it like code.

Config behaviours with the file: the wizard does not ask for a key the file sets (a
personal `postCreate` included when the file has steps). `worktree config <key>
<value>` for a key the file sets shows both values and asks; non-interactive it sets
the value and warns. `worktree config --list` prints `<key>=<value> (.worktree.yml)`
or `<key>=<value> (overrides .worktree.yml: <file value>)`, then one summary line per
file-only key (rules per provider, `branchName`, `copy`, `postCreate` steps). Values
from the user config file read `(user config)` or `(overrides user config: <value>)`.
`worktree config <key>` prints the resolved value (git config, then `.worktree.yml`,
then the user file), not git config alone; `postCreate` and secrets are excepted:
they print git config's value only (the files' step lists show in `--list`).
`worktree config --project` writes a commented `.worktree.yml` at the current
worktree's top level from the team keys in git config (never a personal or secret
key; a personal `postCreate` becomes a one-step list), uncommitted, and refuses to
overwrite an existing one. Local git config keys that hold the same value as a
`.worktree.yml` on the default branch (not one read through
`WORKTREE_PROJECT_CONFIG`) are removed without asking or printing by `branch`
(after the worktree is open, not `--dry-run`) and a bare `worktree config`,
`--json`, `--yes` and CI included. A matching key stays when another git config
scope also sets it (that value would win over the file), a local `postCreate`
stays until the file's step is approved (it is what skips the approval), and
with no `origin/HEAD` a local `defaultSourceBranch` stays, since it finds the
file. A failed removal is a warning, never a failed run. Only one step is an offer, on a terminal
only (never `--json`, `--yes`, `--non-interactive`, CI, no TTY or
`branch --dry-run`; in `branch`, after the worktree is open): `--project`, once
per repository, when the repository has no file and git config holds a team
key. Its answer lives under `northguild.worktree.*` outside the config keys, so
an agent cannot set it.

A user config file holds personal defaults for every repository: `$WORKTREE_USER_CONFIG`,
else `$XDG_CONFIG_HOME/worktree/config.yml` (only when set, non-empty and absolute), else
`~/.config/worktree/config.yml`. It is YAML, with a dotted key written nested
(`herdr: { focus: false }`). It takes the personal keys above (`jira.autoStart`,
`github.autoAssign` and the rest) and, as a fallback below `.worktree.yml`, the team keys
`defaultSourceBranch`, `branchPrefix.*`, `jira.host`, `jira.deployment`,
`clickup.workspaceId`, `github.repository`, `github.host` and `postCreate` (a list);
`branchType`, `branchName` and `copy` stay in `.worktree.yml`. A secret key in it stops the
run with exit `2`, naming the key; an unknown key warns and is ignored. Its `postCreate`
steps run without approval because the file is the user's own, so a file synced between
machines (dotfiles) can carry commands into every new worktree. Install steps run in the
order: git config `postCreate`, the approved `.worktree.yml` steps, the user file's steps,
then the lockfile. `worktree config --user <key> <value>` writes one key (keeps comments,
atomic, directory `0700`, file `0600`, never rewrites a file that does not parse; it takes
only a key and a value). The wizard skips keys the file sets and says so. `worktree config`
warns about a user file or `.worktree.yml` it cannot use and carries on; every other
command stops with exit `2`: on such a user file before it does anything, on such a
`.worktree.yml` when it reads it. With no user file nothing changes.

The file's `copy` list (relative globs such as `config/master.key`) names extra
files for `branch` and `checkout` to copy with the env files. A path must be
gitignored to be copied; a tracked file never is. Copied files are listed in
`envFilesCopied`, and `branch --dry-run` copies nothing.

| Key | Example value | Required for |
|---|---|---|
| `defaultSourceBranch` | `origin/main` | `worktree branch` without `--source`; also the fallback base for unpushed-commit counts when `origin/HEAD` is unset |
| `opener` | `editor`, `herdr`, `rex`, `auto` or `none` | where a worktree opens; `auto` picks Herdr or Rex from the terminal the command runs in (Herdr first if both, since Herdr can run inside Rex but not the reverse) when that CLI is installed, else the editor, and a shell that outlived its Herdr or Rex keeps its variables, so a fixed value is the escape; and for `herdr`, `rex` and `auto` where its space or session is closed on removal (`auto` asks every installed tool); `none` opens nothing and prints `Worktree created at <path>` (`Worktree already exists at <path>` on a reopen); defaults to `editor` |
| `codeEditor` | `code` | auto-opening worktrees when `opener` is `editor`, or `auto` falls back to it |
| `herdr.focus` | `true` or `false` | whether a new Herdr space is focused; defaults to `true` |
| `herdr.agent` | `claude` | starting an agent in a new Herdr space; unset means none, unless a brief is given, which falls back to `agent.command`'s program |
| `rex.focus` | `true` or `false` | whether the app is brought to a new Rex session; defaults to `true`, only `false` turns it off |
| `agent.command` | `claude --bg` | `--agent`, and the runtime listing behind `list --agents` and `cleanup`'s agent check (`herdr.agent` stands in when unset) |
| `postCreate` | `pnpm install` | the install step of `branch`; unset means the steps in `.worktree.yml` (once approved with `worktree config --approve`), then the user config file's, else infer from the lockfile (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock`); when set it also runs on a terminal; inferred, it runs by default only when non-interactive, or with `--install`; `--no-install` skips it |
| `github.token` | `ghp_...` | `--github` flag, for github.com only; a GitHub Enterprise host's token is read from `gh auth token --hostname <host>` |
| `github.autoAssign` | `true` or `false` | whether `--github` assigns the issue to you; unset means ask (assign when non-interactive) |
| `github.repository` | `acme/widgets` | which repository `--github` and `--assign` use: this key (team key, also under `github:` in `.worktree.yml`), else `upstream` if it is on `github.host` (`github.com` unless set), else `origin`; optional, and `worktree config` never asks for it |
| `github.host` | `ghe.example.com` | the GitHub host `--github` and `--assign` use, a bare hostname; default `github.com`; team key (also under `github:` in `.worktree.yml`); the clone also needs a remote on that host (`origin` when `github.repository` is set), or the run fails before any request; `worktree config` never asks for it |
| `jira.host` | `https://company.atlassian.net` | `--jira` flag |
| `jira.deployment` | `cloud` or `datacenter` | which Jira `jira.host` is: Jira Cloud or Jira Data Center (Server); unset means `cloud`; team key (also under `jira:` in `.worktree.yml`); `worktree config` never asks for it |
| `jira.email` | `you@company.com` | `--jira` flag |
| `jira.apiToken` | `ATATT...` | `--jira` flag |
| `jira.autoAssign` | `true` or `false` | whether `--jira` assigns the issue to you; unset means ask (assign when non-interactive) |
| `jira.autoStart` | `true` or `false` | whether `--jira` moves the issue to its in-progress status once the worktree exists; unset means ask (move when non-interactive); moving needs the Transition Issues permission |
| `linear.apiKey` | `lin_api_...` | `--linear` flag, and `linear-listen` requires it; also read by `cleanup` and `list --issues` for canceled issues |
| `linear.autoStart` | `true` or `false` | whether `--linear` moves the issue to a started state once the worktree exists; unset means ask (start when non-interactive); moving needs a key with the Write permission |
| `linear.agentToken` | `<oauth-token>` | the Linear agent app's OAuth token; secret (listed as `***`); read by `linear-listen`; `worktree config` never asks for it, and `.worktree.yml` cannot set it |
| `linear.webhookSecret` | `<signing-secret>` | the Linear agent app's webhook signing secret; secret (listed as `***`); read by `linear-listen`; `worktree config` never asks for it, and `.worktree.yml` cannot set it |
| `linear.agentAllow` | `user-id-1,user-id-2` | the Linear user ids allowed to delegate an issue to the agent; read by `linear-listen`, where unset means only the owner of `linear.apiKey`; `worktree config` never asks for it, and `.worktree.yml` cannot set it (a `linear.agentAllow` there is ignored with a warning) |
| `linear.agentContext` | `true` | whether `linear-listen` adds the delegated issue's text to the agent's brief, fenced as untrusted and capped at 32 KiB; only `true` or `false` is accepted, unset means `false`; `worktree config` never asks for it, and `.worktree.yml` cannot set it (a `linear.agentContext` there is ignored with a warning) |
| `clickup.apiToken` | `pk_...` | `--clickup` flag |
| `clickup.workspaceId` | `12345678` | optional; only a custom task id (`--clickup DEV-123`) needs it |
| `clickup.autoAssign` | `true` or `false` | whether `--clickup` assigns the task to you; unset means ask (assign when non-interactive) |
| `clickup.autoStart` | `true` or `false` | whether `--clickup` moves the task to in progress once the worktree exists; unset means ask (move when non-interactive); moving needs edit access to the task |
| `branchPrefix.feature` | `feature/` | auto-prefix on Feature issues, on Linear issues with no bug, chore or maintenance label, and on ClickUp tasks with no such tag |
| `branchPrefix.bugfix` | `fix/` | auto-prefix on Bug issues, on Linear issues labelled `bug`, and on ClickUp tasks tagged `bug` |
| `branchPrefix.chore` | `chore/` | auto-prefix on Task issues, on Linear issues labelled `chore` or `maintenance`, and on ClickUp tasks tagged so |

```bash
# Configure only missing keys
worktree config --missing

# Configure specific keys
worktree config --missing --names jira.host,jira.email,jira.apiToken

# Non-interactive: takes each key's default, or fails naming the key
# (for example `worktree config github.token <token>`)
worktree config --yes --names branchPrefix.feature,branchPrefix.bugfix

# List current values (tokens shown as ***; read one with worktree config <key>)
worktree config --list

# Write .worktree.yml from the team keys in git config (uncommitted)
worktree config --project
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
worktree is created but not opened — unless `opener` is `herdr` or `rex` (or `auto` resolving to one), which
ignore `codeEditor` and open a Herdr space or a Rex session instead, or `none`, which opens nothing.

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

On Jira Cloud all three Jira keys are required. On Jira Data Center
(`worktree config jira.deployment datacenter`) only `jira.host` and
`jira.apiToken`, a personal access token, are. Missing a needed one causes an
authentication error when the CLI calls the Jira API.

Source: `docs/guides/jira-integration`, `src/integrations/jira.ts`

---

### HIGH `--linear` flag used without a Linear API key

Wrong:

```bash
worktree branch --linear ENG-123
```

Correct:

```bash
worktree config linear.apiKey lin_api_...
worktree branch --linear ENG-123
```

`linear.apiKey` is the only required Linear key. Without it `branch --linear` exits `2`
(`missing_value`) before any worktree is created, and a non-interactive run
never prompts for it. `cleanup` and `list --issues` also read the key, but never require it: without one they make no request.

Source: `docs/guides/linear-integration`, `src/integrations/linear.ts`

---

### HIGH `--clickup` flag used without a ClickUp API token

Wrong:

```bash
worktree branch --clickup 9hx
```

Correct:

```bash
worktree config clickup.apiToken pk_...
worktree branch --clickup 9hx
```

`clickup.apiToken` is required. Without it `branch --clickup` exits `2`
(`missing_value`) before any worktree is created, and a non-interactive run
never prompts for it. A custom id (`DEV-123`) also needs `clickup.workspaceId`
(`worktree config clickup.workspaceId <id>`) and exits `2` without it. Type a
short id without `CU-`: `CU-9hx` is refused as an invalid id (`invalid_value`).

Source: `docs/guides/clickup-integration`, `src/integrations/clickup.ts`

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
the detached start (editor or `none` opener, `auto` with neither tool to open in, `--no-open`, or Herdr not installed) and
for `opener rex`, or
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
`worktree config github.token <token>` or `gh auth login`, or on a GitHub
Enterprise host `gh auth login --hostname <host>`; the token is never printed.

Source: `src/commands/branch.ts`, `src/commands/cleanup.ts`, `src/commands/remove.ts`
