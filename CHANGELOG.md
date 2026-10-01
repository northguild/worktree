# @northguild/worktree

## 2.1.0

### Minor Changes

- 20cc8b4: `worktree config` now asks yes/no and fixed-choice settings (`herdr.focus`, `github.autoAssign`, `opener`) as prompts instead of typed words, and `--yes --names <key>` keeps the stored value instead of exiting 2. Stored values and `worktree config <key> <value>` are unchanged.
- 20cc8b4: The usage skill is now a plain Agent Skill at `skills/worktree/`, installable with `npx skills add northguild/worktree --skill worktree`. TanStack Intent support is removed: the `skills/core/` and `skills/_artifacts/` files and the `tanstack-intent` keyword are gone, so Intent no longer discovers the package.
