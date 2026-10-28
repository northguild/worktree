# Notes — jira-assign-on-branch (#124)

Branch-local, non-blocking observations from the gates. `/feature-close` deletes this file.

## Phase 1 — `assignJiraIssue`

- The fallbacks `"you"` (caller with no `displayName`) and `"someone else"` (holder with no `displayName`) in `assignJiraIssue` are untested.
- Nothing fails if the two reads in `assignJiraIssue` stop running concurrently (D2); only latency would notice.
- `assignJiraIssue` casts the `/myself` and issue JSON with `as`, as the sibling integrations do (`github.ts`); the fields read are checked at runtime and a malformed assignee lands on `held-by-other`, which writes nothing.
- The 403 and 404 messages say what failed but not the next step (e.g. "ask a Jira admin for Assign Issues").
- `jiraAssignFailure` ignores `x-seraph-loginreason`, which `fetchJiraIssue` checks; mitigated because `/myself` is read first and 401s on bad credentials.

## Phase 2 — `jira.autoAssign`

- `config.test.ts` "should ask the Jira prompts in order, the select after the token" counts calls only; comparing `invocationCallOrder` would pin the order.
- The "should write the %s answer to jira.autoAssign" test discards its label; the label→value mapping is pinned by the preselect test instead.
- The Jira select in `config.ts` is a near-copy of the GitHub one; a third provider key (#130 ClickUp, Linear) is the point to extract one.
- The docs written here describe `branch --jira` assigning, which is true only once phase 4 lands.

## Phase 3 — one assign decision

- The shared-decision tests reach the private `shouldAssignIssue` through `(branch as any)`, as the rest of `branch.test.ts` does; `branch["shouldAssignIssue"]` would keep the key type-checked but Biome's `useLiteralKeys` flags it.
- Phase 3's coder reported not loading the standards its `Standards:` line lists; the reviewer checked the diff against them.

## Phase 4 — `branch --jira` assigns

- `branch/page.mdx`'s `assigned` row lists `null` cases as "(no issue, `--no-assign`, or a configured `false`)", which omits a declined prompt and `--assign` with Linear or ClickUp; its `warnings` row says "a failed assignment", which undersells the held-by-other warning.
- The Jira guide's intro mentions only branch names, and its `--missing --names` setup list leaves out `jira.autoAssign`.
- `commands/config/page.mdx` says `true` "always" assigns without the held-by-other exception; it links to the configuration notes, which state it.
- For `/feature-close`'s release note: on upgrade an existing Jira user sees `--jira` prompt once (interactive) or assign (non-interactive) while `jira.autoAssign` is unset, by D3.
