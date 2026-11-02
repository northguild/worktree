---
"@northguild/worktree": minor
---

`worktree branch --linear <ID>` now records the issue on the branch, and `worktree cleanup` removes a worktree whose Linear issue is canceled when its commits are all on the remote and it has no uncommitted changes. `worktree list --issues` shows each worktree's Linear issue and its state, and `--json` gains an `issue` key. This needs `linear.apiKey`; if Linear can't be reached, nothing is removed on its account.
