---
"@northguild/worktree": patch
---

`worktree branch --github` no longer saves the token from `gh auth token` into git config, so a refreshed or revoked `gh` token is not shadowed by a stale copy. When GitHub refuses a token with a 401, the error now says so and names the fix; when the refused token is one stored in git config, including a `gh` token an earlier version saved, it says so and names `worktree config github.token <token>` and `git config --unset northguild.worktree.github.token`.
