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
