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

## Closed

None. Closed findings leave this file — a feature's at `/feature-close`, folded into the retiring plan's
own log; an `ad-hoc` one at the start of the next `/orchestrate`.

`cleanup-data-loss`'s F-001 moved to
[`archive/CLEANUP-DATA-LOSS-PLAN.md`](archive/CLEANUP-DATA-LOSS-PLAN.md) §10 on 2026-09-05.
