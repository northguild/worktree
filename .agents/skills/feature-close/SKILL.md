---
name: feature-close
description: "Retire a finished or abandoned feature — write its context/history.md row and git mv its document to context/archive/, or close its issue with the matching reason where context/tracking.md says so. Explicit invocation only — run this when the user types /feature-close. Do NOT match on 'we're done with X', 'close this out', or general wrap-up requests."
---

# /feature-close

Owns the **Tier 2 → retired** transition. Nothing else in this workflow archives a plan —
`/feature-implement` detects that a feature is finished and *names* this command; it never does the work.

Read [`context/workflow.md`](../../../context/workflow.md) for the tier model, and
[`context/tracking.md`](../../../context/tracking.md) for where a retired feature goes. **Everything below
is written for the working-tree answer**; where that file names the tracker, read [`tracker.md`](tracker.md)
beside this file before anything else — it says what changes.

## Usage

```
/feature-close                                # retire the active feature as shipped
/feature-close "<name>"                       # retire a named feature as shipped
/feature-close "<name>" --dropped "<why>"     # retire one that will not be built
/feature-close --release                      # retire it, then cut the release its note goes out in
```

**`--release` is Mode 1 only**, and it is the one flag in this workflow that acts on the world. What it
does and what it refuses are below, under *The release note*.

**Resolving the target:** with no argument, the entry marked `active`. With a name, resolve it against
`context/roadmap.md` — **any entry holding a plan is a valid target**, not just an active one. An abandoned
plan is a droppable state.

## Mode 1 — `shipped`

### Refuse first

Check this before touching anything, and refuse if it fails:

**Every phase in the ledger is `done`.** If not, list the ones that are not, and stop. Do not offer to mark
them. A phase that ended `blocked` is on that list by definition, and its Note says what stopped it.

**One check, not two.** `done` already means the scope landed and both gates passed, so a defect the gates
caught is either fixed, or it is a row that does not read `done`, or it is an issue this feature never
owned. There is nothing left for a second refusal to catch.

A refusal here is the workflow working, not a problem to route around. If the user overrides after being
told, say plainly what is being overridden, then proceed.

### Then, as one reviewed change

1. **Move the entry into history.** Remove it from `context/roadmap.md` entirely, and append one row to
   `context/history.md`: date, name, outcome `shipped`, a one-line why, and a link into `context/archive/`.
   One line. That file **indexes** depth, it does not duplicate it — the reasoning stays in the archived
   plan.
2. **`git mv` the plan** from `context/plans/` to `context/archive/`. Use `git mv`, not `mv` — the file's
   history is the record of how the feature was actually built.
3. **Rewrite the document's header to point at the history row.** In the moved document, replace
   whatever the header claimed before with:

   ```markdown
   Retired — its outcome and date are in [`../history.md`](../history.md).
   ```

   Add a note if its §-references are cited from source comments. **Do not stamp the outcome and date
   into the document.** `history.md` owns them, and a copy in the header is a second place to maintain.
   Replacing the old header is what stops a stale status surviving the move.
4. **Sweep every reference to its old path**, and **show the sweep for review before committing.**

### The sweep

Plan documents get cited by path from root-level entry points, from other `context/` files, from skills,
and from inside `context/standards/`. An unattended `git mv` breaks all of them silently.

```bash
grep -rn "<old-path>\|<OLD-FILENAME>" --include='*.md' . | grep -v node_modules
```

- **Rewrite links, minding depth.** `context/plans/` and `context/archive/` are the same distance from the
  root, so a `../../` link *inside* the moved document still resolves — but a link *to* it from elsewhere
  changes. Verify, don't assume.
- **Leave §-number citations alone.** Source comments cite plan sections without a path
  (`// SMART-CROP-PLAN.md §7.3`). Those survive the move untouched and must not be "helpfully" rewritten
  into paths that will rot.
- **Show the full list of edits before committing.** That review is why this is an explicit command rather
  than a side-effect.

### Delete `context/notes.md`

**If the file is there, delete it — whole, as part of this same change.** Both modes, both tracking
answers.

Do not read it for things to keep, do not assign each line a disposition, and do not fold any of it into
the history row or the closing comment. Anything that should have outlived this feature was promoted to an
issue while the branch was alive, which is the only moment that call can be made against code that still
exists. What is left is what the branch was for.

**Glancing at it on the way past is fine; triaging it is not.** If something jumps out, file that one as an
issue and then delete the file — one judgement, not a ceremony repeated per entry. **The unconditional
delete is the whole bound on that file**, and a retirement that spends ten minutes disposing of notes has
bought back the cost this arrangement exists to avoid.

### The release note — before the commit, under both granularities

Read [`context/release.md`](../../../context/release.md). **This is the last moment before the feature's
notes leave this machine**, which is why the confirmation is here whichever command wrote them.

- **Once per feature** → write the note now, before the commit, so it rides whatever this command hands
  over. One note per path the feature touched whose row says it deserves one, in whatever that file says
  records a note.
- **Per phase** → the phases already wrote them. **Collect them and show them** — do not write another.

**A note is one or two sentences.** It is read by someone deciding whether this affects them — not
reviewing the diff. Say what changed for them and stop: no phase-by-phase account, no list of files, no
rationale that belongs in the plan. If it needs a paragraph, the thing to link is the plan, not to inline
it.

Then, either way: **propose the bump level for each note and confirm it with the user.** That is a
per-change judgment rather than policy, and it is the one thing in this file that is asked rather than
read. Use your runtime's question mechanism if it has one.

- **The user changes a level** → amend the note and say so.
- **The user declines a note entirely** → write none, and **say in the report that the feature retired
  with no note and why.** That is their call about their own release; doing it quietly is not.

**Retiring a feature is not shipping it.** The note rides this hand-over; the change reaches users on
whatever event that file's *what a release ships* answer names, which is somebody's deliberate act and not
this command's. So the report says what the feature is **waiting for** — never that it is released, deployed
or live, and never that a deploy will follow from the merge. Where that answer is not written down, say that
too and name `/onboard`.

**Say which paths you checked and what each one owed**, including when the answer is *none*. **A path
[`context/release.md`](../../../context/release.md) does not cover is named, not guessed at** — write no
note for it and name `/onboard`, and do not hold up the retirement over a gap in a configuration file.
Name no release tool: that file says what records a note here.

**`--dropped` writes no note. See Mode 2.**

Then read [`context/git.md`](../../../context/git.md) before committing anything. `git mv` stages a rename
and writes no history, so it is safe under either answer — but the commit that carries it is the agent's to
make only where that file says so. If it does not exist, the answer is *the user commits*: show the whole
retirement as one reviewable change and hand it over.

### `--release` — and only with the flag

**Without it, this command writes the note and stops.** That is the default and it is the right one.
[`context/workflow.md`](../../../context/workflow.md) forbids running what bumps, tags, publishes or
deploys, with one exception — *when the user asks for it in that turn* — and **this flag is what that
asking looks like.** So it is never inferred: not from "and ship it" earlier in the session, not from a
plan, not from the notes looking ready, and not from a release being obviously due. A sentence is not a
flag.

Read [`context/release.md`](../../../context/release.md) and run **the script its Bump wire names**. That
file says what it is; naming a tool here would be wrong in half the repositories this command runs in.

**Refuse, finish the retirement without it, and say so, where:**

- **there is no Bump wire** — nothing in this repository is written down as consuming the notes, so there
  is nothing to run and inventing it would be guessing at how someone releases. Name `/onboard`. The notes
  are unharmed; they wait, which is what they are for.
- **the user declined the note** — they said this feature announces nothing, and a release that ships an
  unannounced change is not what they agreed to. Ask before going further.

**Show what it will consume before running it, never after.** That script takes **every** pending note, not
this feature's — including ones other people wrote for work they have not shipped yet. List all of them,
say what version each package lands on, and confirm. Then run it exactly once: it cannot be run twice, the
notes are deleted as it goes, and for a path that deploys this is the act that ships it.

**The level confirmed a moment ago is now final, and say so while asking it.** That confirmation sits where
it does because a note is cheap to correct right up to the release — and this flag deletes the gap it was
relying on. Under `--release` the level chosen is the version that publishes, and for a path that deploys
it is what puts the change in front of users on the merge.

**Commit the bump separately** where [`context/git.md`](../../../context/git.md) says the agent commits.
The retirement and the release are two acts, and somebody deciding whether to merge wants to see which
lines are the version move. Where that file says the user commits, stop and hand over the whole tree,
saying what is in it and which part of it is the release.

**Then push as below.** Nothing else changes: this command still does not merge, and **the change still is
not shipped** — the version moved in a branch, and what ships it is the merge. Report what it is waiting
for, exactly as without the flag.

**If a note check goes red on the pull request this opens, do not write a note to silence it.** A release
commit has no pending notes because they became the changelog, and a check that reads that as a missing
note is asking the wrong question — [`context/release.md`](../../../context/release.md) says what to do
about it. Report it and leave it; a placeholder note written to get past a gate is the one thing that file
forbids outright.

### Then push, if `git.md` says so

Read *Push and pull request* in that same file — **after the retirement is committed, never before.** This
is the only command in the workflow that acts on that answer.

- **Neither** → stop here. Report what changed and hand it over.
- **The agent pushes and opens a pull request** → push this feature's branch and open the pull request. Its
  body is the plan's summary and the phases it landed; link the archived plan at its **new** path, the one
  the sweep just rewrote everything else to.

**A plain push of this feature's branch, and nothing else.** If it will not fast-forward, **stop and say
so** — force-pushing, pushing to the default branch and rewriting published history are asked for by name
each time, under every answer, and this command has not been given that. That the push is the last step of
a finished feature does not change it.

**Both gates have already passed on every phase** — that is what the ledger check at the top of this mode
enforced. A pull request is where finished work goes to be read by a person, not where unfinished work goes
to be verified.

**Nothing merges it.** This command does not merge the pull request, delete the branch, or remove the
worktree. Under the worktree answer all three happen after the merge, and removing a stale tree is the job
of whatever [`context/executors.md`](../../../context/executors.md) names — not of this command, which has
ended by then.

## Mode 2 — `--dropped`

For an entry that will not be built. **There is no ledger check in this mode** — unfinished phases are
expected.

1. Append a `context/history.md` row with outcome `dropped` (or `superseded by <name>`) and **the reason
   the user gave**, verbatim in substance, not softened. That row is what stops the idea being re-proposed,
   so a vague reason makes it worthless.
2. Remove the entry from `context/roadmap.md`.
3. **If the entry never had a document, stop here.** If it had one — a draft in `context/drafts/` or a plan
   in `context/plans/` — `git mv` it to `context/archive/`, repoint its header at the `history.md` row (no
   stamped outcome, same rule as Mode 1), and sweep.
4. **Delete `context/notes.md`** if it exists, per *Delete `context/notes.md`* above. A feature that will
   not be built has nothing its notes should outlive.
**`--release` is refused in this mode**, and not as a technicality: there is no note, so there is nothing
this retirement would be releasing. If a release is due anyway, that is its own act and not this one's.

**No release note is written here, and none is removed.** An idea that will not be built announces nothing.
But a dropped feature may have landed phases, and under *per phase* those phases wrote notes for changes
that are in the repository — **a note belongs to the change that landed, not to the outcome the feature was
later given.** Leave them where they are, and say they are there.

## Rules

- **Never delete a plan document**, and under the tracker answer never delete an issue. Archiving keeps the
  reasoning; deleting throws away the record of a decision someone will otherwise re-litigate.
- **Never leave `roadmap.md` and `history.md` inconsistent.** An entry is in exactly one of them.
- **Never commit the sweep unreviewed** — and never commit it at all unless `git.md` says the agent commits.
- **Never mark a phase `done` to get past the refusal.** If phases are unfinished, the feature is
  unfinished.
