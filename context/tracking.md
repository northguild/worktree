# Tracking

Where the backlog, the plans and the phase ledgers live. **Every command reads this file before it reads or
writes any workflow state** — it is what keeps a different tracker a rewrite of this one file rather than of
every skill. No skill names a tracker.

Configured by `/onboard` on 2026-09-09, when `@baldurpan/create-ai-workflow` 0.8.0 introduced this file.

## The answer

**In an issue tracker: GitHub issues in `northguild/worktree`.**

Confirmed against the remote on 2026-09-09 — `origin` is `git@github.com:northguild/worktree.git`.

This answer exists for **several agents working several features at once**, which is what
[`git.md`](git.md)'s worktree-per-feature answer makes possible. A worktree carries only what its ref
holds, so a plan committed on one branch is invisible to every other tree; the tracker sits outside all of
them and every tree can reach it.

## How each tier is read

**The tier model is identical to the working-tree answer.** Only where a fact is read changes.

| To know | Read |
|---|---|
| the backlog | open issues labelled `workflow:feature` |
| whether a feature has a plan | whether its issue body holds one |
| whether a feature is being worked | whether a worktree exists for it — `git worktree list`, per [`git.md`](git.md) |
| where a phase stands | its sub-issue: open and unassigned, open and assigned, `workflow:blocked`, or closed |
| what a retired feature's outcome was | the closed issue |

The phase vocabulary maps as follows. Spell the phase words exactly as
[`workflow.md`](workflow.md) does when they appear in prose:

| Phase status | In the tracker |
|---|---|
| `not started` | sub-issue open, no assignee |
| `in progress` | sub-issue open, assigned |
| `blocked` | sub-issue open, `workflow:blocked` |
| `done` | sub-issue closed |

**A phase closes its sub-issue through `Closes #N` in the commit**, which only fires once the branch
reaches the default branch — which is why this answer requires [`git.md`](git.md)'s push-and-pull-request
answer, and cannot be held alongside "neither".

## Labels

Two, both created by `/onboard` on 2026-09-09 — neither existed before:

| Label | Colour | Means |
|---|---|---|
| `workflow:feature` | `#1D76DB` | a planning-workflow feature: an issue whose phases are sub-issues |
| `workflow:blocked` | `#B60205` | a phase held up by an open finding or a dependency |

**`feature` here is [`workflow.md`](workflow.md)'s word** — work you would want a history row for — and not
a claim that the issue is not a bug. A bugfix worked through this loop carries `workflow:feature` too.

The repository's nine existing labels were listed before these were created: GitHub's defaults, including
`enhancement`, which is exactly why these two are namespaced. Nothing collided.

## What the workflow will not touch

**This project's own labels, its Projects, and its milestones.** Nothing in the loop reads or writes any of
them, so a board or a release milestone can be used alongside this workflow without interference. The two
`workflow:*` labels above are the whole of its footprint.

Nothing here merges a pull request, deletes a branch, or removes a worktree either — see
[`git.md`](git.md).

## Sub-issues go through `gh api`, not `gh issue`

`gh` 2.87.3 has no sub-issue subcommand and no `--parent` flag on `gh issue create`. Sub-issues are reached
through the REST API:

```bash
# POST /repos/{owner}/{repo}/issues/{parent_number}/sub_issues
gh api repos/northguild/worktree/issues/<parent_number>/sub_issues -f sub_issue_id=<id>
```

**`sub_issue_id` is the issue's database id, not its number.** This is the trap in the endpoint: everything
else in `gh` speaks in issue numbers. Get the id with

```bash
gh api repos/northguild/worktree/issues/<number> --jq .id
```

`GET .../sub_issues` lists them back. Both endpoints were verified against docs.github.com on 2026-09-09;
**neither has been exercised against this repository yet**, so the first `/feature-plan` under this answer
is the real test. The docs also warn about secondary rate limiting when creating sub-issues rapidly — add
them one at a time rather than in a burst.

## The migration, and what is left in the tree

**`context/roadmap.md` is gone.** All four of its entries were migrated to issues on 2026-09-09 and the
file was removed — under this answer the backlog is the tracker, and a second copy in the tree is the
drift this workflow exists to prevent.

| Issue | Feature | State on migration |
|---|---|---|
| [#39](https://github.com/northguild/worktree/issues/39) | `worktree-churn-stats` | backlog |
| [#40](https://github.com/northguild/worktree/issues/40) | `chat-input-multiline` | backlog |
| [#41](https://github.com/northguild/worktree/issues/41) | `github-issue-auto-assign` | backlog; its draft is now a comment on the issue |
| [#42](https://github.com/northguild/worktree/issues/42) | `herdr-space-opener` | **all seven phases `done`** — awaiting `/feature-close` |

None had sub-issues created: the three backlog entries have no plan and therefore no phases, and #42's
phases were already finished, so its ledger is history rather than state to track.

**`context/history.md` and `context/drafts/` are gone too.** The three history rows became closed issues
on 2026-09-09, and the one draft became a comment on its own issue:

| Issue | Feature | Outcome |
|---|---|---|
| [#43](https://github.com/northguild/worktree/issues/43) | `cleanup-data-loss` | shipped 2026-09-05, closed |
| [#44](https://github.com/northguild/worktree/issues/44) | `shell-argv-safety` | shipped 2026-09-06, closed |
| [#45](https://github.com/northguild/worktree/issues/45) | `agent-mode` | shipped 2026-09-06, closed |

**`context/archive/` stays, and that is the deliberate half of the split.** `history.md` always described
itself as indexing depth rather than duplicating it — the reasoning stays in the archived plan document.
Closed issues are a better index than a table that conflicts on every merge; they are a worse home for
30–50KB of decision records. So the index moved and the depth did not. Each closed issue links to its
archived plan, [`findings.md`](findings.md) still links into `archive/`, and a clone of this repository
still contains its own engineering history.

### Where a plan lives

**In the issue.** A plan's prose is the feature issue's body, and its phases are sub-issues — that is the
whole of the phase ledger under this answer. `plans/` is not written to.

This corrects what this file said when it was first written on 2026-09-09, which was that `/feature-plan`
would go on writing `plans/<NAME>-PLAN.md` with the issue pointing at it. That is wrong, and wrong in the
way this answer exists to prevent: **a plan committed on one branch is invisible to every other worktree**,
so a plan in the tree cannot be the shared home that several agents in several trees all read.

One document outlives that rule: `plans/HERDR-SPACE-OPENER-PLAN.md`, the record of
[#42](https://github.com/northguild/worktree/issues/42), whose seven phases were finished before the switch.
`/feature-close` moves it into `archive/` and closes the issue. After that, `plans/` is empty and can go.

**Two open issues predate the workflow and are outside it** —
[#21](https://github.com/northguild/worktree/issues/21) (Gitlab support) and
[#22](https://github.com/northguild/worktree/issues/22) (Bitbucket support). Neither carries
`workflow:feature`, which is deliberate: the backlog this workflow reads is the labelled set, so these stay
ordinary issues until someone labels them.

**`findings.md` stays under both answers**, unchanged. A finding is raised and swept inside a single
branch's life, so it is never the thing two agents contend over.
