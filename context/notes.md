# Notes — branch-prefix-mapping (#128)

Branch-local, for a person. `/feature-close` deletes this file.

- **Phase 1:** plan §7 said phase 1 writes `.changeset/branch-prefix-shared-list.md`, but `context/release.md` says the note is once per feature, written by `/feature-close`. The phase wrote none. Drafted text, for `/feature-close` to widen with phase 2's `Type`/`Labels`: "Add a top-level `branchType` list to `.worktree.yml`, shared by every provider that has no list of its own, so the branch-prefix rules are written once; a provider's own list still wins, and `worktree branch --dry-run` names which list decided." (`minor`) Phase 2 adds: shared rules can name `Type` and `Labels` on every provider (Jira gains `Type`, and `Labels` on a non-English Jira; ClickUp gains `Labels`), and a shared rule naming a field a provider lacks does not warn.
- **Phase 1:** no test asserts the dry run's built-in line (`Rule: built-in mapping (the project file has no <provider>.branchType)`) when neither list is set; `grep -n "built-in mapping" src/commands/branch.test.ts` finds nothing. Seam: the "the human output" describe in `src/commands/branch.test.ts`.
- **Phase 1:** with neither list set, that built-in `Rule:` line names only the provider's list, although a shared list would also turn the mapping off. Left as is deliberately (D7: only the list name changes).
- **Phase 2:** D3/D4's "Jira has `Labels` by name" holds only for an English Jira. On a localized one the `labels` field is not displayed as "Labels", so phase 2 applies D4's own skip rule to `Labels` as well as `Type` (`getJiraIssueFields`). The plan text in #128 was left as written.
- **Phase 2:** a Jira custom field named "Type" anywhere on the instance turns the `Type` alias off for every issue, and the dry run hides empty fields, so a person cannot see why a shared `Type: Bug` stops matching. The docs say so in one sentence.
- **Phase 2:** test gaps, not bugs:
  - GitHub's Done-when test uses a one-rule list, not the two-rule portable list.
  - The id half of the alias "taken" check is not tested on its own.
  - New `as never` casts in `jira.test.ts` follow an existing pattern, and the first is unneeded.
- **Phase 2:** wording:
  - The ClickUp guide's `Labels` sentence is awkward.
  - "names fields by what every provider offers" overstates for Linear, which has no `Type`.
  - The Jira guide mentions the shared `Type` but not `Labels`.
  - The *Fields per provider* Jira cell reads as if `Labels` is always an alias.
