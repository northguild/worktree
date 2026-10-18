# <Feature> Plan

Written <YYYY-MM-DD>. <One line on what this is.> The `<name>` entry in
[`../roadmap.md`](../roadmap.md) is where this feature's status lives.

**Phase status lives in §6.1 of this document, and nowhere else.**

---

## 1. Why

<The problem, with evidence.>

## 2. Constraints

<What the solution may not do.>

## 3. Decisions

**D1.** <Decision.> Rejected: <alternative>, because <why>.

## 4. Design

<How it works.>

## 5. Risks

<What could go wrong, how it would show up, and the response.>

## 6. Phases

### 6.1 Status ledger

| # | Phase | Status | Depends on | Note |
|---|---|---|---|---|
| 1 | <name> | not started | — | |
| 2 | <name> | not started | 1 | |

Status is one of `not started`, `in progress`, `blocked`, `done`. A row goes to `in progress` when work on
the phase starts, before any code, so an interrupted run leaves a ledger that says what was underway. `done`
only when the scope landed and both gates passed, and whoever finishes a phase updates the row as part of
the same change as the work — who commits that change is [`../git.md`](../git.md)'s answer, not this
table's.

**The Note is one line: what a later session needs in order to understand or resume the Status beside it.**
What is underway while a row is `in progress`, what remains where some of the phase landed, what is
blocking a `blocked` row, the commit sha where one is `done`. Nothing else — measurements, test counts,
gate output and the account of how the phase went go in the commit message that carries the row, under
[`../git.md`](../git.md)'s answer, or in the run's own report. A Note that grows into a phase log makes the
ledger unreadable at exactly the moment it is being read in a hurry, and it is the one column in this
document with no length anyone can see coming.

**Exactly one table in this document has these columns.** Do not add a second phase table — a
differently-shaped one nearby is a decoy that gets read by mistake.

**A plan has a size budget**, and *How much a plan may hold* in [`../tracking.md`](../tracking.md) says what
it is. A plan over it is not trimmed to fit — it is a feature that is more than one feature, and
`/feature-plan` proposes the split.

### 6.2 The phases

#### Phase 1 — <name>

**Files:** <every path this phase creates or modifies>

**Standards:** <the files under `../standards/` this phase is reviewed against — its rows of that README's conditional table, the always row included>

**Decisions:** <the §3 decisions that govern this phase, by number and in one clause each — what the coder may not re-litigate>

**Scope:** <what it does>

**Done when:** <a condition checkable against the repo>

#### Phase 2 — <name>

**Files:** <every path this phase creates or modifies>

**Standards:** <the files under `../standards/` this phase is reviewed against — its rows of that README's conditional table, the always row included>

**Decisions:** <the §3 decisions that govern this phase, by number and in one clause each — what the coder may not re-litigate>

**Scope:** <what it does>

**Done when:** <a condition checkable against the repo>

## 7. Documentation

<What this feature makes untrue in the project's own documentation. Start from the Documentation index in
[`../stack.md`](../stack.md), and from the repository itself if that index is empty.>

| Surface | What changes | Phase |
|---|---|---|
| <path, or the URL of a docs site> | <what it claims now that this makes wrong, or what it will not say yet> | <n> |

<If nothing changes, name the surfaces you checked and why none of them describe this. An empty section
reads as "not checked", and nothing downstream can tell those apart.>

## 8. Verification

<How to prove the feature works, beyond `context/verify.md` passing.>

**What decides each value this feature computes.** One row per value, so the expected value in a test has a
source that is not the implementation.

| Value | What decides it |
|---|---|
| <a number, string or structure this feature produces> | <the requirement, specification, published reference or outside source that says what it should be — never the code that computes it> |

<If the feature computes no values of its own — wiring, configuration, documentation — say that. A value
whose source could not be found belongs in §9, not in this table.>

## 9. Open questions

- <Anything the plan could not settle. An honest gap is worth more than an invented decision. Say which
  items need a person — a reading, a judgement, a pass on a device nothing here drives — because
  `/feature-close` goes through this section and gives each of those an end before the plan is archived.>
