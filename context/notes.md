# Notes

Non-blocking review observations for the feature in flight (#55). Branch-local; `/feature-close` deletes this file.

- **Phase 1** — no test adds a label that git does not emit today. §4.1's "anything a future git adds is ignored" is covered only through `HEAD`, `locked` and `prunable`.
- **Phase 1** — `parseWorktreeRecords` spells `{ path: string; branchName: string }` inline twice (`src/lib/git.ts`). A named type would read better.
- **Phase 1** — the `porcelainRecord` test helper's `HEAD` value is 42 characters, not a 40-character SHA-1. The parser ignores it.
- **Phase 1** — the provenance comment over the `gitGetWorktrees` fixtures credits one scratch repository with every record. The `bare` record is from git-worktree(1)'s example instead, which is an allowed source.
