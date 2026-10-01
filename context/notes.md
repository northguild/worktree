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
- **Phase 6.** D7's 48-character cut applies to GitHub-derived names only. Extending it to Jira
  (`jira.ts:210`, which shares `sanitizeBranchName`) was tried and reverted at Gate 2 as unapproved scope;
  it would change a human's pre-filled Jira name. A `/roadmap` candidate if wanted.
- **Phase 6.** `commands/branch/page.mdx:69-71` contradicts itself ("Without either flag the decision is
  made in this order: 1. `--assign` or `--no-assign`").
- **Phase 6.** `branch.ts:182` cites "(D4, D8)", mixing the earlier assignment plan's numbering with this
  plan's; `utils.ts:130` says `sanitizeBranchName` keeps `[a-z0-9_-]` when `_` is collapsed to `-`.
- **Phase 6.** Plan §7 had no Phase 6 rows for `skills/core/SKILL.md` or `configuration/page.mdx`; D8 made
  both untrue and this phase fixed them.
- **Phase 7.** `runStreaming`'s timeout sends SIGTERM to the direct child only — no SIGKILL follow-up, no
  process-group kill — so a package manager that ignores TERM, or a grandchild it leaves, can outlive the
  10-minute bound and keep writing to fd 2.
- **Phase 7.** The inferred install runs the checked-out branch's lifecycle scripts (`postinstall`) by
  default on every non-interactive run, including `--source origin/<someone else's branch>`. D9's design;
  plan §8 *Security* names only "executed config values" — the trust model is worth writing down.
- **Phase 7.** `skills/core/SKILL.md` `postCreate` row ("runs by default only when non-interactive, or with
  `--install`") reads as if a set `postCreate` never runs on a terminal; D9 runs it there too.
- **Phase 7.** A relative `postCreate` (`./setup.sh`) is checked by `which` from the process cwd but runs
  with cwd = the new tree. The docs say the first word has to be on `PATH`.
- **Phase 7.** `runStreaming`'s timeout message rounds sub-second bounds to "0s" (test-only case).
- **Phase 7.** The install-failure advice "run `worktree open <branch>`" does not re-send an `--agent`
  brief on the detached path; Phase 8's handoff rework is where to revisit it. `remove -f` refuses when run
  from inside that worktree.
- **Phase 8.** The plan's Phase 8 `Files:` line omits `src/commands/checkout.ts`; editing it was necessary
  (otherwise checkout dispatches a detached agent and Herdr starts a second, against D11). `checkout --agent ""`
  is now rejected (D13), reversing the old dispatch-an-empty-prompt behaviour.
- **Phase 8.** The missing-kind `MissingValueError` (exit 2) fires after the tree is created and installed;
  it could be checked in `branch.ts` beside `readAgentBrief`, before creation.
- **Phase 8.** A user's own `--name` in `agent.command`'s tail is not removed, so `claude` gets two; which one
  wins is unverified, and `agent.name` could then differ from the real session name.
- **Phase 8.** `--agent-stdin` on a pipe that is never closed blocks indefinitely (inherent; needs the flag
  passed explicitly). Closed stdin and `/dev/null` reach EOF and are rejected as empty.
- **Phase 8.** Docs: branch page steps 6/7 put the open before the agent, but on the editor and `none` paths
  the detached agent is dispatched first; "space already open plus a brief" (warns, not delivered) is
  undocumented; the herdr-spaces guide's line 66 names only `worktree branch`, not `checkout --agent`;
  `SKILL.md`'s detached-path paragraph says "the worktree opens", untrue for `opener none`.
- **Phase 8.** `readBriefFile`'s bare `catch {}` drops the original error as `cause`
  (`typescript/error-handling.md`). One over-width line in the `resolveHerdrAgentPlan` docstring.
- **Phase 8.** Phase 7's install-failure advice note (brief not re-sent by `worktree open`) still stands;
  Phase 8 did not change it.
- **Phase 9.** Herdr fixtures in `herdr.test.ts` / `agent.test.ts` omit the `name` and `interactive_ready` keys
  live Herdr 0.9.0 carries on agents it started; Herdr-only entries are named `<kind>@<pane>` where Herdr's
  own `name` could be used.
- **Phase 9.** Docs: a Herdr-only entry with `agent_status: "done"` (turn over, pane open) gets no marker,
  against `list/page.mdx`'s "No marker — a background agent that is getting on with its work"; the same page's
  `[interactive]` = "not an agent this tool dispatched" is untrue for Herdr-started agents (predates Phase 9).
- **Phase 9.** The worktree-side realpath (`git.ts` `toWorktreeAgent`) is untested; F-022 asks for both sides.
- **Phase 9.** `git.ts` now imports `toRealPath` from `agent.ts`, deepening the pre-existing `agent.ts` ↔
  `git.ts` cycle (`architecture/dependency-boundaries.md`).
- **Phase 9.** `isHerdrInstalled` → `commandExists` runs `which herdr` with no timeout; it now sits on the
  `list --agents` and `cleanup` path. Tests use `as AgentSession` casts. A comment in `agent.ts` `joinSessions`
  has a mid-sentence line break.
- **Phase 10.** `remove.ts` throws a generic `Could not remove the worktree X.` (the cause is already swallowed
  in `gitNukeWorktree`); `remove --json` with no `<branchName>` in a repo with no worktrees returns an empty
  success, while §4 says it needs one (with worktrees present it gives `missing_value`).
- **Phase 10.** `src/lib/types.ts` now type-imports from `./base-command.js` and `./install.js` (type-only
  cycle). `github.ts:178` still uses `console.log` (unreachable under `--json`). `src/test-setup.ts` gained the
  shared `captureOutput()` helper, outside the phase's Files.
- **Phase 10.** `list --json` drops `aheadUnknownReason`; the `timeout` error code is found by matching message
  text; fire-and-forget editor/spawn failures settle after the document is printed, so they miss `warnings`.
  `issue` for Jira is `{provider:"jira",key,url}`, beyond §4's GitHub-only shape (documented).
- **Phase 11.** In `src/agent-mode.test.ts`, the `remove` and `list` cases spawn the CLI twice under one 30 s
  test bound, so a slow first run plus a hung second hits the test timeout before either 20 s kill; the temp
  `tsc` compile has no timeout of its own (the 120 s hook stops the test, not `tsc`); `mkdirSync("list-agents")`
  is not recursive, so a retry would throw EEXIST (no retries configured). The fixture repo is named
  `checkout` to dodge bug #77.
- **Phase 12.** In the manual check (stderr not a TTY), spinner success lines still carried ANSI colour
  (`\e[32m✔\e[39m Fetching GitHub issue #78`) while the progress lines were plain `- text`; and `pnpm install`'s
  own progress and boxed warning stream to stderr unfiltered. Noise for an agent reading stderr, not a defect
  in the stdout contract.
- **Phase 12.** README `## Agent mode` wording: the example pairs path `/abs/repo.worktrees/…` with session
  `demo-42-fix-login` (the code names it after the repo directory; `branch/page.mdx` has the same mismatch);
  "`agent.command`'s arguments are reused without `--bg`" omits "only when that program is the kind" and
  `--background` (also `SKILL.md`); no mention that `--jira` supplies a default name; "nothing removed is never
  a success" misses `remove --json` with no branch in a repo with no worktrees; "tokens are never printed" is
  true of `--json` only (`config <name>` prints secrets, and redaction does not cover a Jira API token).
- **Phase 12.** The README's manual-check record does not name the build that ran (`node bin/run.js` at
  cbc5552); `github.autoAssign=true` was set, so the non-interactive assign default was not exercised live
  (the spawn harness covers it). The section repeats `branch/page.mdx` by the plan's design. The `SKILL.md`
  description is ~968 of intent's 1024 characters.
