# @northguild/worktree

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
