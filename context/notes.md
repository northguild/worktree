# Notes

Branch-local observations from the gates of #87 (`changeset-release-workflow`). Read by a person, by
nothing in the workflow; `/feature-close` deletes this file.

- **Phase 1:** `context/release.md`'s *What records a note* said there was "no fragment directory".
  Phase 2 rewrote that section to name `.changeset/`, the check and its exemption; phase 4 still re-fills
  the rest of the file.
- **Phase 2:** `release-note.yml`'s hint offers `pnpm changeset:add --empty` for a change that owes no note
  (a devDependency-only bump). `context/release.md` says a placeholder note written to satisfy a check
  means the check asks the wrong question. Phase 4 has to settle that in `release.md`: state the `--empty`
  decision, or narrow the check so devDependency-only changes don't trigger it.
- **Phase 2:** the check's path filter means PRs outside it never report it. If it is ever made a required
  check in branch protection, those PRs wait on "Expected" forever.
- **Phase 2:** `README.md` (in `files`) and `tsconfig.build.json` change what ships to npm but are outside
  the Q5 path set, so they never trigger the check.
- **Phase 2:** any non-zero exit from `changeset status`, including a git error, prints the "carries no
  release note" hint. Changesets' own error is printed just above it.
- **Phase 1:** adding `@changesets/cli` re-resolved the optional `yaml` peer of vite, vitest and tsup from
  2.8.3 to 2.9.1 in the lockfile — inside the existing `yaml` override range; tests green.
- **Phase 1:** `@changesets/cli@3.0.3` declares `engines.node: ^22.11 || ^24 || >=26`. Nothing in the repo
  states a Node floor for contributors (no `.nvmrc`, no `engines`); worth a line in the contributor docs.
