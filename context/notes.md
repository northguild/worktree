# Notes

Branch-local observations from the gates of #56. Read by nobody; `/feature-close` deletes this file.

- **Phase 1** — `src/lib/git.test.ts`, the symlinked-worktree join case: the fixture's `mkdirSync`/`symlinkSync`
  sit before the `try`, so a throw there leaves the temp base behind; its comment cites "the cases above"
  rather than the fail-safe rule itself; a nested `describe` would avoid queuing and then `mockReset()`-ing
  the outer sequence. All cosmetic (Gate 2, non-blocking).
