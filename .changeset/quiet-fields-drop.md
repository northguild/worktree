---
"@northguild/worktree": patch
---

On Jira Data Center, `worktree branch --jira` no longer offers the `Environment` field or the bundled `Development` field as rule values. Both used to print into the dry run, `Development` as a 3 KB Java string that could never match a rule, and `Environment` as text that matches on Data Center but never on Cloud. A rule you already wrote on `environment` now matches nothing on Data Center.
