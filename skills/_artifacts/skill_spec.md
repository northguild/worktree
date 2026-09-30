# @northguild/worktree — Skill Spec

`@northguild/worktree` is a workflow-oriented CLI that wraps `git worktree`
commands into a small set of repeatable daily-use tasks. It handles the
boilerplate of branching, directory creation, env file copying, and editor
opening so developers don't have to type the same sequences repeatedly.

## Domains

| Domain | Description | Skills |
|---|---|---|
| setting up and configuring | First-time install, git config defaults, third-party auth | core |
| daily worktree workflow | Creating, opening, navigating worktrees | core |
| housekeeping | Listing, removing, cleaning up stale worktrees | core |

> Single-skill library — all domains converge into one `core` skill because
> a developer working on any feature needs the full surface (setup + use + cleanup).

## Skill Inventory

| Skill | Type | Domain | What it covers | Failure modes |
|---|---|---|---|---|
| core | core | workflow | All 7 commands, 9 config keys, GitHub + Jira integrations, env copying, branch validation | 6 |

## Failure Mode Inventory

### core (6 failure modes)

| # | Mistake | Priority | Source | Cross-skill? |
|---|---|---|---|---|
| 1 | Using checkout to create a new branch | CRITICAL | docs/commands | — |
| 2 | Running outside a git repository | HIGH | src/lib/git.ts | — |
| 3 | Skipping config before first use | HIGH | README, docs/getting-started | — |
| 4 | --source without origin/ prefix (non-interactive exit 2) | MEDIUM | src/commands/branch.ts | — |
| 5 | Partial Jira config (all 3 keys required) | HIGH | docs/guides/jira-integration | — |
| 6 | Branch prefix value missing trailing slash | MEDIUM | docs/configuration | — |

## Tensions

| Tension | Skills | Agent implication |
|---|---|---|
| Interactive prompts vs scripted/agent use | core | Agents must supply explicit flags; a non-interactive run takes a prompt's default or exits 2 naming the flag it needs |

## Cross-References

None (single-skill library).

## Subsystems & Reference Candidates

| Skill | Subsystems | Reference candidates |
|---|---|---|
| core | GitHub integration, Jira integration | — |

## Remaining Gaps

None — all gaps resolved from source code and docs.

## Recommended Skill File Structure

- **Core skills:** `skills/core/SKILL.md` — one file covering the full surface
- **Framework skills:** none (CLI tool, no framework adapters)
- **Lifecycle skills:** none needed (setup covered inside core)
- **Composition skills:** none needed (GitHub/Jira covered inside core)
- **Reference files:** none needed (API surface is small)

## Composition Opportunities

| Library | Integration points | Composition skill needed? |
|---|---|---|
| GitHub CLI (`gh`) | Auth token fallback for `--github` flag | No — documented inside core |
| Jira API | Branch naming via `--jira` flag | No — documented inside core |
