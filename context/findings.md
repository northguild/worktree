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

### F-001 — P2 — a quoted `codeEditor` value no longer launches

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

### F-002 — P2 — the editor opener can no longer launch a `.cmd` or `.bat` on Windows

**Tied to:** herdr-space-opener Phase 1 · **Raised:** 2026-09-07 (Gate 2, the `reviewer` subagent)

`exec` went through `cmd.exe /c`, which resolves `.cmd` and `.bat` via `PATHEXT`; `execFile` without a
shell (`src/lib/cli.ts:48`) cannot spawn either on current Node. `codeEditor` set to `code` on Windows
resolves to `code.cmd`, so it stops launching.

Windows is untested here — `package.json` declares no `os` or `engines`, every workflow is
`runs-on: ubuntu-latest`, and §8 already records that Herdr's own Windows support is unverified. But
`commandExists` branches on `process.platform === "win32"` (`src/lib/cli.ts:70`), so the platform is at
least nominally contemplated, and this is a real regression for anyone there.

Not a one-edit fix: `shell: true` on win32 would reintroduce the quoting defect D4 exists to kill. The
narrow fix is resolving the executable through `PATHEXT` before spawning.

**Closes when:** either the repo states it does not support Windows, or the executable is resolved
before spawning and Gate 1 re-passes with a test covering a `PATHEXT` extension.

### F-004 — P2 — the awaited `worktree open` has no timeout, so an unresponsive Herdr hangs the command

**Tied to:** herdr-space-opener Phase 5 · **Raised:** 2026-09-08 (Gate 2, the `reviewer` subagent, note N2)

`runCommand` passes no options object to `execFile` (`src/lib/cli.ts:44-59`), so there is no timeout, and
Phase 4 made the Herdr branch of the seam `await` it (`src/lib/base-command.ts:116`). Before this feature
the opener never blocked: it registered a callback and `run()` returned. A Herdr that accepts the
connection and then never answers now freezes `worktree branch` **after** the worktree exists and its env
files are copied — the user sees a spinner and has no signal that the real work already succeeded.

§5 names the concrete trigger: v0.9.0's `--trust-repository` may leave the open waiting on a decision for
a repository Herdr has not seen before. §8 records the question and chooses no value.

This is recorded rather than fixed because the fix lives in `src/lib/cli.ts`, which is not in Phase 4's
**Files:** list, and because §8 folds into the archive at `/feature-close` while this file survives —
leaving the deferral only in §8 would give it no owner. Phase 5 is the natural home: it decides the
adjacent §8 question of whether `agent start` is awaited or fire-and-forget, and the two want one answer.

**Still open after Phase 5 (2026-09-08).** Phase 5 answered the §8 half — agent start is awaited, and it
passes `--timeout 15000` — but that flag bounds *Herdr's* wait for the agent to become interactive-ready,
not the `execFile` this repo spawned. `src/lib/cli.ts:49` still calls `execFile(executable, args, cb)`
with no options object, so a `herdr` client that accepts the connection and never answers hangs both the
open and the agent start exactly as described above. Phase 5 did not widen into `src/lib/cli.ts`, which is
absent from its **Files:** list too. **This finding now has no phase left to land in** — Phase 6 is
documentation — so it is a maintainer's call: bound `runCommand` with a timeout as a separate
`/orchestrate` change, or state in the repo why unbounded is correct.

**Closes when:** a timeout bounds the awaited Herdr calls — or the repo states why unbounded is correct —
and Gate 1 re-passes with a test covering what the seam prints when the call times out.

## Closed

### F-003 — P3 — the availability probe discards the reason, narrowing what D5 can print

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
