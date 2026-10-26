# Notes

Branch-local observations from the gates of #56. Read by nobody; `/feature-close` deletes this file.

- **Phase 1** — `src/lib/git.test.ts`, the symlinked-worktree join case: the fixture's `mkdirSync`/`symlinkSync`
  sit before the `try`, so a throw there leaves the temp base behind; its comment cites "the cases above"
  rather than the fail-safe rule itself; a nested `describe` would avoid queuing and then `mockReset()`-ing
  the outer sequence. All cosmetic (Gate 2, non-blocking).
- **Phase 3** — `src/commands/cleanup.test.ts`: the new `--ignore-agents` cases add `as any` casts the
  earlier tests do without (covered by the file-level biome-ignore), and the zero-session case keeps
  `agentWorktree`'s mocked `safeToRemove: false` after stripping its agent, which a real
  `gitGetWorktreeList` would not return. `docs/.../cleanup/page.mdx:154` appends its sentence to an
  already long line. All cosmetic (Gate 2, non-blocking).
- **Phase 4** — `src/lib/cli.ts` `spawnDetached`: on `pid === undefined` the warning carries a synthesised
  `spawn <file> failed to start`, because the errno only arrives on the later `error` event; a human run
  shows the specific `Error: spawn … ENOENT` line right after it, but the `--json` `warnings` entry stays
  generic. Separately, a brief from `--agent-file`/`--agent-stdin` containing a NUL byte makes `spawn`
  throw `ERR_INVALID_ARG_VALUE`, whose message quotes the argument, so the brief text reaches the warning
  (it reached the uncaught throw before this phase; `checkBrief` does not reject NUL bytes). Gate 2,
  non-blocking.
- **Phase 2** — `src/commands/remove.ts:134`, `:173`: nothing pins the `flags.force` gate on the D4 warning;
  dropping it would repeat the warning after a confirmed prompt and no test would fail (`expect(stderr).not
  .toContain("was working in it")` on the prompting test would pin it). `context/executors.md`'s *Remove a
  worktree* list of what the confirmation names omits the agent session now (still true, not complete). The
  remove page's `warnings` row could name the agent warning, and its example pairs session `feature-one-1f`
  with branch `feature/add-bulk-actions`. Gate 2, non-blocking.
