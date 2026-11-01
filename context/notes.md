# Notes

Branch-local and advisory. Nothing reads this file, and `/feature-close` deletes it.

## Phase 1 — `startJiraIssue` (Gate 2, non-blocking)

- `startJiraIssue` lets a non-timeout fetch error through unchanged (`fetchJira`, `jira.ts:265`), unlike `startClickUpTask`, which wraps its `send`. A network failure reads "fetch failed" with no `Jira:` prefix. The token leak §5 fears looks unreachable here, as the header value is base64. Reasoned, not run.
- A transition with no `to.id` is admitted (`jira.ts:634`), so two such candidates with different names collapse into one target and write. A transition with no string id is skipped (`jira.ts:629`), which could hide a second target. Both are theoretical against the published schema.
- A `[null]` transitions list or a `null` body throws a raw `TypeError` rather than `Jira: Unexpected response`.
- Untested: the fallbacks for a nameless status or transition, a stalled body in `startJiraIssue`, and a 400 on a read. A 403 takes the generic message, unlike `jiraAssignFailure`, which names the permission.
- `jira.ts:575` (a const arrow helper) and `jira.ts:626` (`as JiraTransition[]`) sit against `typescript/rules.md`, and the file hand-narrows rather than using Zod, as its existing code does.
- The exact 409 and generic wording has no source beyond the implementation; only the substance traces to D8.
