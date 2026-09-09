---
name: feature-close
description: "Retire a finished or abandoned feature — write its context/history.md row and git mv its document to context/archive/, or close its issue with the matching reason where context/tracking.md says so. Explicit invocation only — run this when the user types /feature-close. Do NOT match on 'we're done with X', 'close this out', or general wrap-up requests."
disable-model-invocation: true
---

# /feature-close

Owns the **Tier 2 → retired** transition. Nothing else in this workflow archives a plan —
`/feature-implement` detects that a feature is finished and *names* this command; it never does the work.

Read [`context/workflow.md`](../../../context/workflow.md) for the tier model, and
[`context/tracking.md`](../../../context/tracking.md) for where a retired feature goes. **Everything below
is written for the working-tree answer**; *Under the tracker answer* at the end says what changes.

## Usage

```
/feature-close                                # retire the active feature as shipped
/feature-close "<name>"                       # retire a named feature as shipped
/feature-close "<name>" --dropped "<why>"     # retire one that will not be built
```

**Resolving the target:** with no argument, the entry marked `active`. With a name, resolve it against
`context/roadmap.md` — **any entry holding a plan is a valid target**, not just an active one. An abandoned
plan is a droppable state.

## Mode 1 — `shipped`

### Refuse first

Check both before touching anything, and refuse if either fails:

1. **Every phase in the ledger is `done`.** If not, list the ones that are not, and stop. Do not offer to
   mark them.
2. **No open `P0` or `P1` in `context/findings.md` is tied to this feature.** If there is, quote it and
   stop.

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

### Finally

Move every **closed** finding tied to this feature out of `context/findings.md` and into the archived plan's
own log. `findings.md` must not grow for the life of the project.

Then read [`context/git.md`](../../../context/git.md) before committing anything. `git mv` stages a rename
and writes no history, so it is safe under either answer — but the commit that carries it is the agent's to
make only where that file says so. If it does not exist, the answer is *the user commits*: show the whole
retirement as one reviewable change and hand it over.

### Then push, if `git.md` says so

Read *Push and pull request* in that same file — **after the retirement is committed, never before.** This
is the only command in the workflow that acts on that answer.

- **Neither** → stop here. Report what changed and hand it over.
- **The agent pushes and opens a pull request** → push this feature's branch and open the pull request. Its
  body is the plan's summary and the phases it landed; link the archived plan at its **new** path, the one
  the sweep just rewrote everything else to.

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

## Under the tracker answer

Read [`context/tracking.md`](../../../context/tracking.md) first. **Both refusals are unchanged** — every
phase finished, no open `P0` or `P1` — and so is everything about pushing.

| Above | Becomes |
|---|---|
| resolve from `roadmap.md` | resolve from the issues carrying the backlog label |
| every phase `done` | **unchanged** — every row in the body's ledger reads `done` |
| remove the entry, append a `history.md` row | **the issue is closed** — *completed* for shipped, *not planned* for `--dropped`. See *Who closes it* |
| the one-line why | the closing comment |
| `git mv` the plan to `archive/` | nothing moves; the issue keeps its body and its whole thread |
| rewrite the document header | nothing — a closed issue does not claim to be open |
| the reference sweep | **nothing to sweep.** No path changed, so no link broke |

**The archive is the closed issue**, and it is more than the file it replaces: the plan, the discussion
that shaped it, the finished ledger with every phase's Note, and the pull request, all at one id that
nothing had to rewrite. This is why the sweep and the header rewrite both disappear rather than being
ported.

### Who closes it

**Where [`context/git.md`](../../../context/git.md) says the agent pushes and opens a pull request**, put
`Closes #<issue>` in the pull request body and let the merge close it. The close then rides the same change
as the work — which is exactly what appending the `history.md` row does under the other answer.

**Where it says anything else, close the issue here**, with the closing comment, and say that is what
happened. Nothing else will: the trailer fires only when the commit reaches the default branch, and under
those answers it never gets there.

**`--dropped` always closes here, whatever `git.md` says.** A trailer closes an issue as *completed*, and
that is the wrong outcome for an idea that will not be built — the two close reasons are how this answer
records what `history.md`'s Outcome column used to.

This is the only place `git.md`'s answer changes what this command does, and it is why
[`context/tracking.md`](../../../context/tracking.md) recommends pairing this substrate with the push
answer rather than requiring it.

**Keep the label and keep the assignee.** The label is what makes retired features findable later, and the
assignee is the record of who ran it. Neither means anything once the issue is closed, and removing either
loses a fact for no gain.

**Closed findings go into the closing comment**, not into an archived document — same rule, same reason:
`findings.md` must not grow for the life of the project.

**`--dropped` closes as *not planned*, and the reason goes in the comment**, verbatim in substance. That
comment is what stops the idea being re-proposed, so a vague one makes it worthless — exactly what the
`history.md` row was for.

**Then push, if `git.md` says so.** Unchanged, except that the pull request body links the issue rather
than an archived path, and carries the trailer described above.

## Rules

- **Never delete a plan document**, and under the tracker answer never delete an issue. Archiving keeps the
  reasoning; deleting throws away the record of a decision someone will otherwise re-litigate.
- **Never leave `roadmap.md` and `history.md` inconsistent.** An entry is in exactly one of them.
- **Never commit the sweep unreviewed** — and never commit it at all unless `git.md` says the agent commits.
- **Never mark a phase `done` to get past the refusal.** If phases are unfinished, the feature is
  unfinished.
