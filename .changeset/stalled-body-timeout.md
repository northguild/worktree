---
"@northguild/worktree": patch
---

A Linear, GitHub or Jira response whose body stalls past the 15-second limit is now reported as a timeout: the message says the call did not answer within 15s, and `--json` gives the code `timeout` instead of `failed`.
