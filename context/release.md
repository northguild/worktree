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
publishes, releases or deploys **on its own initiative** — only `/release`, or `/feature-close --release`,
in the turn somebody types it, and each of those runs what this file names rather than anything it knows.
What ships the change, in this repository, is the last answer in this file.

**Re-checked by `/onboard` on 2026-10-18 under 0.26.0**, which added `/release`. The answers did not
change; the run history under *The wires* was brought up to date from the workflow runs, tags, releases and
the npm registry that day.

What each section takes, and the alternative answers written out, are in
[`release.notes.md`](release.notes.md). `/onboard` reads that file when it fills this one.

## What announces a change, and to whom

`@northguild/worktree` is published to npm, so its paths announce through a release note that ends up in
`CHANGELOG.md` and in the GitHub release body. The table is per path:

| Path | Announces to | Deserves a note when | A bump means |
|---|---|---|---|
| `src/**`, `bin/**` (the CLI) | people installing `@northguild/worktree` | behaviour a user can see changes: a command, flag, output, config key or exit code; a fix that changes what a command does | semver — `major` for a breaking change, `minor` for a new capability, `patch` for a fix |
| `skills/**` | people installing the package (the skill files ship in it, and `npx skills add` reads them) | the shipped skill text changes | semver, as above |
| `package.json` dependencies | people installing the package | a runtime `dependencies` change that reaches an installer. A devDependency-only change owes none by this column, but see the gap under *The check* | semver, as above |

**`docs/**`, `context/**` and `.github/**` owe no note.** `docs` is a private package whose site deploys
with the next stable release, with no npm release and no version of its own (Changesets ignores it);
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
`docs/src/content/docs/changelog.mdx` is a hand-written page stating the single-latest-docs policy and
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
versioned nor tagged — its deploy rides the release's `publish.yml` run, not a version of its own. `commit` is `false` (Changesets never
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

**Nothing in this workflow bumps a version, creates a tag, publishes an artifact, or deploys anything on
its own initiative.** `/release` runs the *Bump* wire below when somebody types it; nothing in the workflow
runs any of the others. What does is below. **A feature's merge ships nothing to npm**: it lands a note on `main` and waits. The
event is the merge of the release pull request, the one made with `pnpm changeset:prepare-release`, which
moves the version. The docs site deploys from the same event: `publish.yml` calls `docs-deploy.yml` once a
stable version has been published.

### The wires

- **Bump** — a release pull request made with `pnpm changeset:prepare-release` (`changeset version`, then
  `pnpm sync-version` to regenerate `docs/src/lib/site-meta.ts`, the one file `ci.yml` checks for drift). It must come from that
  command: it writes the version's `CHANGELOG.md` section, and a hand-edited version bump has none, so
  `publish.yml` stops before publishing. **Who runs it:** `/release`, in the turn a maintainer types that
  command, on a branch of its own and after Gate 1 — or a maintainer running `pnpm
  changeset:prepare-release` by hand. Both are real answers; nothing runs it on a merge or a schedule.
  It cannot be run twice over the same notes, and since `publish.yml` watches the version, it is the button
  that ships. v2.1.1 was a release pull request of its own (#101); v2.1.2's bump and `CHANGELOG.md`
  section rode the fix pull request itself (#103), which `publish.yml` handled the same way.

  **The hold on the first release after #240 is lifted.** That release carries `.changeset/swift-owls-point.md`:
  its CLI writes `https://northguild.dev/worktree/schema/v1.json` into every new `.worktree.yml`, and its npm
  `homepage` and README links point at the same host. The condition was a `docs-deploy.yml` run whose `site` job
  (and its smoke test) passed on `main`; run 41910362381 on `main` for c0cc821 (2026-11-04,
  <https://github.com/northguild/worktree/actions/runs/41910362381>) had `site` and `legacy-pages` both `success`.
  #239 still owns the launch checks, including watching the first release's `docs` job (below).
- **Tag, release, publish** — one workflow, `publish.yml`, on a push to `main` that touches `package.json`
  and moves its version (a `guard` job reads the previous version from `github.event.before`), or on a
  manual dispatch, which forces the guard open. The `publish` job, in the `release` environment with OIDC,
  then runs: `pnpm test`, `pnpm build`; extracts that version's `CHANGELOG.md` section with
  `scripts/release-notes.mjs` and **fails before publishing if it is missing**; `npm publish` (or
  `--tag next` for a version containing `-`); an annotated `v<version>` tag by `github-actions[bot]`; the
  GitHub release from the CHANGELOG section (`--prerelease` for a prerelease). A separate `notify` job, with
  no permissions and no environment, then posts to Discord with `curl`. A `docs` job, `needs: publish` and for a
  stable version only, then deploys the docs (next bullet). Each publish step
  skips itself if its result already exists (version on npm, tag, release), so a failed run is recovered
  with "Run workflow". It replaces `tag-on-version-change.yml` (deleted) and the old `release: published`
  trigger, which could not fire once the release is created by a workflow's own token. **Runs, green**: it
  published, tagged and released v2.1.0 (2026-10-01), v2.1.1 (2026-10-04) and v2.1.2 (2026-10-14), and npm
  serves 2.1.2. `v1.2.8` was once tagged and never released, so never published; that gap is closed
  because tag and release no longer come apart.
- **Deploy (docs)** — `docs-deploy.yml`, called by the `docs` job of `publish.yml` after `publish` succeeds and
  only when the version has no `-` (a prerelease does not deploy docs). The job passes exactly
  `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (no `secrets: inherit`), declares its own `contents: read`,
  `pages: write` and `id-token: write`, and has no `release` environment, so its OIDC token cannot be exchanged for
  an npm credential. The called workflow builds the release commit, the one `v<version>` tags. It is skipped when
  `publish` is. It can also be run by hand (`workflow_dispatch`), from `main` only: `site` carries
  `if: github.ref == 'refs/heads/main'` (#243), so a run from any other ref skips both jobs and deploys nothing. Two jobs. `site` tests, builds `docs/dist`, audits it (`pnpm docs:audit-dist`), copies it to
  `docs/.deploy/worktree/` and runs `wrangler deploy` with `docs/wrangler.jsonc` (a Worker with static assets and no
  script, on the Route `northguild.dev/worktree*`), then runs `docs/scripts/deploy-smoke.mjs` against the live URL,
  retrying for route propagation. `legacy-pages` runs only after `site` is green and publishes the generated
  `docs/legacy/` bundle to GitHub Pages: `schema/v1.json` plus a redirect stub per old route. The old Pages site is
  that bundle and nothing else. **Seen green in this shape once, from a push**: run 41910362381 on `main`
  (2026-11-04, c0cc821), `site` and `legacy-pages` both `success`. **Never yet run from `publish.yml`**: the
  first release after this lands is the first `docs` job, and #239 owns watching it.
  **Recovery:** "Re-run failed jobs" on the same Publish run (`gh run rerun <run-id> --failed`), within 30 days
  of it. Only what failed runs again (`site`, `legacy-pages` or both), with the run's own `GITHUB_SHA` and
  `GITHUB_REF`: it rebuilds the release commit, the `github-pages` rule still sees `main`, and `publish` and
  `notify` do not repeat. Past 30 days, "Run workflow" on `docs-deploy.yml`, from `main`, builds `main`'s head at
  that time, not the release commit. A failed `docs` job leaves the Publish run red although the package shipped.
  The called jobs set their own `timeout-minutes` (20 and 10), which a calling job cannot: they hold the `publish`
  concurrency group while they run.
- **Deploy (Worker)** — `worker-deploy.yml`, on any push to `main` touching `docs/worker/**`, `docs/src/chat/lib/**` (the contract the Worker bundles), or
  `docs/package.json` or `pnpm-lock.yaml` (the dependencies it bundles, so a bump alone redeploys it), or a manual
  dispatch from `main` only: the `deploy` job carries `if: github.ref == 'refs/heads/main'` (#246), so a run from
  any other ref deploys nothing, as long as that ref's copy of the workflow keeps the guard (`workflow_dispatch`
  runs the selected ref's file, and the Cloudflare secrets are repository-level; #253). **Has succeeded on push**: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` were set as
  repository secrets on 2026-10-03, and a manual dispatch that day succeeded. Every earlier run, the last
  one on 2026-10-01, failed at *Deploy to Cloudflare* for want of that credential. Push-triggered runs
  have succeeded since, on 2026-10-26, 2026-11-04 and 2026-11-05 (`gh run list --workflow worker-deploy.yml`).
  The merge deploys the Worker, but the client waits for a release: until one ships, the live client keeps
  calling `POST /`, which the Worker keeps serving unchanged, and `POST /api/chat` sits idle. Once a release has shipped the
  new client and the live site is seen using `/api/chat`, #257's §9 Q6 follow-up retires `POST /`.

### What each path gets on a merge

| Path | On a merge to `main` | Leaves behind |
|---|---|---|
| `@northguild/worktree` (root) | if its version moved: tested, built, published to npm, tagged, released | npm version + tag + GitHub release (all automatic) |
| `docs` | nothing on a merge. If the version moved and is stable: built, audited and deployed to `northguild.dev/worktree/` (Cloudflare Worker with static assets), then the legacy bundle to GitHub Pages, by the `docs` job of `publish.yml` | nothing |
| `docs/worker` | deployed to Cloudflare if the merge touched `docs/worker/**`, `docs/src/chat/lib/**`, `docs/package.json` or `pnpm-lock.yaml` — version or not | nothing |

**The npm path is gated on its own version, correctly.** `publish.yml` keys on the root version moving, and
a merge that does not bump it publishes, tags and releases nothing.

**The docs deploy is gated on the stable release.** It runs after `publish` in the same run, so the live site
describes the version npm serves: a feature's merge, or a docs-only merge, changes nothing live until the next
release. The cost is that a docs fix waits for a release, unless somebody runs `docs-deploy.yml` by hand from
`main`. A deployed site leaves no tag and no release of its own; the `docs` job runs against the same sha as the
`v<version>` tag.

**The gap, named and not generated:** the Worker deploys on no version, by decision
(`docs` is ignored by Changesets), and so leaves no tag and no release; the docs site now deploys with the release. The Worker's missing credential,
named here until 2026-10-18, is closed.

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
