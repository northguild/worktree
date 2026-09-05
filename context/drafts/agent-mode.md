# agent-mode — supplied reference material

Notes, not a design. Captured by `/roadmap` on **2026-09-05** from a brief written by the repository
maintainer. `/feature-plan` turns this into `plans/AGENT-MODE-PLAN.md`; nothing here is a decision.

## Provenance

- Source: maintainer brief pasted into `/roadmap`, 2026-09-05.
- External citation in the brief: <https://code.claude.com/docs/en/agent-view> — the maintainer's claim
  about background-session worktree isolation is attributed to that page. **Not independently verified
  during capture.** Docs move; re-check the page before the plan depends on the behaviour.
- The `claude agents --json` join (item 3) is marked "I verified this join works" by the maintainer.
  Also unverified here — no Claude Code invocation was made while writing these notes.

## The mechanic that makes it worth building

Claude Code background sessions normally isolate themselves into `<project>/.claude/worktrees/`, which
would fight this tool's `<repo>.worktrees/<branch>` layout. Per the brief, that isolation is **skipped when
the session's cwd is already inside a linked git worktree**. So if this CLI creates the worktree and
dispatches the agent with `cwd` set to it, the agent works inside our layout and no nested worktree is
created.

There is a `worktree.location` setting in Claude Code, but per the brief its own schema says the CLI does
not read it yet — so dispatching into an existing worktree is the only way to control placement today.
That is the whole reason this belongs in *this* tool rather than in agent configuration.

## Prerequisite — the shell interpolation bug

`src/lib/base-command.ts:56` interpolates unquoted into a shell string:

```ts
exec(`${codeEditor} ${path}`, (error) => { ... })
```

Verified present. Any worktree under a directory containing a space is already broken today, independent of
this feature. The fix is `spawn`/`execFile` with an argv array, plus a regression test for a path with a
space.

The maintainer's instruction is that this is fixed and tested **separately and first** — it stands on its
own. Per [`workflow.md`](../workflow.md)'s "feature or task?" rule it is commit-sized and would not earn a
`history.md` row, so it is an `/orchestrate` task, not part of this entry. It is recorded here because
agent mode makes it urgent: a prompt string is arbitrary user text full of quotes and apostrophes.

## Wanted, in the order the brief gives

1. **`worktree branch --agent "<prompt>"`** — new config value `agent.command` (e.g. `claude --bg`, but
   any CLI of that shape). `dispatchAgent(path, prompt)` on `BaseCommand` mirroring `openWorktreePath()`:
   split `agent.command` into argv, append the prompt as one argument, `cwd` = worktree path,
   `detached: true` + `unref()` so the CLI exits cleanly. Unset `agent.command` prints a message pointing
   at `worktree config` rather than erroring. `--agent` / `-a` string flag on `branch`.
   - **Ordering is load-bearing:** create worktree → copy env files → dispatch agent. Env files must land
     before the agent starts.
   - **Maintainer's preference:** `--agent` and the editor are independent; both can fire. Whichever way
     the plan decides, it must be documented.
   - End-to-end target: `worktree branch --github 47 --agent "implement the issue"`.
   - Same flag on `checkout` **only if it falls out cheaply**. Explicitly skippable.

2. **`worktree list --agents`** — add to `WorktreeListEntry`:

   ```ts
   filesChanged?: number;
   insertions?: number;
   deletions?: number;
   agent?: { name: string; pid: number };
   ```

   - Churn: `git diff --shortstat <merge-base with source branch> HEAD` per worktree.
   - Agent join: `claude agents --json` emits an array of live sessions each with a `cwd` and a `name`;
     join `cwd` to the worktree `path`. Gate behind `agent.command` being configured. **Degrade silently**
     if the command is missing or returns non-JSON — this must not become a hard dependency on Claude Code.
   - Output stays a printed table, consistent with current `list` formatting.

3. **Agent-aware `cleanup`** — `safeToRemove` does not know a live agent is mid-edit inside a worktree.
   Removing a worktree out from under a running agent is called out as *the worst failure mode in the whole
   flow*. Reuse the session join to mark such worktrees unsafe, and require an explicit override to remove
   them anyway.

## Constraints the brief states

- **Runtime-neutral.** Never hardcode `claude`. The command is a config string so Codex, or anything else
  with the same shape, works. **Tests must not depend on Claude Code being installed.**
- **No TUI, no monitor.** `claude agents` already is one. `list --agents` prints and exits.
- **No orchestration.** This tool decides *where* work happens, never *what* the work is. No task
  assignment, no queue, no prompt templating.

## What already holds in this repo

Read, not recalled — checked 2026-09-05 on `feature/add-agent-mode`.

| Claim | Status |
|---|---|
| Unquoted shell interpolation of the path in `openWorktreePath()` | confirmed, `src/lib/base-command.ts:51-66` |
| `CONFIG_NAMES` has `codeEditor`, no agent entry | confirmed, `src/lib/constants.ts:1-12` |
| `WorktreeListEntry` carries `ahead`/`behind`/`uncommittedChanges`/`safeToRemove` | confirmed, `src/lib/types.ts:12-19` |
| `branch.run()` already orders create → copy env → open editor | confirmed, `src/commands/branch.ts:182-184` |
| `safeToRemove` reasons only about remote / commits / uncommitted | confirmed, `isSafeToRemove()` at `src/lib/git.ts:153-166` |
| `cleanup` filters on `safeToRemove === true` and has only `--force` | confirmed, `src/commands/cleanup.ts:16-27` |
| `list` has no flags at all today | confirmed, `src/commands/list.ts:6-19` — `--agents` is the first |

Consequences the brief does not spell out, found while checking:

- **`codeEditor` is validated by `isValidCommand`** (`src/lib/validators.ts:57-71`, via `commandExists`).
  `agent.command` is a *command line*, not a bare command — `claude --bg` would fail that validator as
  written. The plan has to decide: validate only the argv head, or skip validation for this key.
- **`config.ts` gates `codeEditor` behind a `maybePrompt` confirm** (`src/commands/config.ts:211-224`).
  Following "how `codeEditor` is handled" means an equivalent opt-in confirm for `agent.command`.
- **`gitGetWorktreeList()` already does per-worktree async work in a loop** (`src/lib/git.ts:168-211`).
  Churn and the session join are two more calls per worktree on a path that is already serial — worth a
  thought about cost when the plan is written.
- The merge-base for churn needs a source branch per worktree. `gitGetWorktreeList` tracks `remote` but
  the entry has no record of what the worktree was *branched from*; `defaultSourceBranch` config
  (`src/commands/branch.ts:81`) is the likely fallback. Unresolved.

## Surfaces to update — all verified to exist

- `docs/src/app/docs/commands/branch/page.mdx`, `list/page.mdx`, `cleanup/page.mdx`
- `docs/src/app/docs/configuration/page.mdx` — for `agent.command`
- `docs/src/app/docs/commands/_meta.ts` — **only** if a new command is added (the brief prefers not)
- `skills/core/SKILL.md` — frontmatter `description` enumerates every command and config value, and
  `sources` lists derived-from files. Both need updating; `sources` already lists `src/commands/branch.ts`,
  `src/lib/git.ts`, `src/lib/validators.ts`.
- `README.md` — if the feature list changes

## Definition of done, per the brief

- `pnpm verify` green (see [`verify.md`](../verify.md) — that file, not this one, names the command).
- A real manual run: create a worktree with `--agent`, confirm the agent starts in the right cwd, confirm
  **no `.claude/worktrees/` directory appears inside the repo**.
- The brief's own instruction was "do not commit or push, leave the work in the tree and summarise". That
  was addressed to a direct implementation run and is **superseded** by the roadmap flow — `/feature-implement`
  commits per phase and updates the ledger in the same commit.
