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

## Phase 4 — `cleanup` removes and reports canceled worktrees

- Under `--ignore-agents` the new heading does not name the agent, because the classified copies have it stripped. The uncountable heading works the same way, and the user has asked to ignore agents.
- `--force` prints nothing about what it removed, even in a terminal, and that now includes removals decided by a tracker. It predates this feature.
- `!!wt.pathExists` in the new predicate cannot be false in a real run, and the state test in `removalReason` is equivalent on real inputs. §4.4 asks for the first.
- The "prints one warning" test counts a call its own mock makes, so it pins the pass-through; the one-warning rule is pinned in the gather tests. "removes it under --force too" uses a hand-set `safeToRemove`, so the real removal is proved only by the reviewer's real-repository runs.
- A transient `could not lock config file .git/config` in `src/agent-mode.test.ts` during one coder run did not reproduce in 24 runs and its cause is not established. The same text in passing runs is the mocked rejection at `branch.test.ts:2106`.

## Phase 5 — `list --issues` and its `--json` key

- `README.md:323` and `SKILL.md:304` ("Bounded calls") do not list `ls-remote`'s 60 s. Incomplete rather than false, and outside §7's rows.
- The Linear guide and `SKILL.md:199` still open with "Issue content is used for the branch name and nothing else, with one exception", though a state type now feeds a removal. The guide's "workflow metadata" paragraph makes that defensible.
- `faq/page.mdx` and `herdr-spaces/page.mdx` list the reasons a worktree is held back without naming "commits not confirmed"; what they say about closing spaces is still true.
- In `SKILL.md` the `issue` text sits mid-paragraph, between the `safeToRemove` and `mergedInto` sentences, and the `--help` text wraps with an orphan `recorded,` line. `README.md:186` discusses `safeToRemove` under a human example, though that key exists only in `--json`.
- The exact missing-key warning text has no §8 row; its form follows `linear.ts:83`. The `list.test.ts` "exactly one warning" count comes from its stub; the real rule is pinned in `issue-link.test.ts`.
