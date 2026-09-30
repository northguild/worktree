# Tracking

Where the backlog, the plans and the phase ledgers live. **Every command reads this file before it reads or
writes any workflow state** — it is what keeps a different tracker a rewrite of this one file rather than of
every skill. No skill names a tracker.

Configured by `/onboard` on 2026-09-09, when `@baldurpan/create-ai-workflow` 0.8.0 introduced this file,
and **rewritten by `/onboard` on 2026-09-09 under 0.10.0**, which replaced this answer's mechanism. The
answer did not change; how a phase is recorded did. See *What 0.10.0 changed* at the end — that section is
kept because plan bodies written under 0.8.0 still describe the old shape.

**Re-run by `/onboard` on 2026-09-30 under 0.22.0**, which added the planned label, `blocked by` between
features, the body's size ceiling, and the closing rules. The answer did not change. The `workflow:planned`
label was created that day.

**This file holds an answer, not a procedure.** How a phase is claimed, when a heartbeat is written, and in
what order a plan and its phases are created live in the skills, so a defect in one can be fixed by an
update. What each section takes is in [`tracking.notes.md`](tracking.notes.md).

## The answer

**In an issue tracker: GitHub issues in `northguild/worktree`.**

Confirmed against the remote on 2026-09-09 — `origin` is `git@github.com:northguild/worktree.git`.

**Repository:** `northguild/worktree`
**Backlog label:** `workflow:feature`
**Planned label:** `workflow:planned`

**Nothing in the workflow names GitHub. This file is where it is named**, so that a different tracker is a
rewrite of this file rather than of the skills.

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
| whether a feature has a plan | whether its body holds a phase ledger — never the planned label |
| whether a feature is being worked | the issue's assignee |
| which phases exist, in what order, depending on what | the issue body's phase ledger |
| where a phase stands | **the Status column of the ledger in that issue's body** |
| what a retired feature's outcome was | the closed issue — *completed* for shipped, *not planned* for dropped |
| what kind of work it is | the issue's type — set by the workflow, read by nothing in it |
| which features have to land before this one | the issue's **blocked by** relationships |
| how much a plan may hold | the issue body's size limit — **65,536 characters** |
| how a change closes one | `Closes #<n>`, in the pull request body where there is one and in the commit message otherwise |

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

[#39](https://github.com/northguild/worktree/issues/39) and
[#40](https://github.com/northguild/worktree/issues/40) predate the field and carry no line, so both rank
`Medium`. Left deliberately on 2026-09-09 rather than backfilled — `/roadmap` writes a real value the next
time either is touched.

The seven issues the 2026-09-11 findings triage opened
([#55](https://github.com/northguild/worktree/issues/55)-[#61](https://github.com/northguild/worktree/issues/61))
each carry a real `Priority:` line. They were opened by hand rather than by `/roadmap`, which is the one
route into this backlog that is not that command — recorded here so the exception is visible rather than
inferred from the issue list.

## Issue types

**The `northguild` org has three enabled**, and they are org-level rather than per-repository:

| Type | GitHub's description |
|---|---|
| `Task` | A specific piece of work |
| `Bug` | An unexpected problem or behavior |
| `Feature` | A request, idea, or new functionality |

**Types:** `Bug`, `Feature`, `Task` — re-confirmed against the org on 2026-09-30.

**The workflow sets a type and never reads one.** `/roadmap` guesses it from one or two lines,
`/feature-plan` corrects the guess once there is research to correct it from, and no refusal, ranking or
report branches on it. Where a write is silently dropped for want of push access, it is skipped and said
once — metadata, not a gate.

**`Task` collides, and the collision is only in the word.** In [`workflow.md`](workflow.md) a *task* is
work too small for this loop. An issue typed `Task` on GitHub is still a workflow feature if it carries the
label — the label is what the backlog is read from, and the type says nothing about it.

None of the seven `workflow:feature` issues carries a type as of 2026-09-09; every one predates the field.

## The labels

**Two.** `workflow:feature` (`#1D76DB`) puts an issue in the backlog; `workflow:planned` (`#5319E7`) says
its body holds a plan. Nothing else in the loop is a label.

**There is no `blocked` label and none is needed**: the ledger's Status column carries all four values.
A `workflow:blocked` label was created on 2026-09-09 under 0.8.0, when a phase was a sub-issue and a label
was the only place `blocked` could be written. Nothing writes it under 0.10.0, and it was **deleted from
the repository on 2026-09-09**. No issue carried it.

**`feature` here is [`workflow.md`](workflow.md)'s word** — work you would want a history row for — and not
a claim that the issue is not a bug. A bugfix worked through this loop carries `workflow:feature` too, and
may carry the `Bug` type at the same time.

The repository's nine existing labels were listed before `workflow:feature` was created: GitHub's
defaults, including `enhancement`, which is exactly why it is namespaced. Nothing collided. They were
listed again, ten by then, before `workflow:planned` was created on 2026-09-30, and nothing collided then
either.

### The planned label — the backlog, legible from the list

**The backlog label says an issue is in the loop. The planned label says it has a plan**, and it exists
for one reader: a person scanning the issues list, who cannot open every issue to find out which bodies
hold a ledger. Both chips render on the row, so three states are readable without a click — the backlog
label alone is an idea, both labels is planned and unstarted, and both plus an assignee is being worked.

**The ledger in the body is still the fact. The label is a rendering of it, and nothing reads it.**

> **No ranking, refusal, selection, gate or report may branch on the planned label.** *Whether a feature
> has a plan* is answered by the body, in the table above, by every command, every time. The workflow
> would behave identically if every planned label in this repository were deleted tonight.

**Who writes it, and when:**

| Command | Does |
|---|---|
| `/feature-plan` | **applies it**, in the same run that writes the plan into the body |
| `/tracking-migrate` | applies it to a migrated feature that arrives with a plan already written |
| `/roadmap` | **never** — an entry it opens is an idea, and an issue it adopts is somebody's report |
| `/feature-implement`, `/feature-close`, `/feature-status`, `/orchestrate` | nothing. It is not removed on the way out, because a closed issue has left the list the label is read from |

**A label that disagrees with the body is a stop, and the body wins.** Two disagreements, both for
`/feature-status` to report and neither for it to resolve: a ledger with no planned label (an interrupted
`/feature-plan`, or a plan written by hand), and a planned label on a body with no ledger (a label applied
by hand).

**No backfill was needed.** On 2026-09-30 none of the nine open `workflow:feature` issues held a ledger in
its body, so the label was created with nothing to apply it to.

**Applying it is best-effort**: it needs **triage** on the repository, the same bar as `blocked by`. Where
the write is refused, say so once and carry on. **Creating a label needs write access, which is why only
`/onboard` creates one** — applying a name that does not exist fails before the issue is touched
(`'<name>' not found`), so every other command only ever applies what it finds. On GitHub that is
`gh issue edit --add-label` / `--remove-label` to apply, `gh label create` to make one, `gh label list` to
see what exists. Matching is case-insensitive.

## Blocked by — the order between features

**A dependency between two features is the tracker's own `blocked by` relationship**, set on the issue that
has to wait and naming the issue it waits for. One write, visible from both ends — the waiting issue reads
*blocked by*, the one it waits for reads *blocking*. On GitHub that is `gh issue edit --add-blocked-by` and
`--remove-blocked-by`, `gh issue create --blocked-by`, and `blockedBy` as a JSON field on both
`gh issue view` and `gh issue list` — **the whole backlog's order in one query.**

**Never a body line and never a comment.** A sentence saying *needs the export API first* is a second home
for a fact the tracker already holds, and the two go out of step the moment one issue closes.

**Between features only.** Phases are rows in the ledger, in one body — they are not issues and they have
no relationships. A phase's `Depends on` column and a feature's `blocked by` answer the same question at
two scopes that never meet.

**Closing the blocker is the whole of clearing it.** Nothing in this workflow removes a relationship on the
way out. The exception is a feature closed as *not planned*: whatever it was blocking has just been
unblocked by something nobody is going to build, and only the close reason says so.

**Best-effort, like the type.** It needs triage permission. Where the write is refused, say so once and
carry on — the relationship is how the backlog is read, not a gate anything passes.

## The body has a ceiling, and it measures scope

**An issue body holds 65,536 characters.** That is the one hard limit in this substrate, and this is the
only place the number belongs.

**A plan that does not fit is a feature that is several features**, not a formatting problem. The plan
also needs room left over: every phase row gains a status, a commit sha and a note over the feature's life,
in the same body, so a plan that only just fits has already failed.

For scale, the four archived plans under `archive/` run from 33KB (`CLEANUP-DATA-LOSS-PLAN.md`) to 63KB
(`AGENT-MODE-PLAN.md`), measured 2026-09-30 in bytes. The largest would sit at this ceiling as an issue
body before its first phase row moved, and the smallest would already have spent half of it. That is the
measure this section exists to apply, not a reason to relax it.

**Three workarounds are refused:** trimming the plan until it fits, moving sections into comments, and
linking out to a gist or a file. **The answer is to split the feature into separate issues**, each with its
own plan and ledger — `/feature-plan` proposes the split along phase boundaries and asks, and
`/tracking-migrate` refuses rather than guessing at one.

## What the workflow will not touch

**This project's own labels, its Projects, and its milestones.** Nothing in the loop reads or writes any of
them, so a board or a release milestone can be used alongside this workflow without interference. The two
`workflow:` labels above are the whole of its label footprint, plus the type field on issues it opens and
the `blocked by` relationships between features.

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

## What this file does not decide

**How a phase is claimed, and how staleness is noticed.** Optimistic claiming and the phase-boundary
heartbeat are mechanisms, not preferences, and they live in the skills so an update can repair them.

**Whether work is pushed.** That is [`git.md`](git.md).

**Which features are in flight across the repository.** Under this answer that is the set of assigned
issues. It is written down nowhere else, and a file that tracked it would be a cache of something already
true elsewhere.

## The rules that hold either way

- **A feature never states its own status.** There is no `**Status:**` line in an issue body. *Whether a
  feature is being worked* is read off the assignee, so there is never a second copy to go stale. An issue
  body holds the problem before planning and the plan after, and never a claim about where the work stands.
- **A phase does state its status, in its ledger row.** The ledger is the single home for phase status, and
  the four values are written rather than observed because no structure expresses `blocked`.
- **The ledger row lands with the work, or names it.** A body edit cannot ride a commit, so the closing row
  carries the commit's sha and is checkable against the branch instead.
- **`done` is a verdict about the gates**, not about git and not about the tracker.
- **`notes.md` is a file in the working tree**, written by a phase's review and deleted whole by
  `/feature-close`. Nothing reads it, so there is no fact in it for a substrate to hold.
- **A bug is not a backlog entry.** The backlog holds **features** — work you would want a history row for.
  A defect goes wherever this project already files bugs, keeping this project's own labels, and nothing in
  the workflow reads it, ranks it or carries it. The backlog label is `/roadmap`'s to apply and no gate's,
  and the planned label follows it and never leads.
- **Neither `history.md` nor `archive/` is ever converted, in either direction.** Fabricating closed
  issues for features shipped months ago produces wrong dates, empty threads and an audit trail that looks
  real and is not. The three history rows that did become issues, below, were created on the day of the
  switch from rows that existed, and say so; nothing older will be.
- **If this file is missing, the answer is the working tree.** Say so once, and name `/onboard`.

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

**`findings.md` is no longer part of the workflow**, as of 0.22.0. Nothing reads or writes it: a
blocking item now ends fixed, as its phase's `blocked` ledger row, or filed as a bug or a backlog entry, and
a non-blocking one ends as a bug, a backlog entry, or a line in `notes.md` — see [`workflow.md`](workflow.md).
**The file is still in the tree, with open entries in it**, as of 2026-09-30. `/onboard` did not touch it:
deciding each open finding's end is work, not configuration. Until someone does, it is a record nobody
consults, and nothing that lands will be blocked by it.

What follows is the history of the file while it was live, kept because it is why the workflow dropped it.

**Its stated reason was wrong, and was corrected here.** That sentence used to read *"a finding is
raised and swept inside a single branch's life"*. The 2026-09-11 triage falsified it — 35 findings had
outlived their branch by months, across five retired features, because `/feature-close` sweeps only
*closed* findings and an open `P2`/`P3` passes straight through a retirement. A finding is raised inside one
branch's life; it is not necessarily swept there. The low-contention claim survives, the lifetime claim does
not.

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
