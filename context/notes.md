# Notes

Branch-local and advisory. Nothing reads this file, and `/feature-close` deletes it.

## Phase 1 — Record the Linear link at `branch --linear`

- The ordering in Done-when is proved by three tests together, not one: `branch.test.ts` sees `gitCreateWorktree` then one `gitSetBranchIssueLink`, `issue-link.test.ts` sees one `git config` argv, and `git.test.ts` sees `git worktree add` inside `gitCreateWorktree`. The picker test's title claims an order it does not assert; it shares the code path.
- Two expected values come from the code rather than a source: the `Invalid issue identifier.` text, and exit 128 rethrowing stderr. The plan's "unknown is never safe" supports the second.
- The identifier pattern exists twice, `issue-link.ts` and `getIssueIdentifier` in `linear.ts`, and nothing pins one to the other. On a duplicated key the last value wins, which matches git, but no plan row or test fixes it.
- `toThrow("Invalid issue identifier.")` is a substring match, so a value appended after the period would still pass. The old message does fail it.
- The `fatal: not a git repository` fixture in `issue-link.test.ts` is pass-through text, not what `--local` prints outside a repository.
- A failed write's warning keeps execFile's trailing newline, in `--json` too. `branch.ts:897` interpolates `error.message` the same way.

## Phase 2 — `fetchLinearIssueStates` in the Linear integration

- `fetchLinearIssueStates` does not check the identifier shape; its one caller's source, `gitGetBranchIssueLinks`, already does. `ENG1` would send `number: { eq: null }`, and matching on the returned identifier keeps that safe in direction.
- No test pins sequential chunks (`Promise.all` would pass) or the `.trim()`, which §4.2 does not ask for.
- Two test titles claim more than they assert: `includeArchived` is a literal in the query rather than a variable, and the timeout test does not assert the key's absence.
- `errors: []` proceeding is unasserted. A non-array `errors` beside a `canceled` node also proceeds, read from the condition rather than probed. D7 says "any `errors` array", and a GraphQL server should not send one.
- `parseIssueState` narrows by hand as `listAssignedLinearIssues` does, rather than with `zod`, because §4.2 names that function as its model.

## Phase 3 — The gather and the verdict read the signal

- `delete issue.state` in the gather's catch cannot run on a half-applied answer, because nothing after `states` is assigned can throw. It is harmless.
- `lookup` has no production caller passing `false`; §4.3 specifies the parameter. A failed record read with no key warns with `Linear:` text, which sits against D8's silence but is practically unreachable, because earlier `git` calls would already have failed.
- `await gitGetBranchIssueLinks().catch(...)` inside a `try` is against `typescript/error-handling.md`'s preference for `.catch` on fire-and-forget only.
- The shared-identifier test asserts the de-duplicated request, not that both branches get the state; a real-repo run shows they do. "Failed lookup means not removable" is pinned by composing two units, not end to end.
- The remote-check warning overstates a partial failure: with two remotes and one failing, the healthy remote's branches were considered.
- A canceled record on a branch with no worktree, or one that cannot qualify, still costs an `ls-remote`, bounded at one per remote.
- `gatherIssueLinks` uses a dynamic `import()`, the only one in non-test `src`, because a static one is a cycle; moving `showVisibly` to a leaf module would remove half of the reason.
- `git.test.ts:3120` cites "plan §2 vocabulary"; the vocabulary is in §1. The B4 assertions sit in the middle of `gathers once...` and would read better as their own test.
