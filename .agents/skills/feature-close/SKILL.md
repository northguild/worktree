---
name: feature-close
description: "Retire a finished or abandoned feature — write its context/history.md row, git mv its document to context/archive/, and sweep every reference to its old path for review. Explicit invocation only — run this when the user types /feature-close. Do NOT match on 'we're done with X', 'close this out', or general wrap-up requests."
---

# /feature-close

Owns the **Tier 2 → retired** transition. Nothing else in this workflow archives a plan —
`/feature-implement` detects that a feature is finished and *names* this command; it never does the work.

Read [`context/workflow.md`](../../../context/workflow.md) for the tier model.

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

## Rules

- **Never delete a plan document.** Archiving keeps the reasoning; deleting throws away the record of a
  decision someone will otherwise re-litigate.
- **Never leave `roadmap.md` and `history.md` inconsistent.** An entry is in exactly one of them.
- **Never commit the sweep unreviewed** — and never commit it at all unless `git.md` says the agent commits.
- **Never mark a phase `done` to get past the refusal.** If phases are unfinished, the feature is
  unfinished.
