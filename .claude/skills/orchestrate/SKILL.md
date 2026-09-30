---
name: orchestrate
description: "Run one ad-hoc, commit-sized change through the same verification and review gates the feature loop uses, without a roadmap entry or a phase ledger. Explicit invocation only — run this when the user types /orchestrate. Do NOT match on 'build X', 'implement X', 'orchestrate the work', or any request that belongs to a planned feature."
disable-model-invocation: true
model: sonnet
effort: medium
---

# /orchestrate

A gated one-shot pass over a scope you name. No roadmap entry, no ledger, **no tier boundary crossed.**

It exists because the valuable part of the loop is the **gate machinery** — Gate 1 reading `verify.md`,
Gate 2's reviewer, a capped gate handing back rather than landing — and that is worth having for
unplanned work too, arguably most of all, since that is where fixes get cowboyed. Without it, the only
route to a verified, reviewed change is to file a roadmap entry, and people will route around the workflow
for small things.

Read [`context/workflow.md`](../../../context/workflow.md) for the gate contract and the feature/task rule.

## Usage

```
/orchestrate "<what to do>"
/orchestrate #<issue>              # the issue is the brief
```

**The second form is how a bug reaches this loop.** A defect too small to plan has no backlog entry and
never will — *A bug is not a backlog entry* in [`context/workflow.md`](../../../context/workflow.md) says
why — so without it the tracker and the work never touch, and closing the issue is a separate thing
somebody remembers. Read the issue per [`context/tracking.md`](../../../context/tracking.md)'s repository
answer and use its title and body as the brief; **quote nothing back into a new description.** Where that
file names no tracker, this form has nothing to read: say so and ask for the work as a sentence.

## 1. Refuse, before anything else

Two guards, or this becomes the way to skip planning:

1. **Refuse anything that is not commit-sized.** A commit-sized unit has one checkable outcome. A category
   of activity ("add tests", "improve error handling", "refactor the API layer") is not one. Say what the
   scope would need to be split into, and name `/roadmap`.
2. **Refuse anything an existing roadmap entry already covers.** Read `context/roadmap.md` and check. If
   one covers it, say which, and name `/feature-plan` and `/feature-implement`.
3. **Refuse an issue that carries the backlog label.** That label says the backlog owns it, and a labelled
   issue is a feature whether or not it looks small from here. Name `/feature-plan`. This guard replaces
   guard 2 under the tracker answer, where the backlog is not a file.

Apply the standing test from [`context/workflow.md`](../../../context/workflow.md): *if you would want a
`history.md` row for it, it is a feature.* Ask that question out loud and answer it before proceeding.

A refusal here is the workflow working.

## 2. Do the work

Read `context/stack.md` and load `context/standards/README.md` per its conditional table.

**Ask the surface question first**, per the standing rule in
[`context/workflow.md`](../../../context/workflow.md): does this change put something in front of a person,
sit in a hot path, or cross a trust boundary? Each *yes* is a row of that table nothing else will reach, and
*none of these* goes in the report like any other answer. A one-shot change is where this gets skipped most,
for the same reason the documentation sweep does — there is no plan holding the row.

**Check that file's Documentation section, and the tree if it is empty.** If this change makes something
there wrong — a README, a docs page, a changelog, help text in the code — the fix is part of this change,
per the standing rule in [`context/workflow.md`](../../../context/workflow.md). A one-shot change is where
that gets skipped most, because there is no plan holding the row.

**Read [`context/release.md`](../../../context/release.md) and apply it to the paths this change touches.**
That file's granularity answer — *once per feature*, or *per phase* — is plan vocabulary, and this command
has neither an entry, a plan nor a ledger. **Here the change is the unit.** Do not treat the change as a
feature to make *once per feature* readable, and do not decide the answer never fires: either reading ends
with a user-visible fix shipping unannounced, and nothing goes red when it does.

The table still governs. For each path this change touches, write a note where that path's *deserves a note
when* column says one is deserved — so a docs typo gets nothing, because the column says so — and **propose
the level and confirm it** before writing. **Say which paths you checked and what each one owed**, including
when the answer is *none*. A path the table does not cover is named rather than guessed at: write no note
for it and name `/onboard`. Name no release tool; that file says what records a note here.

Dispatch per [`context/executors.md`](../../../context/executors.md): a **coder subagent if your runtime
provides one**, on the model tier that file names where your runtime lets you choose one; an external
executor, a CLI or a tool, where it names one; otherwise implement in-host, and say which one you ran. The
coder's system prompt is [`context/roles/coder.md`](../../../context/roles/coder.md) either way. The brief
**cites paths, it does not paste files** — this command has no plan and so no `Standards:` line, so it
points at `context/standards/README.md` and says to load per its conditional table. Describe what needs to
happen, never how to code it.

## 3. Gate 1 — verification

Per the gate contract in [`context/workflow.md`](../../../context/workflow.md): read
[`context/verify.md`](../../../context/verify.md) and run every section above *Not run by Gate 1*, in
order — Lint → Typecheck → Build → Test first, then anything that file adds after them. What a missing
section, a non-zero exit or an empty file means is in that contract and in `verify.md`'s own rules, not
here; docs-only changes run Lint plus a read of the diff.

## 4. Gate 2 — review

Dispatch per [`context/executors.md`](../../../context/executors.md) — a **reviewer subagent if your
runtime provides one**, an external reviewer, or the host reading its own diff. The last is the fallback
and the weakest, so **say which one you ran.** Where the runtime has no subagent mechanism, review the diff
yourself against the standards and say that is what happened.

Require concrete evidence — file paths, command output — for every verdict, and for every item in it, **one
bit: does it block this change or not.** There is no severity scale — see *What happens to a defect the gate
found* in [`context/workflow.md`](../../../context/workflow.md).

- `PASS` or `PASS WITH NOTES` → done.
- `FAIL` → loop back.

**A non-blocking observation goes in this run's report and dies with the session** — unless it needs code
changes, in which case it is work and belongs in the backlog per
[`context/tracking.md`](../../../context/tracking.md).

## 5. Loopback

Cap: **two loops per gate.** Re-brief with the prior implementation and the validator's feedback
**verbatim**, plus the instruction to address only the failing items, refactor nothing that passes, and
expand no scope.

At the cap: **stop and hand back.** This command has no ledger to write a `blocked` row into, so the record
is the working tree plus the report: leave the change exactly where it is, uncommitted, and say what failed,
what was tried, and what the last feedback was. **If the work is still worth doing, it is a bug** — file it
wherever this project files bugs and name it. **Never the backlog label**, for the reason in
[`context/workflow.md`](../../../context/workflow.md). Run from `#<issue>`, the issue is already that
record: say what is left in it rather than opening a second one.

**A commit-sized change that cannot pass its gates is handed back, not filed away.** Nothing here writes a
record that outlives the session, because nothing here is half-finished in a way the next session could
resume — the tree either carries the change or it does not.

**This command writes no `context/notes.md`**, and that is the one place it departs from *What happens to a
defect the gate found* in [`context/workflow.md`](../../../context/workflow.md). That file's cheap end is
bounded by `/feature-close` deleting it, and an ad-hoc change has no close — so a note written here is the
one that would outlive every branch. **An observation that is work becomes an issue; every other one goes
in the report and dies with the session.**

## 6. Land it — read [`context/git.md`](../../../context/git.md)

**Do not commit unless that file says the agent does.** If it does not exist, the answer is *the user
commits*: say so once, and name `/onboard`.

**Nothing here branches, worktrees or pushes**, whatever *Where work lands* and *Push and pull request*
say. Both of those answers are about a feature — one branch or tree per entry, one push at
`/feature-close` — and an ad-hoc change has no entry and no feature to close. It lands on whatever branch
is already checked out. **A worktree answer is not permission to move an ad-hoc change into a tree of its
own**; that is the commonest way this rule gets read backwards.

- **The user commits** → leave the change **unstaged** in the working tree and hand it over. Staging it is
  not a head start; it is half a commit.
- **The agent commits** → one commit, at the granularity that file names.

**Run from `#<issue>`, the commit is what closes it.** Put `Closes #<issue>` in the commit message, the
same way `/feature-close` puts it in a pull request body — the close then rides the change instead of being
a step somebody has to remember, which is the whole reason this command takes an issue at all. **Where the
user commits, say the line rather than writing it**: it is their commit, and a close is not yours to make
on their behalf. Never close the issue by hand as a separate act — a closed issue whose fix is sitting
unstaged in somebody's tree is worse than an open one.

## 7. Report

What changed, whether it is committed or waiting in the tree, the Gate 1 output, the Gate 2 verdict, any
loopbacks, any non-blocking observations the review raised — which die here — any bug filed for work that
outlived the change, whether the commit closes the issue it ran from, and any release note written, with
the paths that were checked and owed nothing.

## Rules

- **No ledger row is touched.** This command has no phase and does not belong to a feature.
- **No roadmap entry is created, activated or retired.** If the work turns out to be a feature, stop and
  say so; the user runs `/roadmap`.
- **The release note is not deferred to a later command.** There is no `/feature-close` behind this one to
  write it, which is exactly why the change is the unit.
- **Never skip Gate 1 to save time.** The gates are the entire reason this command exists.
