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
- **Phase 3:** `context/verify.md`'s Test section says `pnpm test` covers `src/`; it now also runs
  `scripts/**/*.test.mjs`. `context/stack.md`'s `scripts/` row says version-sync only; it now also holds
  `release-notes.mjs`. Both are phase 4's files.
- **Phase 3:** recovering by "Run workflow" (dispatch) tags whatever `main` is at dispatch time, which may be
  later than the release commit. "Re-run failed jobs" on the original push run keeps the release commit.
  Worth saying in the contributor docs.
- **Phase 3:** with `concurrency: publish` and no cancelling, GitHub keeps one pending run, so a third
  `package.json` push during a release replaces a pending release run, which then needs a dispatch.
- **Phase 3:** a dispatch re-run re-posts to Discord even when nothing new was published.
- **Phase 3:** the `release` environment has no protection rules, so nothing pauses a publish for a person.
  Unchanged by this feature.
- **Phase 3:** `context/release.md`'s *The wires* intro ("no separate release pull request", "each feature
  carries its own bump") is in tension with the new Bump bullet (a release PR from
  `changeset:prepare-release`), and its gaps line still says "if a note mechanism is ever installed".
  Phase 4's re-fill settles both (D1: a deliberate release PR).
- **Phase 4:** `release.md` now names the gap the phase-2 note above asked about: `release-note.yml` asks
  *did any root-package file change*, broader than the path table, so a devDependency-only bump, a script
  edit or an internal refactor fails it and the only way to green it is the `--empty` placeholder the file's
  own rule forbids. **This feature's own PR is that case** (it changes `package.json` scripts and a
  devDependency, and no `src/`, `bin/` or `skills/` file). Narrowing the check, or the maintainer accepting
  `--empty` as an explicit exception, is still open and has to be settled before `/feature-close` pushes.
- **Phase 4:** `README.md`'s Contributing section reads as if `pnpm changeset:prepare-release` commits and
  opens the PR; it does neither (`commit: false`, the script is `changeset version && pnpm sync-version`).
  The same section doesn't mention the gap above either.
- **Phase 4:** `docs/README.md` says `pnpm docs:dev` runs `pnpm sync-version` first; it runs
  `pnpm docs:sync-version`, the docs half only.
- **Phase 4:** `context/verify.md`'s Test section still says `pnpm test` covers `src/`. It also runs
  `scripts/**/*.test.mjs` (the phase-3 note above). Incomplete rather than false.
- **Phase 4:** `release.md`'s *The check* paragraph puts the raw `changeset status --since=origin/main` next
  to the script name; `release.notes.md` asks for the script name only, so the flags have one home.
- **Phase 4:** the dispatch-recovery caveat, the `README.md`/`tsconfig.build.json` no-row gap, and the
  `@changesets/cli` Node floor (all phase-1–3 notes above) did not reach the contributor docs or `release.md`.
- **Phase 4:** the changelog page's "earlier releases are tracked in Git history and pull requests" leaves out
  the GitHub release pages, which have carried generated notes since 1.3.0. Its line 9, "Docs always describe
  the current released CLI behavior" (on `main` already), is untrue once docs deploy ahead of the release.
- **Phase 4:** `context/git.md` says commits are Conventional Commits "without exception", but `main`'s
  history and this feature's phase commits are plain sentences. The file's claim is stale.
