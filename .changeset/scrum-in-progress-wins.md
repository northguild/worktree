---
"@northguild/worktree": patch
---

`--start` (and `jira.autoStart`) now moves an issue in a default Jira Cloud Scrum project, which offers both In Progress and In Review from To Do. When Jira offers more than one in-progress status, `worktree` takes the one named "In Progress"; with several and none so named it still writes nothing and tells you to move the issue in Jira. A non-interactive `--jira` run with `jira.autoStart` unset now moves these issues too; pass `--no-start` or set `jira.autoStart false` to keep them where they are.
