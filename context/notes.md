# Notes

Branch-local review notes for #281 (user-config-file). Nothing reads this file; `/feature-close` deletes it.

## Phase 1 — Read the user file

- `user-config.ts` imports `validators.js`, which pulls `git.ts` → `config.ts` into its static graph. No cycle today, but a layered reader in `config.ts` (or anything `git.ts` imports) that imports `user-config.ts` would close `config → user-config → validators → git → config`. Moving the pure GitHub patterns/validators into a leaf module would remove the hazard.
- `GITHUB_HOST_MESSAGE` and the repository message are duplicated between `user-config.ts` and `project-config.ts`; they could sit in `config-keys.ts` beside `step`.
- The unknown-keys test pins `jira: {}` surviving once all its children are dropped; the project reader drops such a section. No source decides either.
- Untested rules: a non-ENOENT read error at the default path, the cached rejected promise, a non-mapping section (`jira: x`), and an empty `WORKTREE_USER_CONFIG` treated as unset.
- The user-file reader does not run the sync validators `isValidEmail` (`jira.email`) or `isValidAgentKind` (`herdr.agent`), nor the async program-exists checks (`codeEditor`, `agent.command`). No phase's scope names them; phase 4's writer validates through `validateConfigValue`, so only hand-edited files are affected.
