---
name: feature-implement
description: "Activate a planned feature and run the next phase of its plan through implementation, verification and review, updating that phase's status where context/tracking.md says it lives. Explicit invocation only — run this when the user types /feature-implement. Do NOT match on 'implement X', 'build this', 'let's code it', or any general request to write code."
disable-model-invocation: true
---

# /feature-implement

Owns the transition from *has a plan* to *being worked*, **and** the phases within it. One invocation runs
**one phase**: pick it, do it, gate it, close out its ledger row.

Read [`context/workflow.md`](../../../context/workflow.md) for the tier model, the one-active-feature rule
and the gate contract. This skill cites those rather than restating them.

Read [`context/tracking.md`](../../../context/tracking.md) for where the ledger lives. **Everything below
is written for the working-tree answer**; *Under the tracker answer* at the end says what changes.

## Usage

```
/feature-implement            # resolve or choose a feature, then run the next phase
/feature-implement "<name>"   # a named feature
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
   - *A branch per feature* → if you are on the default branch, create this feature's branch per
     [`context/executors.md`](../../../context/executors.md) and say so; if it already exists, switch to
     it. Never start a phase on the default branch under this answer.
   - *A worktree per feature* → if this working tree's branch is not this feature's, **stop.** Name the
     tree the work belongs in, and how `executors.md` says to create one if it does not exist. Do not
     create it from here and do not carry on in the wrong tree: under this answer the working directory
     *is* the feature, and a session cannot relocate itself into a tree it has just made.
5. Set the marker to `active`, in this working tree. One token, one place — do not move the entry, add a
   section, or write a summary line anywhere. Under the worktree answer that marker never leaves the tree,
   and that is what lets several features hold one at once.

## 3. Pick the phase

Read the plan's status ledger. Take the **lowest-numbered phase that is not `done` and whose `Depends on`
entries are all `done`.**

**State which phase you picked, and why, in one line, before doing anything else.**

If it is already `in progress`, **read its Note and resume from there — do not restart it.**

## 4. Check `context/findings.md`

An open `P0` or `P1` tied to this phase **is** the work. Fix it before starting anything new.

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

Dispatch per [`context/executors.md`](../../../context/executors.md), which holds one of three answers:
implement in-host, hand the work to a **coder subagent if your runtime provides one**, or offload to an
external CLI. The brief is the same either way, and so is the system prompt —
[`context/roles/coder.md`](../../../context/roles/coder.md). A runtime with no subagent mechanism reads
that answer and implements in-host; that is a fallback, not a failure, and say which one you ran.

**Isolating the implementation does not move the gates.** They run here, in the caller, on the diff the
coder produced. A coder that reports its own success has reported nothing — that is what step 11 means by
refusing `done` on a self-report.

The brief **cites paths, it does not paste files.** Point at `context/standards/README.md` and say to load
per its conditional table; point at `context/stack.md` and the phase's own section. Anything that can read
this repository can open them, and a brief that inlines them is a brief that goes stale.

Describe **what** needs to happen, never **how** to code it. Scope each delegated task to specific files.

## 8. Gate 1 — verification

Per the gate contract in [`context/workflow.md`](../../../context/workflow.md): read
[`context/verify.md`](../../../context/verify.md) and run its sections in order — Lint → Typecheck → Build →
Test.

**Never carry a copy of these commands here and never invent one.** A missing section is skipped and said
so, never faked. Exit 0 is the verdict regardless of summary text. If `verify.md` does not exist or has no
filled-in section, stop and say so. Docs-only changes run Lint plus a read of the diff.

A failure is the verdict — go to step 10 with the failing output verbatim as the feedback.

## 9. Gate 2 — review

Dispatch per [`context/executors.md`](../../../context/executors.md), which holds one of three answers: an
external reviewer, a **reviewer subagent if your runtime provides one**, or the host reading its own diff.

The last is the default and the weakest — the session that wrote the code judging whether the code is good
— so **say which one you ran**, every time. The middle one is the cheapest real independence available: a
reader that never saw the implementation being written, only what it produced. Where the runtime has no
such mechanism, fall back to reviewing the diff yourself against the plan's review expectations and the
standards, and say that is what happened.

Require concrete evidence — file paths, command output — for every verdict, and a `P0`–`P3` severity on
every blocking finding.

- `PASS` or `PASS WITH NOTES` → the phase's work is done; go to step 11.
- `FAIL` → **write it to [`context/findings.md`](../../../context/findings.md) first, then** go to step 10.

**Write the finding before the loopback, not after it.** A verdict that lives only in this session's
transcript evaporates when the conversation ends — including a `P0` the cap never got to.

## 10. Loopback

Cap: **two loops per gate, per phase.**

Under the cap: re-brief with the prior implementation and the validator's feedback **verbatim — do not
summarise or paraphrase it** — plus the instruction to address only the failing items, refactor nothing
that passes, and expand no scope. Then re-run the same gate.

At the cap: **write a finding** (`P1` for a Gate 1 cap-out — a phase whose verification cannot pass is
blocked by definition), then escalate to the user with the current state and the last feedback.
**Escalating is not a substitute for recording.**

## 11. Close out the ledger row

The row is part of the same change as the work — never a separate step afterwards:

- **All of the phase's scope landed and both gates passed** → `done`. Its documentation rows are part of
  that scope: a phase whose doc update has not landed has not landed.
- **Some landed** → stays `in progress`, Note rewritten to name exactly what remains.
- **A gate hit its cap, or something external blocks it** → `blocked`, with the blocker in the Note.

**Never mark `done` on a coder's self-report** — the gate output is the evidence. **Refuse `done` while an
open `P0` or `P1` is tied to this phase**; leave it `in progress` and name the finding.

`done` is a verdict about the gates, not about git. Whether the change is committed at all is the next step.

## 12. Land it — read [`context/git.md`](../../../context/git.md)

**Do not commit until you have read that file, and do not commit at all unless it says the agent does.**
It is the only place this project's answer lives, the same way `verify.md` is the only place its commands
live. If it does not exist — an install from before it shipped — the answer is *the user commits*: say so
once, and name `/onboard`.

- **The user commits** → leave the change in the working tree, ledger row and all. Report it, hand it over,
  and stop. Do not stage-and-commit "to be helpful".
- **The agent commits** → the code and the ledger row in one commit, at the granularity that file names, on
  the branch step 2 put you on.

**A phase never pushes**, whatever *Push and pull request* says. That answer is acted on once, by
`/feature-close`, when the branch carries the whole feature. A phase that pushes publishes a half-built
feature and turns every phase after it into a force-push.

## 13. Report

- What changed, and which files — and whether it is committed or waiting in the tree.
- Gate 1 output, and Gate 2's verdict.
- Loopback counts, if any.
- Findings written or closed, by id.
- The phase's new ledger status, and which phase is next.

**When every phase is `done`, say so and name `/feature-close`.** Do not move files, stamp headers or sweep
references — that is a tier boundary, and crossing it is an explicit command the user runs, not a
side-effect of the last phase finishing.

## Under the tracker answer

Read [`context/tracking.md`](../../../context/tracking.md) first. Every step above holds — the approval
checkpoint, both gates, the loopback cap, the refusal to mark `done` on a self-report. Only where status is
written changes, plus two mechanisms that exist because more than one agent can be running.

| Above | Becomes |
|---|---|
| the `active` marker | the issue's assignee |
| the plan's phase list, order and `Depends on` | the issue body — unchanged, it is still the plan |
| the ledger's Status column | its sub-issues |
| a phase's Status | open and unassigned is `not started`, open and assigned is `in progress`, the blocked label is `blocked`, closed is `done` |
| a phase's Note | a comment on that sub-issue |
| step 6, open the row | assign yourself the sub-issue |
| step 11, close the row | `Closes #<sub-issue>` in the commit, so the forge closes it when the branch lands |

**Step 3 reads both.** The body says which phases exist and what each depends on; the sub-issue says where
that phase stands. Pick the same way — lowest-numbered phase not `done` whose `Depends on` are all `done` —
and **stop if the two disagree**: a listed phase with no sub-issue, or a sub-issue naming no listed phase,
is step 5's disagreement rule, and a half-created plan is not something to work around by picking whatever
is there.

### Claiming, in step 2

**Assignment is not compare-and-swap** — two agents can both read *unassigned* and both assign. So:
**assign, re-read, confirm you are the sole assignee, and back off if you are not.** Say which happened. An
issue that already has a different assignee is held; name the holder and stop, exactly as the
one-active-feature rule does above.

**The rule is per working tree and per agent, not per repository.** Several features may be assigned at
once — that is the point of this answer. What must not happen is two agents on one feature.

### The heartbeat, at every phase boundary

**Comment on the issue when a phase opens and when it closes**, naming the phase and, once there is one,
the commit. Two lines is enough.

An assignee is a lock with no expiry: an agent that dies holding one leaves the issue assigned and nothing
reclaims it. The comment cannot prevent that — it makes it **visible**, from a machine that is not the one
that died. *"Phase 2 opened six hours ago and nothing since"* is a reclaimable state; an assignee alone is
not. This is step 6's argument for the opening row write, one level up, and it is why that write is a
comment here as well as an assignment.

**Reclaiming is not this command's job.** If you find a stale claim, say so and stop. Do not un-assign
someone else's agent.

### Closing out, in steps 11 and 12

- **`done`** → put `Closes #<sub-issue>` in the commit message. Do not close the sub-issue by hand: the
  point is that the closing write rides the same change as the work, which is what the ledger row did.
  Where the user commits rather than the agent, say the trailer is needed and leave it in the message you
  hand over.
- **stays `in progress`** → leave it assigned and comment what remains.
- **`blocked`** → add the blocked label and comment the blocker. Remove that label when it unblocks;
  nothing else does.

**Never close a sub-issue to get past a refusal**, exactly as no phase is marked `done` to get past one.

**`findings.md` is unchanged.** It stays a file. A finding is raised and swept inside one branch's life, so
it is never contended — and an open `P0` or `P1` blocks the phase here the same way.
