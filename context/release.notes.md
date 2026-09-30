# Filling in `release.md`

The guidance for filling [`release.md`](release.md), read by `/onboard` Step 9 and by anyone filling the
file by hand. The stub is the answer; this file is never read by a command in the loop. Each heading below
mirrors a section of the stub, in the stub's order.

Every answer in the stub ships as the one that is true of every repository before anyone has looked — and
that is the standard every replacement has to meet. An answer naming a mechanism that is not on disk is a
false answer, and every command would dutifully write into it forever while nothing consumed it.

## What announces a change, and to whom

**Shipped as:** nothing here announces a change. It is the only answer that is true of every repository
before anyone has looked — including one that publishes, where it says the answer has not been set rather
than that there is nothing to announce.

Replace the shipped line with one row per path that announces something. The table is **per path**, not
per repository: a repo can publish one thing, deploy another, and say nothing about a third.

### The table, copy-ready

| Path              | Announces to             | Deserves a note when            | A bump means                       |
|-------------------|--------------------------|---------------------------------|------------------------------------|
| `packages/widgets`| people installing it     | the public surface changes      | semver — major breaks their build  |
| `apps/web`        | people using the app     | behaviour changes in the app    | no contract — it is what the deploy keys on |

Column two governs **how the text is written** — an installer and an end user do not want the same
sentence. Column three governs **whether a file is written at all**, and it is the column that does the
work: it is where "an internal refactor to `apps/web` gets no note" is written down once instead of being
re-argued on every pull request.

Column four is prose for a published package and **a wire for a deployed one**: where the last answer in
the stub says a path deploys on its own version moving, the level chosen for a note is what decides whether
the next release goes to production. Say which it is here, and say the rest there.

A single-package repository gets one row, and that is a real answer rather than a degenerate one.

## What records a note

**Shipped as:** nothing. Keep this until something in the repository actually records notes — an answer
naming a mechanism that is not on disk is a false answer, and every command would dutifully write into it
forever while nothing consumed it.

Replace the shipped line with what this project actually uses. Three common shapes:

**A note file per change.** Each change adds its own file to a notes directory; a release tool collects
them, writes the changelog and moves the versions. Give the directory and the file format.

**A hand-maintained section.** Each change adds a bullet under an `## Unreleased` heading in the changelog,
and cutting a release renames that heading. Give the file and the heading.

**A per-change fragment directory.** Each change adds a fragment named for the issue and the kind of
change, and a builder assembles them. Give the directory and the naming convention.

Whatever it is, write down:

- the exact path a note is written to, and the format of one file — enough that a note can be written by
  hand, because that is what an agent will do;
- the **script name** for any check it offers, never the raw command, so that its flags have one home — the
  same indirection [`verify.md`](verify.md) already uses — **and what exempts the release commit from it.**
  A check of this kind asks *are there pending notes?* as a proxy for *is this change described?*, and
  those two come apart in exactly one place: the commit where the notes were consumed, where every
  description is already in the changelog and nothing is pending. Left unexempted the check is red on the
  one commit that owes nothing, every time, and the condition that tells the two apart is not a new one —
  it is the same *this path's version moved* the last answer in `release.md` already uses to decide what ships.
  Say that the check reads it. A check with a second rule of its own will disagree with the gate
  eventually, and the release is where it does;
- whether **filenames must not collide**. Tools that collect note files use random names on purpose: two
  differently-named files never conflict when two branches merge.

And three settings of the mechanism whose consequences belong to the last answer in the stub. Record what
they are set to in this section; the reason they matter is written down once, under *What a release
ships, and on what event*:

- **Whether private packages get versioned.** Commonly off by default, and a deployed app is usually a
  private package. Left off, it accumulates notes and never bumps — so anything keyed on its version does
  nothing forever.
- **Whether private packages get tagged.** A separate switch from the one above and commonly off by
  default too, so a deployed app can be versioned correctly and still leave no tag. These two are one
  decision rather than two — the reason to version a private package here is that it is deployed, and a
  deploy with no tag leaves no record of what went live — so if they disagree, say which was chosen and
  why.
- **Whether a dependent can be dragged into a release.** Where one package's major puts a sibling's range
  out of range, the sibling is pulled in with a patch, and its version moved too.

## At what granularity

Exactly one of the two answers below is this project's. Keep it, delete the other.

**Shipped as:** once per feature. The note's audience reads releases, not phases, and a feature's phase
sequence is an implementation detail that means nothing to them — so one feature is one entry.

### The two answers, copy-ready

**Once per feature.** The note is written by `/feature-close`, before the commit that retires the feature,
so it rides whatever that command hands over. No phase writes one.

**Per phase.** The note is part of the phase's scope, written by `/feature-implement` alongside the code,
and its path goes on that phase's **Files:** line like anything else it touches. Choose this where a phase
is what goes out on its own — a repository that cuts a release about as often as it merges, so one phase is
one entry somebody reads. Note that it is a claim about the *entries*, not about reaching users: under the
last answer in the stub a landed phase has shipped nothing either.

The paragraphs that follow the answer in the stub — one answer for the project, `/orchestrate` treating
the change as the unit, the bump level confirmed where the note leaves the machine — are live prose and
stay under either answer.

## What a release ships, and on what event

**Shipped as:** nothing here ships on a merge. Like the first answer in the stub it is true of every
repository before anyone has looked — including one that deploys, where it records that the event has not
been written down rather than that nothing reaches users.

Replace the shipped paragraph once something does. There is **one event, not one per artifact kind**: the
merge of the release pull request — the one where the script that consumes the notes was run, so the notes
are gone, the versions have moved and the changelogs are written. Publishing a package and deploying an app
are two consequences of that single merge. **A feature's merge ships nothing**; it lands a note and waits
for that one.

### The wires, copy-ready

Write down what the event is wired to, one line each:

- **Bump** — the script that consumes the notes, and who runs it. It cannot be run twice, and where a
  deploy watches versions it is the button that ships.
- **Tag** — what creates the tag, and from what. **Do not assume the publish step owns this.** In the
  common shape one command both publishes and tags, so a repository that publishes gets tags without ever
  deciding to — and a repository that only deploys runs no such command and silently gets none. If nothing
  here publishes, this line is the one most likely to be empty and least likely to be noticed.
- **Release** — what turns a tag into the page someone reads, and where its text comes from. That text is
  the changelog entry the note was written for, so a release is where a note finally reaches its audience;
  without one the notes are consumed into a file nobody opens.
- **Publish** — what pushes the artifact to a registry, and with what credentials.
- **Deploy** — what puts the app in front of users, and what it keys on.

**A wire names something that has run, or says that it has not.** *Written, never run* is a real answer and
belongs in the stub; a job named without that qualifier reads as working, and someone will plan a release
around it. What makes a wire true is that it produced its artifact — not that the file reads correctly,
which is a claim about a mechanism rather than the mechanism. A file can be entirely sensible and still be
inert: where one lives in a workflow, a single unresolvable reference anywhere in that file takes every job
in it down together.

### The per-path table, copy-ready

Then one row per path, saying what that merge does to it and what it leaves behind:

| Path               | On the release merge                     | Leaves behind          |
|--------------------|------------------------------------------|------------------------|
| `packages/widgets` | published to the registry by `<job>`     | tag + release          |
| `apps/web`         | deployed to production by `<job>`        | tag + release          |
| `docs/`            | nothing                                  | nothing                |

**Every path that merge ships leaves a tag and a release behind, whichever of the two it got.** The record
belongs to the event, not to the kind of artifact: the tag says which commit went live and the release is
where the note is read. A deployed app earns both exactly as a published package does — and the column
exists because that is the half a repository which only deploys will otherwise skip, having nothing that
would have produced them by accident.

**The gate is per path, and what it reads is that path's own version.** A release that bumped only the
package must not deploy the app, so the honest condition is *this path's version moved in this merge* —
never *a release happened*. Four things to write down while you are here:

- **A path that deploys has to be versioned.** Note tools commonly leave private packages unversioned by
  default, and a deployed app is usually a private package. One whose version never moves has nothing for a
  deploy to key on: it either never fires, or it gets wired to every merge instead, which is the next
  bullet.
- **A deploy wired to every merge of the base branch is not gated at all.** It ships whatever pending notes
  happen to be in the tree — other people's unreleased work included — and announces itself with a
  changelog that is a release behind. If that is what this repository does today, **write that down**: an
  answer describing the gate someone meant to have is the one kind of answer the stub must never carry.
- **A major bump can drag a sibling into the release.** Where one package's major puts a dependent's range
  out of range, that dependent is pulled in with a patch — and if the dependent is the deployed app, its
  version moved, so the merge deploys production. Say whether that can happen here.
- **A deploy that leaves no tag and no release is the failure that looks like success.** Everything works —
  the notes are consumed, the version moves, the gate fires, production updates — and the repository keeps
  no evidence of it: nothing says which commit is live, and the changelog entry sits in a file with no
  reader. It surfaces the first time someone opens the tags or releases page and finds it empty, long after
  the deploy they wanted to identify. **Where the mechanism has a setting for this, it is usually off by
  default for exactly the paths that deploy** — see the second answer in the stub — so a repository that
  only deploys reaches this state by changing nothing.

If any of these is "nothing yet", say so. A repository that accumulates notes with nothing to consume them
reads as configured and is not — the notes pile up and no version ever moves.

## The rules that hold either way

Nothing to fill in. Live prose in the stub, and it holds under every answer above.
