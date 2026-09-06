# AGENTS — Worktree repository

`@northguild/worktree` — a Node CLI for managing git worktrees, built on oclif, with a Next.js/Nextra
documentation site under `docs/`. Both live in one pnpm workspace.

Layout, runtime and the conventions specific to this repository are in
[`context/stack.md`](context/stack.md).

## Contact / Maintainers

For agent reviews and maintenance, ask the repository maintainers listed in `package.json`
(`contributors`) or open a PR with suggested agent files.

<!-- ai-workflow:start -->
## Planning workflow

Planning artifacts live in [`context/`](context/README.md). Read
[`context/workflow.md`](context/workflow.md) before using any command below — it holds the tier model and
the standing rules, and every command cites it rather than restating it.

| Command | Does |
|---|---|
| `/roadmap` | prints the Tier-1 backlog, or appends one `pending` entry to it |
| `/feature-plan` | turns a backlog entry into `context/plans/<NAME>-PLAN.md` and **stops** — it never implements |
| `/feature-implement` | activates a planned feature and runs its phases, through both gates |
| `/feature-status` | read-only "where do things stand". **Never a prerequisite** for anything |
| `/feature-close` | retires a finished or abandoned feature into `context/archive/` |
| `/orchestrate` | one ad-hoc, gated, commit-sized change — no roadmap entry, no ledger |
| `/prototype` | a throwaway HTML/CSS mockup under `prototypes/` — no gates, no ledger, no application code |
| `/onboard` | fills in this project's own stubs — `verify.md`, `executors.md`, `git.md`, `stack.md` — adopting what an existing `AGENTS.md` already said |

| Read | For |
|---|---|
| [`context/stack.md`](context/stack.md) | runtime, layout, conventions, and where this project documents itself |
| [`context/standards/README.md`](context/standards/README.md) | engineering standards — load per its conditional table |
| [`context/verify.md`](context/verify.md) | the real lint / typecheck / build / test commands — the only file that names one |
| [`context/git.md`](context/git.md) | who commits, and at what granularity — read it before closing out any change |

**Phase status lives in the active plan's status ledger and nowhere else.** Work the lowest-numbered phase
that is not `done` and whose `Depends on` are all `done`; state which you picked before starting; update
the row as part of the same change as the work. **If the ledger disagrees with the repo, stop and say so.**

**Nothing commits unless [`context/git.md`](context/git.md) says so.** Absent or silent, the work is left in
the working tree and the user commits it.

**An open `P0` or `P1` in [`context/findings.md`](context/findings.md) blocks its phase from being `done`.**

**Documentation is part of the change.** Whatever a change makes untrue in this project's own docs is fixed
by the phase that makes it untrue, not by a follow-up.

**Require evidence, not assertion.** A claim about what a file contains needs the file read, not recalled —
yours as much as a subagent's.
<!-- ai-workflow:end -->
