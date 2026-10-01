# Release

What a change here announces, and to whom. **Every command that lands code reads this file before it closes
out** — the exact parallel to [`verify.md`](verify.md) for commands, [`executors.md`](executors.md) for
dispatch, [`git.md`](git.md) for git etiquette and [`tracking.md`](tracking.md) for workflow state, and for
the same reason: what deserves a note differs per repository, and a skill that assumes one project's answer
ships one project's habits everywhere.

Configured by `/onboard` on 2026-09-30, when `@baldurpan/create-ai-workflow` 0.22.0 introduced this file.
Every fact below was read from the repository, its workflow runs, its tags and releases, and the npm
registry that day.

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

**Nothing here announces a change.** No path is recorded below, so no change owes a note and every command
reads this section and moves on.

**That records that this project has not said how a change is announced — not that it announces
nothing.** It publishes `@northguild/worktree` to npm, and every release it has cut since 1.3.0 carries
text. That text is GitHub's generated release notes, a list of the **pull request titles** merged since the
previous tag, assembled when a person creates the release. So today the pull request title *is* the
announcement. The recent titles are written to be read that way ("Never count merged commits as work at
risk, and the 1.8.0 bump"); earlier ones were conventional-commit subjects ("chore(context): update
ai-workflow to 0.10.0 …"), which reach npm's audience just the same. Nothing in the tree records it, nothing checks it, and nothing in this
workflow writes it — which is why it is described here rather than written in as the answer.

**The gap, and what would close it.** A per-change note file that a release consumes. The installer for one
is:

```bash
npx @baldurpan/create-ai-workflow release-init --private-packages version
```

`--private-packages version` because `docs` is a private package that deploys. It mutates `package.json`
and writes nothing into this file; **it has not been run**, and running it is the maintainer's call. Re-run
`/onboard` afterwards and it will fill in the table this section is waiting for.

**A path with no row is not the same as a path whose row says nothing.** A change touching a path this table
does not cover is **named in the report, given no note, and left alone** — this file is missing an answer,
which is `/onboard`'s work and not something to guess at mid-change. Never invent a row, and never refuse
ordinary work over a gap in a configuration file.

**One change can touch two paths with different answers.** The unit is the path, not the change: a change
touching two paths owes whatever each of their rows says, which may be two notes, one, or none.

## What records a note

**A Changesets fragment directory, `.changeset/`, is being adopted** (#87). `pnpm changeset:add` writes a
note there, and `changeset version` consumes the notes into a `CHANGELOG.md` that does not exist yet. Until
that feature's last phase re-fills this file, no release has consumed a note, so this section's answer is
still incomplete. `docs/src/app/docs/changelog/page.mdx` is a hand-written page stating the
single-latest-docs policy, not a changelog, and it stays in [`stack.md`](stack.md)'s Documentation index.

**The check:** `.github/workflows/release-note.yml` runs `pnpm changeset:status` on a pull request that
touches `src/**`, `bin/**`, `skills/**` or `package.json`, and fails when the package changed and no note
was added. **The exemption:** a pull request that moves the root `package.json` version, read from the
tree against the merge base — the release pull request, whose notes `changeset version` consumed.

## At what granularity

**Once per feature.** The note is written by `/feature-close`, before the commit that retires the feature,
so it rides whatever that command hands over. No phase writes one. *Inert while nothing records a note.*

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
What does is below, and **here a feature's merge can ship** — this repository has no separate release pull
request. A feature that bumps the version carries its own bump, so its merge is the release event for npm;
a feature that touches `docs/` deploys the site on merge, bump or no bump.

### The wires

- **Bump** — by hand, inside the feature's own pull request: the root `package.json` version, then
  `pnpm sync-version` to regenerate the three files `ci.yml` checks for drift. No script consumes notes.
- **Tag** — `tag-on-version-change.yml`, on a push to `main` that touches `package.json` and moves its
  version: an annotated `v<version>` tag by `github-actions[bot]`. **Runs**, green on every recent merge;
  `v1.8.0` is its latest.
- **Release** — **by hand**: a person creates the GitHub release from that tag, with GitHub's generated
  notes. **Nothing enforces that one follows the tag**: `v1.2.8` was tagged and never released, so it was
  never published — npm has 1.2.7 and then 1.3.0.
- **Publish** — `publish.yml`, on a release being published: `pnpm test`, `pnpm build`, then `npm publish`
  (OIDC, the `release` environment), or `npm publish --tag next` for a prerelease, then a Discord post.
  **Runs**, green for 1.5.0 through 1.8.0.
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
| `@northguild/worktree` (root) | if its version moved: tagged. Published only once a person creates the release | tag (automatic) + release (by hand) |
| `docs` | deployed to GitHub Pages if the merge touched `docs/**` or `package.json` — version or not | nothing |
| `docs/worker` | `worker-deploy.yml` fires and fails | nothing |

**The npm path is gated on its own version, correctly.** The tag keys on the root version moving, and a
merge that does not bump it tags nothing.

**The docs deploy is not gated at all**, and that is recorded as what this repository does rather than as
the gate it could have. It ships whatever `docs/` holds at merge time. Because each feature carries its own
bump, the window is usually short — but between a merge and the release a person creates, the live docs
can describe a version npm does not have yet, and a docs change merged without a bump describes behaviour
that is not published at all. A deployed site leaves no tag and no release, so nothing records which commit
is live.

**The gaps, named and not generated:** a release that follows the tag automatically (or a check that
notices one that did not), a Worker deploy credential, and — if a note mechanism is ever installed — the
decision whether `docs` is versioned and tagged so its deploy can key on something.

## The rules that hold either way

- **A note is part of the change, and shares its fate.** It lands with the code it describes, under
  whichever answer [`git.md`](git.md) gives about who commits. A change that is abandoned takes its note
  with it.
- **Re-entering the work does not write a second note.** A resumed phase and a review loopback both come
  back through the same step. Update the note that is already there — two files describing one change do
  not conflict and are both counted, which is the one case where doing the right thing twice is the
  failure.
- **Landing a change is not shipping it.** Never report work as released, deployed or live because it
  landed — say what it is waiting for. Here that is usually a person creating the GitHub release.
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
