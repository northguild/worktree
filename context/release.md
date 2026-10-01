# Release

What a change here announces, and to whom. **Every command that lands code reads this file before it closes
out** — the exact parallel to [`verify.md`](verify.md) for commands, [`executors.md`](executors.md) for
dispatch, [`git.md`](git.md) for git etiquette and [`tracking.md`](tracking.md) for workflow state, and for
the same reason: what deserves a note differs per repository, and a skill that assumes one project's answer
ships one project's habits everywhere.

Configured by `/onboard` on 2026-09-30, when `@baldurpan/create-ai-workflow` 0.22.0 introduced this file.
Every fact below was read from the repository, its workflow runs, its tags and releases, and the npm
registry that day. Re-filled by feature #87 (changeset-release-workflow) on 2026-10-01, after it installed
Changesets and rewrote the release workflow; the answers below were read from the files on disk, not from
a run of `/onboard`.

**This file holds an answer, not a procedure.** Which paths announce, what records a note, and how often —
those are this project's choices. *When* a note is written relative to the gates, and which command writes
it, are not choices; they live in the skills, so a defect in one can be fixed by an update.

**An answer here has to be true.** [`verify.md`](verify.md) can say *no lint step* and be accurate — a
project without a linter chose that. This file cannot: *a change is announced by writing a note* is **false**
in a repository where nothing records one, and a false answer here is the same defect as a `done` row whose
**Files:** do not exist.

**A note is not a release, and a merge is not a deploy.** Nothing in this workflow bumps a version, tags,
publishes, releases or deploys. What does, in this repository, is the last answer in this file.

What each section takes, and the alternative answers written out, are in
[`release.notes.md`](release.notes.md). `/onboard` reads that file when it fills this one.

## What announces a change, and to whom

`@northguild/worktree` is published to npm, so its paths announce through a release note that ends up in
`CHANGELOG.md` and in the GitHub release body. The table is per path:

| Path | Announces to | Deserves a note when | A bump means |
|---|---|---|---|
| `src/**`, `bin/**` (the CLI) | people installing `@northguild/worktree` | behaviour a user can see changes: a command, flag, output, config key or exit code; a fix that changes what a command does | semver — `major` for a breaking change, `minor` for a new capability, `patch` for a fix |
| `skills/**` | people installing the package (the skill files ship in it) | the shipped skill text changes; the generated version lines (`pnpm sync-version`) do not count | semver, as above |
| `package.json` dependencies | people installing the package | a runtime `dependencies` change that reaches an installer. A devDependency-only change owes none by this column, but see the gap under *The check* | semver, as above |

**`docs/**`, `context/**` and `.github/**` owe no note.** `docs` is a private package that deploys on its
own on any push touching `docs/**`, with no npm release and no version of its own (Changesets ignores it);
`context/**` is planning artifacts and `.github/**` is CI, and neither is shipped in the package. These are
rows saying *no note*, not gaps.

**What a bump means is `major` for a breaking change.** `2.0.0` was cut for one, so it is not folded into
`minor`.

**A path with no row is not the same as a path whose row says nothing.** A change touching a path this table
does not cover is **named in the report, given no note, and left alone** — this file is missing an answer,
which is `/onboard`'s work and not something to guess at mid-change. Never invent a row, and never refuse
ordinary work over a gap in a configuration file.

**One change can touch two paths with different answers.** The unit is the path, not the change: a change
touching two paths owes whatever each of their rows says, which may be two notes, one, or none.

## What records a note

**A Changesets note file, `.changeset/<name>.md`**, written by `pnpm changeset:add` and committed with the
change. `changeset version` (run by `pnpm changeset:prepare-release`) consumes the notes into `CHANGELOG.md`,
deletes them and bumps the version. The file format, enough to write one by hand:

```md
---
"@northguild/worktree": minor
---

One or two sentences written for someone installing the package.
```

The frontmatter value is `patch`, `minor` or `major`; the body becomes the changelog entry and the GitHub
release text. **Filenames are random on purpose**, so two branches adding notes never conflict on merge.
`docs/src/app/docs/changelog/page.mdx` is a hand-written page stating the single-latest-docs policy and
pointing at `CHANGELOG.md`; it is not the changelog, and it stays in [`stack.md`](stack.md)'s Documentation
index.

**The check:** `.github/workflows/release-note.yml` runs `pnpm changeset:status` (`changeset status
--since=origin/main`, which needs `fetch-depth: 0`) on a pull request that touches `src/**`, `bin/**`,
`skills/**` or `package.json`, and fails when the package changed and no note was added. **The exemption:** a
pull request that moves the root `package.json` version, read from the tree against the merge base — the
release pull request, whose notes `changeset version` consumed.

**A named gap: the check asks the wrong question.** It asks *did any file in the root package change*
(the root is a workspace package, so `changeset status` counts everything outside `docs/`), which is broader
than the table's column three, *does this change deserve a note*. A change the table says owes nothing —
a devDependency-only bump, an internal `src/**` refactor, a `package.json` script edit — still fails it. Per
the rule below that a note describing nothing is never written to satisfy a check, the work is to narrow
`release-note.yml` (follow-up, not done); the failure message's suggestion of `pnpm changeset:add --empty`
is that placeholder. **Whether `--empty` is accepted in the meantime is open: no maintainer has decided it.**
If it is accepted, that is the maintainer's explicit exception to the rule, not this table's answer, and
nothing here treats it as made.

**Settings, from `.changeset/config.json`:** `docs` is in `ignore`, so the private docs package is neither
versioned nor tagged — its deploy keys on `docs/**`, not on a version. `commit` is `false` (Changesets never
commits), `access` is `public`, `baseBranch` is `main`. There is no dependent package, so nothing can be
dragged into a release.

## At what granularity

**Once per feature.** The note is written by `/feature-close`, before the commit that retires the feature,
so it rides whatever that command hands over. No phase writes one.

**This is one answer for the project, not a column in the table above.** The table asks *does this path
deserve a note*; this section asks *what leaves this repository as a unit*, and that is a property of the
repository rather than of the path a change happened to touch.

**Granularity governs the plan flow, and `/orchestrate` has neither value.** That command has no entry, no
plan and no ledger, so *per phase* and *once per feature* are both unreadable there: **the change is the
unit.** It still consults the table above, so a docs typo gets no note because column three says so.

**The bump level is confirmed where the note leaves this machine, not where it is written.** A note is a
tracked file that publishes nothing until a version moves, so the level is cheap to correct right up to the
release. `/feature-close` shows the notes a feature carries and confirms their levels, and
[`git.md`](git.md)'s *Push and pull request* answer decides whether that is the last moment before a push or
before a handover.

## What a release ships, and on what event

**Nothing in this workflow bumps a version, creates a tag, publishes an artifact, or deploys anything.**
What does is below. **A feature's merge ships nothing to npm**: it lands a note on `main` and waits. The
event is the merge of the release pull request, the one made with `pnpm changeset:prepare-release`, which
moves the version. The one exception is the docs site, which deploys on any merge touching `docs/**`, bump
or no bump.

### The wires

- **Bump** — a release pull request made with `pnpm changeset:prepare-release` (`changeset version`, then
  `pnpm sync-version` to regenerate the three files `ci.yml` checks for drift). It must come from that
  command: it writes the version's `CHANGELOG.md` section, and a hand-edited version bump has none, so
  `publish.yml` stops before publishing.
- **Tag, release, publish** — one workflow, `publish.yml`, on a push to `main` that touches `package.json`
  and moves its version (a `guard` job reads the previous version from `github.event.before`), or on a
  manual dispatch, which forces the guard open. The `publish` job, in the `release` environment with OIDC,
  then runs: `pnpm test`, `pnpm build`; extracts that version's `CHANGELOG.md` section with
  `scripts/release-notes.mjs` and **fails before publishing if it is missing**; `npm publish` (or
  `--tag next` for a version containing `-`); an annotated `v<version>` tag by `github-actions[bot]`; the
  GitHub release from the CHANGELOG section (`--prerelease` for a prerelease); a Discord post. Each step
  skips itself if its result already exists (version on npm, tag, release), so a failed run is recovered
  with "Run workflow". It replaces `tag-on-version-change.yml` (deleted) and the old `release: published`
  trigger, which could not fire once the release is created by a workflow's own token. **Not yet run**: the
  first real publish under this shape is the maintainer's next release. `v1.2.8` was once tagged and never
  released, so never published; that gap is closed because tag and release no longer come apart.
- **Deploy (docs)** — `docs-deploy.yml`, on any push to `main` touching `docs/**`, `package.json`, the
  lockfile, the workspace file or the version-sync script. **Runs**, green. It is not gated on a version.
- **Deploy (Worker)** — `worker-deploy.yml`, on any push to `main` touching `docs/worker/**`. **Has never
  succeeded**: all five runs, the latest on 2026-09-11, failed at *Deploy to Cloudflare* because the
  `CLOUDFLARE_API_TOKEN` secret is empty in this repository. The file loads and its test and build steps
  pass; only the credential is missing. So nothing recorded here deploys the Worker — whatever is live was
  put there some other way.

### What each path gets on a merge

| Path | On a merge to `main` | Leaves behind |
|---|---|---|
| `@northguild/worktree` (root) | if its version moved: tested, built, published to npm, tagged, released | npm version + tag + GitHub release (all automatic) |
| `docs` | deployed to GitHub Pages if the merge touched `docs/**` or `package.json` — version or not | nothing |
| `docs/worker` | `worker-deploy.yml` fires and fails | nothing |

**The npm path is gated on its own version, correctly.** `publish.yml` keys on the root version moving, and
a merge that does not bump it publishes, tags and releases nothing.

**The docs deploy is not gated at all**, and that is recorded as what this repository does rather than as
the gate it could have. It ships whatever `docs/` holds at merge time. Because a feature's merge no longer
bumps anything, the window is now the time between a merge and the release PR that publishes it: the live
docs can describe behaviour npm does not have yet, and a docs change merged without a release describes
behaviour that is not published at all. A deployed site leaves no tag and no release, so nothing records which commit
is live.

**The gaps, named and not generated:** a Worker deploy credential, and the docs deploy, which keys on no
version by decision (`docs` is ignored by Changesets) and so leaves no tag and no release.

## The rules that hold either way

- **A note is part of the change, and shares its fate.** It lands with the code it describes, under
  whichever answer [`git.md`](git.md) gives about who commits. A change that is abandoned takes its note
  with it.
- **Re-entering the work does not write a second note.** A resumed phase and a review loopback both come
  back through the same step. Update the note that is already there — two files describing one change do
  not conflict and are both counted, which is the one case where doing the right thing twice is the
  failure.
- **Landing a change is not shipping it.** Never report work as released, deployed or live because it
  landed — say what it is waiting for. Here that is usually the release pull request still waiting to be made and merged.
- **A dropped feature announces nothing, and its landed phases keep their notes.** A note belongs to the
  change that landed, not to the outcome the feature was later given.
- **Saying nothing is not the same as answering *no*.** Where a change owes no note, name the paths that
  were checked and why none of them deserved one — the rule a plan's §7 Documentation already follows.
  An empty report reads as "nobody looked".
- **A missing entry is skipped, never faked** — the same rule [`verify.md`](verify.md) states about an empty
  section, applied to a path with no row.
- **A note that describes nothing is never written to satisfy a check.** Mechanisms that gate on notes
  commonly offer a placeholder note carrying no change. **Reaching for it is the signal that the check is
  asking the wrong question**, so the work is to fix the check and to say in the report that it was wrong.
- **This file is unaffected by [`tracking.md`](tracking.md).** A note is an artifact of the change, so it is
  a file in this repository under both of that file's answers.
- **If this file is missing, the answer is the first one in every section.** Treat it as *nothing here
  announces a change*, say so once, and name `/onboard`.
