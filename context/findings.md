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
(`src/lib/git.ts:194-196`), so the combination is unreachable from the list builder. Left open rather than
fixed because Phase 2's **Done when** names exactly two over-reach cases and this is not one of them —
adding it would have landed an unreviewed assertion after Gate 2 had already passed on the diff.

This matters sooner than it looks: `agent-mode` Phase 6 adds a live-agent clause to this same predicate
(§2, R2), and is the natural place to pin the ordering while the branches are being re-read anyway.

**Closes when:** a Gate 1 run passes with a `git.test.ts` case asserting the verdict for
`{ pathExists: false, uncommittedChanges: 3 }`.

### F-003 — P3 — a path-less worktree with a non-zero change count would be listed as skipped *and* removed

**Tied to:** cleanup-data-loss Phase 3 · **Raised:** 2026-09-05 (Gate 2, reviewer subagent, Phase 3)

For `{ pathExists: false, uncommittedChanges: 3 }` both halves of `cleanup`'s split claim the entry:
`isSafeToRemove` returns `true` at `src/lib/git.ts:154-156`, so it lands in `worktrees`
(`src/commands/cleanup.ts:48`), and `isSkippedForUncommittedChanges` (`src/commands/cleanup.ts:17-21`) also
returns `true`, because its zeroed probe hits that same first branch. The command would print the worktree
as skipped and then remove it anyway.

Latent, not live, and for the same reason as F-002: `gitGetWorktreeList` hardcodes `uncommittedChanges`
to `0` when the path is missing (`src/lib/git.ts:194-196`), and `cleanup` consumes no other source. The
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

### F-007 — P3 — `cli.test.ts`'s `afterAll` would mask a failure in its own `beforeAll`

**Tied to:** shell-argv-safety Phase 1 · **Raised:** 2026-09-05 (Gate 2, reviewer subagent, Phase 1)

`src/lib/cli.test.ts:35-37` calls `rmSync(tempPath, { recursive: true, force: true })` unconditionally. If
`mkdtempSync` at `:30` ever threw — a full or read-only temp filesystem — `tempPath` would still be
`undefined` and `rmSync` would throw `ERR_INVALID_ARG_TYPE` on top of the real error, so the reported
failure would name the cleanup rather than the cause. `force: true` does not help: it suppresses a missing
path, not an invalid argument type.

Narrow, and it costs a one-line `if (tempPath)` guard. Left unfixed because Gate 2 had already returned
`PASS WITH NOTES` on this exact diff, and editing it afterwards would commit code no gate had seen — the
same reasoning F-002 through F-005 record.

**Closes when:** a Gate 1 run passes with the `afterAll` in `src/lib/cli.test.ts` guarded against an
unset `tempPath`.

### F-008 — P2 — `gitGetWorktrees` splits the worktree-list line on a space, so a repo under a spaced path lists nothing

**Tied to:** shell-argv-safety Phase 2 · **Raised:** 2026-09-05 (hand, §7 case 1)

`gitGetWorktrees` (`src/lib/git.ts:128-150`) parses each `git worktree list` line with
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

Every entry then fails the `path.startsWith(worktreesRootPath)` filter at `src/lib/git.ts:146-149`, because
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
