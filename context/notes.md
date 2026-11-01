# Notes

Branch-local and advisory. Nothing reads this file, and `/feature-close` deletes it.

## Phase 1 — `startJiraIssue` (Gate 2, non-blocking)

- `startJiraIssue` lets a non-timeout fetch error through unchanged (`fetchJira`, `jira.ts:265`), unlike `startClickUpTask`, which wraps its `send`. A network failure reads "fetch failed" with no `Jira:` prefix. The token leak §5 fears looks unreachable here, as the header value is base64. Reasoned, not run.
- A transition with no `to.id` is admitted (`jira.ts:634`), so two such candidates with different names collapse into one target and write. A transition with no string id is skipped (`jira.ts:629`), which could hide a second target. Both are theoretical against the published schema.
- A `[null]` transitions list or a `null` body throws a raw `TypeError` rather than `Jira: Unexpected response`.
- Untested: the fallbacks for a nameless status or transition, a stalled body in `startJiraIssue`, and a 400 on a read. A 403 takes the generic message, unlike `jiraAssignFailure`, which names the permission.
- `jira.ts:575` (a const arrow helper) and `jira.ts:626` (`as JiraTransition[]`) sit against `typescript/rules.md`, and the file hand-narrows rather than using Zod, as its existing code does.
- The exact 409 and generic wording has no source beyond the implementation; only the substance traces to D8.

## Phase 2 — `jira.autoStart` (Gate 2, non-blocking)

- This is the fifth copy of the tri-state select block in `config.ts`. Plan §4 asked for that shape, so it is a candidate for later rather than a defect.
- The new config tests use `(config as any).parse` and const arrow helpers against `typescript/rules.md`, matching the file's existing pattern and its `biome-ignore-all`.
- The decline test does not itself assert the Jira confirm was asked, and relies on the accept test to rule out a vacuous pass.
- The phase's coder did not load its `Standards:` files, reading `context/standards/README.md` as describing a remote repository. Gate 2 checked the change against them.

## Phase 3 — `--start` for `--jira` (Gate 2, non-blocking)

- A declined prompt has no Jira test, though the value path is shared with `--no-start` and pinned under the Linear key.
- The catch shows only `Jira:` messages, so offline a person reads `The request to Jira failed (TypeError).` while the branch page says it warns with the reason. `error.cause.code` could be surfaced safely. A non-JSON 200 body lands here as `SyntaxError` too.
- The assign catch (`branch.ts:795`, the same on main) still interpolates `error.message`. The header leak the new catch guards against looks unreachable for Jira, whose header value is base64 (phase 1's review reasoned this; nobody ran it), so it was not filed as a bug.
- The comment atop the "starting the issue" tests overstates its source: the exact `left-alone` and `ambiguous` strings are the code's own wording, and only their parts trace to D1 and D3. The "thrown Jira failure" fixture matches no message in `jiraStartFailure`; that test only pins pass-through.
- `spinner.warn` is unasserted for Jira, so dropping it fails nothing, though it is the only route a person sees outside `--json`.
- `--assign` and `--start` together have no Jira test (a §5 risk). The code is correct, as `assignJiraIssue` catches.
- Single-row `it.each` at `branch.test.ts` ~2212 and ~2260 could be plain `it`, and new `as any` in tests matches the file's convention.
