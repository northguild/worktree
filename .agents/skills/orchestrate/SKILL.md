---
name: orchestrate
description: "Run one ad-hoc, commit-sized change through the same verification and review gates the feature loop uses, without a roadmap entry or a phase ledger — or, with --pr, end that run at a pull request instead of in the working tree. Explicit invocation only — run this when the user types /orchestrate. Do NOT match on 'build X', 'implement X', 'orchestrate the work', or any request that belongs to a planned feature."
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
/orchestrate --pr "<what to do>"   # end at a pull request, not in the working tree (step 7)
/orchestrate --pr #<issue>
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

Read [`context/stack.md`](../../../context/stack.md) and load `context/standards/README.md` per its
conditional table.

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

**Every non-blocking observation gets one of the ends in *What happens to a defect the gate found* in
[`context/workflow.md`](../../../context/workflow.md), and kind decides which** — not size, and **not
whether it needs code changes**, which every true observation about code does.

- **A real defect, and it is user-visible or a regression would land green** → a **bug**, wherever this
  project already files bugs, carrying this project's own labels. **Never the backlog label** — see *A bug
  is not a backlog entry* in that same file. The backlog is a list of features and this is not one.
- **Not a defect, but work you would want a `history.md` row for** → that is a backlog entry, and adding
  one is `/roadmap`'s. **Name it and say what you would add**; do not append to the backlog from here. That
  command applies the worth-adopting test and writes what the ranking reads, and a gate doing it by hand
  produces neither.
- **Anything else** → this run's report, and it dies with the session. **There is no `context/notes.md` in
  this command** — step 5 says why.

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
one that would outlive every branch. **So step 4's cheap end has nowhere to live here: a bug is filed, a
feature is `/roadmap`'s to admit, and everything else goes in the report and dies with the session.**

## 6. Land it — read [`context/git.md`](../../../context/git.md)

**Do not commit unless that file says the agent does, or `--pr` was typed** — that flag is the same file's
other source of permission and step 7 is where it is spent. If the file does not exist, the answer is *the
user commits*: say so once, and name `/onboard`.

**Without `--pr`, nothing here branches, worktrees or pushes**, whatever *Where work lands* and *Push and
pull request* say. Both of those answers are about a feature — one branch or tree per entry, one push at
`/feature-close` — and an ad-hoc change has no entry and no feature to close. It lands on whatever branch
is already checked out. **A worktree answer is not permission to move an ad-hoc change into a tree of its
own**; that is the commonest way this rule gets read backwards, and **the flag does not change it** — step 7
pushes a branch and creates no tree.

- **The user commits** → leave the change **unstaged** in the working tree and hand it over. Staging it is
  not a head start; it is half a commit. **Under `--pr`, go to step 7 instead**: a pull request with nothing
  committed to it is not a smaller version of this flag, it is nothing.
- **The agent commits** → one commit, at the granularity that file names.

**Run from `#<issue>`, the commit is what closes it.** Put `Closes #<issue>` in the commit message, the
same way `/feature-close` puts it in a pull request body — the close then rides the change instead of being
a step somebody has to remember, which is the whole reason this command takes an issue at all. **Where the
user commits, say the line rather than writing it**: it is their commit, and a close is not yours to make
on their behalf. Never close the issue by hand as a separate act — a closed issue whose fix is sitting
unstaged in somebody's tree is worse than an open one.

## 7. `--pr` — the change leaves the machine

Without the flag this invocation is over at step 6, and the change is committed or waiting on whatever
branch you were already on. With it, the run ends at a **pull request**: one commit, the branch pushed, and
the work opened for a person to read.

**The flag is the permission, not a new `git.md` answer.** That file names two sources and only two — an
answer covering this command at this point, *or* the user asking in this session in plain words — and a
typed flag is the second one. So the flag does not need *Who commits* to say the agent does, and it does
not read *Push and pull request*: both of those answers are about a feature, and this command has none.
What it authorises is **this invocation**. Nothing it does becomes policy for the next one, and nothing
here is written into `git.md`.

It buys exactly three things, in this order: **the commit, a push of the branch you are on, and the pull
request.** Anything past that is refused below, under *What the flag is not*.

**The body is this run's report** — step 8's content, which is the only description of the change that
exists. Run from `#<issue>`, step 6 already put `Closes #<issue>` in the commit, so the body does not repeat
it: the trailer closes the issue on merge whichever text the forge reads.

### It cannot invent a branch

- **HEAD is not the default branch** → commit, push that branch, open the pull request. Nothing was created,
  which is why this is the case the flag is built for.
- **HEAD is the default branch** → **stop before the commit**, unless *Branch and worktree* in
  [`context/executors.md`](../../../context/executors.md) names a command — then run that one. Pushing to
  the default branch is asked for by name each time under every `git.md` answer, and an empty *Branch and
  worktree* means the workflow makes no branch, not that it should improvise `git checkout -b`. Say which
  of the two stopped you, leave the change in the tree, and let the user make a branch and run it again.
- **That command makes a worktree rather than a branch** → stop and say so. Step 6 refuses to move an
  ad-hoc change into a tree of its own, and a flag on this command is not the user lifting that.

### Stop, and hand back

The flag is permission to finish, not an instruction to land. **Stop, report, and name the line that
stopped you**, when:

- **step 1 refuses the scope.** A flag is not a reason to admit work that is not commit-sized, that a
  roadmap entry already covers, or that arrived carrying the backlog label.
- **Gate 1 does not come back clean, or Gate 2's verdict is `FAIL` on its last allowed loop.** Nothing is
  committed and nothing is pushed: a pull request is where finished work goes to be read by a person, not
  where unfinished work goes to be verified. Step 5's handback is unchanged — the change stays in the tree.
- **the push will not fast-forward**, or the repository has no remote to push to.

**Step 2's release-note ask still happens.** The level is a judgment and `release.md` has it confirmed
before the note is written; this flag names where the run ends, not that nobody is reading. A run that
waits there is working as intended.

### What the flag is not

**Nothing merges it.** Not on green CI, not on an approving review, not after any wait. `git.md` reserves
review and merge in one line — *review and merge are yours* — and a pull request nobody reads is the one
thing this flag must not produce, since then the push bought nothing the working tree did not already have.
It also does not delete a branch, enable the forge's own auto-merge, or stay alive watching a check run.

**It lifts no refusal and widens nothing.** It does not skip a gate, raise a loopback cap, admit a scope
step 1 refused, or turn an ad-hoc change into a feature. A stop list worked around once is not a stop list.

## 8. Report

What changed, whether it is committed or waiting in the tree, the Gate 1 output, the Gate 2 verdict, any
loopbacks, any non-blocking observations the review raised — which die here — any bug filed for work that
outlived the change, whether the commit closes the issue it ran from, and any release note written, with
the paths that were checked and owed nothing.

**Under `--pr`**, also the branch that was pushed and the pull request that was opened — or the line in
step 7 that stopped short of one — and that nothing merged it.

## Rules

- **No ledger row is touched.** This command has no phase and does not belong to a feature.
- **No roadmap entry is created, activated or retired.** If the work turns out to be a feature, stop and
  say so; the user runs `/roadmap`.
- **The release note is not deferred to a later command.** There is no `/feature-close` behind this one to
  write it, which is exactly why the change is the unit.
- **Never skip Gate 1 to save time.** The gates are the entire reason this command exists.
- **Nothing merges, and nothing waits for CI.** `--pr` ends at a pull request a person has not read yet.
