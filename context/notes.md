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
