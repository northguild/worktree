---
"@northguild/worktree": patch
---

A failed Jira request answered with an HTML error page, such as a proxy's 502 or 503 page, no longer pastes the whole page into the error. `worktree` now gives the status and names the host that answered. A JSON or plain-text error from Jira is still shown.
