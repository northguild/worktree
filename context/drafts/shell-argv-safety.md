# shell-argv-safety — supplied reference material

Notes, not a design. Captured by `/roadmap` on **2026-09-05**. `/feature-plan` turns this into
`plans/SHELL-ARGV-SAFETY-PLAN.md`; nothing here is a decision.

## Provenance

- Source: maintainer, pasted into `/roadmap` on 2026-09-05. Originated as analysis done while planning
  `agent-mode`, where it is recorded as risk R1 in `plans/AGENT-MODE-PLAN.md`.
- The **original** maintainer brief for `agent-mode` called this a single-site, commit-sized `/orchestrate`
  task citing only `src/lib/base-command.ts:56`. The inventory below is why it was filed as its own entry
  instead.
- Every citation re-verified against the tree on 2026-09-05, branch `feature/add-agent-mode`. Two claims in
  the supplied material were adjusted — see "Corrections".

## The shape of the problem — one chokepoint, one bypass

The supplied material framed this as "at least seven sites across two files". That count is right but the
framing understates how tractable it is. `grep -rn 'exec(\|execSync\|spawn(\|execFile' src/` over non-test
sources returns exactly **two** hits:

| Site | What it is |
|---|---|
| `src/lib/cli.ts:17` | `exec(cmd, …)` inside `cmd()` — **the single shell boundary every git call funnels through** |
| `src/lib/base-command.ts:56` | `exec(\`${codeEditor} ${path}\`, …)` — the one call that **bypasses `cmd()`** and shells out directly |

So this is not seven independent bugs. It is one helper with a string-shaped contract, one caller that
skipped the helper, and a set of call sites that interpolate into that contract.

## Why the `cd` workarounds exist

`CmdOptions` is `{ debug?: boolean }` (`src/lib/cli.ts:3-5`) — **there is no `cwd` option.** That absence is
the direct cause of five of the interpolation sites, which all shell out to `cd` to reach a worktree:

```
src/lib/git.ts:86    `cd ${branchPath} && git rev-list --count @{u}..HEAD`
src/lib/git.ts:95    `cd ${branchPath} && git rev-list --count HEAD..@{u}`
src/lib/git.ts:103   `cd ${branchPath} && git status -s`
src/lib/git.ts:231   `cd ${gitRootPath}`      ─┐ composed at :241 into one chained
src/lib/git.ts:239   `cd ${currentPath}`      ─┘ `${cdRoot} && ${gitFetch} && ${addWorktree} && ${gotoBack}`
```

**Adding a `cwd` option deletes these rather than escaping them.** That is the important consequence: the
fix is mostly subtraction, and `child_process.execFile` already takes `{ cwd }`.

## Full inventory of `cmd()` call sites

**18** non-test call sites (a naive grep finds 14 — four are formatted across lines and need
`grep -n '\bcmd('` to catch: `git.ts:85, 94, 108, 260`).

**Ten pass a static string** and are already safe: `git.ts:28, 32, 36, 65, 71, 76, 108, 133` and
`integrations/github.ts:113, 147`.

**Eight interpolate**, and are the work:

| Site | Interpolates | Source of the value |
|---|---|---|
| `git.ts:17` | `${name}` | a `ConfigName` from a fixed union — low risk |
| `git.ts:24` | `${name}`, `${value}` into `git config … "${value}"` | **arbitrary user input**, double-quoted only |
| `git.ts:86` | `${branchPath}` | filesystem path |
| `git.ts:95` | `${branchPath}` | filesystem path |
| `git.ts:103` | `${branchPath}` | filesystem path |
| `git.ts:241` | four commands chained with `&&`, composed from `231`, `236-237`, `239` — carrying `${branchName}`, `${worktreePath}`, `${sourceBranch}`, `${gitRootPath}`, `${currentPath}` | branch name + filesystem paths |
| `git.ts:261-263` | `${branchName}` ×2 into `git worktree remove` / `git branch -D` | branch name |
| `cli.ts:34` | `${checkCommand} ${baseCommand}` | `commandExists`, already head-split |

Plus `src/lib/base-command.ts:56` — the direct-`exec` bypass, which is not a `cmd()` call site at all.

## Demonstrated, not asserted

Run on 2026-09-05 against a directory whose path contains a space:

```
the pattern the CLI builds today:
  exec(`cd ${branchPath} && git status -s`)
  → FAILS: Command failed: cd /…/tmp/space demo && git status -s

the same call with an argv array and a cwd option:
  execFile("git", ["status", "-s"], { cwd: branchPath })
  → ok — no shell, no quoting
```

## Corrections to the supplied material

- **`git.ts:94` should be `git.ts:95`.** Line 94 is `const countStr = await cmd(`; the interpolated string
  is on the following line. Line 86 was cited correctly because that call is formatted differently.
- **"Every subprocess call … builds a shell string" is too broad.** Ten of the eighteen `cmd()` call sites
  pass static strings with nothing interpolated. The defect is in the *contract* — `cmd()` accepts a string
  and runs it through a shell — not in every caller.

## What already holds in this repo

| Claim | Status |
|---|---|
| `cmd()` is the only shell boundary for git calls | confirmed, `src/lib/cli.ts:7-25` |
| `base-command.ts:56` bypasses `cmd()` and calls `exec` directly | confirmed |
| `CmdOptions` has no `cwd` | confirmed, `src/lib/cli.ts:3-5` |
| Five interpolation sites exist only to work around that | confirmed, `git.ts:86, 95, 103, 231, 239` |
| `git.ts:241` chains four commands with `&&` in one shell string | confirmed |
| `commandExists` already splits on whitespace and checks only the head | confirmed, `src/lib/cli.ts:27-39` |
| No `src/lib/base-command.test.ts` exists | confirmed — a new file either way |
| `src/integrations/` contains no `exec`/`spawn` of its own | confirmed |
| A path containing a space fails today | **demonstrated above** |

## Not decided here

- Whether `cmd()` changes signature to `(file, args[], opts)`, gains an overload, or is replaced by a new
  helper with the old one kept for static strings.
- What happens to the chained command at `git.ts:241` — four sequential `execFile` calls with `{ cwd }`,
  or keep one shell call with proper quoting. The `cd`-back-afterwards half becomes unnecessary with `cwd`.
- Whether branch names need validation as well as escaping. `isValidBranchName`
  (`src/lib/validators.ts:22-55`) already rejects spaces and several metacharacters, but it is not applied
  on every path a branch name reaches `cmd()` by.
- Whether `debug: true` in `CmdOptions` still makes sense once commands are argv arrays.

## Relationship to other entries

- **`agent-mode`** records this as risk R1. Its Phase 1 stores `agent.command` — a value containing spaces —
  through `gitSetConfigValue` (`git.ts:24`), and its Phase 2 edits `base-command.ts`. Doing this first means
  agent mode is not built on the broken contract. Note that `agent-mode`'s own decision D2 already requires
  `spawn` with an argv array for agent dispatch, so that one path is safe regardless.
- **`cleanup-data-loss`** touches `git.ts` too (`isSafeToRemove`, and `gitNukeWorktreeCmd` at `261-263` is
  in this entry's table). The two overlap in that function; sequencing them avoids a conflict.
