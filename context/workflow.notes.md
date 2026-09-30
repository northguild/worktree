# Why the workflow's rules are what they are

[`workflow.md`](workflow.md) holds the rules and this file holds the reasoning behind them — what each rule
is protecting against, what was tried first, and why the alternative was refused. It is organised under the
same headings so the reason for any rule can be found by name. **No command cites this file and nothing in
the loop reads it.** It is tool-owned like its sibling, replaced on `update`, and written for a person who
wants to reopen a decision rather than apply one.

## One source of truth per fact

A header that claims a status is a copy nobody remembers to update. *Is it being worked* and *does it have a
plan* are two facts, so they live in two places — the marker and the **Doc** path — and neither can go stale
against the other. The two status vocabularies are kept apart for the same reason: the word alone says which
tier is being read, so a `blocked` can never be mistaken for a feature that is on hold.

## The standing rules

Every command cites these rather than restating them because two independently-worded copies of one rule
drift, and the drift is invisible until the two disagree in a session.

### One active feature

Planning is separated from activation so that several plans can exist while one is being worked. The
worktree reading — "in flight" is the observation that a worktree exists — mirrors "planned" being the
observation that a document exists in `plans/`: a file recording what is in flight would be a cache of
something git already knows, and it would be wrong in the one case anyone reached for it, a crashed run or a
tree removed by hand. Everywhere else there is one tree, and the rule reads as it always did.

### Feature or task?

The test is a `history.md` row because that is the only durable trace a feature leaves. Anything that would
not earn one is small enough to go through the gates without a plan, and `/orchestrate` exists so that the
small change still gets the gates rather than being cowboyed past them.

### Nothing stages, commits, branches or pushes on your own initiative

This workflow has always described phases as commit-sized and `done` as landed — which an agent, given no
policy, resolves by committing on its own every phase. That is a call about someone else's repository, so it
is a written answer rather than an inference, and the answer ships as the most conservative option because a
tool installed into a repository it knows nothing about does not get to write that repository's history
unasked.

The scope clause — *those answers authorise the commands in this workflow, at the point each one names, and
nothing else* — came from a field report. Repositories that had answered *the agent commits* and *a worktree
per feature* saw worktrees and branches created for ad-hoc requests, and commits made while doing anything at
all. The answers had been read as standing leave. Staging had also been absent from every list for four
versions, so *leave it in the working tree* was satisfiable by an agent that ran `git add -A` first, which
edits what the user's own commit captures.

The option-text case is named because it is the sharpest self-granted failure: the agent writes an option
whose text mentions committing, the user picks that option for its other merits, and the agent reads its
own words back as consent.

The worktree command lives in `executors.md` because a worktree CLI copies the gitignored env files,
enforces the naming, puts the directory somewhere predictable and hands the tree to an editor; a bare
`git worktree add` does none of it, and a tree made that way is missing the half that made the answer worth
choosing. An empty section therefore means *no worktree*, not *improvise one*.

### Where this state lives is an answer, not an assumption

The second answer puts the same tiers in an issue tracker — a feature is an issue, a plan is that issue's
body with the phase ledger as a table inside it, a closed issue is the archive — because **a file cannot be
the shared home for several agents at once.** A worktree carries only what its ref holds, so a plan on one
branch is invisible to every other tree; a tracker sits outside all of them. Keeping the tier model
identical under both, with only `tracking.md` saying where a fact is read, is what makes a different tracker
a rewrite of one file rather than of every command.

Setting the answer and moving the work are two commands because the second is a data migration with remote
writes that can fail partway, and running one off the back of the other is the side-effect this tier model
refuses everywhere else. The first install that switched answers with entries still in `roadmap.md` did not
lose anything — every command simply read the tracker, found nothing, and reported an empty backlog, which
is worse than losing the entries because it looks like a clean install.

### Documentation is part of the change

Documentation is an output with no gate behind it. Nothing fails when a README goes on describing a flag
that was renamed, so the drift is invisible until someone follows the old instructions, and it is not
invisible to them. Putting the surfaces in the plan's §7 and the paths on a phase's **Files:** line is what
turns "update the docs" from a follow-up nobody does into part of the change the gates already check for.

### The standards table is keyed on a question nothing asks

`standards/README.md` loads conditionally, on *if the task involves…*. Most of its rows answer themselves —
a file is TypeScript or it is not, there is a form or there is not — and three do not. Accessibility,
performance and security are properties of the change that the reader has to have thought of already, so
the row saying *accessibility is part of the definition of done* is reached only by somebody who had agreed
before they opened the table.

The kinship is with the documentation rule, and so is the reason: **no gate fails** when a control cannot be
reached by keyboard, any more than one fails when a README describes a flag that no longer exists. A linter
catches a fraction of the first and none of the rest. Neither gap was a missing standard — the vendored tree
already said accessibility was part of done — so the fix is a question asked out loud, with *none of these*
a legitimate answer and silence not one.

### What a change announces is an answer, not an assumption

*Documentation is part of the change* covers a README that a rename made wrong. It does not cover the
release note that was never written — a different surface, a different audience, and one that is not in the
repository to go stale. `release.md` is where that answer lives, and it is the one stub whose answer can be
**false**: *no lint step* is accurate in a project with no linter, but *a change is announced by writing a
note* is a lie in a repository where nothing records one, the same defect as a `done` row whose files do not
exist. That is why `/onboard` writes the true answer or the true answer plus a named gap, and never a
mechanism that is not on disk.

The answer is per path because a repository can publish one artifact, deploy another and say nothing about a
third; a repo-wide yes or no cannot express that. Granularity is per project because it is a fact about what
leaves the repository as a unit, not about which path a change happened to touch. A path the file does not
cover is reported rather than guessed at for the same reason `verify.md` skips an empty section: writing a
note into a path whose owner never answered for it invents policy mid-change, and refusing the work blocks
it over a gap in a configuration file.

*Landing a change is not shipping it* was added after agents reported phases and closed features as live.
`done` plus a closed feature reads as shipped, and nothing had said that a merge and a deploy are different
events. Both are consequences of one event — the merge where the notes were consumed and the versions moved
— which is also why the condition for a deploy is *this path's own version moved*, never *a release
happened*: a release that bumped only the package must not deploy the app.

### Writing a note is the workflow's half; consuming notes is not

Writing a note is cheap and reversible: it is a tracked file that publishes nothing until a version moves.
Consuming them is neither. Whatever a project uses to turn notes into versions takes *every* pending note,
not this change's — including ones other people wrote and have not shipped yet — rewrites the changelogs,
deletes the notes it used, and where a deploy watches versions it is the button that ships. A command that
runs it has released a version of somebody else's work on their behalf. So it is a person's deliberate act,
and `/feature-close --release` is the only shape the ask takes because a flag typed in the turn it acts
cannot be inferred from "and ship it" three messages back, from a plan that ends in a release, or from the
notes looking ready.

The same applies to any script that writes rather than reports. A candidate for `verify.md` is something
Gate 1 can run on every phase; a release command is not, and `/onboard` refuses one there — a wrong
candidate in that sweep bumps versions or publishes rather than failing politely.

### Never transcribe a credential

The rule is stated once because the three places it bites are far apart: `/roadmap` capturing material a
user pasted, `/feature-plan` carrying a draft's specifics forward, and `/onboard` collecting shell commands,
which is the likeliest place a token appears inline. An issue body is a tracked file for this purpose too,
and probably a more public one.

### The ledger is read fresh, every time

There is no build step in the planning loop and no generated "current state" file because a generated file
is one more thing that can disagree with its source. `check` is the one program that touches these files,
and it validates shape only — delete it and every workflow answer is unchanged, which is the property that
keeps it from becoming a second reader whose opinion matters.

### Commands live in one file

The reference this tool was built from carried its verification commands in four places, three of which
named a tool the project no longer had. Fixing one copy left the others wrong for months. One file that
names a command, and a test that no other template may, is the whole of the fix.

## Phase status

**Why the row is written twice.** `in progress` was a legal status that nothing ever wrote — every mention
was a read ("if it is already `in progress`, resume") or a retain ("stays `in progress`"). A phase went
`not started` → `done` in one step, and a run interrupted mid-phase left a tree with half a phase in it under
a row claiming nothing had started, sending the next run into a disagreement stop or into redoing work that
was already there. The opening write is what makes the interruption survivable, and it is left in the tree
rather than committed on its own so that the row and the code it describes still land together.

**Why `--all` stops where a single run stops.** Phase to phase is not a tier boundary — the command already
owns the phases within a plan — so the flag crosses nothing. What it removes is the pause where a user reads
a phase's report before the next one builds on it, so that pause is replaced by a written stop list and two
answers said out loud before the first phase: which reviewer runs, and who commits. Under *the user
commits* the flag runs one phase and declines the continuation, because a tree carrying four phases at once
cannot be cut back into the four commits that answer describes.

**Why `done` is a verdict about the gates and not about git.** Where the user commits, a `done` row whose
change is still in the working tree is the normal end state of every phase. Treating it as a discrepancy
would stop every run in every repository on the default answer.

## The gates

The gate contract is stated in `workflow.md` and restated nowhere because the reference restated it in four
places and they drifted. Gate 1 runs *every section above Not run by Gate 1* rather than four named
headings because the four read as a schema and were never anything but prose — no code has ever parsed
`verify.md`. A project with an end-to-end suite, an accessibility pass or a size budget could stretch one
into a heading it did not belong in or exile it to *Not run by Gate 1*, and both ended with the gate green
for a change that broke a check the project owns.

Gate 2's cap of two loops is what makes the loop converge instead of spin, and the row is written before the
escalation because the conversation ends and the ledger does not — a run that escalates without writing the
row leaves the next session nothing to read.

## What happens to a defect the gate found

**Why there is no severity scale.** Earlier versions kept a findings file under `context/` with four
severity grades — a second status vocabulary laid across the ledger's four, kept in sync by discipline. One
repository reached 1097 lines of defects nothing could close, because their gates belonged to phases that
no longer existed, and the file grew past what a tool reads in one go: the gate that asked *is anything
blocking this phase* was answering from a file that came back truncated. The scale's only real question had
always been *does this block the phase*, which is one bit. Four values invited the lowest grade — *a note
worth not losing* — to be filed and kept, and that was the category that grew without bound.

**Kind is the test because severity was tried and failed.** A grade assigned to answer *does this stop the
phase* tells you nothing about *is this worth keeping*, and having one on hand invited the second question
to be answered with the first question's answer. The first repair widened `/feature-close` to dispose of
everything tied to the feature, with three dispositions and a `check` rule for orphans. It worked and it was
the wrong fix: it bounded the tail and left the accumulation, since an eight-phase feature could still carry
thirty notes through its whole life, read by every phase, going stale as the code moved. The question that
settled it was *what does this file do that something else does not already do*, and the answer was nothing
that matters — a file whose invariant is maintained by discipline has no invariant.

### A bug is not a backlog entry

With nowhere of its own, a defect went into the backlog, because that was the only *record* the workflow
knew about — which is how a list of features fills up with defects. One repository reached fourteen of them
ranking against its actual roadmap. Filing a defect there makes it compete for the next plan against work of
a different kind and a different size, and a gate that labels an issue itself has appended to the backlog
while skipping the one test that decides whether it belongs there, producing an entry missing the `Size:`
and `Priority:` the ranking reads.

`/tracking-migrate` and `/feature-plan` also write the backlog label, and neither is an exception to
*nothing enters except through `/roadmap`*: the first carries an existing backlog out of the working tree
onto the tracker, and the second splits one entry already in it into several. Both move or divide what
`/roadmap` has already admitted, which keeps the worth-adopting test applied exactly once per entry, at the
only moment anyone is deciding whether to have it at all.

### `notes.md`

**Why a file rather than an issue, when an issue is also somewhere to put it.** A note in the backlog is an
object with a number, a title and a rank, competing with real features for the next plan — and the backlog
is a list of features, which a note about internals is not. A line in a branch-local file costs nothing to
write, nothing to ignore and nothing to delete. Keeping the cheap disposition cheap is what stops the
expensive one from being used for everything: the rule that sent every observation "needing code changes"
to the backlog ran to twenty finding-issues in one repository against none in another on the same install.

**Why nothing reads it.** The 76 KB file's real failure was never clutter: it came back truncated to the
very gate that read it, so the check was answering from a file it had not seen. A file nothing reads cannot
fail so quietly, and a `check` rule about it would be exactly that reader. It carries no severities, ids or
statuses because nothing tracks the state of something nothing acts on.

**Why the delete is unconditional.** The scheduled sweep had been built — three dispositions, a `check`
rule, every acceptance test passing — and it still bounded the tail while leaving the accumulation. The
whole bound on the file is that it does not survive the branch, which is a property of the lifecycle rather
than a rule somebody has to keep; a retirement that spends ten minutes disposing of notes has bought back
the cost the arrangement exists to avoid. Anything that should outlive the branch was promoted to an issue
while the branch was alive, the only moment that call can be made against code that still exists.

**Why the ledger is the record.** A row opens to `in progress` before any code and closes when the phase
ends, so a session that dies mid-gate has already written where the phase stands. A separate file saying
*this phase is done and also broken* would be a second answer to a question the Status column already
answers — which is why a defect found against a `done` phase sets that phase back to `blocked` rather than
being recorded elsewhere.

**Why `/orchestrate` writes no `notes.md`.** The file's bound is `/feature-close` deleting it, and an ad-hoc
change has no close — so a note written there is the one that would outlive every branch. A commit-sized
change that cannot pass its gates is not a thing to file away; it is a thing to hand back, because nothing
about it is half-finished in a way the next session could resume. The tree either carries the change or it
does not.
