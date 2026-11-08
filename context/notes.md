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

## Phase 3 — Migrate the readers

- `git.ts` `gitGetComparisonBase` keeps `defaultSourceBranch` git-only: layering it would pull `.worktree.yml` into the unpushed-work base (§2), and git → user while skipping the project file would rank the user file above it (D2). So a `defaultSourceBranch` set only in the user file never becomes that base when origin/HEAD is absent. `project-config.ts` `resolveRef` is in the same position. No phase owns it; it needs a person's call before `/feature-close`.
- `src/test-setup.ts` installs a global stand-in for `getConfigValue` (so the ~300 `vi.spyOn(config, "gitGetConfigValue")` stubs still decide). It copies the routing without the secret check or the user-file layer, and nothing pins it to the real reader; a future suite that writes a user file without `vi.unmock("./lib/config.js")` would silently get no user layer.
- Wizard `config-wizard/agent.ts`: with `agent.command` set only in the user file, pressing Enter writes `""` to git config, which the layered reader treats as unset, so the "no agent" answer does nothing. D11's wizard skip (phase 4) should remove the case.
- `trackers.ts` `*.autoAssign`/`*.autoStart` reads stay git-only while `branch.ts` reads them layered; the audit reason ("is it set in git config itself") is loose for lines that compute a select's default.
- No test checks that `verifyConfig` finds a personal key set only in the user file.
- `jira.ts` `readJiraSettings` reads sequentially only to fit `jira.test.ts`'s `mockResolvedValueOnce` order; keying that mock by argument would allow `Promise.all` back.
- Git-only reasons for the unedited files (`trackers.ts`, `written.ts`, `project-config.ts`, `context.ts`, `run.ts`) live only in the audit table, not as inline comments.
- `user-config-readers.test.ts` reaches the private `getSourceBranch` through a cast, and tests `resolveGitHubHost()` rather than a command run; driving `branch.run()` would be the stronger seam.

## Phase 4 — `config --user`, `--list` origins and the wizard

- `worktree config <key>` now prints the resolved value (git, then `.worktree.yml`, then the user file), per D7. Before, it printed git config only, so a project-file user with no user file sees new output. Only the user-file case is tested; nothing asserts the project layer there.
- The wizard's checklist pre-ticks now count project-file values too (`checklist.ts` reads every key of a listed item).
- `--names <key>` then Enter copies a file-supplied value into local git config, which then shadows later `--user` or team changes; `--list` shows it as `(user config)` while the values are equal.
- `--user` rewrites a file that parses but is otherwise invalid (e.g. holds a secret); the write keeps the bad key and every other command then exits 2.
- Write path: `mkdirSync` sits outside the `try` (an `EACCES` surfaces as a raw error, exit 1, path unescaped); the directory is not fsynced after the rename; a dangling symlink is replaced rather than written through; temp-file cleanup on failure is untested.
- `userFileValue` (`user-config.ts`) duplicates `fileSettingValue` (`config.ts`) except for joining arrays, so `--list` shows a user-file `postCreate` while `worktree config postCreate` prints nothing.
- `config.ts`'s `finally` resets only the caches this run marked unusable; an unconditional reset broke 12 `config.test.ts` tests that rely on a project cache carried between tests.
- Untested: `resolve()`'s retry reading the user layer when `.worktree.yml` is broken; checking the key before `validateConfigValue`; the wizard's user-file message omitting keys the project file also sets, and being suppressed under `--names`.
- Several assertions pin the code's own message wording (`Set <key> in <path>.`, the wizard sentence); D11 requires only which keys and why.
- `config-audit.test.ts`'s `"deferred"` `Kind` member is now unused; `config.ts` `examples` has no `--user` example.
