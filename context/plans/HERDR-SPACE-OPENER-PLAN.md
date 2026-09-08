# Herdr Space Opener Plan

Written 2026-09-07. Makes a newly created or selected worktree land as a Herdr space instead of an editor window, without touching the Jira/GitHub naming and env-file copying that produce it. The `herdr-space-opener` entry in [`../roadmap.md`](../roadmap.md) is where this feature's status lives.

**Phase status lives in §6.1 of this document, and nowhere else.**

---

## 1. Why

Every path that produces a worktree ends in the same call, and that call can only launch an editor.

`openWorktreePath` (`src/lib/base-command.ts:51-66`) reads one config value, `codeEditor`, and runs
``exec(`${codeEditor} ${path}`)``; when the value is unset it logs the path and stops. Three commands call it, and in all three it is the last statement of `run()` — `src/commands/branch.ts:184` (after `gitCreateWorktree` and `copyEnvFilesFromRootPath`), `src/commands/checkout.ts:71`, `src/commands/open.ts:46`. Everything valuable about this CLI happens before that line; the line itself is a single hardcoded destination.

A maintainer who works in Herdr — a terminal workspace manager whose "spaces" are used the way an editor uses windows — has no supported way to say "put it there". The only thing that works today is an abuse of the editor key:

```bash
git config northguild.worktree.codeEditor "herdr worktree open --focus --path"
```

This works solely because `exec` appends the path and `--path` happens to be the trailing flag, and because `commandExists` (`src/lib/cli.ts:27-39`) validates only `value.split(" ")[0]`, so the multi-word value passes `isValidCommand` (`src/lib/validators.ts:8-13`, dispatched at `validators.ts:66`) by accident. It cannot pass `--label`, cannot read the response, and cannot tell whether the space already existed. It is evidence that the seam is in the right place, not a design.

The cost of not passing `--label` is measurable. Running `herdr worktree list --cwd /Users/baldur/Development/northguild/worktree/worktree` against the live server returns both this repo's checkouts with `"label": "worktree"` — the main checkout and `worktree.worktrees/feature/add-agent-mode` are indistinguishable in the sidebar. Every space this repo produced would carry the repo's name, not the branch's.

Two more facts make this the right moment. `openWorktreePath` interpolates an unquoted path into a shell string, so any worktree under a directory containing a space fails to open at all — a defect independent of Herdr that a second opener must not inherit. And the integration has a place to live already: `src/integrations/github.ts` and `src/integrations/jira.ts` are plain named-export modules over `cmd`/`commandExists` plus git config, with no framework and no base class.

## 2. Constraints

- **Non-Herdr users must see no change.** With the new key unset, `openWorktreePath` must behave exactly as it does today for both branches of `src/lib/base-command.ts:54-65`.
- **The interim workaround must keep working.** Multi-word `codeEditor` values already exist in the wild precisely because `src/lib/cli.ts:30` only checks the first token. A change that treats the whole value as one executable is a regression.
- **The creation path is not negotiable.** Herdr's own `worktree create` creates the git worktree; this repo's `gitCreateWorktree` (`src/lib/git.ts:217-250`) is where branch naming and the `.worktrees/` layout live. Only `worktree open`, which adopts a worktree already on disk, is in scope.
- **No new runtime dependency.** `package.json` `dependencies` is nine packages, none of them an HTTP or socket client. `context/standards/tooling/dependencies.md` — "Prefer browser-native or runtime-native APIs when they exist"; "Every dependency is a long-term liability."
- **Repository conventions in [`stack.md`](../stack.md) apply unchanged:** ESM with `.js` extensions on relative imports, no `export default` outside `src/commands/`, colocated `*.test.ts`, biome-owned formatting.
- **No credentials.** The Herdr socket is a local file path (`/Users/baldur/.config/herdr/herdr.sock`, per `herdr status`) and Herdr needs no token, so nothing here touches `context/standards/security/secrets.md`.
- **Config is per-repo.** `gitSetConfigValue` (`src/lib/git.ts:23-25`) runs `git config northguild.worktree.<name> "<value>"` with no `--global`, so anything written lands in the local repo config only.
- **The three caller suites are the regression net.** `src/commands/branch.test.ts:53`, `checkout.test.ts:37` and `open.test.ts:58` each `vi.spyOn(cmd as any, "openWorktreePath")`. They must keep passing without modification.

## 3. Decisions

**D1.** Add one new key, `opener`, whose value selects the opener kind (`editor` or `herdr`); unset means `editor` and preserves today's behaviour byte for byte. `codeEditor` keeps its current meaning and remains the value the `editor` opener uses. *Rejected: renaming `codeEditor` to a generalised opener-command string*, because the value lives in per-repo local git config (see §2) and the CLI has no way to enumerate the repos a user has already configured, so the rename silently drops the setting in each of them; it also touches `src/lib/constants.ts:10`, `src/lib/validators.ts:66`, `src/commands/config.ts:212-224`, the assertions at `src/commands/config.test.ts:51,68,87` and `src/lib/git.test.ts:63,92,95`, and the sixteen `codeEditor` mentions across nine files in `README.md`, `docs/src/app/docs/` and `skills/`. *Also rejected: reusing `codeEditor` with a magic value of `herdr`*, because `isValidCommand` would `which herdr` and pass, leaving the value ambiguous between "run the herdr binary as if it were an editor" and "use the integration".

**D2.** The dispatch stays inside `openWorktreePath` (`src/lib/base-command.ts:51`) — one seam, three callers unchanged. *Rejected: dispatching in each caller* (`branch.ts:184`, `checkout.ts:71`, `open.ts:46`), because that is three copies of the same branch, and because the three colocated suites already spy on the seam, so keeping it means those suites are an unmodified regression check rather than three files to rewrite. `context/standards/philosophy/incremental-abstraction.md` — "A bug was fixed in one place but exists in two others" is listed as a sign to abstract, not to duplicate.

**D3.** Talk to Herdr by invoking the `herdr` CLI and parsing its JSON, not by speaking the unix-socket protocol from Node. Verified against the live 0.8.2 server: `herdr workspace list` prints one JSON envelope on stdout — `{"id":"cli:workspace:list","result":{"type":"workspace_list",...}}` — and exits 0; `herdr workspace get zzz` prints `{"error":{"code":"workspace_not_found","message":"workspace zzz not found"},"id":"cli:workspace:get"}` on **stderr** and exits 1. *Rejected: a `node:net` client against `HERDR_SOCKET_PATH`*, because it would mean owning framing, request-id correlation and protocol-20 negotiation for no gain, against the dependency and native-API guidance in §2, and because `src/integrations/github.ts` and `jira.ts` already establish the shell-out-plus-parse shape.

**D4.** Introduce an argv-based command runner in `src/lib/cli.ts` (built on `node:child_process.execFile`, no shell) and route both openers through it. *Rejected: keeping `exec` and hand-quoting the path*, because hand-quoting is what produced the current defect and still fails on a path containing a quote. **The unquoted-path defect is fixed here, in Phase 1 of this plan, not deferred to `/orchestrate`** — the Herdr opener needs the same helper, and landing the fix twice is worse than landing it once. Scope is limited to `openWorktreePath`; the other unquoted interpolations in `src/lib/git.ts` are out of scope (see §8).

**D5.** When `opener` is `herdr` but Herdr is unavailable or the open fails, print Herdr's own `error.code` and `error.message` **plus the worktree path, and stop — never launch an editor.** *Amended 2026-09-07 by the maintainer at the `/feature-implement` approval checkpoint*, resolving what §8 had left open: someone who set `opener=herdr` deliberately should not get an unexpected editor window as the consolation prize. *Rejected: failing the command*, because the opener is the last statement of `branch` and `checkout` — the worktree exists and the env files are copied by then, so a non-zero exit misrepresents what happened; the command still exits 0. *Rejected: falling back to the editor branch* (the decision as originally written) and *rejected: falling back silently*, the latter per `context/standards/typescript/error-handling.md` — "Never swallow errors silently", "Never hide the original error context".

**D6.** Focus defaults to on; `herdr.focus` set to `false` opts out. All three callers are user-initiated "take me to this worktree" actions, and `worktree open` that does not switch to the space would read as broken. *Rejected: defaulting to `--no-focus`*, which is what `herdr --skill` advises ("Use `--no-focus` for background work unless the user asked to switch context") and what the schema already defaults to (`WorktreeOpenParams.focus.default = false`) — that guidance is aimed at an agent splitting panes behind a user's back, not at a command the user just typed. The `herdr.focus` key exists so agent-driven use can restore Herdr's default.

**D7.** Always pass `--label <branchName>`. *Rejected: letting Herdr choose*, because the live `worktree list` for this repo returns `label: "worktree"` for every checkout (§1), so unlabelled spaces are unusable in a sidebar.

**D8.** Pass `--path <absolute>` together with `--cwd <git root>`, and never `--branch`. Herdr's v0.9.0 socket-API doc states "Use exactly one of `path` or `branch` for `worktree.open`" and "Use at most one of `workspace_id` or `cwd` … omit both to use the active workspace". Both call sites already hold an absolute path: `gitCreateWorktree` returns `${gitRootPath}.worktrees/${branchName}` (`src/lib/git.ts:228,245`), and `gitGetWorktrees` filters on `path.startsWith(worktreesRootPath)` where that root is absolute (`src/lib/git.ts:132,148`). *Rejected: `--branch`*, because it would re-resolve against whichever workspace is active rather than against the repo the command was run in.

**D9.** Agent auto-start is opt-in through `herdr.agent`; unset means no agent is started. *Rejected: always starting `claude`*, because `herdr agent start --help` lists 22 accepted kinds (`pi, claude, codex, gemini, cursor, devin, agy, cline, omp, mastracode, opencode, copilot, kimi, kiro, droid, amp, grok, hermes, kilo, qodercli, qwen, maki`) so there is no canonical choice, and because `agent start` blocks until the agent is detected ready with a default 30 s timeout (`AgentStartParams.timeout_ms`: "greater than 3000 and at most 300000"), which would be added to every `worktree branch` for every user.

**D10.** Do not validate `herdr.agent` against a kind list held in this repo — validate shape only and let Herdr reject an unknown kind. *Rejected: embedding the 22 kinds in `src/lib/validators.ts`*, because the enum is not in the socket schema at all (`AgentStartParams.kind` is `{"type":"string"}`); it exists only in the installed CLI's help text and behind `server.agent_manifests`, so a copy here rots on the next Herdr release.

## 4. Design

### 4.1 The runner

`src/lib/cli.ts` gains an argv-based sibling to `cmd`, backed by `execFile` so no shell is involved: it takes an executable plus a `string[]`, and resolves with stdout, stderr and exit code rather than rejecting. This is the piece D3, D4 and D5 all need — the Herdr error envelope is on **stderr** with exit 1, and today's `cmd` (`src/lib/cli.ts:17-24`) rejects on non-zero exit and passes only `stdout` through, discarding stderr. Node does fold stderr into the rejection's `error.message` (verified: `"Command failed: … \n{\"error\":{\"code\":\"workspace_not_found\",…}}\n"`), but recovering a structured `code` by scraping that string is exactly the "hide the original error context" failure `context/standards/typescript/error-handling.md` names.

`src/test-setup.ts` replaces the whole `./lib/cli.js` module with a factory that exports only `cmd` and `commandExists`. The new export must be added to that factory in the same change, or it is `undefined` in every suite in the repo.

### 4.2 The opener seam

`openWorktreePath` reads `opener` alongside `codeEditor` and branches three ways: `herdr` → the integration; `editor` or unset with `codeEditor` set → today's launch, now through the runner; nothing set → today's log line (`src/lib/base-command.ts:64`). The editor branch splits the configured value on whitespace into executable plus leading arguments and appends the path as its own argv element — which is what keeps the §2 interim workaround intact while fixing paths containing spaces.

This makes `src/lib/base-command.ts` import from `src/integrations/`. Today nothing under `src/lib/` does; the only integration imports in non-test source are `src/commands/branch.ts:4-5`. `context/standards/architecture/dependency-boundaries.md` puts `lib/` at the bottom of the graph ("`lib/` → external packages only"), so this is a deliberate deviation: `BaseCommand` is the composition point every command inherits, not a leaf utility, and it already reaches into `src/lib/git.js` and `@inquirer/prompts`. The alternative that satisfies the boundary strictly is moving `base-command.ts` out of `src/lib/`, which is a wider refactor than this feature justifies. Recorded as a deviation, not an oversight.

### 4.3 The integration module

`src/integrations/herdr.ts`, named exports only, shaped like its two neighbours:

- **Availability** — `commandExists("herdr")`, and nothing more. *Amended 2026-09-08 by the maintainer at Phase 4, closing F-003.* *Rejected: following it with `herdr status server --json` and reading the `running` boolean* (the design as originally written, verified live returning `{"status":"running","running":true,"version":"0.8.2","protocol":20,…,"socket":"…"}` at exit 0) — it spawned a second process on every open and collapsed a dead server into a bare `false`, so the reason Herdr gave was gone before the seam could print it, which is the half of D5 that matters most. Liveness belongs to the open instead: a stopped server fails `worktree open`, and that failure carries Herdr's own `code` and `message`. This also answers §8's third open question.
- **Open** — argv `["worktree", "open", "--path", <abs>, "--cwd", <gitRoot>, "--label", <branch>, "--focus"|"--no-focus"]`, parsing the stdout envelope's `result` into a narrow internal shape. Per protocol 20 the `worktree_opened` result requires `type`, `workspace`, `tab`, `root_pane`, `worktree` and `already_open`; the fields this feature needs are `result.workspace.workspace_id`, `result.root_pane.pane_id` and `result.already_open`. Herdr's socket-API doc instructs clients to "ignore unknown fields and handle unsupported methods as normal errors", so parsing narrows rather than mirrors the schema.
- **Errors** — on a non-zero exit, parse stderr as the error envelope (`{"error":{"code","message"},"id"}`, both fields required by the schema) and raise an `Error` carrying `code` and `message`, with the original as `cause`.
- **Agent start (Phase 5)** — only when `herdr.agent` is set *and* `already_open` is false, argv `["agent","start",<name>,"--kind",<kind>,"--pane",<paneId>]`.

Herdr also injects `HERDR_ENV=1`, `HERDR_BIN_PATH`, `HERDR_SOCKET_PATH`, `HERDR_PANE_ID`, `HERDR_TAB_ID` and `HERDR_WORKSPACE_ID` into managed panes (verified in this shell). These are **not** used for detection: the CLI may legitimately be run from a plain terminal by someone who still wants a Herdr space, so the switch is config, per D1.

### 4.4 Agent naming

Herdr requires agent names matching `[a-z][a-z0-9_-]{0,31}`, unique among live agents (`herdr --skill`). `sanitizeBranchName` (`src/lib/utils.ts:51-58`) is not fit for this: its `/[^\w\s-]/g` strip removes `/` without a separator, so `feature/add-agent-mode` becomes `featureadd-agent-mode`, and it leaves a leading digit intact, so a branch like `178-automate-publishing` produces an invalid name. Phase 5 owns a dedicated derivation with its own tests rather than reusing it.

### 4.5 Testing without a server

`src/test-setup.ts` globally mocks `./lib/cli.js` for every suite, with `commandExists` stubbed to resolve `true` and `cmd` a bare `vi.fn()`; `afterEach` warns about undeclared calls and `expectCommands(...)` declares the expected ones (used at `src/integrations/github.test.ts:80,231`). Nothing reaches a shell, so the entire integration is testable with the Herdr server absent — the tests assert the argv assembled and the parsing of canned stdout/stderr envelopes, both of which are captured verbatim in §1 and §4.3. `src/lib/validators.test.ts:59` shows the override pattern for the availability probe (`vi.spyOn(cli, "commandExists").mockResolvedValue(false)`).

## 5. Risks

**Herdr version drift.** The installed client and server are 0.8.2 / protocol 20, but `herdr.dev/llms.txt` already resolves its documentation links to `v0.9.0`, where `worktree open` has gained a `--trust-repository` flag. It would show up as an unexpected `error.code`, or as an open that never returns because it is waiting on a trust decision. Response: re-run `herdr worktree open --help` and re-dump the schema at the start of Phase 3; branch on `error.code` strings, never on message text; ignore unknown response fields.

**A new export from `src/lib/cli.ts` breaks every suite.** `src/test-setup.ts`'s `vi.mock("./lib/cli.js", …)` factory is a full module replacement, so an export it does not list is `undefined` everywhere. It surfaces as "is not a function" in suites unrelated to this feature. Response: Phase 1 changes `src/test-setup.ts` in the same commit.

**Multi-word `codeEditor` regression.** The §2 workaround is a five-token value. An argv rewrite that treats it as one executable would break users already running it. Response: the whitespace-split described in §4.2, plus a test asserting that the exact workaround string still yields the same argv.

**Dead or unpromptable config keys.** `config.ts`'s `renderInput` (`src/commands/config.ts:108-227`) prompts key by key with hand-written blocks; `getPromptConfigNames` (`config.ts:73-91`) derives the missing set from `CONFIG_NAMES`. A key added to `src/lib/constants.ts` without a matching prompt block is listed forever by `worktree config --missing` and can never be set interactively — `has-called-config` only escapes this because `run()` self-sets it at `config.ts:237`. Response: every phase that adds a key adds its prompt block in the same commit, and none of the new keys is ever passed to `verifyConfig` (`src/lib/base-command.ts:23-49`), which would otherwise re-offer the config command on every run.

**`agent start` blocking the command.** Default startup timeout is 30 s and the maximum is 300 s. A user could sit through a half-minute pause at the end of `worktree branch`. Response: D9 makes it opt-in, and Phase 5 sets an explicit `--timeout` below the default. Whether it should instead be fire-and-forget is open (§8).

**Awaiting the open changes command timing.** Today `openWorktreePath` does not await `exec` — it registers a callback (`src/lib/base-command.ts:56-62`) and `run()` returns. `worktree open` must be awaited to read `root_pane.pane_id`, so an unresponsive server turns a fast exit into a wait. Response: bound the runner call with an explicit timeout; the value is open (§8).

**Agent name collisions.** Derived names can collide with a live agent from another repo — the live `workspace list` already shows six workspaces including one labelled `178-automate-package-publishing`. It surfaces as an `agent start` error *after* the space is already open, so the space is correct and only the agent is missing. Response: treat agent-start failure as a warning, never as a failure of the open.

**Unknown: server-down behaviour.** Could not be observed — `HERDR_CONFIG_PATH` does not relocate the socket (`herdr status` still reported the real path under an overridden config), and stopping the live server was out of bounds. Response: recorded as an open question rather than designed around; D5's fallback is written to cover any non-zero exit, including one whose shape is not yet known.

## 6. Phases

### 6.1 Status ledger

| # | Phase | Status | Depends on | Note |
|---|---|---|---|---|
| 1 | Argv command runner and quoted opener | done | — | `runCommand` on `execFile`; Gate 2 raised F-001 and F-002, both `P2` and non-blocking |
| 2 | `opener` and `herdr.focus` config keys | done | — | Both keys promptable and validated; Gate 2 `PASS WITH NOTES`, all notes `P3` |
| 3 | `src/integrations/herdr.ts` — detect and open | done | 1 | Schema re-verified live at 0.8.2/protocol 20, no drift; Gate 2 `PASS WITH NOTES`, all notes `P3`, F-003 handed to Phase 4 |
| 4 | Wire the opener seam to the `opener` key | done | 2, 3 | Three caller suites passed unmodified; F-003 closed by dropping the probe; Gate 2 `PASS WITH NOTES`, highest note `P2`, N2 recorded as F-004 |
| 5 | Optional agent auto-start (`herdr.agent`) | not started | 4 | Own name derivation; not `sanitizeBranchName` |
| 6 | Documentation and shipped skill | not started | 4 | 16 existing `codeEditor` mentions across 9 files |

Status is one of `not started`, `in progress`, `blocked`, `done`. `done` only when committed and verified,
and whoever finishes a phase updates the row in the same commit.

**Exactly one table in this document has these columns.** Do not add a second phase table — a
differently-shaped one nearby is a decoy that gets read by mistake.

### 6.2 The phases

#### Phase 1 — Argv command runner and quoted opener

**Files:** `src/lib/cli.ts`, `src/lib/cli.test.ts` (new), `src/lib/base-command.ts`, `src/lib/base-command.test.ts` (new), `src/test-setup.ts`

**Scope:** Add an `execFile`-based runner to `src/lib/cli.ts` taking an executable and a `string[]`, resolving with stdout, stderr and exit code instead of rejecting, so a non-zero exit's stderr is available to the caller (D4, §4.1). Add it to the `vi.mock("./lib/cli.js", …)` factory in `src/test-setup.ts`. Rewrite the `codeEditor` branch of `openWorktreePath` to split the configured value on whitespace into executable plus leading arguments and pass the worktree path as its own argv element. `cmd` and `commandExists` keep their current signatures; nothing else changes behaviour.

**Done when:** `src/lib/base-command.ts` contains no template-literal shell string; the new `src/lib/base-command.test.ts` asserts that `codeEditor` = `code` with path `/tmp/a b/c` produces argv `["/tmp/a b/c"]` as a single element, and that `codeEditor` = `herdr worktree open --focus --path` produces executable `herdr` with argv `["worktree","open","--focus","--path",<path>]`; `src/test-setup.ts`'s mock factory exports the new function; the suites for `branch`, `checkout` and `open` pass with no edits; the standing stack in [`../verify.md`](../verify.md) passes.

#### Phase 2 — `opener` and `herdr.focus` config keys

**Files:** `src/lib/constants.ts`, `src/lib/validators.ts`, `src/lib/validators.test.ts`, `src/commands/config.ts`, `src/commands/config.test.ts`

**Scope:** Add `opener` and `herdr.focus` to `CONFIG_NAMES` (`src/lib/constants.ts:1-12`), which widens the `ConfigName` union at `src/lib/types.ts:3` automatically. Add cases to `isValidConfigValue` (`src/lib/validators.ts:57-71`): `opener` accepts only `editor` or `herdr`, `herdr.focus` only `true` or `false`. Add prompt blocks to `renderInput` (`src/commands/config.ts:108-227`) following the `codeEditor` block's shape at `config.ts:211-224`, so both keys are settable interactively. Per `context/standards/typescript/rules.md` the accepted values are a `type` union of string literals, not an enum. Neither key is added to any array passed to `verifyConfig`.

**Done when:** `worktree config opener herdr` persists to `northguild.worktree.opener`; `worktree config opener bogus` raises `InvalidConfigValueError` (`src/lib/validators.ts:73-83`); after setting both keys, `worktree config --list --missing` lists neither; `src/commands/config.test.ts` covers a prompt run that sets both; the standing stack in [`../verify.md`](../verify.md) passes.

#### Phase 3 — `src/integrations/herdr.ts` — detect and open

**Files:** `src/integrations/herdr.ts` (new), `src/integrations/herdr.test.ts` (new)

**Scope:** A named-export module beside `github.ts` and `jira.ts` with two entry points: an availability check (`commandExists("herdr")` then `herdr status server --json`, reading `.running`), and an open that assembles the argv of D8 and D6, parses the stdout envelope into `{ workspaceId, paneId, alreadyOpen }`, and on non-zero exit parses the stderr error envelope into an `Error` carrying Herdr's `code` and `message` with the original as `cause`. Parsed JSON is typed `unknown` and narrowed by hand — no `as`, no `any`, per `context/standards/typescript/rules.md`. Interfaces, not type aliases, for the object shapes; `PascalCase` type names and verb-first function names per `context/standards/typescript/naming.md`. Re-verify `herdr worktree open --help` and the schema before writing the argv (§5).

**Done when:** `src/integrations/herdr.test.ts` covers, with the runner mocked and no server contacted: installed and not installed (`commandExists` true and false — originally also `running: false`, dropped with the probe by the 2026-09-08 amendment to §4.3); a successful open asserting the exact argv including `--label` and the focus flag; `already_open: true`; and a stderr error envelope surfacing as an `Error` whose message contains the `code`. The module has no default export. The standing stack in [`../verify.md`](../verify.md) passes.

#### Phase 4 — Wire the opener seam to the `opener` key

**Files:** `src/lib/base-command.ts`, `src/lib/base-command.test.ts`

**Scope:** `openWorktreePath` reads `opener` and `herdr.focus` and dispatches per §4.2 — `herdr` to the integration, anything else to the editor branch from Phase 1. Herdr unavailability or a failed open prints the `code` and `message` and the worktree path, and stops without launching an editor (D5). The label is the worktree's branch name and the `cwd` is the git root, both resolved at the seam. Callers are not touched.

**Done when:** `src/commands/branch.test.ts`, `checkout.test.ts` and `open.test.ts` pass with **zero modifications** (they spy on `openWorktreePath` at `branch.test.ts:53`, `checkout.test.ts:37`, `open.test.ts:58`); `src/lib/base-command.test.ts` covers all four dispatch outcomes — `opener` unset with `codeEditor` set, `opener` unset with `codeEditor` unset, `opener=herdr` with the integration succeeding, and `opener=herdr` with the integration throwing, printing the error code and the path and launching **no** editor (per D5 as amended 2026-09-07; this bullet originally read “followed by the editor fallback” and was not updated with that amendment); `src/lib/base-command.ts` names the deciding plan section (`§4.2`) in a comment rather than a line number, per `plan-template.notes.md`; the standing stack in [`../verify.md`](../verify.md) passes.

#### Phase 5 — Optional agent auto-start (`herdr.agent`)

**Files:** `src/lib/constants.ts`, `src/lib/validators.ts`, `src/lib/validators.test.ts`, `src/commands/config.ts`, `src/commands/config.test.ts`, `src/integrations/herdr.ts`, `src/integrations/herdr.test.ts`, `src/lib/base-command.ts`, `src/lib/base-command.test.ts`

**Scope:** Add `herdr.agent` to `CONFIG_NAMES` with a shape-only validation case (non-empty, lowercase kebab; no kind list, per D10) and a prompt block. Add an agent-start call to the integration issuing `agent start <name> --kind <kind> --pane <paneId> --timeout <ms>`, invoked from the seam only when `herdr.agent` is set and the open reported `already_open: false`. Derive the agent name from the branch inside the integration module, coerced to `[a-z][a-z0-9_-]{0,31}` — not via `sanitizeBranchName` (§4.4). A failed agent start warns and does not fail the open.

**Done when:** name-derivation tests cover a branch containing `/`, one beginning with a digit, and one longer than 32 characters, each producing a name matching `^[a-z][a-z0-9_-]{0,31}$`; a test asserts no agent-start argv is issued when `herdr.agent` is unset; a test asserts none is issued when `already_open` is `true`; a test asserts an agent-start rejection leaves the open reported as successful; the standing stack in [`../verify.md`](../verify.md) passes.

#### Phase 6 — Documentation and shipped skill

**Files:** `README.md`, `docs/src/app/docs/configuration/page.mdx`, `docs/src/app/docs/getting-started/page.mdx`, `docs/src/app/docs/faq/page.mdx`, `docs/src/app/docs/commands/config/page.mdx`, `docs/src/app/docs/guides/editor-integration/page.mdx`, `docs/src/app/docs/guides/herdr-spaces/page.mdx` (new), `docs/src/app/docs/guides/_meta.ts`, `skills/core/SKILL.md`, `skills/_artifacts/skill_tree.yaml`, `skills/_artifacts/domain_map.yaml`

**Scope:** Document `opener`, `herdr.focus` and `herdr.agent` everywhere `codeEditor` is documented today — 16 mentions across the nine files above (`README.md:79,189`, `configuration/page.mdx:12,28`, `getting-started/page.mdx:59`, `faq/page.mdx:28`, `commands/config/page.mdx:32`, `guides/editor-integration/page.mdx:10,23`, and five in `skills/core/SKILL.md`). Add a Herdr guide page and register it in `docs/src/app/docs/guides/_meta.ts`, which is a hand-maintained `MetaRecord`. Update the shipped skill: the config table at `skills/core/SKILL.md:126`, the description at `SKILL.md:5`, the opener sentence at `SKILL.md:66`, the pitfall at `SKILL.md:212`, the key list at `skills/_artifacts/skill_tree.yaml:24` and the mistake entry at `skills/_artifacts/domain_map.yaml:87-90`. Do **not** touch `library_version:` in `SKILL.md` or `  version:` in `skill_tree.yaml` — `scripts/sync-intent-version.mjs` owns both lines and CI hard-fails on drift ([`stack.md`](../stack.md)).

**Done when:** the config reference in `README.md`, `docs/src/app/docs/configuration/page.mdx` and `skills/core/SKILL.md` each list all three new keys; the new guide is reachable through `guides/_meta.ts`; no file named `biome.json` or `biome.jsonc` was added anywhere ([`../verify.md`](../verify.md)); the version-bearing lines in `skills/` are unchanged; the standing stack in [`../verify.md`](../verify.md) passes.

## 7. Verification

Beyond the standing stack in [`../verify.md`](../verify.md) passing, this feature is proved by five things.

**The three caller suites pass unmodified.** `src/commands/branch.test.ts`, `checkout.test.ts` and `open.test.ts` spy on `openWorktreePath` and never reach the opener's body. If any of them needs an edit, D2's single-seam claim has broken and the change is wider than the design says.

**`opener` unset is indistinguishable from today.** In a repo with `codeEditor` set and `opener` unset, `worktree open <branch>` launches the same editor with the same path and prints the same spinner text as the pre-change build. In a repo with neither set, it prints the same `✔ Worktree created in <path>` line from `src/lib/base-command.ts:64`.

**A real space appears, labelled by branch.** Against a running server, with `git config northguild.worktree.opener herdr`, run `worktree branch <name>`; then confirm with two read-only Herdr calls: `herdr worktree list --cwd <repo root>` shows an entry whose `path` is the new worktree, whose `label` is the branch name and whose `open_workspace_id` is non-null, and `herdr workspace list` shows a workspace with that `label`. Compare against the §1 baseline, where both entries carried `label: "worktree"`.

**A second open does not duplicate.** Record the workspace count from `herdr workspace list`, run `worktree open <same branch>`, and confirm the count is unchanged and the integration reported `already_open: true`. With `herdr.agent` set, confirm no second agent was started — `herdr agent list` shows the same agents.

**The failure path is honest.** Reproduce a stopped server in an **isolated named session** — `herdr --session <test-name>` and stop only that server; never the main session, per `herdr --skill` ("Never run `herdr server stop` from an active session unless the user explicitly intends to stop the server and its pane processes"). Then confirm `worktree open <branch>` prints Herdr's `code` and `message` and the worktree path, opens **no** editor, and that the command exits 0. *Amended 2026-09-08 to match D5, which the maintainer amended on 2026-09-07; this paragraph originally read “and still opens the editor”.*

**Space-in-path.** Create a worktree whose absolute path contains a space and confirm the editor receives it as one argument. Note the limit of this check: `gitGetWorktrees` splits `git worktree list` output on a single space (`src/lib/git.ts:139`), so it mis-parses such a path before the opener ever sees it. Exercise this through `worktree branch`, where the path comes from `gitCreateWorktree`, not through `worktree open`.

## 8. Open questions

- **What the `herdr` CLI does when the server is not running** — exit code, stream, whether it auto-starts a server. Not observable in this session: `HERDR_CONFIG_PATH` does not relocate the socket (`herdr status` under an overridden config still reported `/Users/baldur/.config/herdr/herdr.sock`), and stopping the live server was out of bounds. D5 is written to cover any non-zero exit, but the exact shape is unverified.
- **Whether `--cwd` is needed at all when `--path` is absolute.** D8 passes it defensively. The v0.9.0 doc's "omit both to use the active workspace" implies omitting is legal but resolves against whichever workspace happens to be active. Confirming requires running the mutating `worktree open`, which was out of bounds.
- ~~**Whether `herdr status server --json` is the right liveness probe**, or whether a failed `worktree open` should be the only signal — the probe costs an extra process spawn on every open.~~ **Answered 2026-09-08 at Phase 4** (F-003): it is not. The probe is gone and a failed `worktree open` is the only liveness signal, which is also the only one that carries Herdr's `code` and `message`. See the amended §4.3.
- **`--trust-repository`.** It exists on `worktree open` in v0.9.0 and not in the installed 0.8.2. Unknown whether it becomes required for a repository Herdr has not seen, which would make the first open of a fresh worktree fail. Under the amended D5 that surfaces as a printed `error.code` and the path rather than a space, so it is visible rather than papered over.
- **The timeout bound on the `worktree open` call** (§5, "Awaiting the open changes command timing"). No value is chosen here.
- **Whether agent start should be awaited or fire-and-forget.** D9 makes it opt-in, which caps the blast radius, but a 30 s ceiling on an awaited call is still long for a command whose real work is already done.
- **Whether `worktree remove` and `worktree cleanup` should close the corresponding Herdr workspace** via `workspace.close`. Out of scope — the roadmap entry names only the opener, and `src/commands/remove.ts` and `cleanup.ts` do not call `openWorktreePath`. It is the obvious next roadmap entry.
- **Whether `opener` should be settable globally.** Herdr use is a per-person preference, but `gitSetConfigValue` (`src/lib/git.ts:23-25`) always writes local repo config, so a user must set it once per repo. Adding a `--global` path is a change to the config command's contract, not to this feature.
- **Windows.** `commandExists` already branches on `process.platform` for `where` vs `which` (`src/lib/cli.ts:33`), but Herdr is a unix-socket TUI and whether it runs on Windows at all was not verified.
- **The other unquoted shell interpolations.** `gitCreateWorktree` builds `cd ${gitRootPath} && … git worktree add … ${worktreePath} …` (`src/lib/git.ts:231-241`) and `gitSetConfigValue` interpolates the value into a shell string (`git.ts:24`); `gitGetWorktrees` splits list output on a single space (`git.ts:139`). D4 deliberately scopes Phase 1 to `openWorktreePath`. The rest is a separate, `/orchestrate`-shaped task and should be raised as one.
