---
"@northguild/worktree": patch
---

`worktree branch` and `worktree config` no longer offer to write a `.worktree.yml` when your worktree already has one. The offer used to say the repository had no file, fail to write over yours, and still count as accepted so it was never made again.
