# Filling in a Tier-2 plan

[`plan-template.md`](plan-template.md) is the skeleton. `/feature-plan` copies it **verbatim** into
`context/plans/<NAME>-PLAN.md` and then fills it in — there is no fenced block to extract and no italic
guidance to strip, because all of that is here instead.

Sections may be added. The ones in the template may not be dropped or reordered, and the ledger's column
set is fixed — `check` compares every plan's ledger against the template's.

## What goes in each section

**§1 Why** — the problem, with evidence. Measurements, failing cases, user-visible symptoms; not "it would
be nice if". A reader who disagrees with this section should not read further, and a reader who agrees
should not need convincing again later.

**§2 Constraints** — what the solution may not do. Runtime limits, compatibility promises, things already
decided elsewhere that this must respect. Link to [`stack.md`](stack.md) rather than restating it.

**§3 Decisions** — numbered `D1`, `D2`, … so later sections and source comments can cite them by number.
Each one: the decision, the alternative rejected, and why. This is the section that stops a question being
re-litigated in three months.

**§4 Design** — how it works. Sub-sections as the shape of the work demands. Cite file paths for anything
that already exists.

**§5 Risks** — what could go wrong, how it would show up, and what the response is. "Unknown" is an
acceptable response; silence is not.

**§6.1 Status ledger** — one row per phase, `not started` in a newly written plan. Every row needs a real
`Depends on` value (`—` for none): the phase-selection rule *is* "lowest-numbered phase that is not `done`
and whose `Depends on` are all `done`", so a missing column silently degrades it.

**§6.2 The phases** — one sub-section per ledger row. **The `Files:` line is required, not advisory.** It
is what turns `/feature-status`'s reconciliation from a judgement call into a check: without it, "does the
repo match the ledger" has no answer. A phase is a **commit-sized unit of work with a checkable outcome**,
not a category of activity — "grammar plus container support for the new token" is a phase; "testing" is
not.

**§7 Documentation** — every place this project explains itself that the feature makes wrong, out of date
or incomplete. The surfaces come from [`stack.md`](stack.md)'s Documentation index, and from a sweep of the
repository when that index is empty — an index nobody filled in is not evidence that there are no docs.
**Each row names the phase that carries it, and that phase's `Files:` line names the same path.** A
documentation row with no phase is a follow-up nobody does. If the feature genuinely changes nothing, the
section says which surfaces were checked and why: *"no surface describes this"* is an answer, and it is
distinguishable from silence only when it is written down.

**§8 Verification** — how to prove the feature works, beyond [`verify.md`](verify.md) passing. Commands to
run by hand, files to eyeball, numbers to compare against §1's measurements. Anything that belongs to the
project's standing verification stack goes in `verify.md` instead, not here.

**§9 Open questions** — what the plan could not settle. Do not paper over them.

## Standing rules

- **The document never states its own status.** No `**Status:**` header, ever. Feature status lives in
  [`roadmap.md`](roadmap.md), phase status in §6.1, retired outcomes in [`history.md`](history.md) — one
  place each. `check` fails a plan that grows one.
- **`/feature-plan` produces a reviewable skeleton plus open questions**, not a finished plan of record.
  §1, §3, §6.1 and §7 are the sections research can usefully draft — §7 in particular is a search, not a
  judgement call. §4 and §5 usually arrive as open questions.
- **Cite by §-number, not by line number.** Source comments cite plan sections; line numbers rot on the
  first edit, and a §-number survives the move into `archive/`.
- **Never mark a phase `done` in a plan that has not been executed.** Every phase in a new plan is
  `not started`.
