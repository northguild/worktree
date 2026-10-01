---
"@northguild/worktree": minor
---

The usage skill is now a plain Agent Skill at `skills/worktree/`, installable with `npx skills add northguild/worktree --skill worktree`. TanStack Intent support is removed: the `skills/core/` and `skills/_artifacts/` files and the `tanstack-intent` keyword are gone, so Intent no longer discovers the package.
