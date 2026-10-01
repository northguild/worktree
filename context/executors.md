# Executors

How this project dispatches a **coder** and a **reviewer**, and how it creates a **branch or worktree**.
Hand-written prose, read fresh at dispatch time — the exact parallel to [`verify.md`](verify.md), and for
the same reason: a skill that hardcodes an invocation bakes one machine's setup into a tool that ships
everywhere.

Configured by `/onboard` on 2026-09-05. The **Branch and worktree** section below was added on 2026-09-09,
when [`git.md`](git.md) took the worktree-per-feature answer, under the title *Worktree operations*.
`/onboard` renamed it on 2026-09-30 under `@baldurpan/create-ai-workflow` 0.22.0, whose
`/feature-implement` looks the section up by that name, and added the removal command and the
no-improvising rule.

What each section takes, and the alternative answers written out, are in
[`executors.notes.md`](executors.notes.md).

## Coder

**A subagent, briefed with [`roles/coder.md`](roles/coder.md), on `sonnet` where this runtime lets you
choose a subagent's model — otherwise implement in-host.** The phase's implementation runs in its own
context and returns that file's output contract; the ledger and the gates stay with the caller. A runtime
with no subagent mechanism reads this answer, implements in-host, and says so.

What this buys is a smaller caller, not better code: on a long plan the alternative is one context window
carrying every file read of every phase. No external coder CLI is dispatched, so there is no invocation to
record and no repository-read test to run — the brief is a file already in this repository.

*Set on 2026-09-30 by the maintainer, replacing the in-host answer recorded on 2026-09-05.*

## Reviewer

**The bundled `reviewer` subagent, dispatched with the Agent tool.**

```
Agent(subagent_type: "reviewer", …)
```

Its definition is [`.claude/agents/reviewer.agent.md`](../.claude/agents/reviewer.agent.md) — tool-owned,
replaced on update. It runs with `Read, Grep, Glob, Bash` only, gathers evidence before forming a verdict,
and emits `PASS | PASS WITH NOTES | FAIL` with every item marked blocking or non-blocking. That is the
Gate 2 contract's shape exactly, so nothing has to be mapped or translated at the gate.

*Until 0.22.0 the verdict carried a `P0`–`P3` severity on every blocking finding, and a `FAIL` was written
to `findings.md` first. Both are gone from the workflow — there is one bit, blocking or not, and where a
blocking item ends is [`workflow.md`](workflow.md)'s table, not a file. The answer here did not change.*

Give it the implementation output, the plan's review checklist, and the verification result. It does not
re-run verification and it does not fix anything.

Two alternatives were considered and rejected on 2026-09-05:

- **`/code-review`** reports findings by category (`correctness`, `simplification`) rather than marking
  each one blocking or not, which would put an undefined translation step inside the gate. Its `ultra` level runs in the cloud, is
  user-triggered and billed, and **cannot be launched by the host** — so it can never serve as the Gate 2
  executor. It remains useful when a human wants a deeper look; it is not the gate.
- **The host reviewing its own diff** is the fallback if the subagent is ever unavailable. It is weaker
  than an independent reviewer, and any gate run that falls back to it must say so.

## Branch and worktree

[`git.md`](git.md) says work lands in a worktree per feature and that the agent commits and pushes. The
invocations that carry that out live here, for the same reason the reviewer's does — a skill that hardcodes
one machine's setup ships it everywhere.

**This project is the tool being invoked, and the `worktree` on your `PATH` is not this checkout.** It is
the published package — `npm install -g @northguild/worktree`, per the README — and never this working
tree's `dist/`. That is deliberate and worth keeping: a working tree mid-refactor must not cost you the
ability to create the next worktree.

The consequence is that **the tree-creating binary can lag the source by a release**, so never assume a
flag you just added to `src/` exists in the binary that makes the tree. Check rather than assume:

```bash
worktree --version                             # what will actually make the tree
node -p "require('./package.json').version"    # what this checkout is
```

Where the binary is behind, `npx @northguild/worktree@latest branch …` runs the published latest. That is
the whole of the fallback — see *This section is the only way one gets made* below.

**This file names no install path, deliberately.** The binary lands in the global bin directory of
whichever Node install you have — a Homebrew prefix, nvm, pnpm, a system Node — so a path recorded here
would be one contributor's machine shipped to everyone, which is what the paragraph opening this section
refuses. Do not read a matching version as reassurance either: on 2026-09-09 the binary and this checkout
both read 1.5.0, which was a coincidence of timing and not the binary tracking the source.

### Create a worktree for a feature

```bash
worktree branch <branch-name> --source origin/main
```

It creates the tree, copies every gitignored env-shaped file from the root into it, and then hands it to
the configured opener.
Two consequences for an agent using it:

- **It prompts only for a human.** With no TTY (or `CI`, `--non-interactive`, `--yes`) it never prompts: a
  non-`origin/` `--source` exits 2 naming `--source origin/<branch>`, and with no `--source` it uses
  `defaultSourceBranch`, else `origin/main`. Give `--source origin/<branch>` explicitly.
- **It opens an editor or a Herdr space as its last act**, per the `opener` config key. That is a side
  effect on the user's desktop, not a failure.

`worktree branch --github <n>` derives the branch name from a GitHub issue, which is the natural form under
[`tracking.md`](tracking.md)'s issue-tracker answer.

### Ask whether an agent session is live in a tree

```bash
worktree list --agents
```

`/feature-status` reports this where it can and says it cannot tell where it cannot; here it can. The flag
is opt-in precisely because the session lookup costs something — without it the command costs what it
always did. Sessions are found from two sources joined on the real path of their directory: `herdr agent
list` when `herdr` is on PATH, and the runtime's `<program> agents --json`, where the program is
`agent.command`'s head or else `herdr.agent`. So a repository with only `herdr.agent` set is covered, and a
Herdr entry is named by the runtime session it matches. What comes back per worktree is a session name
(a pid only where the runtime has one), and markers for live, interactive, waiting and `[done]` (a runtime-finished session that Herdr still shows in a pane stays live). With
neither source available the answer is no sessions, not an error — which is "no answer", not "nobody is
there"; see the next paragraph.

**A missing marker is not proof of absence.** `WorktreeAgent.live` is optional and the codebase's own
safety check treats an absent value as live (`!== false`), which is the direction that fails safe. Read it
the same way: no answer means assume someone is working there.

### Remove a worktree

```bash
worktree remove <branch-name>
```

**Nothing in this workflow removes a worktree** — [`git.md`](git.md) says so under every answer. This is
the command that runs where a person asks for one to go. It always confirms, naming what is at risk
where it can — unmerged commits ahead of the source, an ahead count it could not take, uncommitted
changes — and it closes the tree's Herdr space once the checkout is actually gone. **It deletes the local
branch too** (`git branch -D`, `src/lib/git.ts` `gitRemoveWorktree`), so it is a branch deletion as well
as a tree removal. `-f` skips the confirmation, and is asked for by name, never added to get past a
prompt. With no TTY it does not prompt and exits 2 naming `-f`.

### This section is the only way one gets made

**Never run a bare `git worktree add`, `git branch` or `git checkout -b` because a command here is
unavailable or behind.** A tree made by hand skips everything `worktree branch` does around it — the env
files it copies, the naming, the directory it puts the tree in, the opener it hands the tree to. It looks
like a worktree and is missing the half that made this answer worth choosing. Where neither the binary
nor `npx … @latest` can run, stop and say so.

Removal is the same: a tree goes through `worktree remove`, not `git worktree remove`, so its Herdr space
is closed with it.

*Until 2026-09-30 this file offered `git worktree add` as a by-hand fallback. It was dropped by `/onboard`
on that date, on the maintainer's answer, when 0.22.0's stub named it as the one command never to
improvise.*

## The contract, whatever is configured

A review happens, it returns a verdict, and every item in it is marked blocking or not. A `FAIL` is looped
back on, and a gate at its cap leaves the phase `blocked` with the reason in its ledger row.

## Standing rules for any external executor

- **Exit code alone proves nothing.** A CLI can exit 0 after hitting a usage limit mid-run, having
  completed most but not provably all of a brief. Grep the captured output for exhaustion and error
  markers before trusting a summary, and on a hit check `git status` and each acceptance criterion
  individually.
- **Take the model from the CLI's own config**, not from a flag written here. A hardcoded model flag is one
  more place to update when models turn over, and a rejected model can still exit 0 having written nothing.
  **A subagent is the exception**: it has no config of its own, so its tier is written in the Coder answer
  above — as an alias the runtime resolves, never a dated model id.
- **No blanket permission-bypass flag.** Scope permissions in the CLI's own config instead. A standing
  bypass-everything instruction in a committed file is persistent privilege escalation.
- **Assume the executor can read this repository** unless you have tested otherwise. Briefs cite paths;
  they do not paste file contents. If an executor genuinely has no filesystem access, say so here — that is
  the one case where a brief has to carry content inline.
