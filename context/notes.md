# Notes — jira-assign-on-branch (#124)

Branch-local, non-blocking observations from the gates. `/feature-close` deletes this file.

## Phase 1 — `assignJiraIssue`

- The fallbacks `"you"` (caller with no `displayName`) and `"someone else"` (holder with no `displayName`) in `assignJiraIssue` are untested.
- Nothing fails if the two reads in `assignJiraIssue` stop running concurrently (D2); only latency would notice.
- `assignJiraIssue` casts the `/myself` and issue JSON with `as`, as the sibling integrations do (`github.ts`); the fields read are checked at runtime and a malformed assignee lands on `held-by-other`, which writes nothing.
- The 403 and 404 messages say what failed but not the next step (e.g. "ask a Jira admin for Assign Issues").
- `jiraAssignFailure` ignores `x-seraph-loginreason`, which `fetchJiraIssue` checks; mitigated because `/myself` is read first and 401s on bad credentials.
