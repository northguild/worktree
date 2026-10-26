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
