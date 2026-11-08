# Notes

Branch-local review notes for #281 (user-config-file). Nothing reads this file; `/feature-close` deletes it.

## Phase 1 — Read the user file

- `user-config.ts` imports `validators.js`, which pulls `git.ts` → `config.ts` into its static graph. No cycle today, but a layered reader in `config.ts` (or anything `git.ts` imports) that imports `user-config.ts` would close `config → user-config → validators → git → config`. Moving the pure GitHub patterns/validators into a leaf module would remove the hazard.
- `GITHUB_HOST_MESSAGE` and the repository message are duplicated between `user-config.ts` and `project-config.ts`; they could sit in `config-keys.ts` beside `step`.
- The unknown-keys test pins `jira: {}` surviving once all its children are dropped; the project reader drops such a section. No source decides either.
- Untested rules: a non-ENOENT read error at the default path, the cached rejected promise, a non-mapping section (`jira: x`), and an empty `WORKTREE_USER_CONFIG` treated as unset.
- The user-file reader does not run the sync validators `isValidEmail` (`jira.email`) or `isValidAgentKind` (`herdr.agent`), nor the async program-exists checks (`codeEditor`, `agent.command`). No phase's scope names them; phase 4's writer validates through `validateConfigValue`, so only hand-edited files are affected.

## Phase 2 — Layer it into resolution

- Phase 1's Done-when grep (`git grep -n "from \"./user-config" src/lib/project-config.ts` finds nothing) now matches line 31: phase 2 imports `loadUserConfig` there. The intent (§4: user-config.ts imports nothing from project-config.ts) still holds; the plan's grep reads inverted.
- `config.ts` → `project-config.ts` is a dynamic-import back-edge (as `issue-link.ts:246` already does). Not a static cycle; madge may list it.
- `getConfigValue("postCreate")` answers git or `default` only; the project and user step lists have their own readers. A coder choice, not a plan decision.
- `{ value: string; source: ConfigValueSource }` is written out twice (`config.ts` `getConfigValue`, `project-config.ts` `resolveTeamConfig`); a named interface would do.
- No test covers a user-file step that cannot start (`install.ts`, `from !== "project" && from !== "user"`).
- The secrets "never consulted" assertions rely on namespace spies; a broken-user-file variant would show it through behaviour.
- `src/test-setup.ts` dynamically imports the real `user-config.js` to reset its cache; a suite that `vi.mock`s that module without `resetUserConfigCache` would fail loudly. The global `XDG_CONFIG_HOME` stub also reaches real-git subprocesses (git stops reading `~/.config/git/config`).
- `isRecord` in `config.ts` also accepts arrays; harmless, since a key lookup on an array yields `undefined`.
