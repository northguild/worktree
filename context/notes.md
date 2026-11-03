# Notes — jira-data-center (#126)

Non-blocking review observations. Branch-local; `/feature-close` deletes this file whole. Nothing reads it.

## Phase 1 — The `jira.deployment` key

- `config.test.ts` exercises `--list --missing` only. The prompting `config --missing` run (no `--list`) is
  not exercised for `jira.deployment`, where the risk is an empty Jira group question (`config.ts`,
  `hasJiraPrompt`). Membership in `UNPROMPTED_CONFIG_NAMES` is pinned, so a regression on this key still
  fails a test. `github.host`'s test has the same gap.
- `validators.test.ts` pins the message "Jira deployment must be cloud or datacenter", which D2 does not
  specify. The `worktree config` refusal says "Jira deployment" rather than `jira.deployment`, as the other
  validators word theirs.
- `src/lib/types.ts` changed though it is not on the phase's Files line (a one-line `JiraDeployment` alias
  beside `OpenerKind`).
- `config.test.ts` asserts membership in constant arrays, mirroring the `github.host` test; the behavioural
  tests beside it cover the same rule.
- The narrowing comment in `resolveJiraDeployment` runs to 85 characters, a little past the file's ~80.

## Phase 2 — Data Center reads, start, keys and URLs

- `unreachableError` strips user info with `/^[^/@]*@/`, which stops at the first `@`. A raw `@` inside a
  password (`u:p@ss@host`) leaves `ss@host` in the message. A greedy `/^[^/]*@/` would close it.
- The FAQ's "Yes", the guide's opening line, and the branch page's "not asked on Data Center" are true only
  once Phases 3 (assignment) and 5 (wizard) land. Until Phase 5 the first-time wizard still asks for
  `jira.email`.
- Only `UNABLE_TO_VERIFY_LEAF_SIGNATURE` of D10's six TLS codes is tested. All six exist as strings in
  Node 24's libnode.
- About 53 older tests print "Unexpected subprocess calls" warnings (`test-setup.ts`) for the new
  `jira.deployment` read. Not failures; `expectCommands` entries would clear the noise.
- Untested rules: `isAtlassianCloudHost` lower-casing and stripping port and path; `branch.test.ts`
  accepts `MY_KEY-3` with the deployment unset (cloud), which a real Cloud run would later refuse.
- The guide's Suggested Setup block is still unlabelled though it applies to Cloud only.
- D10's message gives no next step for non-TLS codes; D10 settled that form.
- Cosmetic: a stray blank line in `fetchJira`'s parameter list; the test titled "still needs jira.apiToken,
  and names only the host and the token" claims more than it asserts.

## Phase 3 — Data Center assignment

- The coder wrote the implementation before the tests; a key→name mutation run showed the key/name tests
  discriminate, and every expected value traces to §8 or D8/D9.
- On DC the "cannot determine the user" throw fires when `myself.name` is missing even if `key` is present
  (the write body needs `name`). A key-only `myself` on an issue already assigned to that key throws rather
  than returning `already-yours`. Untested; the seam is a `myself` with `key` and no `name`.
- DC 403/400/404 at the assignee write keep the shared wording, which names no credential; untested on DC.
  The DC 401 at the issue read is also unasserted.
- The DC "Could not determine the user behind jira.apiToken …" message gives no next step
  (`typescript/error-handling.md`); the Cloud original has the same shape.
- The DC identity check tests `!== undefined`, so a JSON `"key": null` on both sides would read as
  `already-yours`. `!= null` would close it. Theoretical.
- The guide's "Assigning the issue" line is now one long unwrapped line.

## Phase 4 — Data Center field values

- §9 Q3 defers `system: "environment"` to Q2, but Q2's checklist asks only to dry-run a description and a
  textarea field. A Q2 pass should also record the `environment` field's `schema` from `expand=schema`.
- `jira.test.ts`'s DC field fixture still carries `environment` entries (one with `system: "environment"`)
  that nothing asserts.
- The DC dry-run URL (`?expand=names,schema`) is pinned by composition, not by a `fetch` assertion in the
  dry-run helper.
- Two Cloud behaviours are not pinned: a user field gives `{ id: accountId, name: displayName }` (the label
  order changed to `value, displayName, name`; safe on Cloud, whose user `name` is "no longer available"),
  and ADF rich text gives no values, which the docs now state.
- The textfield fixture cites a community post; Atlassian's KB lists
  `…customfieldtypes:textfield` and could be cited instead.
- `getJiraIssueFields(issue, deployment = "cloud")`: a future caller that omits the deployment gets Cloud
  behaviour on DC silently. The nested ternary building `expand=` would read better as a named local.

## Phase 5 — The wizard on Data Center

- The new `--list --missing` DC test's comment says the Cloud case is "the existing --list --missing case
  above", but no existing `--list --missing` test asserts `jira.email` on Cloud. A mutation to
  `skipEmail = missing` would pass. An `it.each` over `datacenter` / unset would pin both sides.
- "Naming `jira.email` with `--names` still asks for it, unless `--missing` is also given" is true by the
  code but untested.
- `isJiraDataCenter()` turns a hand-edited bad `jira.deployment` into Cloud prompts with no warning (it
  must catch `InvalidValueError` so a bad `.worktree.yml` does not crash the wizard). The test pinning it
  has no plan source; a `this.warn` for a non-`ProjectConfigError` value would surface it.
- The project-file case is tested only through a `getTeamConfigValue` spy on `--names jira.apiToken`, not
  a bare run or `--missing` with a real file.
- Cloud-unchanged is pinned by `toContain` on two of the five instruction lines.
- The new test helpers (`withDeployment`, `run`, `logged`, `asked`) are `const` arrows, against
  `typescript/rules.md`'s function-declaration rule.
- Worked in a scratch tree beside Phase 4 (tip 925da1c).
