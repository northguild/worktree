---
name: feature-implement
description: "Activate a planned feature and run the next phase of its plan — or, with --all, phase after phase until something stops it — through implementation, verification and review, updating that phase's status where context/tracking.md says it lives. Explicit invocation only — run this when the user types /feature-implement. Do NOT match on 'implement X', 'build this', 'let's code it', or any general request to write code."
---

# /feature-implement

Owns the transition from *has a plan* to *being worked*, **and** the phases within it. One invocation runs
**one phase**: pick it, do it, gate it, close out its ledger row. `--all` (step 14) runs that same loop
back to back instead of stopping after the first.

Read [`context/workflow.md`](../../../context/workflow.md) for the tier model, the one-active-feature rule
and the gate contract. This skill cites those rather than restating them.

Read [`context/tracking.md`](../../../context/tracking.md) for where the ledger lives. **Everything below
is written for the working-tree answer**; where that file names the tracker, read [`tracker.md`](tracker.md)
beside this file before step 1 — it says what changes.

## Usage

```
/feature-implement            # resolve or choose a feature, then run the next phase
/feature-implement "<name>"   # a named feature
/feature-implement --all      # keep going, phase after phase, until step 14's stop list says otherwise
```

## 1. Resolve the feature

Read `context/roadmap.md`.

- **One entry is `active`** → that is the feature. Skip to step 3.
- **None active** → rank the entries whose **Doc** points into `context/plans/` and **ask which to
  activate**, using your runtime's question mechanism if it has one. Rank by: open questions resolved →
  dependencies shipped (a `history.md` row under it) → smaller first.
- **No entry has a plan** → say so and name `/feature-plan`. Do not plan one here.
- **A name was given** → resolve it against `roadmap.md`. It must have a plan; if it does not, name
  `/feature-plan`.

**Never execute anything out of `context/drafts/`.** A draft has no ledger and is not a plan, however
detailed it looks.

## 2. The approval checkpoint — before setting the marker

This is the step that used to be structural: `/feature-plan` stopped and you typed a second command. It is
explicit here now, or it is lost.

1. **Surface the plan's Open questions section and require an acknowledgement.** Do not proceed on
   silence. Cite it by name — a plan written against an earlier template numbers its sections differently.
2. **Re-check that the files the plan cites still exist.** A plan drafted a month ago against a
   since-changed tree is a state that can now exist and could not before. Name anything that has moved.
3. **Check the one-active-feature rule** in [`context/workflow.md`](../../../context/workflow.md). If
   another entry holds the slot, stop and name it.
4. **Be where the work lands.** Read *Where work lands* in [`context/git.md`](../../../context/git.md).
   Only the first phase checks it — a feature's branch or tree is made once, before any of its work.
   - *The main working tree* → nothing to do.
   - *A branch per feature* → if you are on the default branch, create this feature's branch with the
     invocation [`context/executors.md`](../../../context/executors.md) names under *Branch and worktree*,
     and say so; if it already exists, switch to it. Never start a phase on the default branch under this
     answer. **If that section names nothing, stop and ask** — do not fall back to `git checkout -b`.
   - *A worktree per feature* → if this working tree's branch is not this feature's, **stop.** Name the
     tree the work belongs in, and the invocation `executors.md` names for creating one if it does not
     exist. Do not create it from here and do not carry on in the wrong tree: under this answer the working
     directory *is* the feature, and a session cannot relocate itself into a tree it has just made.
     **Never improvise the command** — a bare `git worktree add` skips whatever the recorded one does
     around it, and `executors.md` says why.
5. Set the marker to `active`, in this working tree. One token, one place — do not move the entry, add a
   section, or write a summary line anywhere. Under the worktree answer that marker never leaves the tree,
   and that is what lets several features hold one at once.

## 3. Pick the phase

Read the plan's status ledger. Take the **lowest-numbered phase that is not `done` and whose `Depends on`
entries are all `done`.**

**State which phase you picked, and why, in one line, before doing anything else.**

If it is already `in progress`, **read its Note and resume from there — do not restart it.**

## 4. Read the row you are about to work

If the phase you picked reads `blocked`, its Note says what stopped it. **That is the work** — clear it
before starting anything new, or say plainly why it cannot be cleared and stop. A `blocked` row is the only
durable record a previous run left, so it is read rather than overwritten.

## 5. Stop on disagreement

If the ledger's claim contradicts the repo — a phase marked `done` whose **Files:** do not exist, or work
plainly in the tree under a phase marked `not started` — **say so and stop.** Never silently re-do or skip
a phase on a stale ledger.

## 6. Open the ledger row

Set the phase's Status to `in progress` and write a Note naming what is underway — **before any code.**

This row is what a *later* session reads. A phase interrupted here — context exhausted, session closed, run
cancelled — leaves a working tree with half a phase in it. A row still reading `not started` sends the next
run into step 5's disagreement stop, or into redoing work that is already there.

One token and one Note, in the row that is already there — do not move the entry, restructure the table, or
write a summary anywhere else. If the row is already `in progress` because you are resuming it, leave it
alone; step 11 rewrites the Note.

**This write is not a change of its own.** Leave it in the working tree — it lands with the phase's work
under either answer in [`context/git.md`](../../../context/git.md). Never commit it on its own.

## 7. Do the work

Read the phase's §6.2 sub-section: its scope, its **Files:**, and what `done` means for it.

**The plan's Documentation rows assigned to this phase are part of this phase**, not a follow-up — their
paths are on the same **Files:** line as the code. Per the standing rule in
[`context/workflow.md`](../../../context/workflow.md), whatever this phase makes untrue is fixed by this
phase. If the work turned out differently from the plan and made something *else* untrue — a README the
plan never listed — fix that too and say so; the sweep happened before the code existed.

**Read [`context/release.md`](../../../context/release.md) and find out whether this phase owes a release
note.** That file answers per path and at one granularity, and only one of its two granularity answers
reaches this step:

- **Once per feature** → nothing here. `/feature-close` writes it, with the whole feature in view.
- **Per phase** → the note is part of this phase's scope. For each path this phase touches, read that
  path's row: write a note where the *deserves a note when* column says so, in whatever that file says
  records one, and **put the note's path on the phase's `Files:` line** alongside the code. Step 11 then
  refuses `done` on a phase whose note has not landed, by the rule it already applies to documentation.

**A landed phase has shipped nothing, under either granularity.** *Per phase* is a claim about what one
changelog entry covers, not about reaching users: what puts this in front of anyone is the event that file's
*what a release ships* answer names, and this command never fires it. Report the phase as landed and say
what it is waiting for.

**A note is one or two sentences.** It is read by someone deciding whether this affects them — not
reviewing the diff. Say what changed for them and stop: no phase-by-phase account, no list of files, no
rationale that belongs in the plan. If it needs a paragraph, the thing to link is the plan, not to inline
it.

**Say which paths you checked and what each one owed** — including when the answer is *none*. An empty
report reads as "nobody looked", exactly as it does for documentation.

**A path [`context/release.md`](../../../context/release.md) does not cover is named, not guessed at.**
Write no note for it and name `/onboard`: the file is missing an answer, and inventing one mid-phase writes
policy nobody chose. It is not a reason to stop the phase either — the same rule
[`context/verify.md`](../../../context/verify.md) states about an empty section.

**Coming back here does not write a second note.** A resumed phase and a Gate 2 loopback both re-enter this
step. Update the note that is already there — two notes describing one change do not collide and are both
counted, so the announcement says the same thing twice.

**Name no release tool.** That file says what records a note in this project, the same way
[`context/verify.md`](../../../context/verify.md) is the only file that names a command.

Dispatch per [`context/executors.md`](../../../context/executors.md), which holds one of three answers:
hand the work to a **coder subagent if your runtime provides one** — on the model tier that file names,
where your runtime lets you choose one — implement in-host, or offload to an external executor, a CLI or a
tool. The brief is the same either way, and so is the system prompt —
[`context/roles/coder.md`](../../../context/roles/coder.md). A runtime with no subagent mechanism reads
the first answer and implements in-host; that is a fallback, not a failure, and say which one you ran.

**Isolating the implementation does not move the gates.** They run here, in the caller, on the diff the
coder produced. A coder that reports its own success has reported nothing — that is what step 11 means by
refusing `done` on a self-report.

The brief **cites paths, it does not paste files.** Point at the phase's own section in the plan — its
`Files:`, and its `Standards:` line, which is the plan's one traversal of `context/standards/README.md` and
what the coder loads instead of the table — and at `context/stack.md`. Anything that can read this
repository can open them, and a brief that inlines them is a brief that goes stale. A plan written before
phases carried a `Standards:` line has none; then say to load per that README's conditional table.

Describe **what** needs to happen, never **how** to code it. Scope each delegated task to specific files.

## 8. Gate 1 — verification

Per the gate contract in [`context/workflow.md`](../../../context/workflow.md): read
[`context/verify.md`](../../../context/verify.md) and run every section above *Not run by Gate 1*, in
order — Lint → Typecheck → Build → Test first, then anything that file adds after them. What a missing
section, a non-zero exit or an empty file means is in that contract and in `verify.md`'s own rules, not
here; docs-only changes run Lint plus a read of the diff.

A failure is the verdict — go to step 10 with the failing output verbatim as the feedback.

## 9. Gate 2 — review

Dispatch per [`context/executors.md`](../../../context/executors.md), which holds one of three answers: a
**reviewer subagent if your runtime provides one**, an external reviewer, or the host reading its own diff.

The last is the fallback and the weakest — the session that wrote the code judging whether the code is good
— so **say which one you ran**, every time. The first is the cheapest real independence available: a
reader that never saw the implementation being written, only what it produced. Brief it with the phase's
section — its `Files:`, its review expectations and its `Standards:` line — and the diff. Where the runtime
has no such mechanism, fall back to reviewing the diff yourself against the plan's review expectations and
the standards, and say that is what happened.

Require concrete evidence — file paths, command output — for every verdict, and for every item in it,
**one bit: does it block this phase or not.** There is no severity scale to assign — see *What happens to a
defect the gate found* in [`context/workflow.md`](../../../context/workflow.md).

- `PASS` or `PASS WITH NOTES` → the phase's work is done; go to step 11.
- `FAIL` → go to step 10.

**Every non-blocking observation gets one of two ends, and kind decides which** — not size. The full
argument is *What happens to a defect the gate found* in
[`context/workflow.md`](../../../context/workflow.md):

- **A real defect, and it is user-visible or a regression would land green** → it is a **bug**. File it
  wherever this project already files bugs, with this project's own labels, and say in the report that you
  did. **Do not apply the backlog label** — see *A bug is not a backlog entry* in
  [`context/workflow.md`](../../../context/workflow.md). The backlog is a list of features and this is not
  one.
- **Not a defect, but work you would want a `history.md` row for** → that is a backlog entry, and adding
  one is `/roadmap`'s. **Name it and say what you would add**; do not append to the backlog from here. That
  command applies the worth-adopting test and writes what the ranking reads, and a gate doing it by hand
  produces neither.
- **Anything else** → one short entry in `context/notes.md`, naming the phase it came from. Create the file
  if it is not there. It is branch-local, it rides this phase's commit the way the ledger row does, and
  `/feature-close` deletes it whole.

**Do not brief the next phase on either one.** `notes.md` is written for a person and read by nothing — a
phase that took it as input would be reading it against code that has moved, which is the drift the split
above exists to avoid.

## 10. Loopback

Cap: **two loops per gate, per phase.**

Under the cap: re-brief with the prior implementation and the validator's feedback **verbatim — do not
summarise or paraphrase it** — plus the instruction to address only the failing items, refactor nothing
that passes, and expand no scope. Then re-run the same gate.

At the cap: **close the row to `blocked` with the reason in its Note — before you escalate**, not after.
A phase whose verification cannot pass is blocked by definition. Then hand back to the user with the
current state and the last feedback verbatim.

**Escalating is not a substitute for recording.** The conversation ends and the ledger does not, so a run
that escalates without writing the row has left the next session nothing to read.

## 11. Close out the ledger row

The row is part of the same change as the work — never a separate step afterwards:

- **All of the phase's scope landed and both gates passed** → `done`. Its documentation rows are part of
  that scope, and so is any release note step 7 said this phase owed: a phase whose doc update or note has
  not landed has not landed.
- **Some landed** → stays `in progress`, Note rewritten to name exactly what remains.
- **A gate hit its cap, or something external blocks it** → `blocked`, with the blocker in the Note.

**Never mark `done` on a coder's self-report** — the gate output is the evidence. A blocking item that was
not fixed means the gate did not pass, and a gate that did not pass means the phase is not `done` — there
is no second check to run, because `done` already says both gates passed.

`done` is a verdict about the gates, not about git. Whether the change is committed at all is the next step.

## 12. Land it — read [`context/git.md`](../../../context/git.md)

**Do not commit until you have read that file, and do not commit at all unless it says the agent does.**
It is the only place this project's answer lives, the same way `verify.md` is the only place its commands
live. If it does not exist — an install from before it shipped — the answer is *the user commits*: say so
once, and name `/onboard`.

- **The user commits** → leave the change **unstaged** in the working tree, ledger row and all. Report it,
  hand it over, and stop. Do not stage-and-commit "to be helpful", and do not stage without committing
  either — `git add` is the first half of a commit, and it edits what the user's own commit would capture.
- **The agent commits** → the code and the ledger row in one commit, at the granularity that file names, on
  the branch step 2 put you on.

**A phase never pushes**, whatever *Push and pull request* says. That answer is acted on once, by
`/feature-close`, when the branch carries the whole feature. A phase that pushes publishes a half-built
feature and turns every phase after it into a force-push.

## 13. Report

- What changed, and which files — and whether it is committed or waiting in the tree.
- Gate 1 output, and Gate 2's verdict.
- Loopback counts, if any.
- Any non-blocking observation the review raised, and where each one went — a bug, a `/roadmap` you
  named, or `notes.md`.
- The phase's new ledger status, and which phase is next.

**When every phase is `done`, say so and name `/feature-close`.** Do not move files, stamp headers or sweep
references — that is a tier boundary, and crossing it is an explicit command the user runs, not a
side-effect of the last phase finishing.

## 14. `--all` — the next phase without a second invocation

Without the flag, this invocation is over at step 13. With it, **go back to step 3 and run the next
phase**, and keep going until the stop list below says otherwise.

Phase to phase is not a tier boundary — this command already owns "activation, and the phases within a
plan" — so the flag crosses nothing. What it removes is the pause where a user reads a phase's report
before the next one builds on it, and everything below exists to replace that pause with something
written down.

**Step 2 does not run again.** The approval checkpoint, the branch or worktree, and the marker are all
once per feature and happened before the first phase. That is what makes this a loop over steps 3–13
rather than a second invocation of the command.

**Step 13 reports every phase, as that phase ends** — never held back for one summary at the end. The
report is the evidence a phase actually passed, and a run that dies four phases deep has to leave that
evidence behind it. It is step 9's argument about the transcript, one level up.

### Say two things before the first phase

1. **Which reviewer step 9 will run**, from [`context/executors.md`](../../../context/executors.md). Where
   it is the host reading its own diff, **say that plainly**: one phase of the weakest answer with a user
   reading the report afterwards is not four phases of it unattended, each built on the last.
2. **What [`context/git.md`](../../../context/git.md) says about who commits.** Under *the user commits*,
   step 12 leaves each phase in the working tree — so **run this phase, decline the continuation, and name
   that answer as the reason.** *One commit per phase* is that file's answer about the shape the tree is
   left in, and a tree carrying four phases at once cannot be cut back into four commits. Nothing is lost:
   the user commits and runs it again. Under *the agent commits*, each phase is its own commit and the
   loop runs.

### Stop, and hand back

The flag is permission to continue, not an instruction to finish. **Stop after the phase that just ended,
report, and name the line that stopped you**, when:

- it closed `blocked`, or stayed `in progress` because only part of its scope landed
- a gate hit its two-loop cap — step 10 has already written the `blocked` row and escalated
- step 5's disagreement holds for the next phase: the ledger's claim contradicts the repo
- nothing is runnable: the lowest phase that is not `done` has a `Depends on` that is not `done`
- **every phase is `done`** → say so and name `/feature-close`, exactly as step 13 does

**`--all` never crosses into `/feature-close`.** That is a tier boundary, and a flag on this command is not
the user typing that one.

A Gate 2 `PASS WITH NOTES` continues, and so does a `FAIL` that passes on its loopback. Only the cap stops.

**Never widen the flag to cover what it does not.** It runs the phases of one plan. It does not pick a
second feature, re-plan a phase whose scope turned out wrong, or lift any refusal above — a stop list
worked around once is not a stop list.
