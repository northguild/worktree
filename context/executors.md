# Executors

How this project dispatches a **coder** and a **reviewer**. Hand-written prose, read fresh at dispatch
time — the exact parallel to [`verify.md`](verify.md), and for the same reason: a skill that hardcodes an
invocation bakes one machine's setup into a tool that ships everywhere.

Configured by `/onboard` on 2026-09-05. The **Worktree operations** section below was added on
2026-09-09, when [`git.md`](git.md) took the worktree-per-feature answer.

## Coder

**Not configured — implement in-host.**

This is a deliberate choice, not a gap. The host implements directly; no external coder CLI is dispatched,
so the repository-read test in `/onboard` Step 2 does not apply and no invocation is recorded here.

`codex` and `cursor-agent` are both present on the maintainer's machine and were considered. If either is
adopted later, write its exact invocation here along with any directory or permission scoping, test that it
can read this repository unaided before trusting it, and record the result of that test — the standing
rules below say why the answer changes how briefs are written. Its system prompt is
[`roles/coder.md`](roles/coder.md).

## Reviewer

**The bundled `reviewer` subagent, dispatched with the Agent tool.**

```
Agent(subagent_type: "reviewer", …)
```

Its definition is [`.claude/agents/reviewer.agent.md`](../.claude/agents/reviewer.agent.md) — tool-owned,
replaced on update. It runs with `Read, Grep, Glob, Bash` only, gathers evidence before forming a verdict,
and emits `PASS | PASS WITH NOTES | FAIL` with a `P0`–`P3` severity on every blocking finding. That is the
Gate 2 contract's shape exactly, so nothing has to be mapped or translated at the gate.

Give it the implementation output, the plan's review checklist, and the verification result. It does not
re-run verification and it does not fix anything.

Two alternatives were considered and rejected on 2026-09-05:

- **`/code-review`** reports findings by category (`correctness`, `simplification`) rather than `P0`–`P3`,
  which would put an undefined translation step inside the gate. Its `ultra` level runs in the cloud, is
  user-triggered and billed, and **cannot be launched by the host** — so it can never serve as the Gate 2
  executor. It remains useful when a human wants a deeper look; it is not the gate.
- **The host reviewing its own diff** is the fallback if the subagent is ever unavailable. It is weaker
  than an independent reviewer, and any gate run that falls back to it must say so.

## Worktree operations

[`git.md`](git.md) says work lands in a worktree per feature and that the agent commits and pushes. The
invocations that carry that out live here, for the same reason the reviewer's does — a skill that hardcodes
one machine's setup ships it everywhere.

**This project is the tool being invoked.** Verified on 2026-09-09: `worktree` resolves to
`/opt/homebrew/bin/worktree`, reporting `@northguild/worktree/1.5.0`, which is the **published** build and
not this checkout's `dist/`. That is deliberate and worth keeping — a working tree mid-refactor must not
cost you the ability to create the next worktree. It also means the tree-creating tool can lag the source
by a release, so **never assume a flag you just added to `src/` exists in the binary that makes the tree.**

### Create a worktree for a feature

```bash
worktree branch <branch-name> --source origin/main
```

It creates the tree, copies the root's `.env` files into it, and then hands it to the configured opener.
Two consequences for an agent using it:

- **It is interactive.** With no `--source` it prompts, and it confirms a non-`origin/` source. Give
  `--source` explicitly so the run does not block on a prompt that has no TTY behind it.
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
always did. What comes back per worktree is a session name and pid, and markers for live, interactive and
waiting.

**A missing marker is not proof of absence.** `WorktreeAgent.live` is optional and the codebase's own
safety check treats an absent value as live (`!== false`), which is the direction that fails safe. Read it
the same way: no answer means assume someone is working there.

## The contract, whatever is configured

A review happens, it returns a verdict with a `P0`–`P3` severity on every blocking finding, and a `FAIL`
writes a finding to [`findings.md`](findings.md) **before** the loopback.

## Standing rules for any external executor

- **Exit code alone proves nothing.** A CLI can exit 0 after hitting a usage limit mid-run, having
  completed most but not provably all of a brief. Grep the captured output for exhaustion and error
  markers before trusting a summary, and on a hit check `git status` and each acceptance criterion
  individually.
- **Take the model from the CLI's own config**, not from a flag written here. A hardcoded model flag is one
  more place to update when models turn over, and a rejected model can still exit 0 having written nothing.
- **No blanket permission-bypass flag.** Scope permissions in the CLI's own config instead. A standing
  bypass-everything instruction in a committed file is persistent privilege escalation.
- **Assume the executor can read this repository** unless you have tested otherwise. Briefs cite paths;
  they do not paste file contents. If an executor genuinely has no filesystem access, say so here — that is
  the one case where a brief has to carry content inline.
