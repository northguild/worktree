# Git

Who commits the work an agent produces, where that work lands, whether it is pushed, and at what
granularity. **Read this file before any `git` or `gh` command that changes something, and again before
closing out** — the exact parallel to
[`verify.md`](verify.md) for commands and [`executors.md`](executors.md) for dispatch, and for the same
reason: git etiquette differs per repository, and a skill that assumes one project's ships one project's
habits everywhere.

Configured by `/onboard` on 2026-09-06 (`@baldurpan/create-ai-workflow` 0.6.0, which introduced this file)
and re-answered on 2026-09-09 under 0.8.0, which added the three questions below the first. Re-run on
2026-09-30 under 0.22.0, which added *What no answer here authorises*; no answer changed.

What each section takes, and the alternative answers written out, are in [`git.notes.md`](git.notes.md).

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
is created and removed, and how to ask whether an agent session is live in one, are recorded in
[`executors.md`](executors.md)'s *Branch and worktree* section — not here, for the same reason the
reviewer's invocation lives there.

## Push and pull request

**The agent pushes and opens a pull request**, once per feature, at `/feature-close` — never at the end of
a phase. A phase ends with a local commit and nothing more.

## Granularity

**One commit per phase.** A phase is a commit-sized unit with one checkable outcome — that is what a plan's
ledger is a list of.

**The row cannot ride the commit under this project's tracking answer.** [`tracking.md`](tracking.md) puts
the ledger in a GitHub issue body, and a remote write is not part of a commit. The order is fixed instead:
commit, then edit the row immediately, **naming that commit's sha in the Note.** The sha is what replaces
the guarantee a same-change row used to give — a `done` row whose sha is in the branch is checkable, and
one with no sha is a disagreement that stops the next phase.

**`/feature-implement --all` runs here**, because that flag declines under *the user commits* and this
project takes the other answer. Each phase is still its own commit; the flag only removes the pause
between them.

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

**How a branch or a worktree is created.** That is a per-machine fact that changes underneath you, so it
belongs in [`executors.md`](executors.md)'s *Branch and worktree* section, beside the coder and reviewer
invocations. This file says *where work lands*; that one says what to run to put it there — and it is the
only thing that may. Nothing improvises the command.

**Merging, branch deletion and worktree removal.** Nothing in this workflow merges a pull request, deletes
a branch, or removes a worktree, under any answer above. The pull request is opened and left for a human.

## What no answer here authorises

The four answers above say what the **workflow's own commands** do, at the point each one names. They are
not standing leave to use git.

**Never stage, commit, branch, create a worktree, push or open a pull request on your own initiative.**
Either an answer above covers it — this command, at this point — or the user asked for it in this session,
in plain words. There is no third source of permission.

**Permission is not inferred.** A user choosing between approaches has not authorised any of this, even
where the option text mentioned it, and *especially* where the agent wrote that option text itself. "Ship
it" is not authorisation. An approved plan is not authorisation. Neither is a production incident, however
urgent — urgency is a reason to work faster, not a reason to write history nobody asked for.

**These are never standing policy, whatever is kept above.** Each one is asked for by name, each time:

- **Force-pushing**, in any form — `--force`, `--force-with-lease`, or a push that would not fast-forward.
- **Pushing to the default branch**, unless *Push and pull request* names that branch as where work goes.
- **Rewriting published history** — rebasing, amending or resetting anything already pushed.
- **Discarding someone's work** — `git reset --hard`, `git checkout --` over a dirty file, `git clean`,
  `git stash` of changes you did not make. Uncommitted work has no second copy.

**Ask, then wait.** Naming the command you would run and getting agreement is the whole of it — the point
is that a person chose, not that they were told afterwards.

## The rules that hold either way

- **The ledger row lands with the work**, by the strongest means the substrate allows. In a tree that is
  one change; in an issue body it is the commit sha written into the row the moment the commit exists. A
  row left unwritten is a row that disagrees with the repository until someone notices.
- **`done` is a verdict about the gates, not about git.** A phase is `done` when its scope landed and both
  gates passed.
- **If this file is missing, the answer is the most conservative one** — the user commits, work lands in
  the main working tree, nothing is pushed. Say so once, and name `/onboard`.
