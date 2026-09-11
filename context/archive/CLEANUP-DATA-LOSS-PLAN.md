# Cleanup Data Loss Plan

Retired — its outcome and date are in [issue #43](https://github.com/northguild/worktree/issues/43) (`cleanup-data-loss`, closed). `context/history.md` held this until 2026-09-09, when [`../tracking.md`](../tracking.md) moved the outcome index into GitHub issues.

Made `safeToRemove` mean what its name says, so `worktree cleanup` stops force-removing worktrees that hold
uncommitted work.

**Its section numbers are cited from source comments.** `src/lib/git.ts:160`, `src/commands/cleanup.ts:16,77`,
`src/commands/cleanup.test.ts:324` and `src/commands/remove.test.ts:313` reference `CLEANUP-DATA-LOSS-PLAN`
by section and without a path, so they survived this move untouched — but renumbering or deleting a section
below breaks them.

---

## 1. Why

`isSafeToRemove` (`src/lib/git.ts:153-166`) has three branches and returns on the first that matches:

```ts
if (!wt.pathExists) return true;                 // 154-157
if (wt.remote && !wt.remoteExists) return true;  // 158-161  ← returns before line 162
if (!wt.remote && !wt.ahead && !wt.behind && wt.uncommittedChanges === 0) return true;  // 162-165
```

**The second branch returns before the third is ever reached, and the third is the only one that consults
`uncommittedChanges`.** A worktree tracking a deleted remote branch is therefore classified `safeToRemove`
no matter how much uncommitted work sits in it.

Both removal surfaces then act on that verdict without re-checking:

- `cleanup` filters on `safeToRemove === true` (`src/commands/cleanup.ts:27`) and removes every match via
  `gitNukeWorktreeCmd(wt.branchName, { force: true })` (`src/lib/git.ts:354`). That `force: true` is
  unconditional — it is not derived from the flag.
- `remove`'s multi-select path sorts the same field into an "Inactive branches (Safe to delete)" group
  (`src/commands/remove.ts:36-48`) and skips its are-you-sure prompt entirely when every selection is
  `safeToRemove` (`src/commands/remove.ts:81`), then removes through the same forced sweep.

`git worktree remove --force` does not stage, stash or back anything up. The work is gone.

**Reproduction**

1. Create a worktree from a remote branch (`worktree checkout some-branch`).
2. Get its PR merged so the remote branch is deleted, or delete it on the remote by hand.
3. Keep editing in the worktree. Do not commit.
4. Run `worktree cleanup`.

**Who is exposed.** `remote` is only non-empty when the branch has an upstream (`src/lib/git.ts:178` —
`tracking.find(...)?.remote ?? ""`). `branch` creates worktrees with `--no-track` (`src/lib/git.ts:237`), so
those have no `remote` and fall through to the safe third branch. `checkout` creates them with `--track`
(`src/lib/git.ts:236`). **Worktrees made by `worktree checkout` are the exposed ones** — exactly the ones
most likely to have had a PR merged and their remote branch deleted. This is a mainline path, not an exotic
one.

**What the user sees today.** The information is not hidden, but it is easy to miss. In the default path
`cleanup.ts:39-41` prints each candidate through `worktreeListEntryToListName`, which appends an
uncommitted-changes count (`src/lib/utils.ts:38-42`):

```
- feature/thing (Remote removed, 3 uncommitted changes)
Are you sure you want to delete them?
```

That is one bulk yes/no covering every candidate at once, so a single worktree with work in it is easy to
miss in a list. `--force` skips the display entirely (`cleanup.ts:34,46-48`) — it takes the `else` branch
and never prints the candidates.

**The deeper problem is the classification.** `safeToRemove` is the name of a safety verdict, and it returns
`true` for a worktree that is not safe to remove. Anything that trusts the field inherits the bug, which is
why the fix belongs in the predicate rather than in either caller.

**There is no test coverage for any of this.** `src/lib/git.test.ts` contains four `describe` blocks — git
branch parsing, git config, git root path, git status and tracking helpers — and none of them exercise
`isSafeToRemove` or `gitGetWorktreeList`. `cleanup.test.ts` and `remove.test.ts` hand-write `safeToRemove`
into their fixtures (`cleanup.test.ts:44,56,68`), so they assert against a verdict they supply themselves
and never run the predicate.

**The precedent for what correct looks like** is already in the file. `gitRemoveWorktree`'s interactive
single-worktree path (`src/lib/git.ts:303-326`) prompts specifically on `ahead`, then specifically on
`uncommittedChanges`, each defaulting to `false`, and only passes `force` once the user has confirmed
against that specific hazard. The two paths should agree about what "safe" means.

## 2. Constraints

- **`safeToRemove` has two consumers, not one** — `cleanup.ts:27` and `remove.ts:36-48,81`. Any fix must
  leave both correct; a patch applied in `cleanup` alone would leave `remove` removing the same worktrees
  without a prompt, and would put two copies of one safety rule in the tree.
- **`WorktreeListEntry.safeToRemove` is an exported interface member** (`src/lib/types.ts:18`,
  `safeToRemove?: boolean`) in a published npm package. Changing its type is a breaking change to anything
  importing it; see D4.
- **`ahead` and `behind` are only computed when `pathExists && remoteExists`** (`src/lib/git.ts:180-187`),
  so for exactly the worktrees this plan is about, `ahead` is `undefined`. This is not an oversight to
  route around: `gitGetCommitsAheadCount` compares against `@{u}` (`src/lib/git.ts:84-91`), which cannot
  resolve once the upstream branch is deleted. Any check for unpushed commits on a deleted-remote branch
  needs a different comparison base, which is why D3 scopes it out rather than folding it in.
- **Must not change what `branch` or `checkout` do at creation time.** The `--track` / `--no-track`
  difference is the reason the exposure is shaped as it is, but it is correct behaviour and out of scope.
- **Repository conventions** apply as written in [`stack.md`](../stack.md): ESM with `.js` extensions on
  relative imports, named exports outside `src/commands/`, tests colocated as `*.test.ts`, Biome owns
  formatting. Verification commands come from [`verify.md`](../verify.md) and nowhere else.
- **Land this before `agent-mode` Phase 6.** That phase adds a live-agent clause to this same
  `isSafeToRemove` and rewrites `cleanup`'s reporting, touching `src/lib/git.ts`,
  `src/commands/cleanup.ts` and both test files. Running the two concurrently would conflict; running this
  one second would mean Phase 6 had already encoded the current behaviour into `cleanup.test.ts` as if it
  were intended.

## 3. Decisions

**D1.** **Fix the predicate, not the callers.** `isSafeToRemove` is corrected so that its verdict can be
trusted by anything that reads it. Rejected: re-checking `uncommittedChanges` inside `cleanup` before the
sweep, because `remove.ts:81` inherits the identical bug and would need the identical patch — two
independently-worded copies of one safety rule, which is the drift this repository's own workflow exists to
prevent.

**D2.** **Uncommitted changes disqualify a worktree from `safeToRemove`, regardless of remote state.** The
uncommitted-changes test is hoisted above the remote-branch branch so it cannot be skipped. Rejected:
prompting per-worktree inside the sweep, because `cleanup` is the bulk path — per-item prompts defeat its
purpose, and `--force` would skip them anyway, leaving the destructive path exactly as destructive as it is
today.

**D3.** **Unpushed commits on a deleted-remote branch are out of scope for this plan**, and recorded as an
open question (§8, Q1) rather than silently fixed. Branch 2 swallows that case too — a worktree that is
`ahead` with a deleted remote is also classified safe — but detecting it is not a predicate change: `ahead`
is `undefined` for these worktrees by construction (§2), and `gitGetCommitsAheadCount`'s `@{u}` cannot
resolve without an upstream. Fixing it means choosing a new comparison base and changing what
`gitGetWorktreeList` gathers. That is a larger, separately-reviewable change; folding it in here would grow
a `small` entry into a `medium` one and delay the data-loss fix behind an unsettled design question.
Rejected: doing both at once, for that reason.

**D4.** **`safeToRemove` stays `boolean`.** A skipped worktree's *reason* is derived at the point of
reporting from the fields already on the entry (`uncommittedChanges`, `remote`, `remoteExists`), exactly as
`worktreeListEntryToListName` already does (`src/lib/utils.ts:29-42`). Rejected: turning `safeToRemove` into
a reason enum or a `{ safe, reason }` object. It is a published interface member (§2) with two consumers
that both treat it as a boolean — `remove.ts` groups on its truthiness — so the change would ripple through
both commands and their tests for no gain this plan needs.

**D5.** **`isSafeToRemove` becomes a total function with an explicit return type.** It currently declares no
return type and falls off the end when no branch matches, so it returns `boolean | undefined` and
`safeToRemove` is `undefined` rather than `false` for every unsafe worktree. `cleanup.ts:27` compares
`=== true` and `remove.ts:36-37` tests truthiness, so both happen to behave — but the next caller to write
`!== false` inherits a trap. Adding `: boolean` and a final `return false` is a correctness fix in its own
right and makes the compiler enforce that every branch decides.

**D6.** **`isSafeToRemove` is exported as a named export** so it can be unit-tested directly. It is a pure
function over a `WorktreeListEntry`, and testing it through `gitGetWorktreeList` would require mocking four
git calls to assert one predicate. Named export matches the `src/lib/` convention in
[`stack.md`](../stack.md). Rejected: testing it indirectly through `gitGetWorktreeList`, because the mock
scaffolding would exceed the code under test and would couple the predicate's tests to the list builder's
implementation.

**D7.** **`cleanup` reports what it skipped**, naming each worktree it declined to remove and why, in both
the default and `--force` paths. Without this the fix is silent: a user whose worktree is no longer swept
gets no signal that anything changed, and `--force` prints nothing at all today. This is the reporting half
of the roadmap entry.

**D8.** **`gitRemoveWorktreesWithProgress` keeps its unconditional `force: true`** (`src/lib/git.ts:354`).
Once D1/D2 land, everything `cleanup` sends it is genuinely safe, and `remove` sends user-selected
worktrees that have already passed a confirmation prompt, where `--force` is the point. Rejected: deriving
`force` per worktree from its hazards, because the sweep would then fail partway on precisely the
worktrees a user had just confirmed. Recorded as a residual risk (R3) rather than a change.

## 4. Design

### 4.1 The predicate

`isSafeToRemove` is reordered so the hazard test cannot be bypassed, gains an explicit return type, and
becomes total:

```ts
export function isSafeToRemove(wt: WorktreeListEntry): boolean {
  // A worktree whose directory is gone holds nothing to lose.
  if (!wt.pathExists) return true;

  // Uncommitted work disqualifies a worktree whatever its remote looks like. See plan §3 D2.
  if (wt.uncommittedChanges) return false;

  // Tracking a remote branch that no longer exists.
  if (wt.remote && !wt.remoteExists) return true;

  // No remote, and nothing pending.
  if (!wt.remote && !wt.ahead && !wt.behind) return true;

  return false;
}
```

Three things to note about the shape:

- **The `!wt.pathExists` branch stays first.** If the directory is gone there is nothing to lose, and
  `uncommittedChanges` is hardcoded to `0` for that case anyway (`src/lib/git.ts:188-190`), so testing it
  first would be meaningless as well as wrong.
- **The uncommitted test is `if (wt.uncommittedChanges)`, not `=== 0`.** The field is optional
  (`src/lib/types.ts:17`), so `undefined` must not read as "has changes". Truthiness gives `undefined` and
  `0` the same, correct answer.
- **The third branch loses its `wt.uncommittedChanges === 0` clause**, which is now redundant — the hoisted
  test has already returned `false` for that case. Leaving it in would be a second copy of the same rule.

Source comments cite `§3 D2` by section number, not line number, per
[`plan-template.notes.md`](../plan-template.notes.md).

### 4.2 Reporting in `cleanup`

`cleanup` currently derives its candidate list and discards everything else (`src/commands/cleanup.ts:27`).
It instead keeps both halves — the removable set and the worktrees it declined — and prints the declined
ones with the reason drawn from the entry's own fields, reusing `worktreeListEntryToListName`
(`src/lib/utils.ts:24-48`), which already renders "Remote removed" and "N uncommitted changes".

The skipped list prints in **both** paths. Today `--force` takes the `else` branch and prints nothing
(`cleanup.ts:46-48`); after this change it still skips the *confirmation* but still says what it left
alone. `--force` means "do not ask me", not "do not tell me".

The existing "No stale worktree branches found." early return (`cleanup.ts:29-32`) needs to account for the
case where there are no removable worktrees but there *are* skipped ones — reporting "none found" while
silently declining three worktrees with work in them would reintroduce the invisibility this fix exists to
remove.

### 4.3 What `remove` needs

Nothing, in the command itself. Once the predicate is correct, a deleted-remote worktree holding uncommitted
changes stops being sorted into the "Safe to delete" group (`remove.ts:39-47`) and starts tripping the
`selected.some((wt) => !wt.safeToRemove)` confirmation at `remove.ts:81`. The phase for `remove` is
regression coverage proving that, not a code change — and if it turns out a change is needed, that is the
finding the phase exists to surface.

### 4.4 Documentation

`docs/src/app/docs/commands/cleanup/page.mdx:16` lists "worktrees whose remote branch no longer exists" as a
cleanup target with no qualification, which documents the defect as if it were the design. It gains the
uncommitted-work exception.

## 5. Risks

**R1 — `cleanup` becomes less useful because `git status -s` counts untracked files.**
`gitGetUncommittedChangesCount` shells out to `git status -s` (`src/lib/git.ts:102-105`), whose short format
includes untracked entries (`??`) by default. A merged worktree holding only stray cruft — an unignored
`.env.local`, a scratch file, a stale build output — will now be declined rather than swept. **How it shows
up:** users report that `cleanup` stopped cleaning anything. **Response:** this is the correct default —
untracked files are unrecoverable in exactly the way this plan is about, and D7's skip reporting names the
worktree and its count so the user can act. If it proves too noisy in practice, the lever is a flag or a
`-uno` variant, recorded as Q2 rather than pre-emptively built.

**R2 — the `agent-mode` collision.** `archive/AGENT-MODE-PLAN.md` Phase 6 edits the same function and the same
`cleanup` reporting. **How it shows up:** merge conflicts in `src/lib/git.ts` and `src/commands/cleanup.ts`,
or a silent revert of this fix if Phase 6 rewrites the predicate from its own plan text. **Response:** land
this first (§2), and have Phase 6 add its live-agent clause to the corrected predicate.

**R3 — the unconditional `force: true` in the shared sweep remains** (`src/lib/git.ts:354`, D8). This fix
removes the way unsafe worktrees currently *reach* that sweep from `cleanup`, but the sweep itself stays
maximally destructive for whatever is handed to it. **How it shows up:** a future caller that builds its own
worktree list and calls `gitRemoveWorktreesWithProgress` gets force-removal with no prompt and no verdict
check. **Response:** accepted for this plan; the mitigation is that the one remaining unguarded caller path
(`remove`, after an explicit confirmation) is intentional.

**R4 — characterization tests briefly assert the defect.** Phase 1 pins current behaviour, including the
wrong verdict, so that Phase 2's diff shows the behaviour change. **How it shows up:** someone reads the
Phase 1 commit in isolation and believes the project intends that behaviour. **Response:** the assertion
carries a comment naming this plan and the phase that overturns it, and Phase 2 is the immediately following
phase.

## 6. Phases

### 6.1 Status ledger

| # | Phase | Status | Depends on | Note |
|---|---|---|---|---|
| 1 | Make `isSafeToRemove` testable and total | done | — | Verdicts unchanged; only the fall-through moved `undefined` → `false`. F-001 (P3) raised against Phase 2 |
| 2 | Uncommitted work disqualifies removal | done | 1 | Two verdicts moved, both intended: the fix, and the no-remote `undefined` case F-001 pre-registered. F-001 closed. §4.1 cites `git.ts:188-190`; that assignment is now at `194-196` |
| 3 | `cleanup` reports what it skipped | done | 2 | Skipped = held back *only* by uncommitted work, asked of `isSafeToRemove` on a zeroed copy (D1); §4.2's literal "declined" would print every active worktree. F-003 (P3) raised. `verify.md:63` cites `cleanup.ts:37` and `cleanup.test.ts:176-178`; now `69` and `188-190` |
| 4 | `remove` multi-select regression coverage | done | 2 | §4.3 confirmed — `remove.ts` needed no change. The fixture takes `safeToRemove` from the real predicate, unlike the hand-set ones at `remove.test.ts:37,49`. F-004 (P3) raised. `verify.md:68` says `pnpm test` covers 181 tests; now 197 |
| 5 | Document the exception | done | 2 | Docs-only — Lint gate only. §4.4's `page.mdx:16` bullet was at 17. Gate 2 `PASS WITH NOTES`; its N1/N2 tightened the new prose before commit — "every worktree it skipped" was broader than `cleanup.ts:17-21`, and "instead of silently removed" repeated the overstatement §9.2 corrects. F-005 (P3) raised: `README.md:160` still carries the unqualified claim, outside this phase's **Files** |

Status is one of `not started`, `in progress`, `blocked`, `done`. `done` only when committed and verified,
and whoever finishes a phase updates the row in the same commit.

**Exactly one table in this document has these columns.** Do not add a second phase table — a
differently-shaped one nearby is a decoy that gets read by mistake.

### 6.2 The phases

#### Phase 1 — Make `isSafeToRemove` testable and total

**Files:** `src/lib/git.ts`, `src/lib/git.test.ts`

**Scope:** Export `isSafeToRemove` (D6), give it an explicit `: boolean` return type and a final
`return false` (D5). **No branch is reordered and no verdict changes.** Add a `describe("isSafeToRemove")`
block to `src/lib/git.test.ts` covering all four current outcomes: missing path, deleted remote, no-remote
clean, and the fall-through. The deleted-remote-with-uncommitted-changes case is asserted as `true` — the
current, wrong answer — with a comment citing this plan §1 and naming Phase 2 as the phase that overturns
it (R4).

**Done when:** `isSafeToRemove` is exported with a `boolean` return type, `git.test.ts` has a
`describe("isSafeToRemove")` block whose cases include a deleted-remote worktree with non-zero
`uncommittedChanges`, and `pnpm test` exits 0 with no change to any existing assertion.

#### Phase 2 — Uncommitted work disqualifies removal

**Files:** `src/lib/git.ts`, `src/lib/git.test.ts`

**Scope:** Hoist the uncommitted-changes test above the remote branch and drop the now-redundant
`uncommittedChanges === 0` clause from the third branch, per §4.1 (D2). Flip the Phase 1 characterization
assertion to `false` and remove its R4 comment. Add cases pinning that the fix does not over-reach: a
deleted-remote worktree with `uncommittedChanges: 0` is still `true`, and one with `uncommittedChanges:
undefined` is still `true`.

**Done when:** `isSafeToRemove` returns `false` for `{ pathExists: true, remote: "origin/x", remoteExists:
false, uncommittedChanges: 3 }`, still returns `true` for the same entry with `uncommittedChanges` of `0` or
`undefined`, and `pnpm test` exits 0.

#### Phase 3 — `cleanup` reports what it skipped

**Files:** `src/commands/cleanup.ts`, `src/commands/cleanup.test.ts`

**Scope:** Partition the list rather than filtering it, and print the declined worktrees through
`worktreeListEntryToListName` in both the default and `--force` paths (§4.2, D7). Handle the
nothing-removable-but-something-skipped case so it no longer reports "No stale worktree branches found."
while silently declining worktrees that hold work. Existing fixtures at `cleanup.test.ts:44,56,68` hand-set
`safeToRemove`; add one with `safeToRemove: false` and non-zero `uncommittedChanges` to drive the new
output.

**Done when:** running `cleanup` against a list containing a `safeToRemove: false` worktree prints that
worktree and its reason, with and without `--force`; the no-candidates path distinguishes "nothing found"
from "everything was skipped"; `pnpm test` exits 0.

**Note:** assert unstyled strings. `vitest.config.ts` pins `FORCE_COLOR: "0"` and this is load-bearing for
this exact file — see [`verify.md`](../verify.md).

#### Phase 4 — `remove` multi-select regression coverage

**Files:** `src/commands/remove.test.ts`, and `src/commands/remove.ts` only if the test proves a change is
needed

**Scope:** Prove the claim in §4.3 — that a deleted-remote worktree with uncommitted changes now reaches the
`selected.some((wt) => !wt.safeToRemove)` confirmation at `remove.ts:81` instead of being grouped under
"Inactive branches (Safe to delete)" at `remove.ts:39-47`. If it does not, fix `remove.ts` and say so in the
ledger Note.

**Done when:** `remove.test.ts` contains a case selecting such a worktree that asserts the confirmation is
requested and that declining it performs no removal; `pnpm test` exits 0.

#### Phase 5 — Document the exception

**Files:** `docs/src/app/docs/commands/cleanup/page.mdx`

**Scope:** Qualify the "worktrees whose remote branch no longer exists" bullet (line 16) with the
uncommitted-work exception, and state that skipped worktrees are reported (§4.4).

**Done when:** the page no longer claims deleted-remote worktrees are removed unconditionally, and `pnpm
check` exits 0. Docs-only, so per [`verify.md`](../verify.md) this phase runs the Lint gate plus a read of
the diff.

## 7. Verification

Beyond [`verify.md`](../verify.md) passing, the defect in §1 is proved gone by hand, against a real
repository — the unit tests use synthetic `WorktreeListEntry` objects and cannot prove that the real
`gitGetWorktreeList` produces the field values the predicate now depends on.

1. In a scratch repository with a remote, `worktree checkout some-branch`.
2. Delete the remote branch (`git push origin --delete some-branch`), then `git fetch --prune`.
3. Write an uncommitted change in the worktree — do both a modification to a tracked file and an untracked
   new file, since `git status -s` counts both (R1).
4. `worktree list` — the entry should show `Remote removed` and the uncommitted count.
5. `worktree cleanup` — the worktree must **not** appear in the removal candidates, and must appear in the
   skipped report with its reason.
6. `worktree cleanup --force` — same: not removed, and still reported as skipped.
7. Commit the change, leaving the branch `ahead` with no remote. `worktree cleanup` **will** remove it —
   this is Q1, the known remaining gap, and confirming it here is what keeps the open question honest
   rather than forgotten.
8. `worktree remove`, select the worktree from step 3 — it must be listed outside the "Safe to delete"
   group and must trigger the not-safe confirmation.

## 8. Open questions

- **Q1 — unpushed commits on a deleted-remote branch.** Scoped out by D3 and still a live data-loss path,
  narrower than the one this plan closes: a worktree that is `ahead` with a deleted remote is classified
  safe. It cannot be fixed in the predicate alone, because `ahead` is `undefined` for these worktrees by
  construction and `gitGetCommitsAheadCount` relies on `@{u}`, which no longer resolves (§2). Settling it
  means choosing a comparison base — the repository's default branch is the obvious candidate, but that is
  a design decision with its own edge cases, not a detail. **Should this become its own roadmap entry once
  this one lands?**
- **Q2 — should untracked files count?** R1's regression rests on `git status -s` including untracked
  entries. Treating an unignored scratch file as work worth protecting is the safe default and this plan
  adopts it, but it is a judgement call that will shape how `cleanup` feels day to day. No evidence either
  way was available while planning; the honest answer is to ship the safe default and revisit if it
  annoys.
- **Q3 — the `pathExists: false` branch is unverified.** It returns `true` immediately, and
  `uncommittedChanges` is hardcoded to `0` for that case (`src/lib/git.ts:188-190`), so a worktree whose
  directory was deleted out from under git is always swept. That is almost certainly right — there is
  nothing left to lose — but it was not tested against a real repository while planning, only read.
- **Q4 — is `--force` printing skipped worktrees the right call?** D7 says `--force` should still report.
  A user piping `cleanup --force` in a script gets new output on stdout. Nothing in the repository suggests
  that path is scripted, but nothing rules it out either.
- **Q5 — sequencing against `agent-mode`.** This plan assumes it lands before `agent-mode` Phase 6 (§2,
  R2). `agent-mode` is `pending` and holds no active slot, so there is no conflict today — but if
  `agent-mode` is activated first, this plan's §4.1 and §4.2 need re-reading against whatever Phase 6 left
  behind.

## 9. Reference material carried from the draft

Captured by `/roadmap` on 2026-09-05 from maintainer-supplied material, which originated as analysis done
while planning `agent-mode` in the same session — it was found by reading `isSafeToRemove` to work out what
a live-agent check would have to attach to. Retained here because it is the provenance of §1.

### 9.1 Verified against the tree

Read, not recalled. Every row checked on 2026-09-05 on branch `feature/add-agent-mode`, once when the draft
was written and again while writing this plan.

| Claim | Status |
|---|---|
| `isSafeToRemove` returns at line 158 before reaching the `uncommittedChanges` branch at 162 | confirmed, `src/lib/git.ts:153-166` |
| `cleanup` filters on `safeToRemove === true` | confirmed, `src/commands/cleanup.ts:27` |
| The sweep removes with an unconditional `force: true` | confirmed, `src/lib/git.ts:354` |
| `cleanup --force` only skips the confirmation prompt | confirmed, `src/commands/cleanup.ts:34-48` |
| The candidate list already prints uncommitted counts | confirmed, `src/commands/cleanup.ts:40` → `src/lib/utils.ts:38-42` |
| The single-worktree path prompts separately on uncommitted changes | confirmed, `src/lib/git.ts:310-315` |
| `remote` is only non-empty when the branch has an upstream | confirmed, `src/lib/git.ts:178` |
| `remove` also consumes `safeToRemove`, to group choices and to gate its confirmation | confirmed, `src/commands/remove.ts:36-48,81` |
| `ahead`/`behind` are computed only when `pathExists && remoteExists` | confirmed, `src/lib/git.ts:180-187` |
| `gitGetCommitsAheadCount` compares against `@{u}` | confirmed, `src/lib/git.ts:84-91` |
| `gitGetUncommittedChangesCount` uses `git status -s`, which counts untracked files | confirmed, `src/lib/git.ts:102-105` |
| `isSafeToRemove` declares no return type and falls through to `undefined` | confirmed, `src/lib/git.ts:153-166` |
| No test exercises `isSafeToRemove` or `gitGetWorktreeList` | confirmed, `src/lib/git.test.ts` — four `describe` blocks, none covering either |
| The docs page lists deleted-remote worktrees as targets without qualification | confirmed, `docs/src/app/docs/commands/cleanup/page.mdx:16` |

### 9.2 Correction the draft made to the supplied material

The original brief said cleanup shows "only a bulk progress bar". That overstates it — the default path does
print each candidate with its uncommitted count. The accurate, narrower statement is carried in §1, and it
matters because it changes what the fix has to do: the information is displayed but bundled into one bulk
yes/no, `--force` skips the display entirely, and the real defect is the classification rather than the
reporting.

## 10. Findings log

Closed findings tied to this feature, moved here from [`../findings.md`](../findings.md) at
`/feature-close` so that file does not grow for the life of the project.

### F-001 — P3 — `uncommittedChanges: undefined` with no remote is unpinned, and Phase 2 flips it

**Tied to:** Phase 2 · **Raised:** 2026-09-05 (Gate 2, reviewer subagent, Phase 1) ·
**Closed:** 2026-09-05 (Gate 1, Phase 2)

Phase 2 dropped the `wt.uncommittedChanges === 0` clause per §4.1 and pinned the resulting verdict: the
no-remote entry with an unknown count is `true`, asserted at `src/lib/git.test.ts:321-323` against
`entry()`'s defaults of `pathExists: true, remote: ""` (`src/lib/git.test.ts:245-253`). Gate 1 re-passed on
that run — `pnpm check`, `pnpm typecheck`, `pnpm build`, `pnpm test` (12 files, 189 tests) and
`pnpm docs:test` (6 files, 49 tests) all exit 0.

### Still open at retirement

Four `P3` findings tied to this feature were open when it was retired, and **stay in
[`../findings.md`](../findings.md)** — only closed findings move here. None gated the close; `P3` blocks
nothing. They are recorded here so the archive does not read as if the feature retired clean:

| Id | Phase | What it is |
|---|---|---|
| F-002 | 2 | §4.1's `pathExists`-first ordering is argued but unpinned by any test |
| F-003 | 3 | `{ pathExists: false, uncommittedChanges: 3 }` would be listed as skipped *and* removed |
| F-004 | 4 | the `remove` regression cases are looser than the §4.3 claim they pin |
| F-005 | 5 | `README.md:160` still carries the unqualified claim §4.4 corrected on the docs page |

F-002 and F-003 are both the `pathExists: false` ordering question, latent because
`gitGetWorktreeList` hardcodes the count to `0` when the path is missing. `agent-mode` Phase 6 adds a
live-agent clause to this same predicate (§2, R2) and is the natural place to settle them.

### §7 was not performed

**The by-hand verification in §7 was never run.** Every phase passed both gates on unit tests over
synthetic `WorktreeListEntry` objects, which is exactly what §7 says is insufficient: no test in this
feature exercised `gitGetWorktreeList` against a real repository, so nothing proved that the real list
builder produces the field values the corrected predicate depends on. Step 7 of that walkthrough — which
confirms Q1's remaining gap rather than fixing it — is likewise unconfirmed.

---

## Findings triage, 2026-09-11

The notes below were **open** against this feature when it retired, not closed. `/feature-close` blocks only
on an open `P0` or `P1` and sweeps only *closed* findings, so a `P2` or `P3` left open survived the close —
and could then never close, because a finding closes when the gate that raised it re-passes and that gate
belonged to a phase that no longer exists. Thirty-five had accumulated across five retired features,
carrying `context/findings.md` to 76 KB.

They are **withdrawn as findings and kept here as record.** Each is an internal note — a comment that
overclaims, a doc shape, a style observation — of the kind this log exists to hold. Nothing user-facing was
withdrawn this way: the behaviour defects and the mutation-resistance gaps went to the backlog instead, as
issues #55-#60, because those are work someone should still do rather than notes worth not losing.

Withdrawing is not a judgement that each was wrong. It records that no gate will ever close them, so leaving
them open misrepresented them as live.

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

**Withdrawn:** 2026-09-11 by the findings triage. Kept as record; see the section heading above.
