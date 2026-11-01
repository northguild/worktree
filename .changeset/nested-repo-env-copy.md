---
"@northguild/worktree": patch
---

`worktree branch` and `worktree checkout` no longer fail, and now copy your env files, when the repository holds a gitignored nested git repository such as a leftover Claude Code agent worktree under `.claude/worktrees/`.
