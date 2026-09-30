---
name: feature-status
description: "Read-only report of where the active feature stands — its plan's phase ledger and git state, plus every other worktree in flight where the project works that way — ending with exactly one next action. Explicit invocation only — run this when the user types /feature-status. Do NOT match on 'what's the status', 'where are we', or general progress questions."
---

# /feature-status

The read-only "where do things stand" view. **It writes nothing, commits nothing, and invokes no other
agent.**

**It is never a prerequisite.** Every other command resolves its own starting point — nobody has to run
this first. It exists for when *you* want to know.

Read [`context/workflow.md`](../../../context/workflow.md) for the tier model, and
[`context/tracking.md`](../../../context/tracking.md) for where the state it reports lives. **Everything
below is written for the working-tree answer**; where that file names the tracker, read
[`tracker.md`](tracker.md) beside this file before step 1 — it says what changes.

## 1. Read, in this order

1. `context/roadmap.md` — which entry is `active`, and what each entry's **Doc** points at.
2. That plan document's **status ledger**, and each phase's **Files:** line.
3. Any row reading `blocked` — and what its Note says stopped it.
4. Git state — `git status --short` and the last few commits.

**Nothing is cached and nothing is parsed by a script.** Read the ledger every time. That is the property
that makes hand-editing a row change this command's answer immediately, with no regeneration step.

## 2. In worktree mode, sweep the worktrees

Read [`context/git.md`](../../../context/git.md). **If *Where work lands* is not the worktree answer, skip
this step entirely** — there is one working tree and step 1 has already read it.

Under that answer, `roadmap.md` on the default branch cannot see what is in flight: each feature's `active`
marker and its ledger advance inside that feature's own tree, and reach the default branch only when the
branch merges. So enumerate them.

1. `git worktree list` — every working tree, its path and its branch. **That is the state.** Nothing
   records which features are in flight; a worktree existing is the claim, and removing it withdraws the
   claim. Do not write a file to track this, and do not read one if you find it.
2. For each tree other than this one, read `<path>/context/roadmap.md` for its `active` entry and that
   entry's ledger at `<path>/context/plans/<NAME>-PLAN.md`. Two numbers per tree — phases `done` out of
   phases total — and its lowest not-`done` phase.
3. Whether an agent session is live in a tree is not a git fact. If
   [`context/executors.md`](../../../context/executors.md) names a way to ask, run it and say which trees
   are occupied. If it does not, say the report cannot tell rather than guessing from a dirty tree.

**Two things that are not discrepancies here:**

- **A worktree with no `active` entry.** It is a tree nobody has started in, or one whose feature is closed
  and whose branch is waiting to merge. Report it as idle.
- **A plan reading `not started` on the default branch while its own worktree's copy reads phase 3.** That
  is one document at two commits, which is what a branch is. Step 3 reconciles a ledger against the tree it
  lives in, never across two trees — report the worktree's copy, which is the one being worked.

## 3. Reconcile before trusting the ledger

Report and **stop** on any of these:

- A phase marked `done` whose **Files:** or commits do not exist.
- A phase marked `not started` whose work is plainly already in the tree.
- An entry marked `active` pointing at a document that does not exist.
- An entry marked `active` for a feature that already has a `context/history.md` row.
- **A document in `context/plans/` that no roadmap entry points at.**

Do not resolve a discrepancy yourself, and do not pick a next action off a ledger you have just shown to be
stale. That is the exact failure this workflow exists to prevent.

**Two things that are not discrepancies:**

- Every phase `done` while the entry still reads `active` — that is the normal state before
  `/feature-close`. Next action 5 handles it.
- A `done` row with its changes still in the working tree. Under the default policy in
  [`context/git.md`](../../../context/git.md) that is the normal end state of a phase, not a discrepancy —
  the user commits. Name it in the report; do not stop on it, and do not commit it: this command writes
  nothing.

## 4. Report

Keep it short. The user is asking a question, not reading a document.

```
Feature:  <name> — <marker>        (or: none active)
Plan:     <path>
Phases:   <n> done · <n> in progress · <n> blocked · <n> not started

Next: <exactly one action>
```

Under the worktree answer, and only there, one block above **Next** — one line per tree the sweep found,
and nothing for a repository that has none:

```
In flight: <n> worktrees
  <branch>  <feature>  <n>/<n> phases  <idle | agent live | unknown>
```

Under the header, list only the phases that are **not** `done`, one line each with their Note. Do not
re-print the whole ledger.

## 5. Name exactly one next action

In priority order — take the **first** that applies and name only it:

1. A phase reading `blocked` → clear it. Quote the row's Note, which is what stopped it.
2. A phase **`in progress`** → resume it, quoting its Note. Do not restart it.
3. A phase **`blocked`** with every other phase `done` → report the blocker; the next action is the user's.
4. A phase `done` with a next **unblocked** phase → `/feature-implement`, naming the phase it will pick.
5. **Every** phase in the active plan `done` → `/feature-close`.
6. **No active feature, but at least one entry has a plan** → `/feature-implement`, which ranks the planned
   entries and asks.
7. **No plans, at least one `pending` entry** → `/feature-plan`. **Do not pick a candidate yourself** —
   that command ranks the backlog and asks, and naming one here would either duplicate its ranking or
   contradict it.
8. **Nothing at all** → `/roadmap "some idea"`.

**Run from the default branch in worktree mode**, apply that same order across every tree the sweep found
and name the tree the action belongs to — where to be, then what to do there. It is still exactly one. A
fleet of three features with three next actions is precisely the list this command exists to replace: name
the most urgent one, and the other two keep.

**Run from inside a worktree**, the answer is about that tree. Other trees are somebody else's turn, and
the report says so in one line rather than ranking them.

"Exactly one" is the point. A list of three things to consider is what this command exists to replace.

## Rules

- **Read-only. No exceptions.** Not the ledger, not the roadmap, not a finding, not a "quick fix while I'm
  here". If you spot something that needs changing, name it as the next action and let the user decide.
- **Never create, remove or switch a working tree.** The sweep reads `git worktree list` and the files it
  points at. Naming a tree to go to is this command's job; going there is not.
- **Never invoke another agent**, and under the tracker answer never assign, un-assign, label, close
  anything, or edit an issue body. Reading is the whole of this command.
- **Never mark anything.** Reporting that a phase looks finished is not marking it `done`; only
  `/feature-implement` does that, on gate evidence.
