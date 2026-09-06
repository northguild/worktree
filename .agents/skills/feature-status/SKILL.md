---
name: feature-status
description: "Read-only report of where the active feature stands — its plan's phase ledger, open findings, and git state — ending with exactly one next action. Explicit invocation only — run this when the user types /feature-status. Do NOT match on 'what's the status', 'where are we', or general progress questions."
---

# /feature-status

The read-only "where do things stand" view. **It writes nothing, commits nothing, and invokes no other
agent.**

**It is never a prerequisite.** Every other command resolves its own starting point — nobody has to run
this first. It exists for when *you* want to know.

Read [`context/workflow.md`](../../../context/workflow.md) for the tier model.

## 1. Read, in this order

1. `context/roadmap.md` — which entry is `active`, and what each entry's **Doc** points at.
2. That plan document's **status ledger**, and each phase's **Files:** line.
3. `context/findings.md` — open findings, and which phase each is tied to.
4. Git state — `git status --short` and the last few commits.

**Nothing is cached and nothing is parsed by a script.** Read the ledger every time. That is the property
that makes hand-editing a row change this command's answer immediately, with no regeneration step.

## 2. Reconcile before trusting the ledger

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

## 3. Report

Keep it short. The user is asking a question, not reading a document.

```
Feature:  <name> — <marker>        (or: none active)
Plan:     <path>
Phases:   <n> done · <n> in progress · <n> blocked · <n> not started
Findings: <n> open (<severities>)  (or: none open)

Next: <exactly one action>
```

Under the header, list only the phases that are **not** `done`, one line each with their Note. Do not
re-print the whole ledger.

## 4. Name exactly one next action

In priority order — take the **first** that applies and name only it:

1. An open `P0` or `P1` → fix it. Quote the finding's id and its closing condition.
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

"Exactly one" is the point. A list of three things to consider is what this command exists to replace.

## Rules

- **Read-only. No exceptions.** Not the ledger, not the roadmap, not a finding, not a "quick fix while I'm
  here". If you spot something that needs changing, name it as the next action and let the user decide.
- **Never invoke another agent.**
- **Never mark anything.** Reporting that a phase looks finished is not marking it `done`; only
  `/feature-implement` does that, on gate evidence.
