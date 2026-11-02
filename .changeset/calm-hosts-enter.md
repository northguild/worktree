---
"@northguild/worktree": minor
---

`--github` now works with GitHub Enterprise Server: set `github.host` to your instance and the token comes from `gh auth login --hostname`. Remotes in every git URL form are now read, and a gh logged in only to an Enterprise host no longer sends that token to github.com.
