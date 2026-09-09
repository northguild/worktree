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
| no tier crossed | `/orchestrate` — one ad-hoc gated change; `/feature-status` — read-only; `/prototype` — a throwaway mockup |

**Every command finds its own starting point.** Nothing has to be looked up first, and `/feature-status` is
never a prerequisite for anything.

## The commands

| Command | Owns | Writes |
|---|---|---|
| `/roadmap` | Tier 1 contents | `roadmap.md`, and `drafts/` when material is supplied |
| `/feature-plan` | Tier 1 → a plan document | `plans/<NAME>-PLAN.md`; the `active` marker only with `--activate` |
| `/feature-implement` | activation, and the phases within a plan | the plan's ledger, `findings.md`, the code |
| `/feature-status` | nothing — read-only | — |
| `/feature-close` | Tier 2 → retired | `history.md`, `archive/`, the reference sweep, and the push and pull request where [`git.md`](git.md) says so |
| `/orchestrate` | one ad-hoc gated change | the code, and `findings.md` |
| `/prototype` | one throwaway HTML/CSS mockup — no gates, no application code | `prototypes/<NAME>/`, and nothing else |
| `/onboard` | the project-owned stubs | `verify.md`, `executors.md`, `git.md`, `tracking.md`, `stack.md`, and the pruning of what they replace |
| `/tracking-migrate` | moving existing state onto the substrate `tracking.md` names | issues, and the tree files they replace — never `history.md` or `archive/` |

## One source of truth per fact

| To know | Read |
|---|---|
| whether a feature is being worked | the `pending` / `active` marker in its `roadmap.md` heading |
| whether a feature has a plan | whether its **Doc** field points into `plans/` |
| where a phase stands | that plan's own status ledger |
| what a retired feature's outcome was | its `history.md` row |

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

*In a working tree* matters only under [`git.md`](git.md)'s worktree answer, where each feature is worked
in its own tree and sets the marker there. That marker never reaches the default branch — `/feature-close`
removes the entry before the branch merges — so what is in flight across the repository is answered by
`git worktree list` and by nothing else. **"In flight" is not a status; it is the observation that a
worktree exists**, the same way "planned" is the observation that a document exists in `plans/`. Everywhere
else there is one tree, and the rule reads as it always did.

### Feature or task?

> **If you would want a `history.md` row for it, it is a feature — use the roadmap flow.
> If you would not, it is a task — use `/orchestrate`.**

`/orchestrate` is the ad-hoc escape hatch, not the way to skip planning. It refuses anything larger than a
commit-sized unit and anything an existing roadmap entry already covers.

### Nothing commits, branches or pushes unless `git.md` says so

> **Read [`git.md`](git.md) before closing out any command that lands code. If it does not exist, or does
> not say the agent commits, the work is left in the working tree and the user commits it.**

This workflow has always described phases as commit-sized and `done` as landed — which an agent, given no
policy, resolves by committing on its own every phase. That is a call about someone else's repository, so
it is a written answer rather than an inference.

[`git.md`](git.md) answers three more of the same shape, each independent of the others and each shipping
as the most conservative option: **where work lands** (the main working tree, a branch per feature, or a
worktree per feature), **whether the agent pushes and opens a pull request** (it does not), and at what
**granularity** it commits. A push happens once per feature, at `/feature-close` — never at the end of a
phase — and nothing here merges a pull request, deletes a branch, or removes a worktree under any answer.

### Where this state lives is an answer, not an assumption

> **Read [`tracking.md`](tracking.md) before reading or writing any workflow state. If it does not exist,
> or does not say otherwise, the backlog is `roadmap.md`, a plan is a document under `plans/`, and a
> retired feature is a `history.md` row.**

Everything above describes the working-tree answer, which is the default and what every install does
until someone changes it. The second answer puts the same tiers in an issue tracker — a feature is an
issue, a plan is that issue's body, a closed issue is the archive — because **a file cannot be the shared
home for several agents at once.** A worktree carries only what its ref holds, so a plan on one branch is
invisible to every other tree; a tracker sits outside all of them.

**The tier model is identical under both.** What changes is where a fact is read, and only
[`tracking.md`](tracking.md) says how — no skill names a tracker, which is what keeps a different one a
rewrite of that file rather than of every command.

**Changing the answer is not moving the work.** `/onboard` sets which substrate this project uses;
`/tracking-migrate` carries what already exists onto it. They are two commands because the second is a
data migration with remote writes that can fail partway, and running one off the back of the other is the
side-effect this tier model refuses everywhere else. A repository whose answer says *tracker* while its
entries sit in `roadmap.md` reads as an empty backlog to every command — which is why `/onboard` refuses to
write that state and names the migration instead.

### Documentation is part of the change

> **Find where this project documents itself before planning — the Documentation index in
> [`stack.md`](stack.md), and the repository itself when that index is missing or empty. Whatever a change
> makes untrue there is fixed by the phase that makes it untrue, not by a follow-up.**

Documentation is the one output with no gate behind it. Nothing fails when a README goes on describing a
flag that was renamed, so the drift is invisible until someone follows the old instructions and it is not
invisible to them. `/feature-plan` writes the affected surfaces into the plan's §7, each assigned to a
phase, and that phase's **Files:** line carries the path like anything else it touches.

*"Nothing here describes this feature"* is a legitimate answer, and it names the surfaces that were
checked. Saying nothing is not that answer.

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

**One run is one phase, unless `--all` says otherwise.** That flag repeats the pick above, and stops
exactly where a single run would: a phase that ended `blocked` or part-landed, a gate at its loopback cap,
an open `P0` or `P1` tied to the phase, a ledger that disagrees with the repo. Phase to phase is not a tier
boundary, so nothing above changes — and when the last phase goes `done` it stops there and names
`/feature-close`. **That boundary is still crossed by an explicit command**, and a flag on the command
below it is not one.

**A phase's row is written twice.** It opens to `in progress` when the work starts, before any code, and
closes to `done`, `in progress` or `blocked` when the phase ends. The opening write is what makes an
interruption survivable: a run that dies mid-phase leaves a tree with half the work in it, and the row is
the only thing that can say so.

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

**Gate 1 — verification.** Read [`verify.md`](verify.md) and run its sections in order: Lint → Typecheck →
Build → Test. Never carry a copy of those commands and never invent one. A missing section is skipped, never
faked. Exit 0 is the verdict regardless of what any summary text claims. If `verify.md` does not exist, stop
and say so.

**Gate 2 — review.** Dispatch per [`executors.md`](executors.md). Every verdict needs concrete evidence —
file paths, command output — and every blocking finding needs a `P0`–`P3` severity. A `FAIL` is written to
[`findings.md`](findings.md) **first**, then looped back. Cap: two loops, then write a finding and escalate.
Escalating is not a substitute for recording: the conversation ends, the file does not.

## Findings

[`findings.md`](findings.md) holds defects that outlive the session that found them. **An open `P0` or `P1`
tied to a phase blocks that phase from being marked `done`**, and blocks `/feature-close` on its feature.

A finding closes when the gate that raised it re-passes, citing that run. There is no "fixed but unverified"
state. Closed findings leave the file entirely — at `/feature-close` for a feature's findings, and at the
start of the next `/orchestrate` for ad-hoc ones. That file must not grow for the life of the project.
