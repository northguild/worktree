---
name: tracking-migrate
description: "Move this project's existing workflow state onto the substrate context/tracking.md names — every roadmap entry becomes an issue and every plan becomes that issue's body, ledger and all — one feature at a time, resumable, and removing a tree file only once its issue exists. Explicit invocation only — run this when the user types /tracking-migrate. Do NOT match on 'switch to issues', 'move this to GitHub', or any request to change where tracking lives — that answer is /onboard's."
disable-model-invocation: true
---

# /tracking-migrate

Carries the workflow state that already exists in the working tree onto the tracker, so that the answer in
[`context/tracking.md`](../../../context/tracking.md) and the data the commands read are the same thing.

**It moves data. It does not choose the substrate.** That answer is `/onboard`'s Step 5, along with the
repository and the label names this command needs to do anything at all. Run `/onboard` first; run this
second.

**This is the command `/onboard` names when it cannot switch cleanly.** A repository with a backlog, a
plan, or an active feature cannot have its answer flipped and its data left behind — every command would
read an empty tracker and report an empty backlog, while the entries sat in a file nothing opens any more.
`/onboard` refuses to write that state; this command is how it is reached instead.

Read [`context/workflow.md`](../../../context/workflow.md) for the tier model and
[`context/tracking.md`](../../../context/tracking.md) for how this project's tracker answers each tier.

## Usage

```
/tracking-migrate             # migrate every feature the tree still holds
/tracking-migrate --dry-run   # say exactly what would be created and removed, and write nothing
```

**Run `--dry-run` first and show it.** This is the only command in the workflow whose writes are mostly
remote, and a remote write is not a diff someone can read before it lands.

## One direction only

**Tree → tracker. There is no reverse.** Not because it is hard, but because it is lossy in a way this
direction is not: an issue carries a thread, a reporter, subscribers and cross-links that no markdown file
can hold, so converting back would silently discard the reason the answer was taken. It reads like an undo
and is not one.

If the tracker answer turns out to be wrong for this project, the honest move is to change
[`context/tracking.md`](../../../context/tracking.md) back and leave the issues where they are, as the
record of that era — the same way `history.md` stays under the tracker answer.

## Refusals — check all of these before writing anything

Report every one that fires, not just the first. Fixing them one round-trip at a time is the failure this
list exists to prevent.

- **[`context/tracking.md`](../../../context/tracking.md) does not name the tracker answer.** Then there is
  nothing to migrate *to*, and this command would be inventing a destination. Say which answer the file
  holds and name `/onboard`.
- **The tracker's parameters are missing** — the repository, or the label name. Same answer: they are
  Step 5's to collect, and a migration that guessed one would write into the wrong place.
- **A phase is `in progress`.** An agent may be inside it right now, in this tree or another one, and
  [`context/workflow.md`](../../../context/workflow.md)'s read-fresh model assumes the substrate does not
  move underneath a running phase. Name the feature and the phase, and stop. Finish it or park it back to
  `not started` first — that is a person's decision, not this command's.
- **The ledger disagrees with the repo** — a phase marked `done` whose **Files:** do not exist, or the
  reverse. Migrating a disagreement copies it into a substrate where it is harder to see. Name it and stop;
  `/feature-status` is where that gets resolved.
- **A plan in `plans/` with no roadmap entry, or an entry whose **Doc** points at nothing.** The entry and
  its document travel together, and a migration is the wrong moment to decide which of the two is right.

## What moves, and what never does

| In the tree | Becomes | Notes |
|---|---|---|
| a `roadmap.md` entry | an issue carrying the backlog label | the title is the kebab-case name; the body is the entry's one or two lines |
| its `Size:` field | a line in the body | it is part of the entry, and nothing else records it |
| the `active` marker | the issue's assignee | see *Who the active feature is assigned to* below |
| a `drafts/<NAME>.md` document | that same issue's body, under a heading | the draft and the issue are one object under this answer |
| a `plans/<NAME>-PLAN.md` document | that same issue's body, replacing the one or two lines | the full template shape, **ledger included and unchanged** |
| each ledger row | the same row, in the body's table | Status and Note carried across verbatim — nothing is re-derived |
| nothing in the tree | a `Priority:` line in the body | ask for it; an issues list has no manual order, so `roadmap.md` position is the fact being lost |
| nothing in the tree | the issue's type, where this project has them | a guess, best-effort, never overwriting one already set |

| Never moves | Because |
|---|---|
| `history.md` | fabricating closed issues for features shipped months ago produces wrong dates, empty threads, and an audit trail that looks real and is not |
| `archive/` | the same, and the retired plan documents are the evidence behind those rows |
| `findings.md` | it stays a file under both answers — a finding is raised and swept inside one branch's life, so it is never contended |

**`history.md` and `archive/` stay exactly where they are, forever.** They are the record of the era before
the switch, and everything under `context/` is project-owned, so keeping them costs nothing. New closures
become closed issues; the old ones stay where they happened. That is not two homes for one fact — it is two
eras, each honest about what it covers.

## The order, and why a failure is survivable

Twenty issue creations are twenty remote writes and any one of them can fail. What makes that safe is not
retrying harder — it is that **every feature is finished before the next one starts, and its tree files are
removed last.**

For one feature, in this order:

1. **Create the issue** with the backlog label and its body — the plan in full, ledger and all, or the
   entry's one or two lines where it has no plan.
2. **Set its `Priority:` line, and its type** where this project has types. Best-effort, and neither is a
   gate.
3. **Assign the issue** if the entry was `active`.
4. **Only now, remove that feature's tree files** — its `roadmap.md` entry, and its `drafts/` or `plans/`
   document.

**The plan is one write.** The ledger goes into the body as the table it already is, every row's Status and
Note carried across as they stand. There is no second object to create, so there is no window in which a
feature arrives half-migrated with a complete plan that reads as a draft.

**Fail at any point and the feature is still in exactly one substrate.** Steps 1–3 are additive: a partial
issue is visibly partial, and re-running reconciles it. Step 4 is the commit point, and it cannot happen
before the issue it replaces exists. **A repository is never in neither substrate**, which is the failure
mode a bulk migration has and this one does not.

Do the features in `roadmap.md` order, and **say which one you are on** as you go. A run that dies leaves a
readable trail.

## Resuming — by observation, not by a state file

**Re-running this command is safe and is how a failed run is finished.** Nothing records progress: progress
is *observed*, the same way "planned" is the observation that a document exists.

Before creating anything, list the issues already carrying the backlog label and match them to the tree by
name. Then, per feature:

| The tree has | The tracker has | Do |
|---|---|---|
| an entry | no issue with that name | migrate it — the whole sequence above |
| an entry | an issue with that name | **finish it** — set whatever is unset, then remove the tree files |
| no entry | an issue with that name | already done. Say so and move on |
| an entry whose plan and issue body disagree | an issue with that name | **stop and say so.** Neither side is obviously right, and this command is not where that is decided |

**State which row you matched, per feature, before you write anything for it.** The middle row is what
makes a re-run safe: the issue and its whole plan arrive in one write, so everything that can be left
half-done afterwards is additive, and finishing a partial feature is the same operation as re-doing a
finished one.

**Never create a second issue for a name that already has one.** That is the one irreversible mistake
available here — everything else is a re-run away from correct.

## Who the active feature is assigned to

The `active` marker records one fact: *this feature is being worked here*. The assignee is where that fact
lives under the tracker answer, so an `active` entry migrates to an assigned issue.

**Assign it to the account this migration is running as, and say so.** That is the honest reading of a
marker set in this tree. If the person who will actually work it is someone else, that is a reassignment
they make afterwards — say that too, rather than asking, because it is one click and the alternative is a
question with no good default.

`pending` entries migrate unassigned. There is nothing to carry.

## When the tree is empty

Say so and stop. A repository with no entries, no drafts and no plans has nothing to migrate, and this
command has no other purpose — the substrate answer was already complete when `/onboard` wrote it.

Do not create anything to prove the tracker works.

## Finishing up

1. **Show what changed**, as a list: every issue created with its number, what was set on it, and every
   file removed. The removals are the part that is a diff; show them as one.
2. **Offer to remove what is now dead and empty** — `roadmap.md` once its last entry is gone, and `drafts/`
   and `plans/` once they hold nothing. Only where empty, only shown first, and never `history.md`,
   `archive/` or `findings.md`.
3. **Update [`context/tracking.md`](../../../context/tracking.md)** to say the migration ran, on what date,
   and what stayed behind. That file already holds the answer; what it gains is the fact that the answer and
   the data now agree. If anything was left un-migrated, name it there — a split that is written down is a
   task, and one that is not is a trap.
4. **Say what was not decided.** Nothing here closes an issue, merges a pull request, or touches this
   project's own labels, Projects or milestones.

Then stop. **Do not commit** — the file removals are a working-tree change like any other, and
[`context/git.md`](../../../context/git.md) says who commits.

## Rules

- **Never remove a tree file before the issue that replaces it exists.** The whole safety argument is this
  one ordering.
- **Never create a second issue for a name that already has one.**
- **Never convert `history.md` or `archive/`**, in either direction.
- **Never migrate while a phase is `in progress`.**
- **Never invent the substrate.** If [`context/tracking.md`](../../../context/tracking.md) does not name the
  tracker and its parameters, this command has nothing to do — name `/onboard` and stop.
- **Never transcribe a credential.** An entry, a draft or a plan can hold one, and an issue body is a
  tracked file for that purpose and probably a more public one. See the standing rule in
  [`context/workflow.md`](../../../context/workflow.md).
- **Do not commit.**
