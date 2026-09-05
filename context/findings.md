# Findings

Defects that outlive the session that found them. A reviewer `FAIL`, a verification gate that hits its
loopback cap, or a defect found by hand all land here — **before** the loopback, not after it, so a finding
survives even when the cap is hit and the task is escalated.

## Contract

**Severity.** `P0` breaks production or data. `P1` blocks a phase or a gate. `P2` is a real defect that
does not block. `P3` is a note worth not losing.

**Tied to.** Either a phase — `<feature-name> Phase <n>` — or `ad-hoc` for a finding raised by
`/orchestrate` outside any feature.

**Gating.** An open `P0` or `P1` tied to a phase blocks that phase from being marked `done`, and blocks
`/feature-close` on the feature that owns it.

**Closing.** A finding closes when **the gate that raised it re-passes**, citing that run. There is no
"fixed but unverified" state — that implies an owner this workflow does not have.

**Bound.** Closed findings leave this file: a feature's at `/feature-close`, folded into the retiring
plan's own log; an `ad-hoc` one at the start of the next `/orchestrate`. This file must not grow for the
life of the project.

**Shape.** Entries go under **Open** below, newest last, and look like this:

> ### F-001 — P1 — one line naming the defect
>
> **Tied to:** some-feature Phase 2 · **Raised:** YYYY-MM-DD (by the gate that raised it, or "hand")
>
> What is wrong, where, and why it matters. Cite the file and the evidence.
>
> **Closes when:** the condition that closes it, naming the gate run that would prove it.

---

## Open

### F-002 — P3 — the `pathExists` ordering rationale in §4.1 is not pinned by any test

**Tied to:** cleanup-data-loss Phase 2 · **Raised:** 2026-09-05 (Gate 2, reviewer subagent, Phase 2)

§4.1's first bullet argues that `!wt.pathExists` must stay the first branch — a worktree whose directory is
gone holds nothing to lose. No test enforces it. `src/lib/git.test.ts:255-257` covers `{ pathExists: false }`
with the `entry()` default of `uncommittedChanges: 0`, which returns `true` under either ordering, so a
future change hoisting the uncommitted test above the path test would flip
`{ pathExists: false, uncommittedChanges: 3 }` from `true` to `false` with no test failing.

Latent, not live: `gitGetWorktreeList` hardcodes `uncommittedChanges` to `0` when the path is missing
(`src/lib/git.ts:200-202`), so the combination is unreachable from the list builder. Left open rather than
fixed because Phase 2's **Done when** names exactly two over-reach cases and this is not one of them —
adding it would have landed an unreviewed assertion after Gate 2 had already passed on the diff.

This matters sooner than it looks: `agent-mode` Phase 6 adds a live-agent clause to this same predicate
(§2, R2), and is the natural place to pin the ordering while the branches are being re-read anyway.

**Closes when:** a Gate 1 run passes with a `git.test.ts` case asserting the verdict for
`{ pathExists: false, uncommittedChanges: 3 }`.

### F-003 — P3 — a path-less worktree with a non-zero change count would be listed as skipped *and* removed

**Tied to:** cleanup-data-loss Phase 3 · **Raised:** 2026-09-05 (Gate 2, reviewer subagent, Phase 3)

For `{ pathExists: false, uncommittedChanges: 3 }` both halves of `cleanup`'s split claim the entry:
`isSafeToRemove` returns `true` at `src/lib/git.ts:159-162`, so it lands in `worktrees`
(`src/commands/cleanup.ts:48`), and `isSkippedForUncommittedChanges` (`src/commands/cleanup.ts:17-21`) also
returns `true`, because its zeroed probe hits that same first branch. The command would print the worktree
as skipped and then remove it anyway.

Latent, not live, and for the same reason as F-002: `gitGetWorktreeList` hardcodes `uncommittedChanges`
to `0` when the path is missing (`src/lib/git.ts:200-202`), and `cleanup` consumes no other source. The
one-line form is `wt.safeToRemove !== true &&` in front of the existing condition. Left open rather than
fixed because Gate 2 had already passed on the diff — the same reasoning F-002 records — and because both
findings are the `pathExists: false` ordering question that `agent-mode` Phase 6 will have this predicate
open for anyway.

**Closes when:** a Gate 1 run passes with a `cleanup.test.ts` case proving that entry appears in at most one
of the two lists.

### F-004 — P3 — Phase 4's regression cases are looser than the §4.3 claim they pin

**Tied to:** cleanup-data-loss Phase 4 · **Raised:** 2026-09-05 (Gate 2, reviewer subagent, Phase 4)

Two assertions in `src/commands/remove.test.ts` prove less than the plan's §4.3 claims, in ways a future
edit could exploit without failing a test:

- The confirmation case selects a single worktree (`remove.test.ts:367-368`), where `some` and `every` are
  equivalent — so mutating `selected.some((wt) => !wt.safeToRemove)` at `src/commands/remove.ts:81` to
  `every` passes. §4.3 names `some` specifically, and a mixed selection of `[safeWorktree, mergedWithWork]`
  is the multi-select shape the phase is titled after. The pre-existing case at `remove.test.ts:173-194`
  has the identical gap, so this is not introduced here.
- The grouping case asserts position only (`remove.test.ts:363`, `index > activeGroupStart`), so swapping
  the two groups emitted at `src/commands/remove.ts:40-45` would still pass. The test's name promises "not
  Safe to delete" and never asserts that literal.

Non-blocking: Gate 2 returned `PASS WITH NOTES` on the diff and Phase 4's **Done when** is met — the
confirmation is asserted and declining it performs no removal. Left open rather than fixed for the reason
F-002 and F-003 record: adding assertions after Gate 2 had already passed would land unreviewed test code.

**Closes when:** a Gate 1 run passes with the confirmation case selecting a mixed `[safe, unsafe]` list and
the grouping case asserting the entry is absent from the "Safe to delete" group by name.

### F-005 — P3 — `README.md` still describes cleanup's pre-fix behaviour

**Tied to:** cleanup-data-loss Phase 5 · **Raised:** 2026-09-05 (Gate 2, reviewer subagent, Phase 5)

`README.md:160` carries the same unqualified claim Phase 5 corrected on the docs page — cleanup "targets
worktrees that are considered safe to remove, for example branches whose remote no longer exists" — with no
uncommitted-work exception. It is now the only place in the repository that documents the defect as if it
were the design; `grep -rn "remote branch no longer exists" docs README.md skills` returns the corrected
`page.mdx:17` and nothing else. Left unfixed because Phase 5's **Files** names exactly one file,
`docs/src/app/docs/commands/cleanup/page.mdx`, and editing the README would have been scope the gate did
not review.

Adjacent and smaller: neither page documents `cleanup --force`, so D7's design point — `--force` skips the
confirmation but still prints the skipped report (`src/commands/cleanup.ts:66,78-80`) — is written down
nowhere user-facing. §4.4 did not ask for it and Q4 leaves whether `--force` *should* print unsettled, so
this is a note, not a gap to close blindly.

**Closes when:** a Lint gate run passes with `README.md:160` carrying the same uncommitted-work exception
as `page.mdx:17`.

### F-008 — P2 — `gitGetWorktrees` splits the worktree-list line on a space, so a repo under a spaced path lists nothing

**Tied to:** shell-argv-safety Phase 2 · **Raised:** 2026-09-05 (hand, §7 case 1)

`gitGetWorktrees` (`src/lib/git.ts:134-157`) parses each `git worktree list` line with
`line.replace(/\s\s+/g, " ").split(" ")`, taking `[0]` as the path and `[2]` as the branch. That collapses
runs of two-or-more spaces into one and then splits on every single space, so a repository whose own path
contains a space is truncated at that space. Measured on 2026-09-05 against a real repo at
`…/case1/space demo/proj`:

```
line        /Users/…/case1/space demo/proj                         60b9ebe [main]
parsedPath  /Users/…/case1/space
branchStr   60b9ebe   → branchName "0b9eb" after slice(1, -1)

line        /Users/…/case1/space demo/proj.worktrees/feature/test  9a6e0d9 [feature/test]
parsedPath  /Users/…/case1/space
branchStr   9a6e0d9   → branchName "a6e0d" after slice(1, -1)
```

Both lines collapse to the same truncated `parsedPath`, and `branchStr` lands on the commit sha instead of
the bracketed branch, so `branchName` is five characters of that sha.

Every entry then fails the `path.startsWith(worktreesRootPath)` filter at `src/lib/git.ts:152-155`, because
`worktreesRootPath` is the untruncated `/Users/…/case1/space demo/proj.worktrees`. `worktree list` prints
its spinner and no rows; `remove` and `cleanup` consume the same builder and see an empty list.

**This is pre-existing and independent of the subprocess layer** — it is string parsing of stdout, not
command construction, so no phase of this plan touches it. It is recorded here because it is what stopped
§7 case 1 from being run as written: the three functions Phase 2 migrated are never reached under a spaced
repo path, so the end-to-end "counts must be real numbers, not blanks" observation cannot be made.

Phase 2's own claim was verified by substitute evidence instead, against the same real repository — the
built `dist/lib/git.js` called directly with the spaced worktree path returned `ahead: 1`, `behind: 0`,
`uncommitted: 1`, the exact values the fixture was built to have, while the pre-change
`exec("cd /…/space demo/… && git status -s")` form failed on the identical path.

Not fixed here: Phase 2's scope names three functions and F-006, and `gitGetWorktrees` is neither. Landing
a parser change would commit code no gate reviewed — the reasoning F-002 through F-005 record. The likely
shape is `git worktree list --porcelain`, which emits one `key value` record per line and needs no
column-splitting at all.

**No phase of this plan will close this.** §6.1 has no row that touches `gitGetWorktrees`, so this finding
is still open at `/feature-close` unless it is given a home first — a roadmap entry is the natural one.

**Closes when:** a Gate 1 run passes with `gitGetWorktrees` returning the correct path and branch for a
worktree-list line whose path contains a space, and `worktree list` run by hand in a repo under a spaced
path prints its rows.

### F-009 — P2 — the `worktree add` failure path is untested, so a dropped `await` on it would land green

**Tied to:** shell-argv-safety Phase 3 · **Raised:** 2026-09-05 (Gate 2, reviewer subagent, Phase 3)

`gitCreateWorktree` issues two sequential `run` calls of its own (`src/lib/git.ts:245` and `:249-261`),
and D5 rests on both being awaited. Only the **first** is exercised on its rejecting path:
`grep -n "mockRejectedValue" src/lib/git.test.ts` returns `445` as the sole rejection in that describe,
and it is queued on the fetch. So dropping `await` at `src/lib/git.ts:249` passes all four tests — the
call is still recorded synchronously, `succeed` is still called, and the one rejection test stops before
reaching it.

**Line numbers updated at Phase 5**, which moved `gitGetRootPath` onto `run` as well: `gitCreateWorktree`
now records **three** calls, the root lookup ahead of the fetch and the add, so the counts in that describe
read `3` where they read `2`, and the fetch-failure case stops at call 2 rather than call 1.

It matters past mutation hygiene: `src/commands/branch.ts:182-184` and `src/commands/checkout.ts:65-71`
both `await gitCreateWorktree(…)` and immediately act on the returned path, so an un-awaited
`worktree add` would run them against a directory git has not created yet. This is also the one path R7
names for Phase 3, and that prefix change is currently pinned by the hand measurement in §7 case 2 alone,
not by a test.

The smaller half of this finding is **closed**. The spaced-root case omitted the
`toHaveBeenCalledTimes` its two sibling cases carried, so a further `run` issued only on that path would
have gone unseen; Phase 5 added it at `src/lib/git.test.ts:418`, alongside the siblings now at `:363` and
`:395`. The primary half — no rejecting test on `worktree add` — is untouched and is what keeps this
finding open.

Left unfixed because Gate 2 had already returned `PASS WITH NOTES` on the Phase 3 diff, and adding
assertions afterwards would commit test code no gate had seen — the reasoning F-002 through F-005 record.

**Closes when:** a Gate 1 run passes with a `git.test.ts` case that resolves the fetch, rejects the
`worktree add`, and asserts both `rejects.toThrow` and `spinnerMocks.fail` called with that message.

### F-010 — P3 — the relative `worktreePath` does not buy what its comment says it does

**Tied to:** shell-argv-safety Phase 3 · **Raised:** 2026-09-05 (hand, §7 case 2)

`src/lib/git.ts:234-237` keeps the pre-change rationale for passing `git worktree add` a relative path:
"This ensures that everything stays in sync in case the project is moved in the filesystem." Measured on
2026-09-05 on **git 2.38.1**, it does not. `git worktree add` resolves the path it is given and records an
absolute one in both link files, so the relative form, an absolute form, and a shell reproduction of the
exact pre-change command are byte-identical:

```
worktree .git             gitdir: <abs>/proj/.git/worktrees/<n>
.git/worktrees/<n>/gitdir <abs>/proj.worktrees/feature/<n>/.git
```

After renaming the containing directory, all three fail alike with
`fatal: not a git repository: <old abs>/proj/.git/worktrees/<n>`, and `git worktree list` from the root
shows every entry `prunable` at its stale absolute path.

**Not a regression and not introduced here** — Phase 3 preserved the argument shape exactly, which is what
R1 asked of it, and §7 case 2's first half (same shape as before the change) passes. What is wrong is the
claim: the comment survives into the argv form as the stated reason for a choice that, on this git version,
has no effect. A future reader "simplifying" it to `absoluteWorktreePath` would be talked out of a harmless
edit by a false rationale — or, worse, would trust the promise.

Two ways out, and choosing between them is the point of recording this: correct the comment to say the
path is relative for readability and that git records absolute links regardless, or reach for
`git worktree add --relative-paths` (git 2.48+) and actually deliver the property — which would need a
version floor this project does not currently state.

**Closes when:** a Gate 1 run passes with `src/lib/git.ts`'s comment either matching measured git behaviour
or accompanied by the `--relative-paths` flag that makes the original claim true.


### F-011 — P2 — the third `run` in `gitNukeWorktreeCmd` is unpinned, so a dropped `await` would report a removal that did not happen

**Tied to:** shell-argv-safety Phase 4 · **Raised:** 2026-09-05 (Gate 2, reviewer subagent, Phase 4)

`gitNukeWorktreeCmd` now issues three sequential `run` calls (`src/lib/git.ts:282`, `:288`, `:289`), and D5
rests on every one being awaited. The **third** has no rejecting test, because no call follows it to count:
`src/lib/git.test.ts:506-516` rejects call 1 and asserts `toHaveBeenCalledTimes(1)`, and `:518-529` rejects
call 2 and asserts `2`, but nothing observes a rejection from `git branch -D`. So dropping `await` at
`src/lib/git.ts:289` passes all four tests. (Line numbers refreshed at Phase 5, which shifted this file.)

It matters past mutation hygiene. `gitNukeWorktree` catches the rejection (`src/lib/git.ts:300-304`) and is
the only thing standing between a failed `branch -D` and a success message: un-awaited, the catch never
fires and the spinner prints `Worktree <name> was removed.` while the branch is still there. This is
exactly the shape F-009 records for `worktree add`, one phase earlier.

Smaller, and the same shape: the round-trip case at `src/lib/git.test.ts:137-154` asserts the **set** call's
argv and its length, but never `toHaveBeenNthCalledWith(2, …)` for the get, and its
`expect(value).toBe(hostileValue)` half only proves the helper returns what the mock was queued with. The
load-bearing evidence for the return direction is §7 case 3, which was run by hand against the built
`dist/lib/git.js` and re-run independently at Gate 2 — not this assertion.

Left unfixed because Gate 2 had already returned `PASS WITH NOTES` on this exact diff, and adding
assertions afterwards would commit test code no gate had seen — the reasoning F-002 through F-005, F-007
and F-009 record.

**Closes when:** a Gate 1 run passes with a `git.test.ts` case that resolves the first two calls, rejects
`git branch -D`, and asserts both `rejects.toThrow` and that `gitNukeWorktree` fails rather than succeeds
on that path.


## Closed

Closed findings leave this file — a feature's at `/feature-close`, folded into the retiring plan's own log;
an `ad-hoc` one at the start of the next `/orchestrate`.

### F-006 — P2 — the unexpected-call guard watches `cmd` only, so it goes vacuous as call sites migrate

**Tied to:** shell-argv-safety Phase 2 · **Raised:** 2026-09-05 (Gate 2, reviewer subagent, Phase 1) ·
**Closed:** 2026-09-05 (Gate 1, Phase 2)

`src/test-setup.ts:23` built its unexpected-call list from `mockCmd.mock.calls` alone, so every call site
moving to `run` would have left that guard's field of view.

**Fixed in Phase 2.** The `afterEach` at `src/test-setup.ts:39-56` now folds both mocks into one list, with
`describeRunCall` (`src/test-setup.ts:23-31`) rendering a `run` call as its argv joined plus the cwd when
one is given — the same information the `cd ${path} && …` prefix carried. The shape decision F-006 asked
for is that `expectedCommands` stays a `string[]`: the rendering is a diagnostic, and what each call site
passes is asserted by `toHaveBeenCalledWith` in the tests themselves. The warning text is now
`Unexpected subprocess calls detected`, and the plan's §7 case 4 was updated to grep for that string.

**Proved non-vacuous rather than assumed:** deleting one declared entry from `git.test.ts`'s
`expectCommands` made the guard print
`Unexpected subprocess calls detected:\n  - git status -s (cwd: /repo/project.worktrees/test)`; restoring
it returned the run to zero warnings. Gate 1 on the Phase 2 commit: `pnpm check`, `pnpm typecheck`,
`pnpm build`, `pnpm test` (207 passed) and `pnpm docs:test` (49 passed) all exit 0, with zero occurrences
of `Unexpected` in the captured test output.

`cleanup-data-loss`'s F-001 moved to
[`archive/CLEANUP-DATA-LOSS-PLAN.md`](archive/CLEANUP-DATA-LOSS-PLAN.md) §10 on 2026-09-05.

### F-007 — P3 — `cli.test.ts`'s `afterAll` would mask a failure in its own `beforeAll`

**Tied to:** shell-argv-safety Phase 1 · **Raised:** 2026-09-05 (Gate 2, reviewer subagent, Phase 1) ·
**Closed:** 2026-09-05 (Gate 1, Phase 5)

`src/lib/cli.test.ts`'s `afterAll` called `rmSync(tempPath, …)` unconditionally, so a throwing
`mkdtempSync` in `beforeAll` would have left `tempPath` undefined and reported an
`ERR_INVALID_ARG_TYPE` from the cleanup instead of the real failure.

**Fixed in Phase 5**, and in scope rather than swept in: Phase 5's **Files** names `src/lib/cli.test.ts`,
and the phase already had to edit that exact `afterAll` block to restore the `PATH` its new `commandExists`
cases mutate. The guard is `if (tempPath)` at `src/lib/cli.test.ts:47-49`; `tempPath` is declared
`let tempPath: string` with no initializer, so it is genuinely `undefined` on that path.

The PATH restore next to it raised the same class of defect one line earlier and was fixed with it:
assigning a `string | undefined` back would have written the literal string `"undefined"` onto `PATH`, so
an unset `PATH` is restored by `delete process.env.PATH` (`src/lib/cli.test.ts:43-51`). Verified both
directions rather than assumed — after `delete`, `'PATH' in process.env` is `false`, which is the real
pre-`beforeAll` state.

Gate 1 on the Phase 5 commit: `pnpm check`, `pnpm typecheck`, `pnpm build`, `pnpm test` (219 passed) and
`pnpm docs:test` (49 passed) all exit 0, with zero occurrences of `Unexpected` in the captured test output.
Gate 2 returned `PASS`, having verified the guard and the restore against the file.
