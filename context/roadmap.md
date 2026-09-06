# Roadmap

Tier 1 — the backlog. High-level by design: depth belongs in the plan document, not here.

Only `pending` and `active` entries live in this file. Finished and abandoned entries leave entirely, via
`/feature-close`, and are indexed in [`history.md`](history.md).

**An entry's status is the marker in its heading, and nowhere else.** At most one entry is `active` at a
time. There is no "active" section and no summary line — a second place to say the same thing is a second
place for it to go stale. To know what is being worked, scan for the marker.

Each entry's **Doc** field points at its document, and the path says what stage it is at: `drafts/` is
notes, `plans/` is a real plan with a phase ledger. `pending` with a `plans/` document means planned but
not being worked — that is a normal state, not a discrepancy.

Add an entry with `/roadmap "some idea"`. Turn one into a plan with `/feature-plan`. Entries look like
this, appended under **Features** below:

> ### some-feature-name — `pending`
>
> One or two lines: the problem, or what becomes possible. Not a design.
>
> - **Size:** small — what drives the size, a few words
> - **Doc:** none yet

---

## Features

### agent-mode — `active`

A worktree can be handed straight to a coding agent instead of, or as well as, an editor, and one command
shows which worktrees have an agent living in them.

- **Size:** large — three surfaces (`branch`, `list`, `cleanup`), a new config value, and a runtime-neutral
  session join that must degrade silently
- **Doc:** [`plans/AGENT-MODE-PLAN.md`](plans/AGENT-MODE-PLAN.md) — 7 phases, one of them cut; 5 open
  questions, 4 resolved

### worktree-churn-stats — `pending`

`list` says how far ahead or behind a worktree is, but not how much has actually changed in it, so there is
no way to tell a one-line fix from a rewrite without entering the directory.

- **Size:** small — one `git diff --shortstat` per worktree behind an opt-in flag, plus three fields on
  `WorktreeListEntry`
- **Doc:** none yet — cut out of `agent-mode` on 2026-09-06 as unrelated scope; its merge-base design is
  already settled in that plan's D7, and its cost concern in that plan's R4

### chat-input-multiline — `pending`

The docs chatbot's message field is a single-line `<input>`, so a longer question cannot contain newlines
and the text scrolls out of sight instead of the field growing.

- **Size:** small — one component (`ChatInput`) plus its ref type and submit key handling in `ChatForm`
- **Doc:** none yet
