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

## Phase 3 — Opening under `auto`

- "keeps a detected tool's failure on the fixed opener's policy (D5)" asserts no editor launch and exit 0, but
  not the warning or the printed path D5 also requires under `auto`; the fixed-`herdr` tests pin those.
- The two editor-fallback tests assert `outcome.opener === "editor"` but not that the editor was launched
  (`expectCommands` only warns); `expect(mockRun).toHaveBeenCalledTimes(1)` would.
- `open.mdx`, `getting-started.mdx` and `branch.mdx` step 9 state what `auto` does without the guess and
  stale-variable caveats; the Herdr and Rex guides, the FAQ, README and the skill carry them.

## Phase 4 — Closing under `auto`

- The `auto` spinner text "Finding Herdr spaces and Rex sessions" is the coder's wording; the plan names
  none, so its test pins the code to itself. Accepted as decided.
- `resolveSpaceCloser` now runs `gitGetRootPath` beside `gitGetAbsoluteWorktreesPath` and `findSpaces`
  after it, where `findSpaces` used to run beside the worktrees-path lookup. Same commands on success, one
  warning on failure either way.
- No `remove`-level test has `auto` fill both JSON keys in one document; each key's pass-through is
  pinned separately (remove.test.ts 862-869 and 947-951).
- `SKILL.md`'s "`remove --json` lists the killed ids as `rexSessionsClosed`" now follows the `auto`
  sentence and says nothing of `herdrSpacesClosed`; still true, since it is about Rex ids.
