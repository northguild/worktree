# The planning workflow

Three tiers. Every boundary between them is crossed by an **explicit command, never as a side-effect** of
running something else.

```
/roadmap "idea"  ──▶  pending                    Tier 1 — the backlog
                        │                        context/roadmap.md, with notes in context/drafts/
                  /feature-plan [--activate]     writes context/plans/<NAME>-PLAN.md, then STOPS
                        ▼
                  a plan exists                  Tier 2 — one plan, with a phase status ledger
                        │
                  /feature-implement [--all]     activates, then runs phases: plan → code → verify → review
                        ▼
                  /feature-close                 ──▶ context/archive/ + a context/history.md row
```

| Transition | Command |
|---|---|
| Tier 1 → a plan | `/feature-plan` |
| a plan → being worked, then phase by phase | `/feature-implement`, or `/feature-implement --all` |
| Tier 2 → retired | `/feature-close` |
| no tier crossed | `/orchestrate [--pr]` — one ad-hoc gated change; `/release` — cut the accumulated notes into a release pull request; `/feature-status` — read-only; `/prototype` — a throwaway mockup |

**Every command finds its own starting point.** Nothing has to be looked up first, and `/feature-status` is
never a prerequisite for anything.

This file holds the rules. Why each rule is what it is, and what was tried instead, is in
[`workflow.notes.md`](workflow.notes.md). Nothing in the loop reads that file.

## The commands

| Command | Owns | Writes |
|---|---|---|
| `/roadmap` | Tier 1 contents | `roadmap.md`, and `drafts/` when material is supplied |
| `/feature-plan` | Tier 1 → a plan document | `plans/<NAME>-PLAN.md`; the `active` marker only with `--activate` |
| `/feature-implement` | activation, and the phases within a plan | the plan's ledger, the code, and a release note where [`release.md`](release.md) says *per phase* |
| `/feature-status` | nothing — read-only | — |
| `/feature-close` | Tier 2 → retired | `history.md`, `archive/`, the reference sweep, an end for every open question that still needs a person, a release note where [`release.md`](release.md) says *once per feature*, and the push and pull request where [`git.md`](git.md) says so |
| `/orchestrate` | one ad-hoc gated change | the code, a release note where [`release.md`](release.md) says one is owed, and under `--pr` the branch it pushes and the pull request it opens |
| `/release` | the one act that consumes notes | nothing of its own — it runs what [`release.md`](release.md)'s *Bump* wire names, on a branch [`executors.md`](executors.md) made, and ends at a pull request |
| `/prototype` | one throwaway HTML/CSS mockup — no gates, no application code | `prototypes/<NAME>/`, and nothing else |
| `/onboard` | the project-owned stubs | `verify.md`, `executors.md`, `git.md`, `tracking.md`, `release.md`, `stack.md`, and the pruning of what they replace |
| `/tracking-migrate` | moving existing state onto the substrate `tracking.md` names | issues, and the tree files they replace — never `history.md` or `archive/` |

## One source of truth per fact

| To know | Read |
|---|---|
| whether a feature is being worked | the `pending` / `active` marker in its `roadmap.md` heading |
| whether a feature has a plan | whether its **Doc** field points into `plans/` |
| where a phase stands | that plan's own status ledger |
| what a retired feature's outcome was | its `history.md` row |
| whether a change owes a release note | [`release.md`](release.md) — that path's row, and the granularity answer |
| what a merge publishes or deploys | [`release.md`](release.md) — its *what a release ships* answer, per path |

**"Planned" is not a status.** It is the observation that a document exists in `plans/`. The marker answers
*is it being worked*; the **Doc** path answers *does it have a plan*. The two are orthogonal, so neither can
go stale against the other.

| Marker | **Doc** points at | Means |
|---|---|---|
| `pending` | nothing, or `drafts/` | an idea |
| `pending` | `plans/` | planned, not being worked |
| `active` | `plans/` | being worked |

**The two status vocabularies stay distinct.** The word alone tells you which tier you are looking at:

| Tier | Lives in | Values |
|---|---|---|
| Feature | `roadmap.md`, in the entry heading | `pending`, `active` |
| Phase | the plan's ledger, Status column | `not started`, `in progress`, `blocked`, `done` |

They are not synonyms. Spell them exactly as written — `not started` is two words, never `not-started`.

## The standing rules

Every command below cites these rather than restating them. Two independently-worded copies of one rule is
the drift this design exists to prevent.

### One active feature

> **At most one roadmap entry is `active` in a working tree. Any command that sets the marker checks this
> first.**

`/feature-plan --activate` and `/feature-implement` both check it. Planning is *not* activation — several
features may hold plans at once, and that is what makes planning ahead possible.

Under [`git.md`](git.md)'s worktree answer each feature sets the marker in its own tree, and the marker
never reaches the default branch — `/feature-close` removes the entry before the branch merges. What is in
flight is answered by `git worktree list` and by nothing else: **"in flight" is not a status; it is the
observation that a worktree exists.**

### Feature or task?

> **If you would want a `history.md` row for it, it is a feature — use the roadmap flow.
> If you would not, it is a task — use `/orchestrate`.**

`/orchestrate` is the ad-hoc escape hatch, not the way to skip planning. It refuses anything larger than a
commit-sized unit and anything an existing roadmap entry already covers.

### Nothing stages, commits, branches or pushes on your own initiative

> **Read [`git.md`](git.md) before any `git` or `gh` command that changes something — staging included.
> If it does not exist, or does not say the agent commits, the work is left *unstaged* in the working tree
> and the user commits it.**

[`git.md`](git.md) answers three more, each independent and each shipping as the most conservative option:
**where work lands**, **whether the agent pushes and opens a pull request**, and at what **granularity** it
commits. Under those answers a push happens once per feature, at `/feature-close` — never at the end of a
phase — and the only pushes outside them are the two asked for by name: `/orchestrate --pr`, and
`/release`. **Nothing merges a pull request, deletes a branch, or removes a worktree under any answer, any
flag or any command.** The one exception is not a worktree in that sense: `/feature-implement` makes a
**detached, branchless checkout in `.phase-trees/`** for a phase it runs beside another, and removes it
when its row reads `done`. Not by the recorded invocation, and no other command makes or removes one.

**Those answers authorise the commands in this workflow, at the point each one names, and nothing else.**
*The agent commits* is permission for `/feature-implement` to close a phase it just ran, not standing leave
to commit whatever is in the tree; *a worktree per feature* is permission for a **planned feature's** first
phase to make one, not for an ad-hoc request to be moved into a tree of its own. Outside those points, an
operation needs the user to ask for it in this session. **A typed flag or a typed command is that ask** —
`/orchestrate --pr` and `/release` are the two the workflow ships, and each authorises that invocation's
commit, push and pull request without changing a single answer in [`git.md`](git.md) for the next one.

**Permission is not inferred.** Choosing between approaches does not authorise any of this, even where the
option text mentions it — and *especially* where you wrote that option text yourself. Neither does "ship
it", nor an approved plan, nor a production incident. Wanting the work finished is not the same as wanting
it in someone's history.

**Some operations are never standing policy**, whatever `git.md` says: force-pushing, pushing to the
default branch, and rewriting published history. Each has to be asked for by name, each time.

**A worktree is created only by what [`executors.md`](executors.md) names.** If that file names no
invocation, there is no fallback — a bare `git worktree add` is the failure this rule exists to stop, not
the default. The same goes for removing one. **`/release` is the one command that may make one for
something that is not a feature**, because a branch of its own is what that command is for rather than a
side effect of it — and it still makes it only with the recorded invocation, and still removes nothing.

### Where this state lives is an answer, not an assumption

> **Read [`tracking.md`](tracking.md) before reading or writing any workflow state. If it does not exist,
> or does not say otherwise, the backlog is `roadmap.md`, a plan is a document under `plans/`, and a
> retired feature is a `history.md` row.**

Everything in this file describes the working-tree answer, which is the default. **The tier model is
identical under both answers.** What changes is where a fact is read, and only [`tracking.md`](tracking.md)
says how — no skill names a tracker.

**Changing the answer is not moving the work.** `/onboard` sets which substrate this project uses;
`/tracking-migrate` carries what already exists onto it. A repository whose answer says *tracker* while its
entries sit in `roadmap.md` reads as an empty backlog to every command — which is why `/onboard` refuses to
write that state and names the migration instead.

### Documentation is part of the change

> **Find where this project documents itself before planning — the Documentation index in
> [`stack.md`](stack.md), and the repository itself when that index is missing or empty. Whatever a change
> makes untrue there is fixed by the phase that makes it untrue, not by a follow-up.**

`/feature-plan` writes the affected surfaces into the plan's §7, each assigned to a phase, and that phase's
**Files:** line carries the path like anything else it touches. *"Nothing here describes this feature"* is
a legitimate answer, and it names the surfaces that were checked. Saying nothing is not that answer.

### The standards table is keyed on a question nothing asks

> **Before loading standards, ask what surfaces this change has: something a person operates
> (accessibility), a hot path or a payload that grows (performance), a trust boundary — input,
> authentication, a secret, a public endpoint, a URL the server will fetch (security).
> Write the answer down. *None of these* is an answer; saying nothing is not.**

**A surface reaches the work the way a documentation row does.** The standards rows it loads become the
review expectations on the phase that carries it, and whatever proves it goes in that plan's §8
Verification — for something a person operates, an **end-to-end pass in a real browser**. Which browser
driver is [`verify.md`](verify.md)'s answer like every other command, and nothing here names one.

### An expected value has a source, and it is never the code under test

> **Where a change has behaviour you can observe at a seam, work test-first in thin slices: decide what
> each expected value should be — from the requirement, the specification, or a source independent of the
> implementation — before the code that produces it runs, and write down what decided it. Never read an
> expectation back out of the code under test. Documentation, configuration and wiring that only passes a
> value through have no such seam; say which it is rather than leaving the question unasked.**

**A green suite proves that the tests and the implementation agree with each other.** It says nothing about
whether either agrees with the requirement, so an assertion copied from what the code returned passes both
gates forever and pins nothing: Gate 1 runs the suite, and Gate 2 walks a checklist that was never asked
where the number came from. The plan is where the sources are written — a value this feature computes gets
a row in its §8 Verification naming what decides it, and a value whose source nobody could find is a §9
open question rather than a number for the implementation to supply.

**Two findings follow, and Gate 2 raises them whatever the suite says:** an expected value with no
traceable source, and a rule the code implements that no test asserts. Neither is visible to Gate 1 — the
first passes, and the second is behaviour nothing would fail if it stopped.

Testing behaviour at a seam rather than internals is the standards tree's rule and not this one's; the
phase's `Standards:` line names the file that carries it.

### What a change announces is an answer, not an assumption

> **Read [`release.md`](release.md) before closing out any command that lands code. If it does not exist, or
> does not say otherwise, nothing here announces a change and no note is owed.**

**Landing a change is not shipping it, and that holds for a deployed app as much as a published package.**
Both are consequences of **one event** — the merge of the pull request where the notes were consumed and the
versions moved — and a feature's own merge lands a note and ships nothing. So a command that finishes work
reports what the change is waiting for; it never reports it as released, deployed or live because the work
landed. Which paths that merge publishes or deploys is [`release.md`](release.md)'s answer, per path —
never inferred from the fact that a version exists.

**The answer is per path, and the granularity is per project.** *Does this change deserve a note* is asked
of each path it touched; *when is one written* — once per feature, or per phase — is asked once.
`/orchestrate` has neither an entry nor a ledger, so for that command the change is the unit. **A path that
file does not cover is reported, never guessed at** — name the path and name `/onboard`.

### Writing a note is the workflow's half; consuming notes is not

> **Never run what bumps, tags, publishes or deploys — not as a step, not to tidy up, and not to check
> that it works. Only when the user asks for it in that turn.**

A skill may **name** it, report that it is pending, and stop — the same way it names `/onboard` for a gap it
will not fill itself. Asked for directly, in that turn, it is the user's call and theirs to give.

**A command or a flag typed in the turn it takes effect is what that asking looks like, and those are the
only two shapes of it this workflow ships.** Both list every pending note they are about to consume —
other people's included — before running anything, and **neither is inferred from prose: a sentence is not
a command.**

| Shape | The release is | Cut from |
|---|---|---|
| `/release` | its own pull request, and the merge of that is the ship event | the default branch, where notes accumulate as features land |
| `/feature-close --release` | fused into the feature's own merge | that feature's branch — for a repository that releases about as often as it merges |

**The gap between writing a note and consuming it is where a wrong bump level is still free**, so whichever
of the two closes that gap says so while it asks.

### Never transcribe a credential

> **A DSN, token or key is described and pointed at the secret store, never copied into a tracked file.**

Write `$SENTRY_DSN`-style placeholders and name where the real value lives. The sharp cases are `/roadmap`
capturing supplied material, `/feature-plan` carrying a draft's specifics forward, and `/onboard`, which
collects shell commands.

### The ledger is read fresh, every time

Nothing is cached, parsed by a script, or generated. Hand-editing a ledger row changes the answer
immediately, with no regeneration step. `check` validates shape and answers no workflow question — delete
it and every answer here is unchanged.

### Commands live in one file

`verify.md` is the only file in this project that names a verification command — not a skill, not an agent
prompt, not a role file. A hardcoded stack rots the moment the project changes shape, and a second copy
rots faster.

## Phase status

Inside a plan, phase status lives in that document's status ledger **and nowhere else**. Not in a separate
file, not in a TODO list, not in a commit message.

To pick the next phase: take the **lowest-numbered phase that is not `done` and whose `Depends on` entries
are all `done`.** State which one you picked before starting. If it is already `in progress`, read its Note
and resume — do not restart it.

**One run is one round**, and a round is one phase or the independent phases `/feature-implement` runs side
by side under the cap in [`executors.md`](executors.md). **`--all` repeats the pick above**, and stops
exactly where a single run would: a phase that ended `blocked` or part-landed, a gate at its loopback cap,
a ledger that disagrees with the repo. When the last phase goes `done` it stops there and names
`/feature-close` — **that boundary is still crossed by an explicit command.**

**A phase's row is written twice.** It opens to `in progress` when the work starts, before any code, and
closes to `done`, `in progress` or `blocked` when the phase ends. The opening write is what makes an
interruption survivable.

`done` means the phase's scope landed and both gates passed — **a verdict about the gates, not about git.**
Whoever finishes a phase updates its row **as part of the same change as the work**: one commit where the
agent commits, one working tree handed over where the user does. A closing row updated separately is a row
that disagrees with the repository in between. The opening write is not a change of its own — it is left in
the tree and lands with the work it describes.

If the ledger's claim disagrees with the repo — a phase marked `done` whose files do not exist, or the
reverse — **stop and say so.** Never silently re-do or skip a phase on a stale ledger. A `done` row whose
change is still uncommitted is not that: under the default policy in [`git.md`](git.md) it is the normal
end state.

## The gates

Any command that lands code runs two gates, in order.

**Gate 1 — verification.** Read [`verify.md`](verify.md) and run **every section above *Not run by Gate
1*, in order** — Lint → Typecheck → Build → Test first, then anything that file adds after them. Those four
are the headings every project has, not the whole of what one checks: an end-to-end run, an accessibility
suite or a size budget that is cheap enough to run on every phase is a section like any other, and a
project that has one with nowhere to write it down is a project where this gate reports green for a change
that broke it. Never carry a copy of those commands and never invent one. A missing section is skipped, never
faked. Exit 0 is the verdict regardless of what any summary text claims. If `verify.md` does not exist, stop
and say so.

**Gate 2 — review.** Dispatch per [`executors.md`](executors.md). Every verdict needs concrete evidence —
file paths, command output — and every item in it is **blocking or it is not.** A `FAIL` is looped back on.
Cap: two loops, then the phase goes `blocked` and the run escalates. **Escalating is not a substitute for
recording** — the conversation ends, the ledger does not, so the row is written before the hand-back.

## What happens to a defect the gate found

A review produces two kinds of thing, and the difference is the only one that matters: **does it block this
phase, or not.** There is no severity scale and no second status vocabulary — a phase has four states, they
are the four in the ledger, and **nothing below adds to them**: the file this section ends up describing
holds no status, gates nothing, and is read by no command.

**A blocking item has three ends, and the run that found it picks one before it reports:**

| End | When | Where the record lives |
|---|---|---|
| **fixed** | the loopback fixes it and the gate re-passes | nowhere — there is nothing left to record |
| **`blocked`** | the gate hit its cap, or it cannot be fixed in this phase | the phase's own ledger row: status `blocked`, the reason in its Note |
| **filed** | it is real work that outlives this phase | a bug, or a backlog entry — see *A bug is not a backlog entry* |

**A non-blocking observation has two ends, and kind decides which** — not size, and not how interesting it
was to find:

| End | When | Where the record lives |
|---|---|---|
| **a bug** | it is a real defect, and it is user-visible or a regression would land green — the gates pass and the defect ships anyway | wherever this project already files bugs |
| **a backlog entry** | it is not a defect, and it is work you would want a `history.md` row for | the backlog, added by `/roadmap` |
| **a note** | anything else | `notes.md` in this branch's working tree, until the branch ends |

### A bug is not a backlog entry

**The backlog is a list of features** — work you would want a `history.md` row for. A defect is not one,
however real it is.

**A bug goes wherever this project already files bugs**, carrying this project's own labels. The workflow
does not read it, rank it or carry it: [`tracking.md`](tracking.md) adds one bit to an issue and reads
nothing else, and a bug is outside that bit. **Do not apply the backlog label to it.**

> **A gate never applies the backlog label.** That label is what `/roadmap` writes, and that command
> applies the worth-adopting test first — *would you want a history row for it* — then writes what an entry
> needs to be ranked. A gate that labels an issue itself has appended to the backlog while skipping the one
> test that decides whether it belongs there, and produced an entry missing what the ranking reads. Where a
> finding really is a feature, **name `/roadmap` and let it decide.**

**Nothing enters the backlog except through `/roadmap`.** `/tracking-migrate` and `/feature-plan` also
write the label, and both only move or divide what `/roadmap` has already admitted.

**This is the third category the loop had no word for.** A feature is planned and gets a history row; a
task is `/orchestrate`'s and is not written down at all; a bug is recorded and is neither.

### `notes.md`

**`notes.md` is branch-local, advisory and disposable.** The first note that needs it creates it; it is
never installed and there is no stub. **Nothing reads it** — no gate consults it, no command parses it, no
refusal turns on it, and `check` has no rule about it. It carries no severities, no ids and no statuses,
because nothing tracks the state of something nothing acts on.

> **`/feature-close` deletes it whole** — no triage, no dispositions, no sweep. Anything that should
> outlive the branch was promoted to an issue while the branch was alive. **This is the entire bound:** the
> file cannot accumulate across features because it does not survive one, which is a property of the
> lifecycle rather than a rule somebody has to keep.

**The ledger is the record, because it is already the record.** A row opens to `in progress` before any
code and closes to `done`, `in progress` or `blocked` when the phase ends, so a session that dies mid-gate
has already written where the phase stands.

> **A defect found against a phase that is already `done` sets that phase back to `blocked`**, with the
> reason in its Note. Do not record it elsewhere and leave the row claiming `done`. If it is larger than
> the feature, it is an issue instead, and the row stays as it is.

**Nothing accumulates across features.** A `blocked` row is archived with its plan at `/feature-close`,
`notes.md` is deleted there, and an issue was never this feature's to carry.

**`/orchestrate` has no ledger**, so a capped gate there hands the work back: it stays in the working tree,
the report says what failed, and anything still worth doing becomes an issue. **It writes no `notes.md`** —
it has no close, so nothing would ever delete one.

## What happens to a question the plan could not settle

A plan's §9 Open questions has two readers after the planner: `/feature-implement` surfaces it at
activation, and `/feature-close` goes through it at the retirement. **In between it is the phases' to
answer** — whatever a phase settles is written into the item it settles, by that phase, the same way
whatever it makes untrue in the documentation is fixed by it.

**What is still open at the retirement is an owner check** — an item no gate can close, because it needs a
person. **It is not a defect**, and it is not a backlog entry: nothing is known to be wrong, and nobody who
could say has looked.

> **Every one of them gets an end before `/feature-close` writes anything** — answered, filed or waived,
> picked by the user item by item. A feature never retires with its open questions archived into a document
> no command opens again.

**The ends, what each one writes, and where a filed check goes are `/feature-close`'s**, which is the only
command that reads §9 after activation. The destination for a filed one is the shelf *A bug is not a
backlog entry* already names, and the kind is not a bug.
