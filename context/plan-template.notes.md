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

**The Note is one line, and it is the one column with no visible bound.** Everything else in the row is a
number, a word from a fixed set or a short list; the Note is prose in a table cell that nothing wraps, so
it grows until a reader cannot find the Status beside it. Keep it to what a later session needs in order
to understand or resume that Status — what is underway, what remains, what is blocking, the sha where the
phase is `done`. The measurements, the test counts, the gate output and the account of how the phase went
belong in the commit message that carries the row or in the run's report, both of which are read by
someone who went looking for them.

**§6.2 The phases** — one sub-section per ledger row. **The `Files:` line is required, not advisory.** It
is what turns `/feature-status`'s reconciliation from a judgement call into a check: without it, "does the
repo match the ledger" has no answer. A phase is a **commit-sized unit of work with a checkable outcome**,
not a category of activity — "grammar plus container support for the new token" is a phase; "testing" is
not.

**The `Standards:` line is the phase's share of the conditional table**, and the plan is the one place that
table is traversed. The planner read [`standards/README.md`](standards/README.md) with the research in
hand; the coder and the reviewer read this line instead of reading the table again, so each loads the
three or five files that apply rather than the eleven a fresh table read tends to produce. It carries the
always row, the rows for the code the phase touches, and the rows the surface question in
[`workflow.md`](workflow.md) added — accessibility, performance, security — which are the ones a table read
misses. A reviewer that finds the change drifted past the line opens the table; that is the fallback, not
the route.

**The `Decisions:` line is the same move applied to §3.** A phase's constraints are in §3 and its work is
in §6.2, and a brief that carries only the second leaves the coder to either read the whole plan or
re-decide what §3 already settled. The line names the decisions that govern the phase, by number and in a
clause each, so the brief is the phase's own section and nothing more. Where a phase is genuinely governed
by no decision, say `—`; the empty line and the unfilled one read alike otherwise.

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

**This is where a surface the planning question found gets proved** — the keyboard and contrast pass for
something a person operates, an **end-to-end pass in a real browser** for a user interface, the measurement
to compare for a hot path. Which driver runs it is [`verify.md`](verify.md)'s answer and never this
section's; a feature whose project has no such driver says that in §9 rather than naming one.

**It is also where each value the feature computes gets a source**, one row each: the requirement, the
specification, the published reference or the outside source that says what the value should be. The coder
works test-first from that row — *An expected value has a source, and it is never the code under test* in
[`workflow.md`](workflow.md) — so a row left unwritten is an expectation somebody derives mid-phase, in the
one place it is cheapest to derive it from the code that was just written. Research is what finds these,
which is why they are planned rather than left to the phase. A feature that computes nothing of its own
says so; a value whose source the research could not find is a §9 open question, because the alternative is
a number the implementation gets to choose.

**§9 Open questions** — what the plan could not settle. Do not paper over them. **Say which items need a
person**, because this section has two readers after you: `/feature-implement` surfaces it at activation,
and `/feature-close` goes through it before the plan is archived and gives every item that still needs a
person an end — answered, filed where this project files bugs, or waived by the user in that turn. An item
a phase settles is answered in place, by that phase. Nothing here is archived unread.

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
- **A plan has a size budget**, in *How much a plan may hold* in [`tracking.md`](tracking.md). It is
  measured before the plan is written, with room held back for the ledger rows still to come. A plan over
  the line is split along phase boundaries, never trimmed to fit: trimming discards the research the plan
  exists to hold, and a trimmed plan reads exactly like one that was small enough.
