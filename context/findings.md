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

### F-001 — P3 — `uncommittedChanges: undefined` with no remote is unpinned, and Phase 2 flips it

**Tied to:** cleanup-data-loss Phase 2 · **Raised:** 2026-09-05 (Gate 2, reviewer subagent, Phase 1)

No test covers `{ pathExists: true, remote: "", uncommittedChanges: undefined }`. Today the third branch's
strict `wt.uncommittedChanges === 0` (`src/lib/git.ts:162`) makes `undefined` fail the clause, so the entry
falls through and `isSafeToRemove` returns `false`. Under the §4.1 rewrite that clause is dropped, and the
same entry becomes `true` — a silent verdict change in a phase whose stated scope is the deleted-remote
case.

Not reachable from `gitGetWorktreeList`, which always assigns a number (`src/lib/git.ts:189-191`), so this
is a latent contract change rather than a live defect. Phase 2's **Done when** already requires cases
pinning that the fix does not over-reach; this is the case it does not currently name.

**Closes when:** Phase 2's Gate 1 re-passes with a `git.test.ts` case asserting the verdict for a
no-remote entry whose `uncommittedChanges` is `undefined`, whichever verdict Phase 2 decides is correct.

## Closed

