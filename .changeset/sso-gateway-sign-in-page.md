---
"@northguild/worktree": patch
---

A Jira site behind an SSO gateway no longer fails with a raw JSON parse error. When the gateway answers an API call with its sign-in page, `worktree` now says that Jira's host answered with a web page, not the API, and names the host it was redirected to.
