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

**Closes when:** Phase 4 decides which, and its Gate 1 re-passes with a test covering what the seam
prints when Herdr is unavailable.

## Closed

