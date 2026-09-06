---
name: feature-plan
description: "Promote one item from the Tier-1 backlog in context/roadmap.md into a Tier-2 plan document under context/plans/, then stop without implementing. Explicit invocation only — run this when the user types /feature-plan. Do NOT match on 'plan out X', 'how should we build X', or any general planning or design request."
---

# /feature-plan

Turns one roadmap entry into a plan document, then **stops**. It never implements anything and never marks
a phase `done` — every phase in a new plan is `not started`.

**Planning is not activation.** Several features may hold plans at once; there is no "a feature is already
active" refusal here. That is what makes planning ahead possible. Activation is `--activate` or
`/feature-implement`, and both are subject to the one-active-feature rule in
[`context/workflow.md`](../../../context/workflow.md).

## Usage

```
/feature-plan                        # rank the pending entries and ask which to plan
/feature-plan "<name>"               # plan a named entry
/feature-plan "<name>" --activate    # plan it, and mark it active
```

**Nothing needs to be looked up first.** This command resolves its own starting point.

## Steps

### 1. Pick the entry

Read `context/roadmap.md`.

**With a name:** take that entry. If none matches, say which names exist and stop.

**With no argument:** rank the `pending` entries and **ask which to plan**, using your runtime's question
mechanism if it has one, or a plain numbered question if it does not. Writing a plan is a commitment and
takes real work to produce; silently taking the top entry makes that decision on the user's behalf, badly,
whenever the backlog order is stale.

**Ranking**, in priority order:

1. **Has a draft** — the entry's **Doc** names a document in `context/drafts/`. Half-researched is better
   and cheaper. This dominates: an entry with real notes beats a one-line entry almost regardless.
2. **Unblocked by what just shipped** — it builds on something with a `context/history.md` row, so the
   ground under it is settled rather than hypothetical.
3. **Smaller first** — `small`, then `medium`, then `large`. A plan that can be executed beats one that
   gets admired.
4. **Backlog order** — ties break by position in the file.

Offer the top four, **best first**, each with a one-line reason drawn from the ranking — say *why* it is
ranked there, not just what it is. Leave room for the user to name something else.

Special cases, where asking is noise rather than help:

- **Exactly one `pending` entry** — state it and proceed. A one-option question is not a choice.
- **No `pending` entries** — say the backlog is empty and name `/roadmap "some idea"`. Do not invent one.

**State which entry you picked and why, in one line, before doing anything else.**

### 2. Already planned? Start a conversation, not a refusal

If the entry's **Doc** already points into `context/plans/`, say so, show the plan, and ask whether to
iterate on it.

- **Every phase `not started`** → iterate freely.
- **Any phase `in progress`, `blocked` or `done`** → **warn first, and get an answer before writing.**
  Rewriting a plan under work that already happened is the "ledger disagrees with the repo" hazard arriving
  by a new route. Name which phases have moved.

### 3. Decide the document

The plan ends up at `context/plans/<NAME>-PLAN.md`, where `<NAME>` is the entry's kebab-case name
upper-cased.

- **If the entry's **Doc** names a draft in `context/drafts/`**, `git mv` it to that path and build the
  plan on top of its content. Use `git mv`, not `mv`. Do not create a second file and do not leave the
  draft behind — a draft and a plan for the same feature is two documents disagreeing about one thing.
- **Otherwise** copy `context/plan-template.md` to that path. Copy it verbatim; it is a bare skeleton with
  nothing to strip. [`context/plan-template.notes.md`](../../../context/plan-template.notes.md) says what
  goes in each section.

**The draft is the most valuable input you have** — material the user gathered deliberately, often from
somewhere you cannot reach. Carry its specifics forward; do not summarise them away, and do not silently
drop a fact because you could not verify it. Mark it as an open question instead.

### 4. Research and draft

Delegate the research and the draft to a planner subagent **if your runtime provides one**; otherwise do it
inline. Either way the brief is the same, and the output contract is the template's section list, not a
planner's own default shape:

- The roadmap entry verbatim, and the full content of its draft if there was one.
- **If `prototypes/<NAME>/` exists at the repository root**, its `NOTES.md` and the mockups beside it. A
  sketch someone has already looked at settles a design question that a paragraph would only argue. Carry
  what it settled into §4 Design and cite the folder; treat anything it marked invented as a proposal, not
  a fact. **No folder, no step** — this is a conditional read, not a prerequisite.
- **The full section list from `context/plan-template.md`, stated as required output**, in order, with the
  ledger's exact column set. A general-purpose planner will otherwise emit implementation-steps-and-
  acceptance-criteria — a per-phase artifact, not a plan — and you will throw it away.
- Pointers to `context/stack.md`, `context/standards/README.md` (load per its conditional table) and
  `context/verify.md`. Cite the paths; do not paste the files in. Anything reading this repo can open them.
- **Where this project documents itself, and what this feature makes untrue there.** Start from the
  Documentation section of `context/stack.md`. **If that section is empty, missing, or names less than the
  tree plainly holds, sweep for it** — the root `README`, a `README` in each package, `docs/`, a docs site
  or landing page in the repository, an API reference or OpenAPI document, a changelog, help text and
  format comments that live in the code. Ask the user about anything hosted elsewhere: a wiki, a docs site
  built from another repo, a published reference. **An index nobody filled in is not evidence that there
  are no docs**, and a plan that assumes it is ships the drift.
- **Cite file paths and command output for every claim about the current codebase.** Anything unverified is
  an open question, not an assertion.
- Phases are **commit-sized units with checkable outcomes**, each with a real `Depends on` value and a
  **Files:** line naming every path it touches. That line is what makes reconciliation a check rather than
  a judgement call.

### 5. Write the document

Fill in the template's shape. Then:

- Date it and point its header at the roadmap entry.
- **No `**Status:**` header.** Feature status lives in `roadmap.md`, phase status in the ledger. A document
  that claims its own status is a copy that goes stale.
- Fill in **§7 Documentation** from what the sweep found: one row per surface the feature changes, each
  assigned to the phase that carries it, **and that phase's `Files:` line names the same path.** A
  documentation row with no phase is a follow-up nobody does. If nothing changes, say which surfaces you
  checked and why none of them describe this — that is an answer, and leaving the section blank is not.
- Fill in **§9 Open questions** honestly. An honest gap is worth more than an invented decision.
- Every phase is `not started`.

### 6. Update the roadmap entry

Repoint the entry's **Doc** field at the new `plans/` path. If you `git mv`d a draft, that same edit is
what fixes the now-dead `drafts/` link, so do it together.

**Leave the marker alone unless `--activate` was given.** `pending` with a `plans/` document is the correct
state for a planned-but-not-started feature.

**With `--activate`:** check the one-active-feature rule in
[`context/workflow.md`](../../../context/workflow.md) first. If another entry holds the slot, **write the
plan, skip the activation, and name the feature that holds it.** The plan is valuable and harmless on its
own; discarding it over a marker would undo the point of the split.

### 7. Report and stop

State the document path, the phase count, the documentation surfaces §7 commits to updating, and the open
questions. Then say plainly that **what you produced
is a reviewable skeleton plus open questions, not a finished plan of record** — the value is the structure
and the research. Name the next step: the user reviews and edits the plan, and `/feature-implement` runs it
once they are satisfied.

## Rules

- **Never implement anything.** Not "just the first phase", not "a quick scaffold".
- **Never mark a phase `done`**, and never mark a phase anything other than `not started`.
- **Never write outside `context/`.** No source files, no config.
- Do not fold the draft's content into `context/roadmap.md`. Tier 1 stays high-level.
