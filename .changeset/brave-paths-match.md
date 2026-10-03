---
"@northguild/worktree": patch
---

`worktree remove` and `worktree cleanup` no longer fail with "is not a working tree" when another worktree's path, or the main checkout's, ends in the same name as the branch being removed — for example a checkout directory named like the branch, or branches `demo` and `x/demo` side by side.
