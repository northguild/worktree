---
"@northguild/worktree": minor
---

`worktree branch` and `worktree config` now remove, without asking, the local git config keys that the `.worktree.yml` on your default branch already sets to the same value. A key stays where removing it would change what `worktree` does: one another git config scope also sets, a `postCreate` whose step you have not approved, and a `defaultSourceBranch` when there is no `origin/HEAD`.
