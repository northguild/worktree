---
"@northguild/worktree": minor
---

`worktree branch --github` and `--assign` now read and assign issues in your `upstream` remote when it is a GitHub repository, so a fork no longer reads its own issue numbers. If your issues live on the fork, or on a repository neither remote points at, pin it with the new `github.repository` key (`owner/repo`, in git config or `.worktree.yml`). The output names the repository whenever it is not the one behind `origin`.
