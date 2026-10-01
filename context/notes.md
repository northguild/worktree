# Notes

Branch-local observations from the gates. Nothing reads this file; `/feature-close` deletes it.

- **Phase 1:** the GitHub form `npx skills add northguild/worktree --skill worktree` resolves the repository
  but can only find `worktree` once this is on `main`. Only the local-checkout form has installed it.
- **Phase 2:** the skill's `Source:` lines name docs-site paths, which an installed copy can't follow.
  They're provenance, not instructions.
- **Phase 3:** the install scope (project vs `-g`) isn't mentioned. Nobody has run `-g`.
- **Phase 4:** the help tests are substring checks on `description`. With no `static summary`, oclif prints
  the first line twice in `--help`.
- **Phase 5:** `SKILL.md:467` is 86 characters wide where the paragraph wraps near 80. Cosmetic.
