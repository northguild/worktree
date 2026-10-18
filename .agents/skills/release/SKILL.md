---
name: release
description: "Cut a release from the notes already accumulated on the default branch — make the branch the recorded command makes, run the script context/release.md's Bump wire names, and end at a pull request for a person to approve. Explicit invocation only — run this when the user types /release. Do NOT match on 'ship it', 'cut a release', 'release this', 'publish it', or a release being obviously due."
---

# /release

Consumes the notes that are waiting, moves the versions, and ends at a **pull request nobody has read
yet.** No roadmap entry, no ledger, **no tier boundary crossed** — and nothing released: the version moved
in a branch, and what ships it is the merge.

It exists because [`context/release.md`](../../../context/release.md) has always named the ship event as
*the merge of the release pull request* — and nothing in this workflow created one. `/feature-close
--release` fuses the release into a feature's own merge, which is right for a repository that releases
about as often as it merges. This command is the separated shape: the notes accumulate on the default
branch as features land, and somebody decides when they go out.

Read [`context/workflow.md`](../../../context/workflow.md) for the standing rules — above all
*Writing a note is the workflow's half; consuming notes is not*, which this command is the asked-for
exception to.

## Usage

```
/release                  # the branch is release/<today>, as YYYY-MM-DD
/release "<name>"         # the branch is release/<name>
```

**Typing the command is the permission.** [`context/workflow.md`](../../../context/workflow.md) forbids
running what bumps, tags, publishes or deploys, with one exception — *when the user asks for it in that
turn* — and **a typed command is what that asking looks like**, the same way `/orchestrate --pr` and
`/feature-close --release` are. So it is never inferred: not from "and ship it" earlier in the session, not
from a plan, not from the notes looking ready, and not from a release being plainly overdue. **A sentence
is not a command.**

**The name is the act, not the version.** The version is not knowable until the script that consumes the
notes has run, and that script **cannot be run twice** — so a branch named for the version cannot exist
before the thing that would name it. The version goes in the commit message and the pull request title,
where it is known. A name that already exists **stops the run**: do not suffix it, because an existing
release branch is either one in progress or one somebody abandoned, and both want a person.

## 1. Refuse, before anything else

Nothing is created and nothing is run until all five pass. They are in this order because the first two
cost nothing and are the common case.

1. **No *Bump* wire in [`context/release.md`](../../../context/release.md)** → nothing in this repository
   is written down as consuming the notes, so there is nothing to run and inventing it would be guessing at
   how somebody releases. Refuse and name `/onboard`. The notes are unharmed; they wait, which is what
   they are for.
2. **That file's *What records a note* answer is *nothing*** → this project records no notes, so there are
   none to consume. Refuse and name `/onboard`.
3. **No notes are pending** → there is nothing to release. A run that moves no version publishes nothing
   and writes a changelog entry describing nothing. Say so and stop; do not reach for whatever the
   mechanism offers to make the run proceed.
4. **No invocation under *Branch and worktree* in
   [`context/executors.md`](../../../context/executors.md)** → the workflow makes no branch, and **that is
   not a licence to improvise one.** Never run a bare `git checkout -b`, `git branch` or `git worktree
   add` because that section is empty. The alternative to a branch here is moving a version on the default
   branch and pushing it, which is asked for by name each time under every
   [`context/git.md`](../../../context/git.md) answer and is not what typing this command asked for.
   Refuse, name `/onboard`, and say the release can still be cut by hand.
5. **HEAD is not the default branch, or the working tree is not clean** → a release is cut from the ref the
   notes accumulated on, and uncommitted work would be swept into the release commit. Say which of the two
   stopped you and stop.

**A feature in flight is not a reason to refuse.** Its notes are not on this ref yet, so this release does
not include it — and that is the property the whole command rests on: **the notes on this ref are exactly
the changes on this ref.** Say which features are in flight and that they are not in this release.

A refusal here is the workflow working, not a problem to route around.

## 2. Gate 1, before anything is consumed

Read [`context/verify.md`](../../../context/verify.md) and run every section above *Not run by Gate 1*, in
order — Lint → Typecheck → Build → Test first, then anything that file adds after them. The gate contract
is in [`context/workflow.md`](../../../context/workflow.md); a missing section is skipped, never faked, and
exit 0 is the verdict regardless of what any summary text claims.

**It runs here, before the branch exists and before the script runs, and that ordering is the whole
reason this section is second.** The script that consumes the notes cannot be run twice. A gate run
afterwards, on a default branch that turns out to be red, leaves a tree whose notes are gone and whose
release cannot be cut again — **the one unrecoverable state in this design.** Finding out first costs one
gate run.

**Gate 1 not clean → stop.** Nothing created, nothing consumed, nothing to undo. Report what failed and
say the notes are untouched.

**There is no Gate 2, and that is deliberate.** Gate 2 reviews code against this project's standards, and
this run writes none — the version move and the changelog are a script's output. The review this change
needs is a **person's, on the pull request**, which is the entire reason the command ends at one. Do not
dispatch a reviewer to read a generated changelog.

## 3. Show what it will consume, and confirm — before anything is created

**This is the last moment anything here is free to change, and it is the only confirmation this command
has.**

List **every pending note.** Not this session's, not the ones you can account for — every one, including
notes other people wrote for work that merged while nobody was releasing. For each, say what it describes
and what level it carries. Then, from [`context/release.md`](../../../context/release.md):

- **what version each package lands on**, per note level;
- **what the merge of this pull request will do to each path**, from that file's *what a release ships*
  answer — published, deployed, or nothing — and **what it leaves behind**. Read it; never infer it from
  the fact that a version exists.

Then confirm, using your runtime's question mechanism if it has one.

**Every level is now final, and say so while asking.** [`context/release.md`](../../../context/release.md)
has the level confirmed where a note is written rather than here, on the reasoning that a note is a tracked
file publishing nothing and a wrong level is cheap to correct right up to the release. **This command is
that release.** A level that looks wrong is corrected by editing the note before the script runs, and after
it there is nothing left to edit — the note is gone and the version has moved.

**Where that file records no answer for a path this release moves**, name the path, say the answer is
missing, and name `/onboard`. Do not guess at what the merge does to it, and do not hold up the release
over a gap in a configuration file.

**Name no release tool.** That file says what records a note here and what consumes them.

## 4. Make the branch, then run the Bump wire — in that order

**The branch exists before the notes are consumed.** A script that eats the notes in a tree with no branch
to carry them has put the only copy of every pending note into whatever was checked out, and guard 5 says
that is the default branch.

1. **Create it with the invocation [`context/executors.md`](../../../context/executors.md) names under
   *Branch and worktree*.** That invocation, or nothing — never the bare git command, which skips whatever
   the recorded one does around it. Say which invocation you ran.

   **A separate working tree is welcome here**, and this is the one place in the workflow where that is
   true. `/orchestrate --pr` refuses one because an ad-hoc change has no feature and a tree of its own was
   not what any answer authorised; a release is not ad-hoc work, and a branch of its own is the point of
   the command rather than a side effect of it. Run whichever the recorded invocation makes, say which, and
   **where it makes a separate tree, run everything below inside it.**

2. **Then run the script the *Bump* wire names, exactly once.** It consumes every note, moves the versions
   and writes the changelogs. [`context/release.md`](../../../context/release.md) says what it is; naming a
   tool here would be wrong in most repositories this command runs in.

3. **If it fails part-way, stop.** Do not re-run it and do not reach for a repair: the notes may already be
   gone, and a second run on a half-consumed set is how a release goes out describing half of itself.
   Report what it printed, what state the tree is in, and that the branch is there to inspect.

## 5. Read the diff

The versions that moved and the changelog text are the whole of it, and **the changelog text is what the
release page will say** — that is what
[`context/release.md`](../../../context/release.md)'s *Release* wire does with it, and it is where a note
finally reaches the audience it was written for. Read it rather than trusting the script's summary, and say:

- **every version that moved, from what to what**, and whether that matches what step 3 confirmed. A
  disagreement is a finding, not a rounding error.
- **every package that moved which no note named.** A major can drag a dependent in with a patch where it
  puts that dependent's range out of range — and **where the dependent is a path that deploys, its version
  moved, so this merge deploys it.** Say so plainly; it is the consequence least likely to be noticed and
  most likely to matter.
- **any changelog entry that reads wrong.** Report it. The text came from a note, the note is gone, and
  rewriting a shipped changelog is the user's call on the pull request rather than something to tidy up
  here.

**Never hand-edit a version.** The Bump wire owns every version it moved, and a hand-typed one is a number
nothing agrees with.

## 6. Commit, push, open the pull request

Read [`context/git.md`](../../../context/git.md). **The typed command is the permission, not a new answer
in that file.** It names two sources and only two — an answer covering this command at this point, *or* the
user asking in this session in plain words — and a typed command is the second. So this command does not
need *Who commits* to say the agent commits, and it does not read *Push and pull request*: both of those
answers are written about a feature, and a release is not one. What it authorises is **this invocation**.
Nothing it does becomes policy for the next one, and **nothing here is written into
[`context/git.md`](../../../context/git.md).**

**One commit**, carrying the version moves and the changelogs and nothing else — guard 5 made sure there
was nothing else. Name the version in its subject.

**Push that branch and open the pull request.** Its title carries the version; its body is:

- every version that moved,
- the changelog entry for each, or a link to it in the file — **never a summary written in its place.**
  That text is the description of this release and it was written by whoever wrote each note;
- what the merge will ship per path, and what it will leave behind, from
  [`context/release.md`](../../../context/release.md);
- which features' notes are in it.

**The push is a plain push of this branch.** If it will not fast-forward, or there is no remote, **stop and
say so** — and say it precisely, because the state is unusual: the branch exists, the notes are consumed,
and the commit is sitting there for the user to push. Force-pushing and pushing to the default branch are
asked for by name each time, under every answer, and this command has not been given either.

### Nothing merges it

Not on green CI, not on an approving review, not after any wait.
[`context/git.md`](../../../context/git.md) reserves it in one line — *review and merge are yours* — and a
release pull request nobody reads is the one thing this command must not produce, since the whole of what
it buys over moving the version on the default branch is that a person looks first. It also does not delete
a branch, enable the forge's own auto-merge, or stay alive watching a check run.

**It removes nothing either.** Where the invocation in step 4 made a separate working tree, that tree is
still there after this command ends, and removing it is the job of whatever
[`context/executors.md`](../../../context/executors.md) names — after the merge, and not this command's at
any point. Say in the report that it is there.

### The note check will go red, and a note is not what fixes it

Where [`context/release.md`](../../../context/release.md)'s *What records a note* answer names a check that
asks *are there pending notes*, it will fail on this pull request, every time: there are none, **because
they became the changelog.** The description exists, more permanently than before.

**Do not write a note to silence it.** These mechanisms offer a placeholder note carrying no change, and it
is the obvious way past a check that has gone red on the one commit that owes nothing — which is exactly
why reaching for it is the signal that **the check is asking the wrong question.** That file says what to
do about it, and the condition that resolves it is the one its ship answer already uses: *this path's
version moved in this merge.*

Report it and leave it. Where the answer records the exemption and the check is red anyway, say that too —
the answer claims something the check does not do, and closing that gap is editing a workflow, which is not
this command's to edit.

## 7. Report

- the branch, and the invocation that made it — and where that made a separate working tree, that it is
  still there and what removes one.
- **every note consumed**, and whose work each described.
- **every version that moved, from what to what**, including any package no note named.
- the pull request, and **that nothing merged it.**
- **what the merge will ship, per path, and what it will leave behind** — read from
  [`context/release.md`](../../../context/release.md), never inferred.
- any path that file has no answer for, named rather than guessed at, with `/onboard`.
- the note check, if it went red, and that no note was written to quiet it.

**Say what this is waiting for.** The merge. **Never report this as released, published, deployed or
live** — a version moved in a branch, and that is all that has happened. For a path that deploys, the merge
is what puts the change in front of users, and saying so is how somebody knows what approving the pull
request does.

## Rules

- **The Bump wire runs exactly once, and never twice.** It consumes the notes as it goes.
- **Never cut a release on the default branch.** Pushing to it is asked for by name each time, under every
  answer, and this command was not given that.
- **Never improvise the branch.** [`context/executors.md`](../../../context/executors.md) names the
  invocation or there is no branch.
- **Never write a release note here.** This command consumes notes; it has no change of its own to
  announce, and a release commit carrying a note is a release describing itself.
- **Never hand-edit a version or a published changelog.**
- **No ledger row is touched, and no roadmap entry is created, activated or retired.** A release is not a
  feature.
- **Nothing merges, nothing waits for CI, and nothing is removed.**
