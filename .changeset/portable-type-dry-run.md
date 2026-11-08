---
"@northguild/worktree": patch
---

`worktree branch --dry-run` no longer warns "Check the spelling, or use the field's id" when a shared `branchType` rule names the portable `Type` or `Labels` and the provider does not offer it, such as `Type` on ClickUp and Linear. A misspelt field in the shared list still warns on a dry run.
