# Tracking

Where the backlog, the plans and the phase ledgers live. **Every command reads this file before it reads or
writes any workflow state** — it is what keeps a different tracker a rewrite of this one file rather than of
every skill. No skill names a tracker.

Configured by `/onboard` on 2026-09-09, when `@baldurpan/create-ai-workflow` 0.8.0 introduced this file,
and **rewritten by `/onboard` on 2026-09-09 under 0.10.0**, which replaced this answer's mechanism. The
answer did not change; how a phase is recorded did. See *What 0.10.0 changed* at the end — that section is
kept because plan bodies written under 0.8.0 still describe the old shape.

## The answer

**In an issue tracker: GitHub issues in `northguild/worktree`.**

Confirmed against the remote on 2026-09-09 — `origin` is `git@github.com:northguild/worktree.git`.

This answer exists for **several agents working several features at once**, which is what
[`git.md`](git.md)'s worktree-per-feature answer makes possible. A worktree carries only what its ref
holds, so a plan committed on one branch is invisible to every other tree; the tracker sits outside all of
them and every tree can reach it.

## How each tier is read

**The tier model is identical to the working-tree answer.** Only where a fact is read changes.

| To know | Read |
|---|---|
| the backlog | open issues labelled `workflow:feature` |
| what matters more within it | the issue body's `Priority:` line — see *Priority* below |
| whether a feature has a plan | whether its body holds a phase ledger |
| whether a feature is being worked | the issue's assignee |
| where a phase stands | **the Status column of the ledger in that issue's body** |
| what a retired feature's outcome was | the closed issue — *completed* for shipped, *not planned* for dropped |

## The plan and its ledger both live in the issue body

**One object, one write.** The plan's prose is the feature issue's body and the phase ledger is a table
inside that same body — `#`, `Phase`, `Depends on`, `Status`, `Note`, exactly the table a plan document
carries. `plans/` is not written to.

There is no second object to create and nothing to reconcile against, so **there is no window in which a
plan is half-written.** The phase vocabulary needs no mapping either: `not started`, `in progress`,
`blocked` and `done` are written into the Status column as [`workflow.md`](workflow.md) spells them.

### The body is a read-modify-write

**Re-read the body immediately before editing it, and change only the row.** A person may be refining the
plan while an agent flips a status, and a stale copy written back loses their edit with no trace. This
hazard does not exist under the working-tree answer, where the plan sits in a tree only one agent is in.

What makes that safe enough to rely on is the assignee: **a feature has exactly one writer**, and it is
whoever holds it. Several features may be assigned at once — that is the point of this answer — but never
two agents on one feature.

### A `done` row carries its commit sha

**The row cannot ride the commit here.** Under the working-tree answer the ledger row is a line in a file
that travels inside the commit, so the row and the code can never disagree. A body edit is a remote write
and cannot be part of a commit — so the evidence goes into the row instead: make the commit, then edit the
row immediately, **with that commit's sha in the Note.**

A `done` row whose sha is in the branch is checkable against the repository. **A `done` row with no sha is
a disagreement**, and `/feature-implement`'s step 5 stops on it. This project takes
[`git.md`](git.md)'s *the agent commits* answer, so there is always a sha to write.

**Comment at every phase boundary.** An assignee is a lock with no expiry: an agent that dies holding one
leaves the issue assigned and nothing reclaims it. The comment is what makes that visible from a machine
that is not the one that died — and under `/feature-implement --all` it is the only thing outside the run
that can see it at all.

## Priority

**A `Priority:` line in the issue body**, written by `/roadmap` and read by `/feature-plan` above *has a
draft*. An issues list has no manual order, so this line is the only place *what matters more* can be said
under this answer — it is what replaces the file answer's backlog ordering.

An issue carrying no `Priority:` line ranks as `Medium`. **Nothing else in the loop reads it**, and no
refusal or report may start to.

The two open backlog issues predate the field and carry no line, so both rank `Medium`:
[#39](https://github.com/northguild/worktree/issues/39) and
[#40](https://github.com/northguild/worktree/issues/40). Left deliberately on 2026-09-09 rather than
backfilled — `/roadmap` writes a real value the next time either is touched.

## Issue types

**The `northguild` org has three enabled**, and they are org-level rather than per-repository:

| Type | GitHub's description |
|---|---|
| `Task` | A specific piece of work |
| `Bug` | An unexpected problem or behavior |
| `Feature` | A request, idea, or new functionality |

**The workflow sets a type and never reads one.** `/roadmap` guesses it from one or two lines,
`/feature-plan` corrects the guess once there is research to correct it from, and no refusal, ranking or
report branches on it. Where a write is silently dropped for want of push access, it is skipped and said
once — metadata, not a gate.

**`Task` collides, and the collision is only in the word.** In [`workflow.md`](workflow.md) a *task* is
work too small for this loop. An issue typed `Task` on GitHub is still a workflow feature if it carries the
label — the label is what the backlog is read from, and the type says nothing about it.

None of the seven `workflow:feature` issues carries a type as of 2026-09-09; every one predates the field.

## The label

**One: `workflow:feature`** (`#1D76DB`) — a planning-workflow feature, an issue whose body holds the plan
and its phase ledger.

**There is no `blocked` label and none is needed**: the ledger's Status column carries all four values.
A `workflow:blocked` label was created on 2026-09-09 under 0.8.0, when a phase was a sub-issue and a label
was the only place `blocked` could be written. Nothing writes it under 0.10.0, and it was **deleted from
the repository on 2026-09-09**. No issue carried it.

**`feature` here is [`workflow.md`](workflow.md)'s word** — work you would want a history row for — and not
a claim that the issue is not a bug. A bugfix worked through this loop carries `workflow:feature` too, and
may carry the `Bug` type at the same time.

The repository's nine existing labels were listed before this one was created: GitHub's defaults, including
`enhancement`, which is exactly why this one is namespaced. Nothing collided.

## What the workflow will not touch

**This project's own labels, its Projects, and its milestones.** Nothing in the loop reads or writes any of
them, so a board or a release milestone can be used alongside this workflow without interference. The one
`workflow:feature` label above is the whole of its footprint, plus the type field on issues it opens.

Nothing here merges a pull request, deletes a branch, or removes a worktree either — see
[`git.md`](git.md).

## How a feature issue is closed

[`git.md`](git.md) says the agent pushes and opens a pull request, so **`/feature-close` puts
`Closes #<issue>` in the pull request body and lets the merge close it.** The close then rides the same
change as the work.

**`--dropped` closes the issue directly**, whatever `git.md` says: a trailer closes an issue as *completed*,
and that is the wrong outcome for an idea that will not be built. The two close reasons are how this answer
records what `history.md`'s Outcome column used to.

**This substrate does not require the push answer** — it works under every one of them. What the pairing
buys is not mechanical: this substrate exists so several agents in several trees can share state, and work
that is never pushed is visible to exactly one of them. This project holds the strong pair.

## The 0.8.0 migration, and what is left in the tree

**`context/roadmap.md` is gone.** All four of its entries were migrated to issues on 2026-09-09 and the
file was removed — under this answer the backlog is the tracker, and a second copy in the tree is the
drift this workflow exists to prevent.

| Issue | Feature | State on migration |
|---|---|---|
| [#39](https://github.com/northguild/worktree/issues/39) | `worktree-churn-stats` | backlog |
| [#40](https://github.com/northguild/worktree/issues/40) | `chat-input-multiline` | backlog |
| [#41](https://github.com/northguild/worktree/issues/41) | `github-issue-auto-assign` | backlog; its draft became a comment on the issue. **Shipped since**, in 7e59e95 (#50) |
| [#42](https://github.com/northguild/worktree/issues/42) | `herdr-space-opener` | all seven phases `done`. **Closed since** |

**`context/history.md` and `context/drafts/` are gone too.** The three history rows became closed issues
on 2026-09-09, and the one draft became a comment on its own issue:

| Issue | Feature | Outcome |
|---|---|---|
| [#43](https://github.com/northguild/worktree/issues/43) | `cleanup-data-loss` | shipped 2026-09-05, closed |
| [#44](https://github.com/northguild/worktree/issues/44) | `shell-argv-safety` | shipped 2026-09-06, closed |
| [#45](https://github.com/northguild/worktree/issues/45) | `agent-mode` | shipped 2026-09-06, closed |

**`context/archive/` stays, and that is the deliberate half of the split.** `history.md` always described
itself as indexing depth rather than duplicating it — the reasoning stays in the archived plan document.
Closed issues are a better index than a table that conflicts on every merge; they are a worse home for
30–50KB of decision records. So the index moved and the depth did not. Each closed issue links to its
archived plan, [`findings.md`](findings.md) still links into `archive/`, and a clone of this repository
still contains its own engineering history.

**`context/plans/` is empty.** `HERDR-SPACE-OPENER-PLAN.md` was the one document that outlived the
migration — the record of [#42](https://github.com/northguild/worktree/issues/42), whose seven phases
finished before the switch. That issue was closed without the move being made; `/onboard` moved the
document to `archive/` on 2026-09-09 to settle it. The directory is kept with its `.gitkeep` rather than
removed, so nothing has to be recreated if this answer is ever revisited.

**Two open issues predate the workflow and are outside it** —
[#21](https://github.com/northguild/worktree/issues/21) (Gitlab support) and
[#22](https://github.com/northguild/worktree/issues/22) (Bitbucket support). Neither carries
`workflow:feature`, which is deliberate: the backlog this workflow reads is the labelled set, so these stay
ordinary issues until someone labels them.

**`findings.md` stays under both answers**, unchanged. A finding is raised and swept inside a single
branch's life, so it is never the thing two agents contend over.

## What 0.10.0 changed

Recorded because **[#41](https://github.com/northguild/worktree/issues/41)'s body still describes the old
shape**, in a sentence that is now false: *"Phase status lives in this issue's sub-issues, and nowhere
else."* It is a closed, shipped feature and its body is history, so it was left as written rather than
rewritten after the fact. Read it as a record of how that feature was worked, not as instruction.

| Under 0.8.0 | Under 0.10.0 |
|---|---|
| one sub-issue per phase, titled `[<n>] <phase name>` | no sub-issues — the ledger is a table in the body |
| the body's phase table dropped its Status column | the body carries the full table, Status and all |
| status was open / assigned / `workflow:blocked` / closed | the four status words, written into the column |
| a phase closed via `Closes #<sub-issue>` on the commit | the row is edited after the commit, with the sha in its Note |
| two labels | one — `workflow:blocked` deleted |
| the tracker answer **required** git.md's push answer | it works under every push answer; the pairing is recommended |
| — | `Priority:` and the issue type, both new, neither read by the loop |

**`gh` has no sub-issue support and this answer no longer needs any.** The `gh api .../sub_issues` recipe
this file carried under 0.8.0 was removed with the mechanism it served. It was never exercised against this
repository: the three sub-issues that did exist, on #41, were created before that note was written and
were **closed as completed on 2026-09-09** — they had stayed open under a closed parent, which under the
old reading meant three phases `in progress` on a shipped feature.
