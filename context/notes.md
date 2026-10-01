# Notes

Branch-local observations from the gates. Nothing reads this file; `/feature-close` deletes it.

- **Phase 1:** `docs/README.md:81` says the skill is installable with `npx skills add northguild/worktree`.
  Only the local-checkout form was run (`skills` 1.7.0 found `worktree`); the GitHub shorthand can only be
  confirmed once this is on `main`. Phase 3 documents the same command.
- **Phase 1:** `context/stack.md:58-59` has an awkward hard wrap. Cosmetic.
- **Phase 2:** the skill's agent-mode section is still loose in three small places (branch-local, not on
  `main`). `agent.name` is also `null` for Herdr kinds other than `claude` (`base-command.ts:840-841`).
  `issue.url` can be `null` (`types.ts` `BranchIssue`). `--no-open` is missing from the detached-start list
  near `SKILL.md:465`.
- **Phase 2:** the skill's `Source:` lines name docs-site paths, which an installed copy can't follow.
  They're provenance, not instructions.
- **Phase 2:** the `postCreate` row says "unset" twice. Wording only.
