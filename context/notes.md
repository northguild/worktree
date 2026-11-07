# Notes — opener-auto-detect (#271)

Branch-local and advisory; `/feature-close` deletes this file. See `context/workflow.md`, *`notes.md`*.

## Phase 1 — The terminal-host detector

- D3 says the Herdr-then-Rex order is "written in one array" (and §5 "one array to reverse"). The detector
  encodes it as the order of two `if` statements in `detectTerminalHosts`. It is still one place, and the
  doc comment states it, but it is not literally an array.
- The "editor host alone" test row uses `TERM_PROGRAM: "vscode"` and `VSCODE_PID`. Neither is among the
  plan's §1 observed VS Code variables (`VSCODE_INJECTION`, `VSCODE_GIT_IPC_HANDLE`, …), which §8 names as
  the source for the detector's inputs. The expected `[]` is unaffected.
- `TerminalHost = "herdr" | "rex"` restates a subset of `OpenerKind`; `Extract<OpenerKind, "herdr" | "rex">`
  would keep one source of truth.

## Phase 2 — `auto` as an opener value

- Two of the four `--missing` + `auto` tests in `config.test.ts` assert only that `mockCheckbox` was called
  once, not which item it listed — copied from the existing `editor` test's pattern.
- Exact-order assertions (`"editor, herdr, rex, auto or none"`, the choice arrays) pin `OPENER_KINDS`'s order,
  which the plan never named; membership is what phase 2's Done-when asked for.
