# shell-argv-safety Plan

Retired — its outcome and date are in [issue #44](https://github.com/northguild/worktree/issues/44) (`shell-argv-safety`, closed). `context/history.md` held this until 2026-09-09, when [`../tracking.md`](../tracking.md) moved the outcome index into GitHub issues.

Removed the shell from this CLI's subprocess calls, replacing an interpolated command-string contract with
an argv-array one. `cmd()`, the `exec` inside it, and the one `exec` that bypassed it are all gone; every
subprocess call is now an argv array with an explicit `cwd`.

**Nothing cites this document by section.** `grep -rn "SHELL-ARGV-SAFETY" .` at retirement returned exactly
one hit — the `roadmap.md` entry this close removed — so no source comment depends on the numbering below.
That is the opposite of [`CLEANUP-DATA-LOSS-PLAN.md`](CLEANUP-DATA-LOSS-PLAN.md), whose sections *are* cited
from source, and it is why renumbering here breaks nothing.

Built on the reference material captured by `/roadmap` on 2026-09-05, which this document replaced. That
material's provenance is carried forward in §0, and its inventory — re-verified and corrected — is §10.

---

## 0. Provenance of the source material

- **Source:** maintainer, pasted into `/roadmap` on 2026-09-05. Originated as analysis done while planning
  `agent-mode`, where it is recorded as risk R1 in [`AGENT-MODE-PLAN.md`](AGENT-MODE-PLAN.md).
- The **original** `agent-mode` brief called this a single-site, commit-sized `/orchestrate` task citing
  only `src/lib/base-command.ts:56`. The inventory is why it was filed as its own roadmap entry instead.
- The draft's two corrections to the supplied material (`git.ts:94` → `:95`, and "every subprocess call
  builds a shell string" being too broad) **both still hold** and are carried into §10.
- **Every line number in the draft was re-verified against the tree on 2026-09-05 while writing this plan,
  and four had drifted.** See §10's "Corrections to the draft" — the draft is now three commits stale, and
  the phases below cite the current numbers.

## 1. Why

`cmd()` (`src/lib/cli.ts:7-25`) runs every git call through `child_process.exec`, which means a shell,
which means every value interpolated into it is parsed as shell syntax. Two consequences, one live today
and one latent:

**A path containing a space fails.** Re-demonstrated first-hand on 2026-09-05, not inherited from the
draft — the exact pattern the CLI builds at `src/lib/git.ts:103`, against a directory whose path contains
a space:

```
today's pattern  -> FAILS: Command failed: cd /…/tmp/space demo && git status -s
argv + cwd       -> ok
```

The second line is `execFile("git", ["status", "-s"], { cwd })` — the same work, no shell, no quoting.

**A config value is an injection vector.** `gitSetConfigValue` (`src/lib/git.ts:23-25`) interpolates an
arbitrary user-supplied value into `git config … "${value}"` with nothing but double quotes around it. A
value containing `"` closes the quote; a backtick or `$(…)` executes.

The shape of the problem is better than the raw count suggests.
`grep -rn --include='*.ts' 'exec(\|execSync\|spawn(\|execFile' src/` over non-test sources returns exactly
**two** hits:

| Site | What it is |
|---|---|
| `src/lib/cli.ts:17` | `exec(cmd, …)` inside `cmd()` — **the single shell boundary every git call funnels through** |
| `src/lib/base-command.ts:56` | `exec(\`${codeEditor} ${path}\`, …)` — the one call that **bypasses `cmd()`** |

So this is not eighteen independent bugs. It is **one helper with a string-shaped contract, one caller that
skipped the helper, and eight call sites that interpolate into that contract.** Ten further call sites pass
static strings and are already safe.

**Five of the eight interpolations exist only to work around a missing option.** `CmdOptions` is
`{ debug?: boolean }` (`src/lib/cli.ts:3-5`) — there is no `cwd`. So five sites shell out to `cd` to reach a
worktree:

```
src/lib/git.ts:86    `cd ${branchPath} && git rev-list --count @{u}..HEAD`   ─┐ deleted by Phase 2
src/lib/git.ts:95    `cd ${branchPath} && git rev-list --count HEAD..@{u}`   │
src/lib/git.ts:103   `cd ${branchPath} && git status -s`                     ─┘
src/lib/git.ts:237   `cd ${gitRootPath}`     ─┐ composed at :247 into one chained
src/lib/git.ts:245   `cd ${currentPath}`     ─┘ `${cdRoot} && ${gitFetch} && ${addWorktree} && ${gotoBack}`
```

The first three are historical from Phase 2 onward; the line numbers above are the pre-Phase-2 tree.

**Adding a `cwd` option deletes these rather than escaping them.** That is the load-bearing consequence for
how this plan is phased: the fix is mostly subtraction, and `execFile` already takes `{ cwd }`.

## 2. Constraints

- **No behaviour change that a user can see**, except the two that are the point: paths with spaces start
  working, and hostile config values stop executing. Command output, error text and exit behaviour stay as
  they are.
- **The suite must stay green at every phase boundary.** This is a refactor of a contract that 18 call
  sites and 16 test assertions depend on; a phase that leaves the tree red is not commit-sized.
- **No new runtime dependency.** `node:child_process` already provides `execFile`. Adding a shell-quoting
  library would be the wrong direction — it keeps the shell.
- From [`../stack.md`](../stack.md): ESM throughout, relative imports keep the `.js` extension; `export
  default` only in `src/commands/*.ts`; tests colocated as `*.test.ts`, vitest. Never add a file named
  `biome.json` or `biome.jsonc` anywhere in the tree.
- Console output is chalk-styled and TTY-dependent; assertions on printed text rely on the
  `FORCE_COLOR: "0"` pin in `vitest.config.ts`.

## 3. Decisions

**D1. A new `run(file, args, opts)` lands alongside `cmd()`, call sites migrate in batches, and `cmd()` is
deleted when its last caller is gone.** *Rejected:* changing `cmd()`'s signature in place — that moves 18
call sites, 16 assertions and the global mock in one commit, which is not a commit-sized unit and hands the
review gate one undifferentiated diff. *Rejected:* an overload on `cmd()` — a union signature keeps the
string path reachable and reviewable-as-normal forever, and the goal here is to **remove** that path, not to
park a safer one next to it.

**D2. `run` is built on `execFile`, not `spawn`.** `execFile` buffers stdout and hands it back, which is
exactly what all 18 call sites want — every one of them parses stdout. `spawn` would push chunk
accumulation into each caller. *Note:* `agent-mode` D2 chooses `spawn` for agent dispatch, and that is not
in tension — it dispatches a detached, long-lived process whose output is deliberately not collected.

**D3. `run` takes `{ cwd }`, and the five `cd` sites are deleted rather than quoted.** This is the whole
reason the change is mostly subtraction (§1). A per-call `cwd` also never mutates the process's own working
directory, which is what makes the `cd`-back halves unnecessary (D5).

**D4. `CmdOptions.debug` is dropped, not carried onto `run`.** Verified dead: it is defined at
`src/lib/cli.ts:4,9,12` and **passed by no caller** — `grep -rn --include='*.ts' 'debug' src/` returns only
those three lines. *Rejected:* preserving it — it is a branch that logs, resolves `""` and skips execution
entirely, so setting it on a migrated call site would silently no-op the command rather than run it.

**D5. Chained `&&` commands become sequential `await run(…)` calls.** Short-circuit semantics are preserved
exactly: an `await` that rejects stops the sequence, which is what `&&` did. The `cd`-back halves disappear
under D3.

**D6. `openWorktreePath` splits `codeEditor` on whitespace — head as the file, tail as leading args.** This
is the contract `commandExists` (`src/lib/cli.ts:27-39`) **already** applies, since it does
`command.split(" ")[0]` and checks only the head. Today validation and execution disagree: `commandExists`
validates `code`, the shell then runs the whole string. After this, they agree. *Rejected:* a shell-quoting
library, per §2.

**D7. `src/test-setup.ts` gains a `run` mock in the same commit that adds `run` to `cli.ts`.** The global
`vi.mock("./lib/cli.js", …)` factory returns an **explicit object** (`{ cmd, commandExists }`), so any export
missing from it is `undefined` at call time. A migrated call site would not fail with a useful assertion —
it would throw "run is not a function". This is a sequencing constraint, not a preference.

**D8. Migration order is read-only sites first, filesystem-mutating sites last.** Ahead/behind/uncommitted
counts are pure reads (Phase 2). `gitCreateWorktree` and `gitNukeWorktree` create and destroy directories
(Phases 3, 4), and go after the pattern is established and covered.

## 4. Design

### 4.1 The helper

```ts
// src/lib/cli.ts
interface RunOptions { cwd?: string }

export function run(file: string, args: string[] = [], { cwd }: RunOptions = {}): Promise<string>
```

`execFile(file, args, { cwd })`, resolving `stdout?.trim() ?? ""` and rejecting on error — the same
resolve/reject shape `cmd()` has today, so no caller's error handling changes. `cmd()` stays untouched
until Phase 5.

### 4.2 What each call-site group becomes

| Group | Today | After |
|---|---|---|
| three `cd ${branchPath}` reads | `cmd(\`cd ${p} && git status -s\`)` | `run("git", ["status", "-s"], { cwd: p })` |
| `gitCreateWorktree`'s chain | one `cmd()` with four `&&`-joined commands | two sequential `run`s, both `{ cwd: gitRootPath }` |
| `gitNukeWorktreeCmd`'s chain | one `cmd()` with three `&&`-joined commands | three sequential `run`s |
| config get/set | `cmd(\`git config … "${value}"\`)` | `run("git", ["config", name, value])` |
| ten static sites | `cmd("git --no-pager branch")` | `run("git", ["--no-pager", "branch"])` |
| `openWorktreePath` | `exec(\`${codeEditor} ${path}\`)` | argv-split head + `[...tail, path]` |

### 4.3 What disappears

- The `cd …` prefix at five sites, and the `&&` chaining at two.
- `const currentPath = process.env.PWD` (`src/lib/git.ts:230`) and the `gotoBack` it feeds — the only
  `process.env.PWD` read in the codebase. **That deletion removes a latent failure, not only dead code**
  (found at Phase 3's Gate 2): `PWD` is not guaranteed to be in the environment of a non-shell parent, and
  when it was unset the chain ended in `cd undefined`, which exits non-zero — so `cmd()` rejected *after*
  the worktree had already been created successfully.
- `CmdOptions.debug` (D4), and eventually `cmd()` and the `exec` import in `cli.ts`.

### 4.4 The test surface

This is the part the draft does not cover, and it is what sizes the work. `src/test-setup.ts` mocks
`./lib/cli.js` **globally** and its `afterEach` maps `mockCmd.mock.calls` to `call[0]` — a command string.
Sixteen assertions across `src/lib/git.test.ts` (23 mock references), `src/integrations/github.test.ts` (7)
and `src/integrations/jira.test.ts` (2) assert on that string. Each migrated call site moves its assertion
from `toHaveBeenCalledWith("git …")` to `toHaveBeenCalledWith("git", […], { cwd })`, in the same commit as
the source change.

## 5. Risks

**R1 — `gitCreateWorktree` is the highest-consequence migration.** The comment at `src/lib/git.ts:235-236`
says the `cd` to the git root is deliberate: it makes `git worktree add` receive a **relative**
`worktreePath` so the layout survives the project being moved on disk. Getting `cwd` wrong there does not
error — it creates a worktree in the wrong place. Response: Phase 3 asserts both the `cwd` and the relative
path shape, and §7 case 2 checks the resulting `.git` file by hand.

**The premise behind that comment does not hold on git 2.38.1, measured at Phase 3 rather than assumed.**
`git worktree add` resolves the path it is given and records an **absolute** one in both link files, so a
relative argument, an absolute argument and the pre-change shell form produce byte-identical
`.git` and `.git/worktrees/<n>/gitdir` contents; after moving the containing directory all three fail
alike with `fatal: not a git repository`. What R1 asked of Phase 3 is unaffected — the argument stays
relative and the behaviour is unchanged — but the comment now states a benefit this git version does not
deliver. Recorded as F-010, which is where the decision belongs: correct the comment, or reach for
`git worktree add --relative-paths` (git 2.48+) and actually deliver it.

**R2 — a `codeEditor` value with quoted arguments regresses.** `code -n` splits correctly on whitespace.
`open -a "Visual Studio Code"` does not — today the shell parses those quotes, and after D6 it becomes three
argv entries. Narrow but real, and it is a behaviour change a user could see, against §2. Response: Phase 6
documents the contract on the configuration page. See §8 Q2 — whether to reject such values at config time
is not settled here.

**R3 — the global mock warns instead of failing.** `src/test-setup.ts`'s `afterEach` `console.warn`s on
unexpected calls; it does not fail the test. So a migration that changes *which* commands are issued
can pass a green suite while printing a warning nobody reads. Response: each phase's **Done when** names the
assertion, not just the green run, and §7 case 4 greps the captured output for the warning. **Extended at
Phase 2 to cover `run` as well as `cmd`** (F-006): `describeRunCall` renders a `run` call as its argv joined
plus the cwd when one is given, so `expectedCommands` stays a `string[]` and a call site moving to `run`
stays inside the guard. The warning text is now `Unexpected subprocess calls detected`. The guard was proved
non-vacuous by deleting a declared entry and watching it fire, not by assuming it would.

**R4 — overlap with two other roadmap entries.** `agent-mode` Phase 2 edits `src/lib/base-command.ts` and
creates `src/lib/base-command.test.ts` — the same file this plan's Phase 6 creates. `cleanup-data-loss`
touched `src/lib/git.ts`'s `isSafeToRemove`, and `gitNukeWorktreeCmd` is in this plan's Phase 4. Response:
this is a sequencing question, not a design one — see §8 Q1.

**R5 — `execFile` has a default `maxBuffer`.** `exec` and `execFile` both default to 1 MB of stdout in
current Node. `git worktree list` or `git --no-pager branch -r` in a very large repository could exceed it,
and the failure mode is a rejected promise, not truncation. Unchanged from today — `exec` has the same
default — so this is not a regression, but it is now worth knowing. Not mitigated. **Re-verified at
Phase 1's Gate 2** by running both against a 1 MB stdout on Node 24: identical
`ERR_CHILD_PROCESS_STDIO_MAXBUFFER` at 1 048 576 bytes. The claim is measured, not inferred.

**R6 — `execFile` cannot launch a Windows `.cmd` or `.bat` shim.** Found at Phase 1's Gate 2 and **not in
the original inventory.** `exec` always goes through a shell; `execFile` defaults to `shell: false`, and
since the Node 18.20/20.12 spawn hardening a `.cmd`/`.bat` shim on Windows needs `shell: true` to launch at
all. This barely touches git — `git.exe` is a real binary — but it lands squarely on **Phase 6**, where a
`codeEditor` of `code` is `code.cmd` on Windows, and on `commandExists` in Phase 5, which already branches
on `win32` (`src/lib/cli.ts:57`). **Unverified from macOS**: the restriction lives in libuv's Windows
`uv_spawn`, not in the JS layer, so this is a question Phase 6's design must answer rather than a
demonstrated defect. Do not close it by assertion.

**Answered at Phase 6 from Node's own source, not by assertion.** Three things, each read rather than
recalled, on 2026-09-05:

- **Node 24.19.0's JavaScript layer contains no batch-file handling at all.** All 371 builtin module
  sources — every key of `process.binding("natives")` bar the non-string `configs` — were read and scanned.
  `.bat` and `IsWindowsBatchFile` return **zero** lines; the 16 `.cmd` lines, across 5 modules, are all
  property reads in the child-process and cluster IPC code — `message.cmd` twelve times, `msg.cmd` three
  and `ex.cmd` once — not batch-file handling. So there is no JS branch to take, and nothing there that can be probed from macOS. (Stated
  loosely as "zero matches for the pair" when first written, and corrected at Gate 2, which reproduced the
  scan.)
- **The rejection is native and deliberate.** `src/process_wrap.cc` on `v24.x` — the async spawn path
  `execFile` uses — sets `err = UV_EINVAL` when `IsWindowsBatchFile(options.file)`, under the comment that
  spawning batch files directly "is potentially insecure because arguments are not escaped (and sometimes
  cannot be unambiguously escaped), hence why they are rejected here." `src/spawn_sync.cc` carries the same
  guard.
- **An extension-less `code` never even reaches that guard.** libuv's `path_search_walk_ext`
  (`deps/uv/src/win/process.c`) appends only `.com` and `.exe` — "Since CreateProcess can start only .com
  and .exe files" — so `code` fails `ENOENT` before `code.cmd` is considered.

**The design answer is no Windows branch.** The only way to launch a `.cmd` shim is `shell: true`, and Node
refuses that path for exactly the argument-escaping hazard this plan exists to remove; re-adding a shell at
the one site that interpolates a user-supplied config value would undo the change at its own last call
site. The contract is documented on the configuration page instead. The consequence is **recorded as F-012,
not closed here** — it is measured from Node's source, never observed on a Windows host.

**R7 — two caller-observable error differences that §2 should acknowledge.** §4.1's "no caller's error
handling changes" is very slightly overstated, in two ways found by measurement at Phase 1's Gate 2:

- **The message prefix shrinks.** `src/lib/git.ts:253` surfaces a rejection with
  `spinner.fail(error.message)`. Both forms carry `Command failed: …` plus stderr, so nothing is lost, but
  at **Phase 3** the prefix goes from `cd /x && git fetch && git worktree add …` to `git worktree add …`.
  That is an improvement and still a user-visible text change. Phase 3 should state it deliberately rather
  than let it happen. **Measured at Phase 3, not predicted:** the same failing `worktree add` gave
  `Command failed: cd /…/proj && git fetch && git worktree add --no-track -b feature/abs
  ../proj.worktrees/feature/abs main` before and `Command failed: git worktree add --no-track -b
  feature/abs ../proj.worktrees/feature/abs main` after, with the stderr detail retained in both. **It happened at Phase 2 as well**, found at that phase's Gate 2 and measured: a
  vanished `cwd` on the three migrated reads now rejects with `spawn git ENOENT` where the old form gave
  `Command failed: cd /x && git status -s`. Narrow — `git.ts:194` gates all three behind `pathExists`, so
  reaching it needs a race — and it is the same class of change this risk already accepts. **And a third
  time at Phase 4**, stated here deliberately because it is the one instance that reaches a user unswallowed:
  a rejection from `gitNukeWorktreeCmd` on the `gitRemoveWorktreesWithProgress` path (`git.ts:375`) is
  awaited bare by `src/commands/cleanup.ts:89` and `src/commands/remove.ts:92` and surfaces at
  `src/lib/base-command.ts:75`, so its text goes from
  `Command failed: git worktree remove X && git worktree prune && git branch -D X` to
  `Command failed: git worktree remove X`. The `gitNukeWorktree` path is unaffected — `git.ts:296-300`
  catches and prints a fixed message.
- **`code` changes type when the file is missing.** `exec` rejects with a numeric `127` from the shell;
  `execFile` rejects with the string `"ENOENT"`. Harmless today — `grep -rn 'error\.code|\.code ===' src/`
  returns nothing, so no caller branches on it — but a future caller must not assume a number.

## 6. Phases

### 6.1 Status ledger

| # | Phase | Status | Depends on | Note |
|---|---|---|---|---|
| 1 | `run()` helper, `cwd` support, and its global mock | done | — | Gate 2 `PASS WITH NOTES`; R5 re-verified, not a regression |
| 2 | The three read-only `cd` sites | done | 1 | Gate 2 `PASS WITH NOTES`; F-006 closed, F-008 raised — §7 case 1 blocked by it |
| 3 | `gitCreateWorktree`'s four-command chain | done | 1 | Gate 2 `PASS WITH NOTES`; F-009 and F-010 raised; R1's premise disproved on git 2.38.1, behaviour unchanged |
| 4 | Config get/set and `gitNukeWorktreeCmd` | done | 1 | Gate 2 `PASS WITH NOTES`; §7 case 3 run and the pre-change form proved live; F-011 raised |
| 5 | Static sites, `commandExists`, and deleting `cmd()` | done | 2, 3, 4 | Gate 2 `PASS WITH NOTES` then `PASS`; `cmd()` gone; F-007 closed; R3 guard re-proved non-vacuous |
| 6 | `openWorktreePath` — the last `exec` | done | 1 | Gate 2 `PASS WITH NOTES`; R6 answered from Node's source; F-012 and F-013 raised; `exec` gone from `src/` entirely |

Status is one of `not started`, `in progress`, `blocked`, `done`. `done` only when committed and verified,
and whoever finishes a phase updates the row in the same commit.

**Exactly one table in this document has these columns.** Do not add a second phase table — a
differently-shaped one nearby is a decoy that gets read by mistake.

### 6.2 The phases

#### Phase 1 — `run()` helper, `cwd` support, and its global mock

**Files:** `src/lib/cli.ts`, `src/lib/cli.test.ts` (new), `src/test-setup.ts`

**Scope:** Add `run(file, args, opts)` per §4.1 — `execFile`, `{ cwd }`, same resolve/reject shape as
`cmd()`. Add `run` to the `vi.mock` factory in `src/test-setup.ts` (D7). **No call site migrates in this
phase** and `cmd()` is untouched. `src/lib/cli.test.ts` does not exist today — this phase creates it.

**Done when:** `run("git", ["status", "-s"], { cwd })` resolves trimmed stdout, rejects on a non-zero exit,
and passes `cwd` through, all covered in `cli.test.ts`; `pnpm test` is green with `cmd()` still present and
**every existing assertion unmodified**.

#### Phase 2 — The three read-only `cd` sites

**Files:** `src/lib/git.ts`, `src/lib/git.test.ts`

**Scope:** Migrate `gitGetCommitsAheadCount` (`git.ts:85-87`), `gitGetCommitsBehindCount` (`git.ts:94-96`)
and `gitGetUncommittedChangesCount` (`git.ts:103`) to `run("git", […], { cwd: branchPath })`. The
`cd ${branchPath} &&` prefix is deleted, not quoted (D3). Move each function's assertion to the argv form
(§4.4).

**Also in scope — F-006, and it is the reason this phase is where R3 lives or dies.** The `afterEach`
guard in `src/test-setup.ts` maps `mockCmd.mock.calls` only. These are the first call sites to move onto
`mockRun`, so from this phase on every migrated call is invisible to that guard and §7 case 4's grep goes
quietly vacuous — the opposite of what R3 asks for. Decide the shape here: either extend the guard to cover
`run` (`expectedCommands: string[]` cannot hold an argv triple unchanged, so this is a shape decision, not a
one-line edit) or retire R3's mitigation explicitly in this document. Do not leave it implicit.

**Done when:** none of the three functions' bodies contain the string `cd `; their tests assert
`("git", [...], { cwd })`; a `branchPath` containing a space produces a correct call (§7 case 1); F-006 is
either closed or consciously retired.

#### Phase 3 — `gitCreateWorktree`'s four-command chain

**Files:** `src/lib/git.ts`, `src/lib/git.test.ts`

**Scope:** Replace the `${cdRoot} && ${gitFetch} && ${addWorktree} && ${gotoBack}` chain
(`git.ts:237-247`) with two sequential `run` calls under `{ cwd: gitRootPath }` (D5). Delete `gotoBack`
and the `process.env.PWD` read at `git.ts:230`. **Preserve the relative `worktreePath`** and the comment
at `git.ts:235-236` explaining why it is relative (R1).

**Done when:** `gitCreateWorktree` issues exactly two subprocess calls, both with `cwd` at the git root;
the `worktree add` argv still carries the **relative** path; both the `isCheckout` and non-`isCheckout`
branches are covered; `process.env.PWD` appears nowhere in `src/`.

#### Phase 4 — Config get/set and `gitNukeWorktreeCmd`

**Files:** `src/lib/git.ts`, `src/lib/git.test.ts`, `src/test-setup.ts`,
`src/integrations/jira.test.ts`, `src/integrations/github.test.ts`

The last three were not in this line as written and were added at the phase, not assumed: `test-setup.ts`
is mandated by the "Also decide here" paragraph below, and the two integration test files mock the config
helpers through `cmd`, so §2's "green at every phase boundary" forces them to move in this commit rather
than in Phase 5, whose Files list already names them.

**Scope:** Migrate `gitGetConfigValue` (`git.ts:17`) and `gitSetConfigValue` (`git.ts:24`) — the
arbitrary-value site that is `agent-mode`'s R1 — plus `gitNukeWorktreeCmd`'s three-command chain
(`git.ts:266-270`) into sequential `run` calls (D5).

**Also decide here:** `describeRunCall` in `src/test-setup.ts` renders a `run` call by joining its argv on
spaces, so `["config", name, "a b"]` and `["config", name, "a", "b"]` read identically in the R3 guard.
Phase 2 accepted that because no call site then passed an argv element containing a space. **Phase 3 is
where that stopped being hypothetical** — its spaced-root case declares
`git worktree add … ../my project.worktrees/feature/test …`, which the guard renders exactly as two argv
entries would. `gitSetConfigValue` is the first site to pass such an element in production rather than in a
fixture, and §7 case 3's hostile value is exactly that shape. Either quote spaced elements in
the rendering or accept the collision knowingly — do not leave it unexamined.

**Settled 2026-09-05: quoted.** `describeRunCall` (`src/test-setup.ts:31-33`) wraps any element matching
`/\s/` in double quotes, so one spaced argument no longer reads as two. Two declarations moved with it —
Phase 3's spaced-root entry and this phase's hostile value — and they are the only whitespace-bearing argv
strings in any `expectCommands` call. The `cwd` is left unquoted: it is a single labelled trailing field,
so it has no boundary to lose. The quoting does not escape an embedded `"`, which is why
`src/test-setup.ts:22-24` keeps saying the rendering is a diagnostic and `toHaveBeenCalledWith` is the
assertion.

**Done when:** a config value containing `"`, a backtick and `;` round-trips through set-then-get unchanged
and is asserted as a single argv element; `gitNukeWorktreeCmd` issues three sequential calls that stop at
the first rejection; the `force` branch still appends `--force`.

#### Phase 5 — Static sites, `commandExists`, and deleting `cmd()`

**Files:** `src/lib/cli.ts`, `src/lib/cli.test.ts`, `src/lib/git.ts`, `src/lib/git.test.ts`,
`src/integrations/github.ts`, `src/integrations/github.test.ts`, `src/integrations/jira.test.ts`,
`src/test-setup.ts`

**Scope:** Migrate the ten static call sites (`git.ts:28, 32, 36, 65, 71, 76, 108, 133` and
`github.ts:113, 147`) and `commandExists` (`cli.ts:34`). Then delete `cmd()`, `CmdOptions.debug` (D4), the
`exec` import in `cli.ts`, and the `cmd` entry in the global mock factory.

**Done when:** `grep -rn --include='*.ts' '\bcmd(' src/` returns nothing outside `*.test.ts` history;
`grep -rn --include='*.ts' 'exec(' src/` returns only `src/lib/base-command.ts`; `pnpm test` and
`pnpm typecheck` green.

**Recorded at the phase, 2026-09-05.** Three things this phase settled that the scope above did not
anticipate:

- **`gitGetRootPath` moving onto `run` changes what `gitCreateWorktree`'s tests count.** Phase 3's **Done
  when** said "exactly two subprocess calls", and that was true when it was written: the root lookup went
  through `cmd`, a separate mock. It is now a third `run` call ahead of the fetch and the add, so that
  describe asserts `3` and the fetch-failure case stops at call 2. Nothing about `gitCreateWorktree`'s own
  body changed — it still issues two calls of its own — and Phase 3's claim is left as written rather than
  back-dated. `vi.spyOn` returns the existing mock when the property is already one, so every
  `mockResolvedValueOnce` across a migrated test now sits in a single ordered queue; that is what made the
  ordering, not just the count, the thing to check in this phase's tests.
- **The `for-each-ref` format loses its quotes, and that is the correct migration.** The shell form carried
  `--format='%(refname:short) <- %(upstream:short)'`, whose single quotes the shell stripped before git saw
  them. As one argv element the quotes must not be there. Verified byte-for-byte rather than reasoned
  about: `sh -c` with the old string and `execFile` with the new argv produce identical output on this
  repository. `git rev-parse  --show-toplevel`'s double space collapses for the same reason.
- **`commandExists` gained its first tests.** It had none, and this phase is what moves it off `cmd`. The
  three cases in `src/lib/cli.test.ts` pin that a command on `PATH` resolves `true`, an absent one `false`,
  and that only the head of a command line is looked up — the last being the contract D6 relies on at
  Phase 6. `beforeAll` prepends `dirname(process.execPath)` to `PATH` so the hit does not depend on how the
  suite was launched. The `win32` branch stays untested, per R6.

#### Phase 6 — `openWorktreePath` — the last `exec`

**Files:** `src/lib/base-command.ts`, `src/lib/base-command.test.ts` (new),
`docs/src/app/docs/configuration/page.mdx`, `docs/src/app/docs/guides/editor-integration/page.mdx`
(added at the phase — see §9)

**Scope:** Replace `exec(\`${codeEditor} ${path}\`)` (`base-command.ts:56`) with the D6 argv split, keeping
the existing ora spinner success/fail behaviour exactly. Document on the configuration page that
`codeEditor` is a command line split on whitespace, and that quoted arguments are not supported (R2).
`src/lib/base-command.test.ts` does not exist today — this phase creates it. **See R4: `agent-mode` Phase 2
creates the same file.**

**Done when:** `grep -rn --include='*.ts' 'exec(' src/` returns nothing outside `*.test.ts`; a worktree path
containing a space opens; `base-command.test.ts` asserts the argv without launching a real editor; the
spinner still fails with the error message on a rejected call.

**Recorded at the phase, 2026-09-05.** Five things this phase settled:

- **R6 is answered in §5, from Node's and libuv's source**, and the answer is that no Windows branch is
  added. The user-facing half lands on the configuration page; the unobserved half is F-012.
- **The launch stays fire-and-forget.** `exec`'s callback was never awaited, so `run(…).then(succeed, fail)`
  is not either — `openWorktreePath` still returns as soon as the child is spawned, and the spinner settles
  when it exits. Awaiting would have made all three callers (`branch.ts:184`, `checkout.ts:71`,
  `open.ts:46`) block until the editor process closed, which is a behaviour change §2 does not allow.
  Biome's `noFloatingPromises`, enabled in `biome.json`, accepts the two-argument `.then`; `pnpm check` is
  green.
- **R7, a fourth time, and stated deliberately.** An editor that cannot be launched used to fail with
  `Command failed: <editor> <path>` plus the shell's own `command not found` line, and now fails with
  `spawn <editor> ENOENT`. Narrow: `isValidConfigValue` routes `codeEditor` through `commandExists`
  (`validators.ts:66-67`), and both config paths validate — `config.ts:221` interactively, `config.ts:250`
  for `worktree config <name> <value>` — so an unfound editor is rejected at config time. **That mitigation
  inverts on Windows**, where `commandExists` runs `where` (`cli.ts:31`), which resolves `PATHEXT` and so
  finds `code.cmd`, while launching the stored value `code` fails `ENOENT` — libuv's path search tries only
  `.com` and `.exe` (the `UV_EINVAL` refusal needs the value to name the batch file outright). Carried in
  F-012, not here.
- **The split is `trim().split(/\s+/)`, not `split(" ")`.** `commandExists` looks up
  `command.split(" ")[0]` (`cli.ts:28`), and the two agree on the head for every value that passes that
  validation; the stricter form additionally stops a doubled space from becoming an empty argv element.
  Pinned by the third case in `src/lib/base-command.test.ts`.
- **The fire-and-forget property itself is not pinned**, and Gate 2 measured that: adding `await` at
  `src/lib/base-command.ts:65` leaves all six cases passing. Recorded as F-013 rather than fixed, for the
  reason F-009 and F-011 record — the same shape of gap, one phase on.

## 7. Verification

[`../verify.md`](../verify.md) names the commands — this file does not repeat them. Beyond Gate 1:

1. **The space-path case, by hand, at Phase 2. Run 2026-09-05 — blocked by F-008, and verified another
   way.** Create a worktree under a path containing a space and run `worktree list`. Ahead/behind/uncommitted
   counts must be real numbers, not blanks. **`worktree list` prints no rows at all under a spaced repo
   path**, for a reason that has nothing to do with this plan: `gitGetWorktrees` splits the `git worktree
   list` line on single spaces and truncates the path, so every entry fails its own filter before the three
   migrated functions are reached. Recorded as F-008. Phase 2's claim was verified against the same real
   repository instead, by calling the built `dist/lib/git.js` directly with the spaced worktree path —
   `ahead: 1`, `behind: 0`, `uncommitted: 1`, the fixture's exact values, where the pre-change
   `exec("cd /…/space demo/… && git status -s")` form failed on the identical path. **Re-run this case as
   written once F-008 is fixed.**
2. **The relative-path check, by hand, at Phase 3. Run 2026-09-05 — first half confirmed, second half
   disproved for both forms.** After `worktree branch <name>`, read the `.git` file in the new worktree and
   confirm it points at a path of the same shape as before this change (R1). Then move the repository
   directory and confirm the worktree still resolves — that is what the relative path buys. Run against a
   scratch repo by calling the built `dist/lib/git.js` directly, alongside a shell reproduction of the exact
   pre-change command in the same repository: **the recorded links are byte-identical between the two
   forms** — worktree `.git` holds `gitdir: <abs>/.git/worktrees/<n>` and `.git/worktrees/<n>/gitdir` holds
   `<abs>/<worktree>/.git` in both — so the first half passes. An absolute argument produces identical links
   too, and after moving the containing directory **all three forms fail alike** with
   `fatal: not a git repository`, so the second half's expectation is false on git 2.38.1 for reasons that
   predate this change. See R1 and F-010.
3. **The hostile-value case, at Phase 4. Run 2026-09-05 — passed, and the pre-change form proved live.**
   `worktree config codeEditor 'x"; touch /tmp/pwned; #'` must store the literal string and create no file.
   Run against a scratch repo by calling the built `dist/lib/git.js` directly, with the marker path inside a
   scratch directory rather than `/tmp`. The value carried a quote, a semicolon, a `#` and a backtick pair;
   `gitSetConfigValue` then `gitGetConfigValue` round-tripped all of it byte-for-byte, `git config` held the
   whole string, and **no file was created**. Then the *exact* pre-change shell string
   (`git config northguild.worktree.codeEditor "${value}"` through `exec`) was reproduced in the same
   repository: it exited 0, stored `x`, and **created the marker file** — so the injection this phase closes
   was live rather than theoretical, and the check is not vacuous. Re-verified independently at Gate 2.
4. **Grep the test output for the R3 warning** at every phase: a run that prints
   `Unexpected subprocess calls detected` is a failure even when vitest is green. The string was
   `Unexpected cmd calls detected` until Phase 2 extended the guard to `run` (R3, F-006) — grep for the
   current one.
5. **The spaced-path editor launch, at Phase 6. Run 2026-09-05 — passed, and the pre-change form proved
   broken.** Set `codeEditor` in a scratch repo to a recorder that appends its own `process.argv.slice(2)`
   to a file, then drive the built `dist/lib/base-command.js` through a concrete subclass with a worktree
   path containing two spaces (`…/space demo/proj.worktrees/feature/my branch`). The recorder received
   **one** argument, the whole path, and the spinner succeeded. The *exact* pre-change form
   (``exec(`${codeEditor} ${path}`)``) reproduced in the same repository handed the recorder **three**
   fragments — `…/space`, `demo/proj.worktrees/feature/my`, `branch` — and reported no error, so the defect
   was live rather than theoretical and this check is not vacuous. The recorder doubles as the
   leading-argument case: `codeEditor` was `node <recorder.mjs>`, which is a two-element command line.

## 8. Open questions

- **Q1 — sequencing against `agent-mode` and `cleanup-data-loss`. Settled 2026-09-05: this plan holds the
  slot.** Activated ahead of `agent-mode` on the argument it and `agent-mode`'s §8 Q4 both make — that
  `agent-mode` Phase 1 pushes `agent.command`, a value containing spaces, through the `gitSetConfigValue`
  quoting this plan's Phase 4 fixes. The consequence for Phase 6 stands: it **creates**
  `src/lib/base-command.test.ts`, and `agent-mode` Phase 2 merges into it rather than creating it.
- **Q2 — should a `codeEditor` value with quotes be rejected at config time?** R2 makes such a value
  silently misbehave after D6. `isValidConfigValue` (`src/lib/validators.ts:57-70`) is where a check would
  go, and `agent-mode` D1 proposes an `isValidCommandLine` for exactly this shape. Deferring: adding the
  validator here would collide with that plan's Phase 1.
- **Q3 — do branch names need validation as well as argv-safety?** Carried from the draft, unresolved.
  `isValidBranchName` (`src/lib/validators.ts:22-55`) already rejects spaces and several metacharacters, but
  it is **not applied on every path a branch name reaches a subprocess call by** — `gitNukeWorktreeCmd` takes
  whatever it is handed. Argv-safety makes this non-exploitable, so it is now a correctness question rather
  than a security one. **Sharpened at Phase 4's Gate 2:** the concrete residue is that `branchName` reaches
  `git worktree remove` and `git branch -D` (`git.ts:278-285`) with no `--` end-of-options separator, so a
  name beginning with `-` is still read as a flag. Unchanged from the shell form and not introduced by the
  migration — but it is what this question is actually about now, and `--` is the one-line answer if it is
  taken up.
- **Q4 — is `run` the right name? Settled 2026-09-05: yes, `run`.** Confirmed against the tree rather than
  waved through: no `src/commands/*.ts` imports from `cli.js` today, so the only file that will see both
  names is `src/lib/base-command.ts` after Phase 6, where the inherited oclif method is reached as
  `this.run()` and the helper as `run()` — distinct to TypeScript and to a reader. `execCmd` was the
  considered alternative and was rejected for costing a rename across §4.1, all six phases and §10 to buy
  nothing. `sh` was rejected as actively misleading: the point of the change is that no shell is involved.
  **Do not revisit.**

## 9. Surfaces to update — all verified to exist

- `docs/src/app/docs/configuration/page.mdx` — the `codeEditor` contract note (Phase 6). It documents the
  value at lines 12 and 28 with no mention of arguments today.
- `docs/src/app/docs/guides/editor-integration/page.mdx` — **missed by this sweep and found at Phase 6's
  Gate 2.** Its closing line told the reader to set `codeEditor` to "the matching shell command", which
  Phase 6 makes false. Corrected there, after the Gate 2 diff, and re-reviewed.
- **No generated-surface sweep is needed, and this was checked rather than assumed.** `skills/core/SKILL.md`
  lists `src/lib/git.ts` and `src/lib/validators.ts` in `sources`, and both paths survive; its frontmatter
  `description` enumerates commands and config values, none of which change. No command is added, so
  `docs/src/app/docs/commands/_meta.ts` is untouched.
- `docs/src/app/docs/changelog/page.mdx` — **not touched.** It explicitly records a "single latest-docs
  strategy" with no per-release notes, so there is no entry to add.
- `README.md` — no feature-list change; nothing in it describes subprocess behaviour.

## 10. What already holds in this repo

Read, not recalled — checked 2026-09-05 on `feature/add-agent-mode`. The first nine rows are the draft's
own table, re-verified; the rest were found while writing this plan.

| Claim | Status |
|---|---|
| `cmd()` is the only shell boundary for git calls | confirmed, `src/lib/cli.ts:7-25` |
| `base-command.ts:56` bypasses `cmd()` and calls `exec` directly | confirmed |
| `CmdOptions` has no `cwd` | confirmed, `src/lib/cli.ts:3-5` |
| Five interpolation sites exist only to work around that | confirmed, `git.ts:86, 95, 103, 237, 245` — the first three deleted by Phase 2, leaving two |
| The create-worktree call chains four commands with `&&` | confirmed, `git.ts:247` |
| `commandExists` splits on whitespace and checks only the head | confirmed, `src/lib/cli.ts:27-39` |
| No `src/lib/base-command.test.ts` exists | confirmed, `ls src/lib/` — Phase 6 creates it |
| `src/integrations/` contains no `exec`/`spawn` of its own | confirmed |
| A path containing a space fails today | **re-demonstrated 2026-09-05** — see §1 |
| Exactly 18 non-test `cmd()` call sites; 10 static, 8 interpolating | confirmed by `grep -rn --include='*.ts' '\bcmd(' src/` |
| `CmdOptions.debug` is passed by no caller | confirmed — `grep` returns only `cli.ts:4,9,12` |
| No `src/lib/cli.test.ts` exists | confirmed, `ls src/lib/` — Phase 1 creates it |
| `src/test-setup.ts` mocks `./lib/cli.js` globally with an explicit factory | confirmed, `src/test-setup.ts:5-8` — the D7 constraint |
| Its `afterEach` warns, and does not fail, on unexpected calls | confirmed, `src/test-setup.ts:19-31` — R3; still warns, now at `:39-56` and covering `run` too after Phase 2 |
| 16 assertions across 3 test files assert on the command string | confirmed, `git.test.ts` (23 mock refs), `github.test.ts` (7), `jira.test.ts` (2) |
| `process.env.PWD` is read exactly once in `src/` | confirmed, `git.ts:230` — deleted by Phase 3 |
| The relative worktree path is deliberate, with a comment saying why | confirmed, `git.ts:235-236` — R1 |
| The changelog page keeps no per-release notes | confirmed, `docs/src/app/docs/changelog/page.mdx` |

### Corrections to the draft

The draft's line numbers were correct when written and have since drifted. Four are restated here so the
phases are not read against stale citations:

| Draft said | Actually | What it is |
|---|---|---|
| `git.ts:231` | `git.ts:237` | `const cdRoot = \`cd ${gitRootPath}\`` |
| `git.ts:239` | `git.ts:245` | `const gotoBack = \`cd ${currentPath}\`` |
| `git.ts:241` | `git.ts:247` | the four-command chained `cmd()` call |
| `git.ts:261-263` | `git.ts:266-270` | `gitNukeWorktreeCmd`'s three-command chain |

The draft's own two corrections to the material it was given — `git.ts:94` → `:95`, and "every subprocess
call builds a shell string" being too broad — both still hold and are carried into §1 and the table above.

## 11. Findings log

Closed findings tied to this feature, moved here from [`../findings.md`](../findings.md) at
`/feature-close` so that file does not grow for the life of the project.

### F-006 — P2 — the unexpected-call guard watches `cmd` only, so it goes vacuous as call sites migrate

**Tied to:** Phase 2 · **Raised:** 2026-09-05 (Gate 2, reviewer subagent, Phase 1) ·
**Closed:** 2026-09-05 (Gate 1, Phase 2)

`src/test-setup.ts:23` built its unexpected-call list from `mockCmd.mock.calls` alone, so every call site
moving to `run` would have left that guard's field of view.

**Fixed in Phase 2.** The `afterEach` at `src/test-setup.ts:39-56` now folds both mocks into one list, with
`describeRunCall` (`src/test-setup.ts:23-31`) rendering a `run` call as its argv joined plus the cwd when
one is given — the same information the `cd ${path} && …` prefix carried. The shape decision F-006 asked
for is that `expectedCommands` stays a `string[]`: the rendering is a diagnostic, and what each call site
passes is asserted by `toHaveBeenCalledWith` in the tests themselves. The warning text is now
`Unexpected subprocess calls detected`, and the plan's §7 case 4 was updated to grep for that string.

**Proved non-vacuous rather than assumed:** deleting one declared entry from `git.test.ts`'s
`expectCommands` made the guard print
`Unexpected subprocess calls detected:\n  - git status -s (cwd: /repo/project.worktrees/test)`; restoring
it returned the run to zero warnings. Gate 1 on the Phase 2 commit: `pnpm check`, `pnpm typecheck`,
`pnpm build`, `pnpm test` (207 passed) and `pnpm docs:test` (49 passed) all exit 0, with zero occurrences
of `Unexpected` in the captured test output.

`cleanup-data-loss`'s F-001 moved to [`CLEANUP-DATA-LOSS-PLAN.md`](CLEANUP-DATA-LOSS-PLAN.md) §10 on
2026-09-05.

### F-007 — P3 — `cli.test.ts`'s `afterAll` would mask a failure in its own `beforeAll`

**Tied to:** Phase 1 · **Raised:** 2026-09-05 (Gate 2, reviewer subagent, Phase 1) ·
**Closed:** 2026-09-05 (Gate 1, Phase 5)

`src/lib/cli.test.ts`'s `afterAll` called `rmSync(tempPath, …)` unconditionally, so a throwing
`mkdtempSync` in `beforeAll` would have left `tempPath` undefined and reported an
`ERR_INVALID_ARG_TYPE` from the cleanup instead of the real failure.

**Fixed in Phase 5**, and in scope rather than swept in: Phase 5's **Files** names `src/lib/cli.test.ts`,
and the phase already had to edit that exact `afterAll` block to restore the `PATH` its new `commandExists`
cases mutate. The guard is `if (tempPath)` at `src/lib/cli.test.ts:47-49`; `tempPath` is declared
`let tempPath: string` with no initializer, so it is genuinely `undefined` on that path.

The PATH restore next to it raised the same class of defect one line earlier and was fixed with it:
assigning a `string | undefined` back would have written the literal string `"undefined"` onto `PATH`, so
an unset `PATH` is restored by `delete process.env.PATH` (`src/lib/cli.test.ts:43-51`). Verified both
directions rather than assumed — after `delete`, `'PATH' in process.env` is `false`, which is the real
pre-`beforeAll` state.

Gate 1 on the Phase 5 commit: `pnpm check`, `pnpm typecheck`, `pnpm build`, `pnpm test` (219 passed) and
`pnpm docs:test` (49 passed) all exit 0, with zero occurrences of `Unexpected` in the captured test output.
Gate 2 returned `PASS`, having verified the guard and the restore against the file.

### Still open at retirement

Six findings tied to this feature were open when it was retired, and **stay in
[`../findings.md`](../findings.md)** — only closed findings move here. None gated the close: five are `P2`
and one `P3`, and only `P0`/`P1` blocks. They are recorded here so the archive does not read as if the
feature retired clean:

| Id | Sev | Phase | What it is |
|---|---|---|---|
| F-008 | P2 | 2 | `gitGetWorktrees` splits the `worktree list` line on a space, so a repo under a spaced path lists nothing |
| F-009 | P2 | 3 | the `worktree add` failure path is untested, so a dropped `await` would land green |
| F-010 | P3 | 3 | the relative `worktreePath` comment claims a property git 2.38.1 does not deliver |
| F-011 | P2 | 4 | the third `run` in `gitNukeWorktreeCmd` is unpinned against a dropped `await` |
| F-012 | P2 | 6 | a Windows `.cmd`/`.bat` editor can no longer be launched, and `code` is one there |
| F-013 | P2 | 6 | the editor launch is unpinned as fire-and-forget, so an added `await` would land green |

**F-008 has no home and this close does not give it one.** Its own text says so: no row in §6.1 touches
`gitGetWorktrees`, because it is stdout parsing rather than command construction, so no phase of this plan
could ever have closed it. It is the one finding here that describes a defect a user hits today — a
repository under a path containing a space lists no worktrees at all — and the likely fix,
`git worktree list --porcelain`, is a roadmap entry rather than a loose end. **Raise one with `/roadmap`,
or it stays open against a retired feature indefinitely.**

F-009, F-011 and F-013 are one shape three times: a sequential `run` whose `await` no test observes. Each
records the mutation that survives and the one case that would kill it. Whoever picks up any of them should
take all three — they are the same test, written three times.
