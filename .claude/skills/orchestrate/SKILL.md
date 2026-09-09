---
name: orchestrate
description: "Run one ad-hoc, commit-sized change through the same verification and review gates the feature loop uses, without a roadmap entry or a phase ledger. Explicit invocation only — run this when the user types /orchestrate. Do NOT match on 'build X', 'implement X', 'orchestrate the work', or any request that belongs to a planned feature."
disable-model-invocation: true
---

# /orchestrate

A gated one-shot pass over a scope you name. No roadmap entry, no ledger, **no tier boundary crossed.**

It exists because the valuable part of the loop is the **gate machinery** — Gate 1 reading `verify.md`,
Gate 2's reviewer, failures landing in `findings.md` before the loopback — and that is worth having for
unplanned work too, arguably most of all, since that is where fixes get cowboyed. Without it, the only
route to a verified, reviewed change is to file a roadmap entry, and people will route around the workflow
for small things.

Read [`context/workflow.md`](../../../context/workflow.md) for the gate contract and the feature/task rule.

## Usage

```
/orchestrate "<what to do>"
```

## 0. Sweep first

Move every **closed** finding tied to `ad-hoc` out of `context/findings.md`. Those belong to no feature, so
nothing else would ever retire them and the file would grow forever. Say what you swept.

## 1. Refuse, before anything else

Two guards, or this becomes the way to skip planning:

1. **Refuse anything that is not commit-sized.** A commit-sized unit has one checkable outcome. A category
   of activity ("add tests", "improve error handling", "refactor the API layer") is not one. Say what the
   scope would need to be split into, and name `/roadmap`.
2. **Refuse anything an existing roadmap entry already covers.** Read `context/roadmap.md` and check. If
   one covers it, say which, and name `/feature-plan` and `/feature-implement`.

Apply the standing test from [`context/workflow.md`](../../../context/workflow.md): *if you would want a
`history.md` row for it, it is a feature.* Ask that question out loud and answer it before proceeding.

A refusal here is the workflow working.

## 2. Do the work

Read `context/stack.md` and load `context/standards/README.md` per its conditional table.

**Check that file's Documentation section, and the tree if it is empty.** If this change makes something
there wrong — a README, a docs page, a changelog, help text in the code — the fix is part of this change,
per the standing rule in [`context/workflow.md`](../../../context/workflow.md). A one-shot change is where
that gets skipped most, because there is no plan holding the row.

Delegate to a coder per [`context/executors.md`](../../../context/executors.md) if one is configured;
otherwise implement in-host. The coder's system prompt is
[`context/roles/coder.md`](../../../context/roles/coder.md). The brief **cites paths, it does not paste
files.** Describe what needs to happen, never how to code it.

## 3. Gate 1 — verification

Read [`context/verify.md`](../../../context/verify.md) and run its sections in order: Lint → Typecheck →
Build → Test. **Never carry a copy of these commands here and never invent one.** A missing section is
skipped and said so, never faked. Exit 0 is the verdict regardless of summary text. If `verify.md` does not
exist or has no filled-in section, stop and say so. Docs-only changes run Lint plus a read of the diff.

## 4. Gate 2 — review

Dispatch per [`context/executors.md`](../../../context/executors.md) — an external reviewer, a **reviewer
subagent if your runtime provides one**, or the host reading its own diff. The last is the default and the
weakest, so **say which one you ran.** Where the runtime has no subagent mechanism, review the diff
yourself against the standards and say that is what happened.

Require concrete evidence — file paths, command output — for every verdict, and a `P0`–`P3` severity on
every blocking finding.

- `PASS` or `PASS WITH NOTES` → done.
- `FAIL` → **write it to [`context/findings.md`](../../../context/findings.md) first, then** loop back.

Findings raised here are recorded with **`Tied to: ad-hoc`**.

## 5. Loopback

Cap: **two loops per gate.** Re-brief with the prior implementation and the validator's feedback
**verbatim**, plus the instruction to address only the failing items, refactor nothing that passes, and
expand no scope.

At the cap: write a finding (`P1` for a Gate 1 cap-out), then escalate with the current state and the last
feedback. **Escalating is not a substitute for recording.**

## 6. Land it — read [`context/git.md`](../../../context/git.md)

**Do not commit unless that file says the agent does.** If it does not exist, the answer is *the user
commits*: say so once, and name `/onboard`.

**Nothing here branches or pushes**, whatever *Where work lands* and *Push and pull request* say. Both of
those answers are about a feature — one branch or tree per entry, one push at `/feature-close` — and an
ad-hoc change has no entry and no feature to close. It lands on whatever branch is already checked out.

- **The user commits** → leave the change in the working tree and hand it over.
- **The agent commits** → one commit, at the granularity that file names.

## 7. Report

What changed, whether it is committed or waiting in the tree, the Gate 1 output, the Gate 2 verdict, any
loopbacks, and any findings written, closed or swept — by id.

## Rules

- **No ledger row is touched.** This command has no phase and does not belong to a feature.
- **No roadmap entry is created, activated or retired.** If the work turns out to be a feature, stop and
  say so; the user runs `/roadmap`.
- **Never skip Gate 1 to save time.** The gates are the entire reason this command exists.
