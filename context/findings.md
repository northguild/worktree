# Findings

Defects that outlive the session that found them. A reviewer `FAIL`, a verification gate that hits its
loopback cap, or a defect found by hand all land here — **before** the loopback, not after it, so a finding
survives even when the cap is hit and the task is escalated.

## Contract

**Severity.** `P0` breaks production or data. `P1` blocks a phase or a gate. `P2` is a real defect that
does not block. `P3` is a note worth not losing.

**Tied to.** Either a phase — `<feature-name> Phase <n>` — or `ad-hoc` for a finding raised by
`/orchestrate` outside any feature.

**Gating.** An open `P0` or `P1` tied to a phase blocks that phase from being marked `done`, and blocks
`/feature-close` on the feature that owns it.

**Closing.** A finding closes when **the gate that raised it re-passes**, citing that run. There is no
"fixed but unverified" state — that implies an owner this workflow does not have.

**Bound.** Closed findings leave this file: a feature's at `/feature-close`, folded into the retiring
plan's own log; an `ad-hoc` one at the start of the next `/orchestrate`. This file must not grow for the
life of the project.

**Shape.** Entries go under **Open** below, newest last, and look like this:

> ### F-001 — P1 — one line naming the defect
>
> **Tied to:** some-feature Phase 2 · **Raised:** YYYY-MM-DD (by the gate that raised it, or "hand")
>
> What is wrong, where, and why it matters. Cite the file and the evidence.
>
> **Closes when:** the condition that closes it, naming the gate run that would prove it.

---

## Open

### F-002 — P3 — the `pathExists` ordering rationale in §4.1 is not pinned by any test

**Tied to:** cleanup-data-loss Phase 2 · **Raised:** 2026-09-05 (Gate 2, reviewer subagent, Phase 2)

§4.1's first bullet argues that `!wt.pathExists` must stay the first branch — a worktree whose directory is
gone holds nothing to lose. No test enforces it. `src/lib/git.test.ts:255-257` covers `{ pathExists: false }`
with the `entry()` default of `uncommittedChanges: 0`, which returns `true` under either ordering, so a
future change hoisting the uncommitted test above the path test would flip
`{ pathExists: false, uncommittedChanges: 3 }` from `true` to `false` with no test failing.

Latent, not live: `gitGetWorktreeList` hardcodes `uncommittedChanges` to `0` when the path is missing
(`src/lib/git.ts:200-202`), so the combination is unreachable from the list builder. Left open rather than
fixed because Phase 2's **Done when** names exactly two over-reach cases and this is not one of them —
adding it would have landed an unreviewed assertion after Gate 2 had already passed on the diff.

This matters sooner than it looks: `agent-mode` Phase 6 adds a live-agent clause to this same predicate
(§2, R2), and is the natural place to pin the ordering while the branches are being re-read anyway.

**Closes when:** a Gate 1 run passes with a `git.test.ts` case asserting the verdict for
`{ pathExists: false, uncommittedChanges: 3 }`.

### F-003 — P3 — a path-less worktree with a non-zero change count would be listed as skipped *and* removed

**Tied to:** cleanup-data-loss Phase 3 · **Raised:** 2026-09-05 (Gate 2, reviewer subagent, Phase 3)

For `{ pathExists: false, uncommittedChanges: 3 }` both halves of `cleanup`'s split claim the entry:
`isSafeToRemove` returns `true` at `src/lib/git.ts:159-162`, so it lands in `worktrees`
(`src/commands/cleanup.ts:48`), and `isSkippedForUncommittedChanges` (`src/commands/cleanup.ts:17-21`) also
returns `true`, because its zeroed probe hits that same first branch. The command would print the worktree
as skipped and then remove it anyway.

Latent, not live, and for the same reason as F-002: `gitGetWorktreeList` hardcodes `uncommittedChanges`
to `0` when the path is missing (`src/lib/git.ts:200-202`), and `cleanup` consumes no other source. The
one-line form is `wt.safeToRemove !== true &&` in front of the existing condition. Left open rather than
fixed because Gate 2 had already passed on the diff — the same reasoning F-002 records — and because both
findings are the `pathExists: false` ordering question that `agent-mode` Phase 6 will have this predicate
open for anyway.

**Closes when:** a Gate 1 run passes with a `cleanup.test.ts` case proving that entry appears in at most one
of the two lists.

### F-004 — P3 — Phase 4's regression cases are looser than the §4.3 claim they pin

**Tied to:** cleanup-data-loss Phase 4 · **Raised:** 2026-09-05 (Gate 2, reviewer subagent, Phase 4)

Two assertions in `src/commands/remove.test.ts` prove less than the plan's §4.3 claims, in ways a future
edit could exploit without failing a test:

- The confirmation case selects a single worktree (`remove.test.ts:367-368`), where `some` and `every` are
  equivalent — so mutating `selected.some((wt) => !wt.safeToRemove)` at `src/commands/remove.ts:81` to
  `every` passes. §4.3 names `some` specifically, and a mixed selection of `[safeWorktree, mergedWithWork]`
  is the multi-select shape the phase is titled after. The pre-existing case at `remove.test.ts:173-194`
  has the identical gap, so this is not introduced here.
- The grouping case asserts position only (`remove.test.ts:363`, `index > activeGroupStart`), so swapping
  the two groups emitted at `src/commands/remove.ts:40-45` would still pass. The test's name promises "not
  Safe to delete" and never asserts that literal.

Non-blocking: Gate 2 returned `PASS WITH NOTES` on the diff and Phase 4's **Done when** is met — the
confirmation is asserted and declining it performs no removal. Left open rather than fixed for the reason
F-002 and F-003 record: adding assertions after Gate 2 had already passed would land unreviewed test code.

**Closes when:** a Gate 1 run passes with the confirmation case selecting a mixed `[safe, unsafe]` list and
the grouping case asserting the entry is absent from the "Safe to delete" group by name.

### F-005 — P3 — `README.md` still describes cleanup's pre-fix behaviour

**Tied to:** cleanup-data-loss Phase 5 · **Raised:** 2026-09-05 (Gate 2, reviewer subagent, Phase 5)

`README.md:160` carries the same unqualified claim Phase 5 corrected on the docs page — cleanup "targets
worktrees that are considered safe to remove, for example branches whose remote no longer exists" — with no
uncommitted-work exception. It is now the only place in the repository that documents the defect as if it
were the design; `grep -rn "remote branch no longer exists" docs README.md skills` returns the corrected
`page.mdx:17` and nothing else. Left unfixed because Phase 5's **Files** names exactly one file,
`docs/src/app/docs/commands/cleanup/page.mdx`, and editing the README would have been scope the gate did
not review.

Adjacent and smaller: neither page documents `cleanup --force`, so D7's design point — `--force` skips the
confirmation but still prints the skipped report (`src/commands/cleanup.ts:66,78-80`) — is written down
nowhere user-facing. §4.4 did not ask for it and Q4 leaves whether `--force` *should* print unsettled, so
this is a note, not a gap to close blindly.

**Closes when:** a Lint gate run passes with `README.md:160` carrying the same uncommitted-work exception
as `page.mdx:17`.

### F-008 — P2 — `gitGetWorktrees` splits the worktree-list line on a space, so a repo under a spaced path lists nothing

**Tied to:** shell-argv-safety Phase 2 · **Raised:** 2026-09-05 (hand, §7 case 1)

`gitGetWorktrees` (`src/lib/git.ts:134-157`) parses each `git worktree list` line with
`line.replace(/\s\s+/g, " ").split(" ")`, taking `[0]` as the path and `[2]` as the branch. That collapses
runs of two-or-more spaces into one and then splits on every single space, so a repository whose own path
contains a space is truncated at that space. Measured on 2026-09-05 against a real repo at
`…/case1/space demo/proj`:

```
line        /Users/…/case1/space demo/proj                         60b9ebe [main]
parsedPath  /Users/…/case1/space
branchStr   60b9ebe   → branchName "0b9eb" after slice(1, -1)

line        /Users/…/case1/space demo/proj.worktrees/feature/test  9a6e0d9 [feature/test]
parsedPath  /Users/…/case1/space
branchStr   9a6e0d9   → branchName "a6e0d" after slice(1, -1)
```

Both lines collapse to the same truncated `parsedPath`, and `branchStr` lands on the commit sha instead of
the bracketed branch, so `branchName` is five characters of that sha.

Every entry then fails the `path.startsWith(worktreesRootPath)` filter at `src/lib/git.ts:152-155`, because
`worktreesRootPath` is the untruncated `/Users/…/case1/space demo/proj.worktrees`. `worktree list` prints
its spinner and no rows; `remove` and `cleanup` consume the same builder and see an empty list.

**This is pre-existing and independent of the subprocess layer** — it is string parsing of stdout, not
command construction, so no phase of this plan touches it. It is recorded here because it is what stopped
§7 case 1 from being run as written: the three functions Phase 2 migrated are never reached under a spaced
repo path, so the end-to-end "counts must be real numbers, not blanks" observation cannot be made.

Phase 2's own claim was verified by substitute evidence instead, against the same real repository — the
built `dist/lib/git.js` called directly with the spaced worktree path returned `ahead: 1`, `behind: 0`,
`uncommitted: 1`, the exact values the fixture was built to have, while the pre-change
`exec("cd /…/space demo/… && git status -s")` form failed on the identical path.

Not fixed here: Phase 2's scope names three functions and F-006, and `gitGetWorktrees` is neither. Landing
a parser change would commit code no gate reviewed — the reasoning F-002 through F-005 record. The likely
shape is `git worktree list --porcelain`, which emits one `key value` record per line and needs no
column-splitting at all.

**No phase of this plan will close this.** §6.1 has no row that touches `gitGetWorktrees`, so this finding
is still open at `/feature-close` unless it is given a home first — a roadmap entry is the natural one.

**Closes when:** a Gate 1 run passes with `gitGetWorktrees` returning the correct path and branch for a
worktree-list line whose path contains a space, and `worktree list` run by hand in a repo under a spaced
path prints its rows.

### F-009 — P2 — the `worktree add` failure path is untested, so a dropped `await` on it would land green

**Tied to:** shell-argv-safety Phase 3 · **Raised:** 2026-09-05 (Gate 2, reviewer subagent, Phase 3)

`gitCreateWorktree` issues two sequential `run` calls of its own (`src/lib/git.ts:245` and `:249-261`),
and D5 rests on both being awaited. Only the **first** is exercised on its rejecting path:
`grep -n "mockRejectedValue" src/lib/git.test.ts` returns `445` as the sole rejection in that describe,
and it is queued on the fetch. So dropping `await` at `src/lib/git.ts:249` passes all four tests — the
call is still recorded synchronously, `succeed` is still called, and the one rejection test stops before
reaching it.

**Line numbers updated at Phase 5**, which moved `gitGetRootPath` onto `run` as well: `gitCreateWorktree`
now records **three** calls, the root lookup ahead of the fetch and the add, so the counts in that describe
read `3` where they read `2`, and the fetch-failure case stops at call 2 rather than call 1.

It matters past mutation hygiene: `src/commands/branch.ts:182-184` and `src/commands/checkout.ts:65-71`
both `await gitCreateWorktree(…)` and immediately act on the returned path, so an un-awaited
`worktree add` would run them against a directory git has not created yet. This is also the one path R7
names for Phase 3, and that prefix change is currently pinned by the hand measurement in §7 case 2 alone,
not by a test.

The smaller half of this finding is **closed**. The spaced-root case omitted the
`toHaveBeenCalledTimes` its two sibling cases carried, so a further `run` issued only on that path would
have gone unseen; Phase 5 added it at `src/lib/git.test.ts:418`, alongside the siblings now at `:363` and
`:395`. The primary half — no rejecting test on `worktree add` — is untouched and is what keeps this
finding open.

Left unfixed because Gate 2 had already returned `PASS WITH NOTES` on the Phase 3 diff, and adding
assertions afterwards would commit test code no gate had seen — the reasoning F-002 through F-005 record.

**Closes when:** a Gate 1 run passes with a `git.test.ts` case that resolves the fetch, rejects the
`worktree add`, and asserts both `rejects.toThrow` and `spinnerMocks.fail` called with that message.

### F-010 — P3 — the relative `worktreePath` does not buy what its comment says it does

**Tied to:** shell-argv-safety Phase 3 · **Raised:** 2026-09-05 (hand, §7 case 2)

`src/lib/git.ts:234-237` keeps the pre-change rationale for passing `git worktree add` a relative path:
"This ensures that everything stays in sync in case the project is moved in the filesystem." Measured on
2026-09-05 on **git 2.38.1**, it does not. `git worktree add` resolves the path it is given and records an
absolute one in both link files, so the relative form, an absolute form, and a shell reproduction of the
exact pre-change command are byte-identical:

```
worktree .git             gitdir: <abs>/proj/.git/worktrees/<n>
.git/worktrees/<n>/gitdir <abs>/proj.worktrees/feature/<n>/.git
```

After renaming the containing directory, all three fail alike with
`fatal: not a git repository: <old abs>/proj/.git/worktrees/<n>`, and `git worktree list` from the root
shows every entry `prunable` at its stale absolute path.

**Not a regression and not introduced here** — Phase 3 preserved the argument shape exactly, which is what
R1 asked of it, and §7 case 2's first half (same shape as before the change) passes. What is wrong is the
claim: the comment survives into the argv form as the stated reason for a choice that, on this git version,
has no effect. A future reader "simplifying" it to `absoluteWorktreePath` would be talked out of a harmless
edit by a false rationale — or, worse, would trust the promise.

Two ways out, and choosing between them is the point of recording this: correct the comment to say the
path is relative for readability and that git records absolute links regardless, or reach for
`git worktree add --relative-paths` (git 2.48+) and actually deliver the property — which would need a
version floor this project does not currently state.

**Closes when:** a Gate 1 run passes with `src/lib/git.ts`'s comment either matching measured git behaviour
or accompanied by the `--relative-paths` flag that makes the original claim true.

### F-011 — P2 — the third `run` in `gitNukeWorktreeCmd` is unpinned, so a dropped `await` would report a removal that did not happen

**Tied to:** shell-argv-safety Phase 4 · **Raised:** 2026-09-05 (Gate 2, reviewer subagent, Phase 4)

`gitNukeWorktreeCmd` now issues three sequential `run` calls (`src/lib/git.ts:282`, `:288`, `:289`), and D5
rests on every one being awaited. The **third** has no rejecting test, because no call follows it to count:
`src/lib/git.test.ts:506-516` rejects call 1 and asserts `toHaveBeenCalledTimes(1)`, and `:518-529` rejects
call 2 and asserts `2`, but nothing observes a rejection from `git branch -D`. So dropping `await` at
`src/lib/git.ts:289` passes all four tests. (Line numbers refreshed at Phase 5, which shifted this file.)

It matters past mutation hygiene. `gitNukeWorktree` catches the rejection (`src/lib/git.ts:300-304`) and is
the only thing standing between a failed `branch -D` and a success message: un-awaited, the catch never
fires and the spinner prints `Worktree <name> was removed.` while the branch is still there. This is
exactly the shape F-009 records for `worktree add`, one phase earlier.

Smaller, and the same shape: the round-trip case at `src/lib/git.test.ts:137-154` asserts the **set** call's
argv and its length, but never `toHaveBeenNthCalledWith(2, …)` for the get, and its
`expect(value).toBe(hostileValue)` half only proves the helper returns what the mock was queued with. The
load-bearing evidence for the return direction is §7 case 3, which was run by hand against the built
`dist/lib/git.js` and re-run independently at Gate 2 — not this assertion.

Left unfixed because Gate 2 had already returned `PASS WITH NOTES` on this exact diff, and adding
assertions afterwards would commit test code no gate had seen — the reasoning F-002 through F-005, F-007
and F-009 record.

**Closes when:** a Gate 1 run passes with a `git.test.ts` case that resolves the first two calls, rejects
`git branch -D`, and asserts both `rejects.toThrow` and that `gitNukeWorktree` fails rather than succeeds
on that path.

### F-012 — P2 — a Windows `.cmd`/`.bat` editor can no longer be launched, and `code` is one there

**Tied to:** shell-argv-safety Phase 6 · **Raised:** 2026-09-05 (hand, R6)

`openWorktreePath` now launches the editor through `run` (`src/lib/base-command.ts:65`), which is
`execFile` with no shell. On Windows that cannot start a `.cmd` or `.bat` file, and the usual `codeEditor`
value — `code` — is `code.cmd` there. The pre-change `exec` form always went through `cmd.exe`, so this is
a behaviour change a Windows user would see, against §2 of the plan.

**Measured from source rather than asserted, and the design answer is in the plan's R6:** Node 24.19.0's
JavaScript layer has no batch-file handling at all (371 builtin module sources scanned via
`process.binding("natives")`: zero `.bat` lines, and all 16 `.cmd` lines are property reads —
`message.cmd`, `msg.cmd`, `ex.cmd`); `src/process_wrap.cc` on `v24.x` returns `UV_EINVAL` for
`IsWindowsBatchFile(options.file)` because batch-file arguments "cannot be unambiguously escaped"; and
libuv's `path_search_walk_ext` appends only `.com` and `.exe`, so an extension-less `code` fails `ENOENT`
before the guard is reached. Adding `shell: true` on `win32` would restore the exact hazard this feature
removes, at the one site that interpolates a user-supplied config value, so it was rejected.

**Config-time validation does not catch it, and on Windows it actively hides it.** The plan's R7 note
argues the new `spawn <editor> ENOENT` text is narrow because `commandExists` rejects an unfound editor
before it can be stored. On Windows that inverts: `commandExists` runs `where` (`src/lib/cli.ts:31`), which
resolves `PATHEXT` and therefore *finds* `code.cmd`, while libuv's spawn path tries only `.com` and `.exe`.
Validation passes and the launch then fails — the one configuration where the "narrow" argument does not
hold. **This half is reasoned from documented behaviour, not measured**, which is why it lives here rather
than anywhere that reads as settled.

**Not observed on a Windows host.** This repository has no Windows CI — every workflow is `ubuntu-latest`
— and the phase was implemented and verified on macOS. The configuration page documents the limitation
(`docs/src/app/docs/configuration/page.mdx`), which is the user-facing half; this finding is the half that
is still unproved.

**Closes when:** the behaviour is observed on a real Windows host and the configuration page's note is
made to match what was seen — corrected and removed if `code` launches anyway, or kept with the observed
error text if it does not.

### F-013 — P2 — the editor launch is unpinned as fire-and-forget, so an added `await` would land green

**Tied to:** shell-argv-safety Phase 6 · **Raised:** 2026-09-05 (Gate 2, reviewer subagent, Phase 6)

`openWorktreePath` deliberately does not await the launch (`src/lib/base-command.ts:65`): the editor
outlives the command, and the spinner settles from the `.then(succeed, fail)` after `openWorktreePath` has
already resolved. **No case in `src/lib/base-command.test.ts` pins that.** Measured at Gate 2 rather than
argued: putting `await` in front of that `run(…)` call leaves all six cases passing, for two reasons —
the two cases that do assert a spinner outcome reach it through `vi.waitFor`
(`src/lib/base-command.test.ts:83` and `:93`), which tolerates either ordering, and the other four never
observe timing at all. The comment at
`src/lib/base-command.test.ts:81-82` states the property in prose and asserts nothing about it.

It matters past mutation hygiene. All three callers await `openWorktreePath` — `src/commands/branch.ts:184`,
`src/commands/checkout.ts:71`, `src/commands/open.ts:46` — so the mutation would make `worktree branch`,
`checkout` and `open` block until the editor process exits, which for a terminal editor is until the user
closes it. This is the same shape as F-009 (`worktree add`) and F-011 (`git branch -D`), one phase on: a
dropped or added `await` that no test observes.

The property was measured by hand instead, at Gate 2 and again independently afterwards: driving the built
`dist/lib/base-command.js` with an editor that sleeps 900 ms returns from `openWorktreePath` in **43 ms**,
while the process stays alive until the child exits at 990 ms and the spinner succeeds there. That is
evidence for the current commit, not a guard on the next one.

Left unfixed because Gate 2 had already returned `PASS WITH NOTES` on this diff, and adding assertions
afterwards would commit test code no gate had seen — the reasoning F-002 through F-005, F-009 and F-011
record.

**Closes when:** a Gate 1 run passes with a `base-command.test.ts` case asserting that `succeed` has *not*
been called at the moment `openWorktreePath` resolves, and has been once the launch settles.

### F-014 — P3 — `codeEditor` keeps the whole-line error message that D1 rejected for `agent.command`

**Tied to:** agent-mode Phase 7 · **Raised:** 2026-09-06 (Gate 2, reviewer subagent, Phase 1)

Phase 1 added `isValidCommandLine` (`src/lib/validators.ts:21-35`) because `isValidCommand`'s message quotes
the whole value back — `Command not found: claude --bg` names the flag rather than the program that is
actually missing. That reasoning is `AGENT-MODE-PLAN.md` §3 D1. But the switch wires only `agent.command` to
the new validator (`src/lib/validators.ts:90-91`); `codeEditor` stays on `isValidCommand`
(`src/lib/validators.ts:88-89`).

The two keys now have **identical execution semantics and different error quality**: `openWorktreePath`
splits `codeEditor` on `/\s+/` and launches the head alone (`src/lib/base-command.ts:62`), exactly as
`agent.command` will, so `worktree config codeEditor "code -n"` with `code` absent reports
`Command not found: code -n`. The current behaviour is pinned by `src/lib/validators.test.ts:56`, which
asserts `"Command not found: bad command with args"` — so switching `codeEditor` over is a deliberate change
with a test to update, not a silent fix.

Out of Phase 1's scope: the plan wires `agent.command` and nothing else, and editing `codeEditor`'s
validation after Gate 2 had passed on the diff would land an unreviewed behaviour change. Phase 7 is the
generated-surface sweep and the natural place to take it.

**Closes when:** a Gate 1 run passes with `codeEditor` routed to `isValidCommandLine` and
`validators.test.ts:56` updated to expect the head alone — or the finding is closed as deliberate if the
maintainer prefers the two keys to differ.

### F-015 — P3 — a rejected config value prints an error but exits 0, so a scripted `worktree config` cannot detect it

**Tied to:** agent-mode Phase 1 · **Raised:** 2026-09-06 (hand, confirmed by Gate 2)

`worktree config agent.command "nope-not-a-binary"` prints `Error: Command not found: nope-not-a-binary` and
**exits 0**. The value is correctly not stored, so Phase 1's **Done when** clause ("is rejected") does hold —
but a caller that checks the exit code sees success. `BaseCommand.catch` (`src/lib/base-command.ts:74-85`)
logs the message and returns instead of re-throwing, which is what swallows the status.

**Pre-existing and repo-wide, not introduced by Phase 1.** Verified on 2026-09-06 against the built `dist`
in a throwaway repo: `worktree config codeEditor "also-not-a-binary"` exits 0 identically, and that path is
untouched by this phase.

Recorded because it compounds with the §8 Q5 resolution rather than because Phase 1 caused it. Q5 accepted
that `--agent` with no `agent.command` set prints a message and exits 0, on the grounds that the CI case is
a caveat worth taking. With this, a scripted setup that both *sets* the key wrongly and *uses* `--agent` gets
two consecutive exit-0s and no agent — the failure is invisible at both ends.

**Closes when:** the maintainer either accepts it explicitly (and it is folded into the plan's log at
`/feature-close`) or a Gate 1 run passes with `catch` re-raising a non-zero status for
`InvalidConfigValueError`. The second is a repo-wide behaviour change well outside agent-mode and should not
be taken as part of it.

### F-018 — P3 — `✔ Agent started` is printed before a failed launch is knowable

**Tied to:** agent-mode Phase 2 · **Raised:** 2026-09-06 (Gate 2, reviewer subagent, Phase 2)

`dispatchAgent` logs its success line immediately after `spawnDetached` returns (`src/lib/base-command.ts`),
but the launch is fire-and-forget: an ENOENT arrives as an `error` event a tick later. Measured on
2026-09-06 against the built `dist` with `agent.command` pointing at a missing binary — the terminal shows
`✔ Agent started in …` and then a red `Error: spawn worktree-no-such-agent ENOENT`, exit 0.

Narrow, because `isValidCommandLine` refuses to store a head that is not on PATH: the residual cases are a
binary removed after it was configured, and the Windows `.cmd` shim case [F-012] records. There is no exit
status to wait for by design (§3 D2), so the fix is wording, not sequencing.

**Closes when:** a Gate 1 run passes with the dispatch line no longer asserting success ahead of the launch
— or the maintainer accepts the current wording, folded into the plan's log at `/feature-close`.

### F-019 — P3 — `stdio: "ignore"` discards the output of an agent that does not background itself

**Tied to:** agent-mode Phase 2 · **Raised:** 2026-09-06 (Gate 2, reviewer subagent, Phase 2)

`spawnDetached` sets `stdio: "ignore"` (`src/lib/cli.ts`), which is right for the runtime the plan was
written against: `claude --bg` detaches and keeps its own transcript, reachable through `claude agents`.
§2 requires runtime neutrality, and an agent of the same shape that stays in the foreground and writes to
stdout — `codex exec`, the plan's own second example at `docs/src/app/docs/configuration/page.mdx:54` — has
its output thrown away irrecoverably: no file, no terminal, nothing to attach to.

Inherited stdio is not the answer, since the CLI exits immediately and would be writing into a terminal that
has moved on; a log file under the worktree would be. `docs/src/app/docs/commands/branch/page.mdx` currently
tells the reader to use their agent's own tooling, which is only true of an agent that has some.

**Closes when:** a Gate 1 run passes with dispatch writing the child's output somewhere recoverable and the
branch page saying so — or the maintainer accepts backgrounding agents as the supported shape, folded into
the plan's log at `/feature-close`.

### F-021 — P3 — `toAgentSession` drops a session that has a usable `cwd` but no `name` or `pid`

**Tied to:** agent-mode Phase 3 · **Raised:** 2026-09-06 (Gate 2, reviewer subagent, Phase 3)

`toAgentSession` (`src/lib/agent.ts`) requires `name`, `pid` and `cwd`, and its comment justifies all three
with "an entry without them cannot match a worktree in the first place". That reasoning holds for `cwd`,
the join key, and not for `name` and `pid`, which are only rendering fields. A runtime that renamed either
would yield zero sessions and `cleanup` would then delete everything — the unsafe direction.

This matches §4's type sketch literally, and §1 measured all three as present on both session kinds, so it
is defensible as written. It is in tension with R3's response, "every field the code reads is optional",
which the plan scopes to `kind`, `state` and `status` without saying so explicitly.

**Closes when:** the plan says which fields are load-bearing and which are optional, and the code and its
comment agree with that — or the maintainer accepts the current shape, folded into the plan's log at
`/feature-close`.

### F-022 — P3 — the `cwd` join misses on case and symlink differences, and fails toward "no session"

**Tied to:** agent-mode Phase 3 · **Raised:** 2026-09-06 (Gate 2, reviewer subagent, Phase 3)

`isPathInside` (`src/lib/agent.ts`) compares paths segment-wise via `path.relative`, which is
case-sensitive on posix and does not resolve symlinks. So `/Repo/…` against `/repo/…` on a case-insensitive
macOS volume, or `/tmp/wt` against `/private/tmp/wt`, both report no match. Every such miss fails toward
"no session found", which for Phase 6 means the worktree is removable.

Low probability: `git rev-parse --show-toplevel` and `process.cwd()` both return resolved physical paths,
so the two sides of the comparison normally agree. R5 already accepts a stale PID as a spurious block; this
is the same class of imprecision pointing the other way, and it is unrecorded.

**Closes when:** the paths are normalised on both sides before comparison, or R5 is widened to name this as
an accepted risk, folded into the plan's log at `/feature-close`.

### F-023 — P3 — `isHere` is the only const-assigned arrow function in non-test `src/`

**Tied to:** agent-mode Phase 3 · **Raised:** 2026-09-06 (Gate 2, reviewer subagent, Phase 3)

`findSessionForPath` binds its predicate as `const isHere = (session) => …` (`src/lib/agent.ts`). Every
other named function in non-test `src/` is a declaration; the reviewer's grep found this to be the only
const-assigned arrow outside tests. `context/standards/typescript/rules.md:25-27` reserves arrow
expressions for anonymous callbacks and inline handlers, and its `BAD` example is module-level, so a named
local sits in a gray zone the rule does not directly address. A nested `function isHere(…)` closes over
`worktreePath` identically.

Cosmetic, and `pnpm check` passes it. Left unfixed because Gate 2 had already passed on the diff — the same
reasoning F-002, F-003 and F-004 record: editing after the gate lands unreviewed code.

**Closes when:** a Lint gate run passes with the predicate written as a nested function declaration — or the
maintainer accepts the arrow, folded into the plan's log at `/feature-close`.

### F-024 — P3 — among several *live* sessions in one worktree the choice is arbitrary, which Phase 5's marker inherits

**Tied to:** agent-mode Phase 5 · **Raised:** 2026-09-06 (Gate 2, reviewer subagent, Phase 3)

`findSessionForPath` (`src/lib/agent.ts`) now prefers a live session over a finished one, but among two live
ones it returns whichever the runtime listed first. With a human's interactive terminal and a dispatched
background agent both live in one worktree — the ordinary `--agent`-then-editor case — either may win.

Phase 6 is unaffected: both are live, so `cleanup` blocks either way, which is what F-020 set out to
guarantee. Phase 5 is affected. Its **Done when** says "an interactive session renders with its marker and a
background one without it", and the marker will describe whichever session was picked rather than the
worktree as a whole — so a worktree holding both may render either way between runs. The singular signature
is what §4 specifies, so this is a limit to state, not a defect to fix blindly.

**Closes when:** Phase 5 either renders a marker that does not depend on which of several live sessions was
picked, or its docs and plan section say the marker describes one session — folded into the plan's log at
`/feature-close`.

## Closed

Closed findings leave this file — a feature's at `/feature-close`, folded into the retiring plan's own log;
an `ad-hoc` one at the start of the next `/orchestrate`.

`shell-argv-safety`'s F-006 and F-007 left at its close on 2026-09-06, into
[`archive/SHELL-ARGV-SAFETY-PLAN.md`](archive/SHELL-ARGV-SAFETY-PLAN.md) §11. These two leave at
`agent-mode`'s.

### F-016 — P3 — the configuration docs describe dispatch semantics that no code reads yet

**Tied to:** agent-mode Phase 2 · **Raised:** 2026-09-06 (Gate 2, reviewer subagent, Phase 1)

`docs/src/app/docs/configuration/page.mdx` documents `agent.command` and says the tail is "passed to that
program as leading arguments". That is true of the `spawn` in §3 D2 — which Phase 2 adds. Today nothing
reads the key, so a reader who sets it gets no behaviour. The page never names a dispatching command, so it
does not document a phantom flag; the gap is that the key is inert until Phase 2.

Not fixed in Phase 1, and deliberately not hedged with a temporary "no command reads this yet" line: that
sentence would have to be removed again in Phase 2, and Phase 2's **Files** do not include this page, so the
note would strand. `docs-deploy.yml:3-7` deploys only on push to `main`, so the intermediate state never
reaches readers — the branch merges as a unit.

**Closes when:** Phase 2's Gate 1 run passes with `dispatchAgent` reading `agent.command`, making the page's
description true.

**Closed:** 2026-09-06 by agent-mode Phase 2's Gate 1 run (`pnpm check`, `pnpm typecheck`, `pnpm build`,
`pnpm test` 261 passed, `pnpm docs:test` 49 passed — all exit 0). `dispatchAgent` reads `agent.command` and
passes its tail as leading arguments, so the page's description is now true of shipped code, confirmed
end-to-end against the built `dist`.

### F-017 — P1 — the "no agent configured" hint points at a command that does nothing

**Tied to:** agent-mode Phase 2 · **Raised:** 2026-09-06 (Gate 2, reviewer subagent, Phase 2)

`dispatchAgent` tells a user with no `agent.command` set to run `worktree config agent.command`
(`src/lib/base-command.ts:79`). That form does nothing: `config.ts:273-274` calls `gitGetConfigValue(args.name)`
and **discards the result** when no value argument follows, so the command prints nothing, writes nothing and
exits 0. Verified by hand on 2026-09-06 in a throwaway repo — zero output, and only `has-called-config` written.

The one new user-facing string this phase adds therefore sends the reader to a dead end, on exactly the path
§8 Q5 resolved to keep friendly. The repository's four existing hints of this shape all name the bare,
working form — `src/integrations/jira.ts:80,86,92,100`, `Run "worktree config" to configure …` — and
`context/standards/typescript/error-handling.md:172-176` requires a user-facing message to name an
actionable next step.

**Closes when:** a Gate 1 run passes with the message naming a form that works — the bare `worktree config`,
or the `worktree config agent.command "<command>"` shape the docs already show at
`docs/src/app/docs/configuration/page.mdx:52-54` — and the assertion at `src/lib/base-command.test.ts:187`
updated to match.

**Closed:** 2026-09-06 by the same Gate 1 run, after one Gate 2 loopback. The message now names
`worktree config agent.command "<command>"`, and that form was verified by hand to set the value
(exit 0, `git config --get` returns it); the unset path still prints the message, creates the worktree and
exits 0.

### F-020 — P2 — `findSessionForPath` returns the first match, so a finished session can mask a live one

**Tied to:** agent-mode Phase 3 · **Raised:** 2026-09-06 (Gate 2, reviewer subagent, Phase 3)

`findSessionForPath` (`src/lib/agent.ts`) returns `sessions.find(...)` — the first session whose `cwd` sits
in the worktree, in whatever order the runtime listed them. D5 requires that `cleanup` block on **any**
session; a single-match lookup delivers "block on the first one".

Two sessions in one worktree is the ordinary case for `--agent`, which dispatches an agent and then opens
the editor. If the first listed entry carries `state: "done"`, Phase 6 sees `isSessionLive` false and
removes the worktree out from under the live second session — a live session treated as dead, which is the
direction D6 exists to fail away from and the failure mode §7 calls the worst in the flow. D6's own premise
is that a finished session can appear in the default listing, so the shadowing case is inside the plan's
model rather than hypothetical.

**Closes when:** Gate 2 re-passes on Phase 3 with a live match preferred over a finished one, and a test
covering two matching sessions whose first is `done`.

**Closed:** 2026-09-06 by agent-mode Phase 3's Gate 2 re-run (reviewer subagent, `PASS`, no blocking
findings), after one loopback. `findSessionForPath` prefers a live match and falls back to any match, so the
set of paths yielding no session is unchanged; `src/lib/agent.test.ts` pins two matching sessions with the
finished one listed first, and a lone finished session still being returned. The re-run followed a Gate 1
pass — `pnpm check`, `pnpm typecheck`, `pnpm build`, `pnpm test` 294 passed, `pnpm docs:test` 49 passed, all
exit 0.
