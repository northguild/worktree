# Notes

Branch-local observations from the gates of #87 (`changeset-release-workflow`). Read by a person, by
nothing in the workflow; `/feature-close` deletes this file.

- **Phase 1:** `context/release.md`'s *What records a note* says there is "no fragment directory";
  `.changeset/` now exists. The plan's phase 4 rewrite of that file has to cover the clause.
- **Phase 1:** adding `@changesets/cli` re-resolved the optional `yaml` peer of vite, vitest and tsup from
  2.8.3 to 2.9.1 in the lockfile — inside the existing `yaml` override range; tests green.
- **Phase 1:** `@changesets/cli@3.0.3` declares `engines.node: ^22.11 || ^24 || >=26`. Nothing in the repo
  states a Node floor for contributors (no `.nvmrc`, no `engines`); worth a line in the contributor docs.
