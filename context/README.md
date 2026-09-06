# context/

Everything an agent needs to work on this project, in one agent-neutral place. Nothing here is specific to
any one coding agent — `AGENTS.md` at the repo root is the entry point that points here.

## The one rule that outranks the others

**No document states its own status.** There is no `**Status:**` header anywhere under `context/`. Every
status has exactly one home:

| To know | Read |
|---|---|
| whether a feature is being worked | the `pending` / `active` marker in its [`roadmap.md`](roadmap.md) heading |
| whether a feature has a plan | whether its **Doc** field points into [`plans/`](plans/) |
| where a phase stands | that plan's own status ledger |
| what a retired feature's outcome was | its [`history.md`](history.md) row |

A header that claims a status is a copy nobody remembers to update. The two facts "is it being worked" and
"does it have a plan" are orthogonal, which is why they live in two different places and neither can go
stale against the other.

Nothing here is cached, parsed by a script, or generated. There is no build step in the planning loop and no
generated "current state" file — hand-editing a ledger row changes every command's answer immediately.

## What the tool installs

| File | Holds | Owner |
|---|---|---|
| `README.md` | this file | tool |
| [`workflow.md`](workflow.md) | the tier model, the commands, the standing invariants | tool |
| [`plan-template.md`](plan-template.md) | the bare skeleton every Tier-2 plan is copied from | tool |
| [`plan-template.notes.md`](plan-template.notes.md) | what goes in each section of that skeleton | tool |
| [`roles/coder.md`](roles/coder.md) | the coder system prompt — names no commands | tool |
| [`standards/`](standards/README.md) | engineering standards, loaded per that README's conditional table | tool* |
| [`stack.md`](stack.md) | this project's runtime, layout, conventions, where it documents itself, and an index of your own files | project |
| [`verify.md`](verify.md) | this project's real lint / typecheck / build / test commands | project |
| [`executors.md`](executors.md) | how this project dispatches a coder and a reviewer | project |
| [`git.md`](git.md) | who commits the work an agent produces, and at what granularity | project |
| [`roadmap.md`](roadmap.md) | Tier 1 — the backlog. `pending` and `active` entries only | project |
| [`history.md`](history.md) | index of retired features, newest last | project |
| [`findings.md`](findings.md) | open findings that gate a phase from being marked `done` | project |
| [`drafts/`](drafts/) | notes and source material for ideas not yet planned — no ledger | project |
| [`plans/`](plans/) | Tier 2 — documents with an executable phase ledger | project |
| [`archive/`](archive/) | retired plans, moved here by `/feature-close` | project |

`*` `standards/` is tool-owned only while it is the bundled default and unmodified. Swap it with
`standards add <git-url>`, or edit it, and it becomes yours — it drops out of the manifest and updates
stop reaching it.

A document moves once per tier transition, and **which directory it sits in tells you what it is**:

```
drafts/  ──/feature-plan──▶  plans/  ──/feature-close──▶  archive/
notes                        a phase ledger              retired
```

`plans/` means "has an executable ledger" and nothing more — it does not imply the feature is being worked.
If a document is ever misfiled, the roadmap's link to it breaks loudly rather than lying quietly.

## Ownership

This directory mixes tool-supplied content with project state. The boundary is enforced by a data structure,
not by a rule someone has to remember: `context/.state/manifest.json` lists every tool-owned file with its
hash, `update` walks that manifest, and a project-owned file is not in it — so no code path reaches it.

| Tool-owned — replaced on `update` | Project-owned — unreachable by the updater |
|---|---|
| `README.md`, `workflow.md`, `plan-template*.md`, `roles/` | `stack.md`, `verify.md`, `executors.md`, `git.md` |
| the skill and agent trees, the `AGENTS.md` block | `roadmap.md`, `history.md`, `findings.md` |
| `standards/` while it is ours and unmodified | `drafts/`, `plans/`, `archive/`, `CLAUDE.md` |

`update` prints both columns when it runs. A visible boundary beats a documented one.

The boundary has a cost, and `update` prints that too: a new version's tool-owned files can expect
something of a project-owned one — a section of [`stack.md`](stack.md), a `git.md` that predates the
file — and nothing in the updater may write it. So it names each gap under **Next** and stops there.
Closing them is `/onboard`, which is re-runnable for exactly this reason.

**Anything else you add under `context/` is yours forever**, by the same property — `context/decisions.md`,
`context/glossary.md`, `context/ops-notes.md` all survive by default, with no feature required to protect
them. Index your own additions in [`stack.md`](stack.md), not here: this file is replaced on every update,
so a line you add to it is a line you lose.

## What does not belong here

Planning artifacts live in `context/`, wherever else your docs live. Product specs, API references and
anything else written for humans or library consumers stay where this project already keeps them.

They are not out of scope for being elsewhere, though. [`stack.md`](stack.md)'s Documentation section
indexes where "elsewhere" is, so a plan can name what a feature makes untrue there and a phase can carry
the fix — the standing rule is in [`workflow.md`](workflow.md).
