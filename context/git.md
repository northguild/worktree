# Git

Who commits the work an agent produces, where that work lands, whether it is pushed, and at what
granularity. **Every command that lands code reads this file before it closes out** — the exact parallel to
[`verify.md`](verify.md) for commands and [`executors.md`](executors.md) for dispatch, and for the same
reason: git etiquette differs per repository, and a skill that assumes one project's ships one project's
habits everywhere.

Configured by `/onboard` on 2026-09-06 (`@baldurpan/create-ai-workflow` 0.6.0, which introduced this file)
and re-answered on 2026-09-09 under 0.8.0, which added the three questions below the first.

## Who commits

**The agent commits.** One commit per phase, the code and its ledger row as a single change.

This reverses the 2026-09-06 answer, deliberately and with the reason recorded. That answer cited
[`.github/agents/fix-format-and-lint.agent.md`](../.github/agents/fix-format-and-lint.agent.md), which
requires its agent to be "suggest-only" and to "*not* auto-commit or push changes". That file is
documentation-only and nothing executes it — see the Documentation section of [`stack.md`](stack.md) — and
it describes a lint-fixing agent, not the phase loop. **It no longer governs this question**, and the two
now disagree on paper; this file is the executable answer and wins. If that manifest is ever revived as a
mechanism, its rule applies to it alone.

## Where work lands

**A worktree per feature.** Several features may be in flight at once, each in its own tree, created from
`origin/main`.

This project *is* the worktree tool, so the shape is also the dogfooding: a feature is worked in a tree
made by `worktree branch`, and the tool's own rough edges surface in the workflow that uses it. How a tree
is created, and how to ask whether an agent session is live in one, are recorded in
[`executors.md`](executors.md) — not here, for the same reason the reviewer's invocation lives there.

## Push and pull request

**The agent pushes and opens a pull request**, once per feature, at `/feature-close` — never at the end of
a phase. A phase ends with a local commit and nothing more.

## Granularity

**One commit per phase.** A phase is a commit-sized unit with one checkable outcome — that is what a plan's
ledger is a list of. The row and the code it describes go in together.

**Conventional Commits with a scope**, which is what this repository's history uses without exception:
`feat(cleanup):`, `docs(context):`, `refactor(git):`, `chore(release):`, `test(remove):`.

## Under the worktree answer

- **One active feature per tree.** The `active` marker is set in the worktree that holds the feature and
  never reaches the default branch — `/feature-close` retires the entry before the branch merges. What is
  in flight across the repository is answered by `git worktree list` and by nothing else.
- **No append-only file is left to conflict.** `context/history.md` was the one file every
  `/feature-close` appended to, and parallel trees would have collided there on every merge. It was
  removed on 2026-09-09 — closed issues are the outcome index now, see [`tracking.md`](tracking.md) — and
  the `.gitattributes` union-merge rule written for it went with it. **`findings.md` never wanted that rule
  anyway**: closed findings leave that file, and a union merge would resurrect deleted lines.
- **Env files do not travel.** A new worktree starts without the `.env` files the tool copies for a human;
  `copyEnvFilesFromRootPath` handles that at creation time. A tree made by any other means may need them
  copied before `pnpm docs:dev` or the Worker scripts will run.
- **`pnpm install` per tree.** `node_modules` is not shared between worktrees, and the prerequisites in
  [`verify.md`](verify.md) apply in each one before Gate 1 means anything.

## What this file does not decide

**Merging, branch deletion and worktree removal.** Nothing in this workflow merges a pull request, deletes
a branch, or removes a worktree, under any answer above. The pull request is opened and left for a human.

## The rules that hold either way

- **The ledger row lands with the work.** Whoever makes the commit, the row and the code it describes are
  one change. A row updated separately is a row that disagrees with the repository in between.
- **`done` is a verdict about the gates, not about git.** A phase is `done` when its scope landed and both
  gates passed.
- **If this file is missing, the answer is the most conservative one** — the user commits, work lands in
  the main working tree, nothing is pushed. Say so once, and name `/onboard`.
