---
"@northguild/worktree": minor
---

`worktree branch --linear` with no identifier now lists your unstarted and started Linear issues and lets you pick one, instead of needing the key up front. A non-interactive run (`--json`, CI, an agent) or `--dry-run` still refuses and needs an identifier.
