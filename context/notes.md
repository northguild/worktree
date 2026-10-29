# Notes — branch-prefix-mapping (#128)

Branch-local, for a person. `/feature-close` deletes this file.

- **Phase 1:** plan §7 said phase 1 writes `.changeset/branch-prefix-shared-list.md`, but `context/release.md` says the note is once per feature, written by `/feature-close`. The phase wrote none. Drafted text, for `/feature-close` to widen with phase 2's `Type`/`Labels`: "Add a top-level `branchType` list to `.worktree.yml`, shared by every provider that has no list of its own, so the branch-prefix rules are written once; a provider's own list still wins, and `worktree branch --dry-run` names which list decided." (`minor`)
- **Phase 1:** no test asserts the dry run's built-in line (`Rule: built-in mapping (the project file has no <provider>.branchType)`) when neither list is set; `grep -n "built-in mapping" src/commands/branch.test.ts` finds nothing. Seam: the "the human output" describe in `src/commands/branch.test.ts`.
- **Phase 1:** with neither list set, that built-in `Rule:` line names only the provider's list, although a shared list would also turn the mapping off. Left as is deliberately (D7: only the list name changes).
