# Git

Who commits the work an agent produces, and at what granularity. **Every command that lands code reads this
file before it closes out** — the exact parallel to [`verify.md`](verify.md) for commands and
[`executors.md`](executors.md) for dispatch, and for the same reason: git etiquette differs per repository,
and a skill that assumes one project's ships one project's habits everywhere.

Configured by `/onboard` on 2026-09-06, when `@baldurpan/create-ai-workflow` 0.6.0 introduced this file.

## Who commits

**The user commits.** A phase ends with the work verified and its ledger row updated, left in the working
tree. The agent reports what changed and stops there — no `git commit`, no `git push`, nothing that
rewrites history.

**This project said so before this file existed**, which is why the shipped default stands here as a
decision rather than as an unexamined inheritance.
[`.github/agents/fix-format-and-lint.agent.md`](../.github/agents/fix-format-and-lint.agent.md) requires
its agent to be "suggest-only" and to "*not* auto-commit or push changes", and repeats it under
**Safety**. That directory is documentation-only and nothing executes it — see the Documentation section
of [`stack.md`](stack.md) — so it binds nothing on its own. This file is the executable form of the same
policy, and the two now agree.

## Granularity

**One commit per phase.** A phase is a commit-sized unit with one checkable outcome — that is what a plan's
ledger is a list of. Where the user commits, this describes the shape the agent leaves the tree in, not
something it carries out.

**Conventional Commits with a scope**, which is what this repository's history uses without exception:
`feat(cleanup):`, `docs(context):`, `refactor(git):`, `chore(release):`, `test(remove):`. An agent that
proposes a commit message proposes one in that form; it still does not run the commit.

## What this file does not decide

**Branches, pushes and pull requests.** Nothing in this workflow creates a branch, pushes, or opens a pull
request, and the answer above does not make it start. If work here belongs on a branch, make the branch
before the phase starts.

## The rules that hold either way

- **The ledger row lands with the work.** Whoever makes the commit, the row and the code it describes are
  one change. A row updated separately is a row that disagrees with the repository in between.
- **`done` is a verdict about the gates, not about git.** A phase is `done` when its scope landed and both
  gates passed. Here, where the user commits, a `done` row whose change is still in the working tree is the
  normal end state — not a discrepancy, and nothing stops on it.
- **If this file is missing, the answer is the first one.** An install from before this file existed has no
  policy written down; treat it as *the user commits*, say so once, and name `/onboard`.
