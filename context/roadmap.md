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

### herdr-space-opener — `active`

Worktrees always open in a code editor. Someone who works in Herdr wants a new worktree to land as a new
Herdr space instead, without giving up the Jira/GitHub branch naming and env-file copying that creates it.

- **Size:** medium — one integration module, a config key, and the opener seam shared by three commands
- **Doc:** [`plans/HERDR-SPACE-OPENER-PLAN.md`](plans/HERDR-SPACE-OPENER-PLAN.md) — plan, built on the captured Herdr 0.8.2 API notes
