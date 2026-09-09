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

### F-025 — P2 — `git.ts` and `agent.ts` now import each other, the only circular import in non-test `src/`

**Tied to:** agent-mode Phase 6 · **Raised:** 2026-09-06 (Gate 2, reviewer subagent, Phase 5)

Phase 5 introduced it: `src/lib/git.ts:7-12` imports four symbols from `./agent.js`, while
`src/lib/agent.ts:3` imports `gitGetConfigValue` from `./git.js`. A depth-first scan over relative imports
in non-test `src/` reports `git.ts -> agent.ts -> git.ts`; the same scan at the pre-phase commit reports no
cycle at all. `context/standards/architecture/dependency-boundaries.md:81` reads *"Circular dependencies are
always forbidden. They indicate a design problem."* Nothing catches it — there is no `madge` step in
`.github/workflows/` and Biome has no rule for it enabled in `biome.json`.

It is safe **today** and that is exactly why it is worth recording. Neither module has a top-level binding
that references the other — `agent.ts`'s only module-scope `const` is `SESSION_ARGS` (line 15) — so every
crossing is a hoisted function declaration resolved at call time, and the build is plain `tsc`, not a
bundler that could reorder it. The hazard is latent: the first top-level `const` added to either module that
references the other becomes a temporal-dead-zone crash at CLI startup, with a stack trace naming neither
the cause nor the author.

It is the joint consequence of two plan-directed decisions rather than an invention of Phase 5 — §4 puts the
`includeAgents` flag on `gitGetWorktreeList`, and Phase 3 already read config through `git.ts`. The fix is
to extract `gitGetConfigValue` / `gitSetConfigValue` into a `src/lib/config.ts` depending only on
`./cli.js`, leaving `git.ts -> agent.ts -> config.ts`. That touches `git.ts`, `agent.ts`, `base-command.ts`,
`src/commands/config.ts` and their tests — outside Phase 5's scope, but **Phase 6 already owns
`src/lib/git.ts`** and will have the module open, which is why it is tied there.

**No remaining phase of this plan will close this.** It was tied to Phase 6 because that phase owns
`src/lib/git.ts`; Phase 6 has now shipped without taking it, and Phase 7's **Files** are `skills/core/SKILL.md`
and `README.md`, so no row is left that opens either module. Deferred deliberately: the extraction is `P2`,
which does not gate a phase, and the Phase 6 Gate 2 reviewer measured its real blast radius as **seven**
non-test files (`git.ts`, `agent.ts`, `base-command.ts`, `commands/config.ts`, `commands/branch.ts`,
`integrations/github.ts`, `integrations/jira.ts`) plus six test files that spy on `git.gitGetConfigValue` —
materially wider than this finding's own estimate above, and roughly twelve files against Phase 6's five.
Landing it inside Phase 6 would have been the unreviewed-scope-expansion this file records elsewhere. It is
therefore still open at `/feature-close` unless it is given a home first — a roadmap entry is the natural
one, as with F-008.

**Closes when:** a cycle scan over non-test `src/` reports none, proven by a Gate 1 run.

### F-027 — P3 — a new `git.test.ts` comment claims an ordering assertion the harness does not make

**Tied to:** agent-mode Phase 5 · **Raised:** 2026-09-06 (Gate 2, reviewer subagent, Phase 5)

`src/lib/git.test.ts:630-633` introduces its fixture as *"Every git call gitGetWorktreeList makes, in
order…"* and passes an eight-command sequence to `expectCommands`. But `src/test-setup.ts:47-53` only
`console.warn`s on an unexpected call — it asserts nothing, and it tests membership, not order. The comment
promises a guard the harness does not provide.

Nothing this phase guarantees rests on it: the load-bearing R4 check is the `toHaveBeenCalledTimes(1)` at
`src/lib/git.test.ts:685`, which is a real assertion. The harness property is pre-existing and surfaced only
because this comment leans on it.

**Closes when:** the comment states what `expectCommands` actually does, or `test-setup.ts` asserts rather
than warns — either proven by a Gate 1 run.

### F-028 — P3 — `list`'s `-a` alias and flag description are pinned by no test

**Tied to:** agent-mode Phase 5 · **Raised:** 2026-09-06 (Gate 2, reviewer subagent, Phase 5)

`docs/src/app/docs/commands/list/page.mdx:22` documents `-a` and the exact description string, and a manual
`list --help` run confirmed both, but nothing in `src/commands/list.test.ts` reads `List.flags` — the suite
stubs `parse` wholesale (`src/commands/list.test.ts:34-37,41`). Changing `char: "a"` or the description at
`src/commands/list.ts:16-17` would diverge from the docs table with every test still green.

Cosmetic, and consistent with how `branch` and `checkout` flags are tested in this repo — so this is a note
about a repo-wide gap that Phase 5 inherited, not a Phase 5 defect.

**Closes when:** a test reads `List.flags.agents` and asserts its `char` and `description`, proven by a Gate
1 run — or the maintainer accepts the gap, folded into the plan's log at `/feature-close`.

### F-029 — P3 — `hasLiveAgent`'s comment credits the fail-safe to a path that cannot reach it

**Tied to:** agent-mode Phase 6 · **Raised:** 2026-09-06 (Gate 2, reviewer subagent, Phase 6)

`src/lib/git.ts:168-172` says an absent `live` marker counts as live "so a hand-built entry **and a runtime
that renamed its state field** both block removal rather than being waved through". The hand-built half is
real. The renamed-`state` half never reaches the `!== false` branch: `toWorktreeAgent` always sets `live`
(`src/lib/git.ts:231`), and `isSessionLive` returns `true` for an unrecognised state (`src/lib/agent.ts:132`),
so a renamed field yields `live: true` explicitly, not an absent one. The outcome is the same and the code is
right; the comment names the wrong mechanism for it.

The same shape as F-027 — a comment leaning on a guard that lives in another module. One line.

**Closes when:** the comment attributes the renamed-`state` case to `isSessionLive` rather than to the absent
marker, proven by a Gate 1 run.

### F-030 — P3 — `--ignore-agents` is "do not tell me" as well as "do not look", against this command's own stated principle

**Tied to:** agent-mode Phase 6 · **Raised:** 2026-09-06 (Gate 2, reviewer subagent, Phase 6)

`archive/CLEANUP-DATA-LOSS-PLAN.md:209` states *"`--force` means \"do not ask me\", not \"do not tell me\"."*
and `src/commands/cleanup.ts:147-148` carries that forward for uncommitted changes. `--ignore-agents` is
implemented as *not gathering* the sessions (`src/commands/cleanup.ts:110-112`), so
`cleanup --force --ignore-agents` sweeps agent-occupied worktrees and names none of them — "do not tell me",
for the one category D5 calls the worst failure mode in the flow.

This is a deliberate trade, not an oversight: not looking is also what keeps R4's constant cost off the
overridden path, the docs disclose the mechanism (`docs/src/app/docs/commands/cleanup/page.mdx:55-57`), and
nothing in §4 or D5 requires a report from the override. Recorded because it is the single place the new flag
departs from a principle this command already had in writing, and someone will otherwise rediscover it as a
bug.

**Closes when:** the override reports what it swept past — which means gathering sessions and discounting
them rather than skipping the lookup — or the maintainer accepts the trade, folded into the plan's log at
`/feature-close`.

### F-031 — P3 — `cleanup`'s flags block is pinned by no test

**Tied to:** agent-mode Phase 6 · **Raised:** 2026-09-06 (Gate 2, reviewer subagent, Phase 6)

`src/commands/cleanup.test.ts` stubs `parse` wholesale and never reads `Cleanup.flags`, so deleting the
`"ignore-agents"` entry at `src/commands/cleanup.ts:58-61` leaves every test green while
`worktree cleanup --ignore-agents` fails at runtime against a flag the docs table documents
(`docs/src/app/docs/commands/cleanup/page.mdx:31`). Only §7's manual run currently proves the flag exists.

Identical in shape to F-028, one command over, and to how `branch` and `checkout` flags are tested here — so
this is the repo-wide gap Phase 6 inherited rather than a Phase 6 defect.

**Closes when:** a test reads `Cleanup.flags["ignore-agents"]` and asserts it, proven by a Gate 1 run — or
the maintainer accepts the gap, folded into the plan's log at `/feature-close`. Best taken together with
F-028.

### F-032 — P3 — `remove` and `cleanup` now disagree about a worktree an agent is living in

**Tied to:** agent-mode Phase 6 · **Raised:** 2026-09-06 (Gate 2, reviewer subagent, Phase 6)

`src/commands/remove.ts:54` calls `gitGetWorktreeList()` with no options, so no session join happens and a
worktree holding a live agent still gets `safeToRemove: true` — landing it under *"Inactive branches (Safe to
delete)"* (`src/commands/remove.ts:40`) while `cleanup` refuses the same worktree.

Out of scope by design: D5 names `cleanup` only, §4's **Cleanup** paragraph names `isSafeToRemove` and
`cleanup`'s override and nothing else, and `remove` is an explicit single-worktree choice rather than a
sweep, so the case for blocking it is weaker. But the label it prints is now wrong for that worktree, which
is a different thing from declining to block.

**Closes when:** `remove` either joins sessions and stops calling such a worktree safe, or the maintainer
accepts the asymmetry — either folded into the plan's log at `/feature-close`, or re-filed as its own
roadmap entry.

### F-033 — P3 — a finished session renders in `list --agents` as though it were working

**Tied to:** agent-mode Phase 5 · **Raised:** 2026-09-06 (Gate 2, reviewer subagent, Phase 6)

`src/lib/utils.ts:37-44` gives a session no marker unless it is interactive or waiting, so a session with
`state: "done"` renders as bare `Agent: <name>` — indistinguishable from a background agent that is getting
on with its work. `docs/src/app/docs/commands/list/page.mdx` says *"**No marker** — a background agent that is
getting on with its work"*, which is now false for that case, and `cleanup` will happily remove the worktree
the reader has just been shown an agent in.

Reachable only through D6's second layer — a finished session appearing in a listing that omits `--all` — so
low probability. Phase 5 owns both files, and Phase 6 is what made the divergence observable by acting on
`live` where `list` does not render it.

**Closes when:** `list --agents` distinguishes a finished session from a working one, proven by a Gate 1 run
— or the maintainer accepts the gap, folded into the plan's log at `/feature-close`.

### F-034 — P3 — the cleanup docs open with an absolute the page then qualifies twice

**Tied to:** agent-mode Phase 6 · **Raised:** 2026-09-06 (Gate 2, reviewer subagent, Phase 6)

`docs/src/app/docs/commands/cleanup/page.mdx:35` opens *"A worktree that an agent session is living in is
never removed."* Two exceptions exist: `--ignore-agents`, qualified three paragraphs later at `:54-57` and in
the flags table at `:31`, and a worktree whose directory is already gone, which `isSafeToRemove` answers
before it ever reaches the agent clause (`src/lib/git.ts:178-183`).

Ordinary topic-sentence-then-qualification prose, so a note rather than a defect. *"is not removed unless you
pass `--ignore-agents`"* would remove the tension in one edit.

**Closes when:** the sentence carries its qualification, proven by a Lint gate run — or the maintainer
accepts the prose as written.

### F-035 — P3 — the cleanup docs flags table has a different shape from the list page's

**Tied to:** agent-mode Phase 6 · **Raised:** 2026-09-06 (Gate 2, reviewer subagent, Phase 6)

`docs/src/app/docs/commands/cleanup/page.mdx:28-31` uses a two-column Flag/Description table with the alias
folded into the flag cell, where `docs/src/app/docs/commands/list/page.mdx:20-22` uses three columns —
Flag/Alias/Description — and quotes each flag's `description` string verbatim. `--ignore-agents`' row does
quote the code; `--force`'s paraphrases it as "Skip the confirmation prompt" against
`src/commands/cleanup.ts:53`'s "Force cleanup without confirmation".

Cosmetic, and the two pages were written by different phases. Recorded so the docs settle on one shape rather
than drifting page by page.

**Closes when:** the two pages use one table shape and quote the flag descriptions the code carries, proven by
a Lint gate run — or the maintainer accepts the variation.

### F-036 — P3 — two shipped skill artifacts still enumerate the pre-agent config and command surface

**Tied to:** agent-mode Phase 7 · **Raised:** 2026-09-06 (hand, during the Phase 7 sweep)

`skills/_artifacts/domain_map.yaml:38` claims `'worktree config (all 9 keys)'` and
`skills/_artifacts/skill_spec.md:23` claims `All 7 commands, 9 config keys`. There are ten user-facing keys
now — `agent.command` is the tenth (`src/lib/constants.ts:1-12`, less the internal `has-called-config`) —
and neither file mentions `--agent`, `list --agents` or `cleanup --ignore-agents`. Both ship: the `files`
field in `package.json` publishes the whole `skills/` tree.

They were left untouched deliberately, and the reasoning is in the plan's Phase 7 **Files** line. What
draws the line is that `scripts/sync-intent-version.mjs:49-50` writes only `SKILL.md` and
`skill_tree.yaml`, and `.github/workflows/ci.yml:33-34` gates on that same pair — so those two are the
maintained artifacts and these two are inputs nothing consumes. `domain_map.yaml` is a stamped record on
top of that (`:4-6` — `Version: 1.2.0`, `Date: 2026-04-06`, `Status: reviewed`, against a package now at
1.2.8), so editing it by hand would assert a discovery run and a review that never happened.
`skill_spec.md` carries no stamp and rests on the sync/CI criterion alone.

A second consequence worth naming: `skill_tree.yaml:8-10` declares `generated_from` these two files, and
its hand-edited `description` now enumerates a surface neither declared input describes. That is the
accepted trade — a shipped description that is correct, sourced from inputs that are not.

`P3` because nothing reads these two at runtime: `SKILL.md`'s own frontmatter is what an agent loads, and
that is now correct. The cost is a published artifact that undercounts the surface.

**Closes when:** the skill generator is re-run against the current tree and its output committed, restamping
both files — or the maintainer accepts that they are frozen 1.2.0 records and the claim is scoped to that
version in the files themselves.

### F-037 — P3 — `SKILL.md` shows `list --agents` without naming the three states it renders

**Tied to:** agent-mode Phase 7 · **Raised:** 2026-09-06 (Gate 2, reviewer subagent, Phase 7)

`skills/core/SKILL.md:128-129` gives the invocation and its `-a` alias and stops there. The command renders
`Agent: <name>` qualified by `[interactive]` or `[waiting]` or neither (`src/lib/utils.ts:37-44`), and
`docs/src/app/docs/commands/list/page.mdx:36-39` documents all three. An agent reading only the skill file
sees output it has not been told how to read — and the interactive marker is the one that matters, because
it is the difference between "an agent this tool dispatched" and "somebody's own terminal".

Not fixed in the phase that raised it: Gate 2 had already passed on the diff, and adding shipped prose
afterwards lands content no gate reviewed — the same reasoning F-002 through F-005 record.

**Closes when:** a Lint gate run passes with `SKILL.md`'s `list --agents` text naming the no-marker,
`[waiting]` and `[interactive]` states as `page.mdx:36-39` does.

### F-038 — P3 — `SKILL.md` inherits the cleanup docs' absolute-then-qualified opening

**Tied to:** agent-mode Phase 7 · **Raised:** 2026-09-06 (Gate 2, reviewer subagent, Phase 7)

`skills/core/SKILL.md:145` opens "A worktree a live agent session is sitting in is never removed by
`cleanup`", which is the same unqualified absolute F-034 records against
`docs/src/app/docs/commands/cleanup/page.mdx:35`. `src/lib/git.ts:178-183` returns `true` before the agent
clause is reached when `pathExists` is false, so "never" has an exception neither page states.

**This one must not be fixed alone.** The two sentences agreeing is the property Phase 7 exists to
establish, so editing the skill file without the docs page would trade a wording defect for a consistency
defect. It closes with F-034 or not at all.

**Closes when:** a Lint gate run passes with `SKILL.md:145` and `page.mdx:35` carrying the same qualified
claim — that is, jointly with F-034.

### F-041 — P2 — the awaited `worktree open` has no timeout, so an unresponsive Herdr hangs the command

**Tied to:** herdr-space-opener Phase 5 · **Raised:** 2026-09-08 (Gate 2, the `reviewer` subagent, note N2)

The capturing runner sets no `timeout` on `execFile` (`src/lib/cli.ts:48-68`), and Phase 4 made the Herdr
branch of the seam `await` it (`src/lib/base-command.ts:114`). Before this feature
the opener never blocked: it registered a callback and `run()` returned. A Herdr that accepts the
connection and then never answers now freezes `worktree branch` **after** the worktree exists and its env
files are copied — the user sees a spinner and has no signal that the real work already succeeded.

§5 names the concrete trigger: v0.9.0's `--trust-repository` may leave the open waiting on a decision for
a repository Herdr has not seen before. §8 records the question and chooses no value.

This is recorded rather than fixed because the fix lives in `src/lib/cli.ts`, which is not in Phase 4's
**Files:** list, and because §8 folds into the archive at `/feature-close` while this file survives —
leaving the deferral only in §8 would give it no owner. Phase 5 is the natural home: it decides the
adjacent §8 question of whether `agent start` is awaited or fire-and-forget, and the two want one answer.

**Renamed at the merge with `main` (2026-09-08).** The runner this finding was raised against is now
`runCapturing`, `main`'s `run` having taken the plain name. The defect is unchanged: `runCapturing` grew
a `cwd` option in the merge and still sets no `timeout`.

**Still open after Phase 5 (2026-09-08).** Phase 5 answered the §8 half — agent start is awaited, and it
passes `--timeout 15000` — but that flag bounds *Herdr's* wait for the agent to become interactive-ready,
not the `execFile` this repo spawned. `src/lib/cli.ts:54` passes an options object carrying only `cwd`
and no `timeout`, so a `herdr` client that accepts the connection and never answers hangs both the open
and the agent start exactly as described above. Phase 5 did not widen into `src/lib/cli.ts`, which is
absent from its **Files:** list too. **This finding now has no phase left to land in** — Phase 6 is
documentation — so it is a maintainer's call: bound `runCommand` with a timeout as a separate
`/orchestrate` change, or state in the repo why unbounded is correct.

**Closes when:** a timeout bounds the awaited Herdr calls — or the repo states why unbounded is correct —
and Gate 1 re-passes with a test covering what the seam prints when the call times out.

**Renumbered on merge (2026-09-08).** Raised as F-004 on the `herdr-space-opener` branch, which numbered from the same starting point as `main` and collided with it. The finding is unchanged.

### F-042 — P2 — an unquoted apostrophe is consumed by the command-value split

**Tied to:** herdr-space-opener Phase 1 · **Raised:** 2026-09-08 (Gate 2, the `reviewer` subagent, note N1)

`splitCommandValue` treats a quote as grouping wherever it appears (`src/lib/utils.ts:99-141`), so an
unquoted apostrophe inside a token is removed: `/Users/o'brien/bin/ed` splits to
`["/Users/obrien/bin/ed"]`. `main`'s `trim().split(/\s+/)` preserved it, so this is a change for a
`codeEditor` or `agent.command` value that worked before the merge, against §2's "Non-Herdr users must
see no change".

The behaviour is what a shell does with the same characters, and it fails visibly — the launch reports
`ENOENT` for a path that does not exist — rather than corrupting anything. It is the cost of the
quote-awareness the maintainer chose at Phase 6, which is why it is recorded rather than treated as a
departure. `docs/src/app/docs/guides/editor-integration/page.mdx` now documents it with the working form
(quote the whole path).

The narrow alternative, if it is ever worth the complexity: open a quote only at a token boundary, which
would keep `open -a "Sublime Text"` and `--flag="a b"` working while leaving a bare apostrophe alone. It
trades one surprising rule for a subtler one, so it is not taken here.

**Closes when:** either the split leaves an unquoted apostrophe alone and Gate 1 re-passes with a test
covering it, or the documented behaviour is accepted as final and this entry is retired at
`/feature-close`.

### F-043 — P2 — `requireGitHubToken`'s configured-token short-circuit is pinned by a comment, not an assertion

**Tied to:** github-issue-auto-assign Phase 1 · **Raised:** 2026-09-09 (Gate 2, reviewer subagent, Phase 1)

`src/integrations/github.test.ts:260-262` states the behaviour in a comment and then does not assert it:

```ts
// fetchGitHubLogin needs a token and nothing else — it never reads the
// origin remote, so the config lookup is the only run() call it makes.
vi.spyOn(cli, "run").mockResolvedValueOnce("ghp_test_token");
```

Mutate `requireGitHubToken` to `return resolveGitHubToken();`, dropping the `if (configuredToken)` guard at
`src/integrations/github.ts:208-210`, and the test still passes: `commandExists` is stubbed `true` in
`src/test-setup.ts:16`, so the single `mockResolvedValueOnce` is consumed by `gh auth token` rather than the
config read, the resulting token string is identical, and the `Authorization` assertion at
`github.test.ts:275` is unaffected. The `expectCommands` net does not catch it either — `test-setup.ts:55-57`
emits a `console.warn` for unexpected subprocess calls and `vitest.config.ts` sets no `onConsoleLog` hook, so
an unexpected call never fails a run.

That guard is why an assign against an already-configured repository does not shell out to `gh` and rewrite
git config on every run, and it is half of what keeps the PAT prompt off the plain `--github` path (§4.1, R3).
It is correct today and untested.

Non-blocking: Gate 2 returned `PASS WITH NOTES` on the diff, and Phase 1's **Done when** is met in full — the
three required response shapes are covered and `grep -r "assignGitHubIssue" src/commands` is empty. The
assertion gap is not on that list. Left open rather than fixed for the reason F-002, F-003 and F-004 record:
adding assertions after Gate 2 had already passed would land unreviewed test code.

**Closes when:** a Gate 1 run passes with `github.test.ts`'s configured-token case capturing the spy and
asserting `expect(runSpy).toHaveBeenCalledTimes(1)`, in the idiom of `src/lib/git.test.ts:371` and
`src/lib/agent.test.ts:89`.

## Closed

### F-039 — P2 — a quoted `codeEditor` value no longer launches

**Tied to:** herdr-space-opener Phase 1 · **Raised:** 2026-09-07 (Gate 2, the `reviewer` subagent)

`openWorktreePath` splits the configured value on `/\s+/` with no quote awareness
(`src/lib/base-command.ts:61`). A macOS-idiomatic value like `open -a "Sublime Text"` used to reach
`/bin/sh` through `exec` and work; it now produces argv `["-a", "\"Sublime", "Text\"", <path>]` and fails.
Same class: `~/bin/editor` and `$EDITOR` no longer expand, because nothing expands them any more.

This is what the plan prescribes — §4.2 says "splits the configured value on whitespace" and Phase 1's
**Done when** tests only the unquoted cases — so it is a gap in the design, not a departure from it. It
does sit against §2's "Non-Herdr users must see no change", which is why it is recorded rather than
waved through: the two statements cannot both be true for a quoted value.

Deciding it is a maintainer's call, and there are three ways out: accept it and correct
`docs/src/app/docs/guides/editor-integration/page.mdx:23`, which today tells the reader to set
`codeEditor` to "the matching shell command" and becomes wrong; parse the value with quote awareness;
or keep a shell for the editor branch and use the argv runner only for Herdr.

**Closes when:** the decision is made and Gate 1 re-passes on whichever branch it lands in — a doc
correction inside Phase 6, or a split change inside Phase 1's files.

**Closed:** 2026-09-08 by Phase 6, which took the second of the three options at the maintainer's
decision. `splitCommandValue` (`src/lib/utils.ts:99-141`) splits the configured value honouring both
quote styles, and the editor branch calls it (`src/lib/base-command.ts:185`), so `open -a "Sublime
Text"` again yields argv `["open", "-a", "Sublime Text", <path>]` — asserted at
`src/lib/base-command.test.ts:155-169` and across 14 table rows at `src/lib/utils.test.ts:222-241`.
The `~` and `$EDITOR` half is **not** restored and is not a defect: nothing expands those without a
shell. It is now stated where a reader meets the key — `README.md:217-220`,
`docs/src/app/docs/configuration/page.mdx:25-49` and the rewritten
`docs/src/app/docs/guides/editor-integration/page.mdx:23-45`, which also covers backslashes and
replaces the "matching shell command" sentence this finding named. Gate 1 re-passed on that change —
`pnpm check`, `pnpm typecheck`, `pnpm build`, `pnpm test` (297 passed) and `pnpm docs:test`
(49 passed), all exit 0, 2026-09-08.

**Renumbered on merge (2026-09-08).** Raised as F-001 on the `herdr-space-opener` branch, which numbered from the same starting point as `main` and collided with it. The finding is unchanged.

### F-040 — P3 — the availability probe discards the reason, narrowing what D5 can print

**Tied to:** herdr-space-opener Phase 4 · **Raised:** 2026-09-08 (Gate 2, the `reviewer` subagent)

`isHerdrAvailable` destructures only `stdout` and `exitCode` from the probe
(`src/integrations/herdr.ts:156`) and returns `false` on a non-zero exit without reading `stderr`
(`herdr.ts:162-163`). D5 requires the seam to print Herdr's own `error.code` and `error.message` when
"Herdr is unavailable **or** the open fails" — but for a case where the binary exists and the server is
dead, whatever structured envelope Herdr writes to stderr is discarded before Phase 4 can reach it. The
seam can only print a generic "Herdr is not available" for that half of D5.

This is Phase 3 behaving exactly as §4.3 prescribes ("The `running` boolean is the probe"), so it is a
design consequence, not a departure. It is recorded because it lands on Phase 4's **Done when**, which
names printing the `code` and `message`. §8 already carries the adjacent open question — whether
`herdr status server --json` is the right probe at all, given it costs an extra spawn on every open —
and the two should be decided together. The options are: return a reason alongside the boolean; drop
the probe and let a failed `worktree open` be the only signal; or accept a generic message for the
server-down case.

**Closed:** 2026-09-08 by Phase 4, which chose the second option. The `herdr status server --json` probe
is gone; `isHerdrAvailable` is now `isHerdrInstalled` and is `commandExists("herdr")` and nothing more
(`src/integrations/herdr.ts:141-155`). A dead server is no longer detected in advance — it fails
`worktree open`, and that failure reaches the seam carrying Herdr's own `code` and `message` through
`toHerdrError`, which is what D5 asks it to print. §4.3 and Phase 3's **Done when** were amended to match.
This also answers §8's third open question: the probe was not the right liveness signal, and its extra
spawn per open is gone. Gate 1 re-passed on that change — `pnpm check`, `pnpm typecheck`, `pnpm build`,
`pnpm test` (233 passed) and `pnpm docs:test` (49 passed), all exit 0, 2026-09-08.

**Renumbered on merge (2026-09-08).** Raised as F-003 on the `herdr-space-opener` branch, which numbered from the same starting point as `main` and collided with it. The finding is unchanged.

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

**Closed:** 2026-09-08 by the `herdr-space-opener` merge, which answers the question rather than
observing it. The maintainer's call at that branch's Phase 6 was that this repository does not support
Windows, so there is no longer a claim for a Windows host to verify: the CLI is developed and tested on
macOS and Linux, and `docs/src/app/docs/configuration/page.mdx` now says so under **Platform Support**
instead of describing how to work around `.cmd`. `README.md`, `docs/.../getting-started/page.mdx`,
`docs/.../faq/page.mdx` and `docs/.../guides/editor-integration/page.mdx` carry the same statement, the
last naming the `PATHEXT` mechanism this finding measured so the reasoning is not lost. That branch had
raised the identical defect independently as its own F-002; this entry is the surviving one. Gate 1
re-passed on the merge — `pnpm check`, `pnpm typecheck`, `pnpm build`, `pnpm test` and `pnpm docs:test`,
all exit 0.

Closed findings leave this file — a feature's at `/feature-close`, folded into the retiring plan's own log;
an `ad-hoc` one at the start of the next `/orchestrate`.

`shell-argv-safety`'s F-006 and F-007 left at its close on 2026-09-06, into
[`archive/SHELL-ARGV-SAFETY-PLAN.md`](archive/SHELL-ARGV-SAFETY-PLAN.md) §11. These two leave at
`agent-mode`'s.

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

**Closed:** 2026-09-06 by agent-mode Phase 6's Gate 1 run (`pnpm check`, `pnpm typecheck`, `pnpm build`, `pnpm test` 322
passed, `pnpm docs:test` 49 passed — all exit 0). `src/lib/git.test.ts` now carries "is safe when the directory is gone
even with uncommitted work", asserting `true` for `{ pathExists: false, uncommittedChanges: 3 }` — the exact
case this finding names. The predicate was open for the live-agent clause, which is placed *after* the path
branch and pinned by a second ordering case of its own, so the argument in §4.1 is now enforced by tests on
both sides rather than by a comment.

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

**Closed:** 2026-09-06 by agent-mode Phase 6's Gate 1 run (`pnpm check`, `pnpm typecheck`, `pnpm build`, `pnpm test` 322
passed, `pnpm docs:test` 49 passed — all exit 0). Both skip predicates in `src/commands/cleanup.ts` now open with
`wt.safeToRemove !== true`, so an entry the sweep will remove can never also be announced as held back.
`src/commands/cleanup.test.ts` pins it with "claims a worktree whose directory is gone for at most one
report". The Gate 2 reviewer went further and ran the two predicates against the built `dist/lib/git.js`
over all 48 combinations of `pathExists` × `uncommittedChanges` × four agent shapes × three remote states,
reporting **0** entries claimed by more than one list — so the defect class is closed empirically, not just
for the one case named here.
