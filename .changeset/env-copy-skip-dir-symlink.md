---
"@northguild/worktree": patch
---

`worktree branch` and `worktree checkout` no longer stop copying files at a gitignored symlink to a directory (or to nothing) that matches an env-file name or a `copy` pattern, such as `.env.link`; it is skipped and the files after it are still copied.
