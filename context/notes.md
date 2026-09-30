# Notes — feature/70-headless-agent-mode

Branch-local, advisory, read by nothing. `/feature-close` deletes this file.

- **Phase 1.** `BaseCommand.catch` reads only `error.oclif.exit`, not `CommandError.exitCode`, which oclif's
  own `catch` also honours. Harmless today (nothing sets `exitCode`); an error class meant to exit non-1
  has to carry `oclif.exit`.
- **Phase 1.** `this.exit(n)` would now print `Error: EEXIT: n` on stderr (it printed the same on stdout
  before). No caller exists.
- **Phase 1.** The `console.error` / `console.log` spies in `base-command.test.ts` are never restored;
  `vi.clearAllMocks()` keeps the silencing for the rest of that file. Same pattern as `config.test.ts`.
- **Phase 1.** `dispatchAgent`'s `onError` (`base-command.ts:379`) still writes `Error: …` to stdout — a
  fire-and-forget spawn failure outside `catch`.
- **Phase 2.** The `--non-interactive` / `--yes` help text (`base-command.ts:77,81`) describes Phase 3's
  behaviour; until Phase 3 lands, `remove -y` still prompts. Phase 3 has to make that text true.
- **Phase 2.** `interaction.ts` holds the mode as module state (one writer, `init()`), which
  `philosophy/maintainability.md` would query; accepted because the git/env helpers have no command to ask.
- **Phase 2.** The flags `init()` reads come back from an options-less `this.parse()` typed `any`;
  harmless at runtime (`=== true`), unchecked by the types.
- **Phase 2.** Untested: the cli-progress bar being skipped when progress is disabled, and `config -y`
  leaving the mode interactive.
- **Phase 2.** Intended, visible: stdin piped with a TTY stderr now gets plain `- text` lines, and `-y` on a
  TTY gets no removal progress bar.
- **Phase 3.** Visible by design (R4, Q4 accepted): `worktree config --names …` run by a human without
  `--yes` no longer asks the group confirm it asked at 6269ebe. Worth a line in the PR description.
- **Phase 3.** A non-interactive `config` prints the Jira / GitHub token instructions to stdout before it
  exits 2 (`github.ts` avoids this with `assertCanPrompt`; `config.ts` does not). Fix before close — Phase 10's
  stdout contract makes it matter.
- **Phase 3.** A non-interactive `config --names github.token` with nothing stored exits 2, although the
  interactive empty answer ("let `gh auth token` supply one") is valid and writes nothing.
- **Phase 3.** `docs/.../commands/config/page.mdx:18` lists `worktree config --yes` as a usage line; bare
  `--yes` always exits 2 (the Jira group has no default without `--names`).
- **Phase 3.** `config.test.ts` parse mocks still pass `yes: false` (e.g. :1116), a flag `Config.flags` no
  longer declares; the "declined" tests assert less tightly than their titles say.
- **Phase 3.** `src/test-setup.ts` gained `setNonInteractive(false)` in the global `beforeEach` — outside
  Phase 3's Files line, needed because vitest's stdin is not a TTY.
- **Phase 3.** Non-interactive coverage is per representative, not per site (no test for `jira.host` /
  `jira.apiToken`, three of the four `git.ts` removal confirms, or the branch-name fallback's validator path).
- **Phase 4.** The fetch timeout wraps `fetch()` only; `response.text()` / `.json()` sit outside the try, so
  a body that stalls after the headers is still aborted by the same signal but surfaces as the raw
  "The operation was aborted due to timeout" rather than the named message.
- **Phase 4.** `execFile`'s `timeout` sends SIGTERM with no SIGKILL escalation — a child that ignores TERM
  runs on (probed). Real git honours it; a user-chosen `agent.command` might not.
- **Phase 4.** `GIT_TERMINAL_PROMPT=0` does not silence SSH: a passphrase or host-key prompt reads
  `/dev/tty`, so a non-interactive run with a controlling terminal can sit there until the 60 s bound.
- **Phase 4.** `cli.ts:10-12` comment ("unbounded, which is what every git call here wants") is now
  slightly stale — `git fetch` sets a timeout.
- **Phase 5.** `worktree open` with `opener=none` prints "Worktree created at <path>" for a worktree that
  already existed (`base-command.ts:171`) — same shape as the older editor-unset line. Fits Phase 8's
  outcome-returning `openWorktreePath`.
- **Phase 5.** Stale comments: `base-command.ts:434-435` and `base-command.test.ts:300-301` still say
  `config <name>` "discards the result (config.ts:273-274)"; it now prints the value.
- **Phase 5.** "should store opener none" in `config.test.ts` runs under the still-active
  `validateConfigValue` stub, so it never hits the real validator (`validators.test.ts` covers `none`).
- **Phase 5.** The `opener=none` path line goes to stdout; Phase 10's `branch --json` has to route it.
- **Phase 5.** `guides/editor-integration/page.mdx:55-58` mentions only `herdr` as an alternative to an
  editor — incomplete, not untrue.
