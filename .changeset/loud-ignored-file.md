---
"@northguild/worktree": patch
---

A `.worktree.yml` in your worktree is no longer ignored without a word when your default branch has none. `worktree` now warns that the file is not in use and names `WORKTREE_PROJECT_CONFIG` for trying it.
