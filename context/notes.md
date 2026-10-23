# Notes

Non-blocking review observations for the feature in flight (#55). Branch-local; `/feature-close` deletes this file.

- **Phase 1** — no test adds a label that git does not emit today. §4.1's "anything a future git adds is ignored" is covered only through `HEAD`, `locked` and `prunable`.
- **Phase 1** — `parseWorktreeRecords` spells `{ path: string; branchName: string }` inline twice (`src/lib/git.ts`). A named type would read better.
- **Phase 1** — the `porcelainRecord` test helper's `HEAD` value is 42 characters, not a 40-character SHA-1. The parser ignores it.
- **Phase 1** — the provenance comment over the `gitGetWorktrees` fixtures credits one scratch repository with every record. The `bare` record is from git-worktree(1)'s example instead, which is an allowed source.
- **Phase 2** — the digit half of D6 (`\p{N}`) has no test row. Narrowing the class to `\p{L}` would stay green. A row such as `v2'3` → `["v2'3"]` would pin it.
- **Phase 2** — no row puts an astral letter beside the apostrophe (for example `𝒜'𝒜`), so a regression from code-point to UTF-16 indexing would stay green.
- **Phase 2** — under D6 as written, a combining mark (`\p{M}`) is not a word character. A decomposed (NFD) `café's` still opens a quote and splits to `cafés`. That matters if macOS path text arrives in NFD. It is a question about D6 for the maintainer, not a defect in the change.
