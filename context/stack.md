# Stack

`@northguild/worktree` is a Node CLI for managing git worktrees, published to npm and built on
[oclif](https://oclif.io/docs/api_reference). The repository is a two-package pnpm workspace: the CLI at
the root, and a Next.js/Nextra documentation site under `docs/` that deploys to GitHub Pages and talks to
a small Cloudflare Worker proxying Gemini for its chat feature.

One piece of history explains a lot of the current shape: the project moved from the `@burglekitt` org to
`@northguild` in 35fc08f (2026-08-26). Package names, the biome plugin and the docs' shared library all
changed scope in that commit, so anything installed or generated before it is stale in a way that produces
confusing errors rather than obvious ones — see the prerequisites in [`verify.md`](verify.md).

| Concern | Target |
|---|---|
| Runtime | Node 24 (CI pins it; `@types/node` is still on 18) |
| Package manager | pnpm 10.32.1, workspace of the root and `docs` (the root is listed as `"."` so Changesets can see it; `pnpm -r` still skips it) |
| Database | none |
| Storage | none |
| Hosting | CLI → npm; docs → GitHub Pages; chat proxy → Cloudflare Workers |

## Layout

```
bin/                  oclif entry point — bin/run.js, produced by tsc
src/commands/         one file per CLI command; each default-exports a BaseCommand subclass
src/lib/              CLI helpers — git integration, validators, env, types, constants, cli
src/integrations/     GitHub and Jira integrations
scripts/              version-sync script, run by `pnpm sync-version`; `release-notes.mjs`, which publish.yml uses to cut a version's CHANGELOG section
.changeset/           Changesets config and pending release notes (`.changeset/<name>.md`)
skills/               the usage skill, `skills/worktree/SKILL.md`; hand-written, shipped inside the npm package (package.json `files`) and installable with `npx skills add`. Nothing on npm discovers it since TanStack Intent went (`skills add` reads GitHub); it stays in `files` so an `npm i -g` install has a copy matching its own version on disk
docs/                 Next.js 16 + Nextra 4 docs app, React 19, Base UI; own package.json
docs/src/app/         docs content
docs/src/             UI, components, chat client, site metadata
docs/worker/          Cloudflare Worker proxying Gemini for the docs chat
context/              planning-workflow artifacts (this directory)
context7.json         what Context7 (context7.com) may index from this repo: the user docs, the usage skill and the README — see Documentation below
.github/agents/       documentation-only agent manifests — nothing executes them
```

## Conventions

- **ESM throughout** (`"type": "module"`). Relative imports carry a `.js` extension even in TypeScript
  source — `import { BaseCommand } from "../lib/base-command.js"`. This is a runtime requirement, not a
  style choice; dropping the extension breaks the built CLI.
- **Avoid `export default`.** The one exception is `src/commands/*.ts`: oclif requires each command file to
  default-export its command class. `src/lib/` and `src/integrations/` use named exports throughout.
- **New commands follow the existing pattern** — extend `BaseCommand` from `src/lib/base-command.js`, use
  the oclif flags/args pattern, and add a colocated `src/commands/<name>.test.ts`.
- **Tests are colocated** as `*.test.ts` next to the code they cover, in both workspaces. vitest.
- **Biome owns formatting and linting**, configured in `biome.json` with the `@northguild/gmt-biome` grit
  plugin. Never add a file named `biome.json` or `biome.jsonc` anywhere else in the tree, including as an
  example or template — Biome 2 loads every one it finds as a nested config, and no exclusion in the root
  config can stop it. [`verify.md`](verify.md) has the detail; the standards bundle's starter template is
  renamed to `biome-example.json` here for exactly this reason.
- **The docs app is static/SSR and must never hold a secret.** `GEMINI_API_KEY` lives in Cloudflare Worker
  secrets (`pnpm --filter docs worker:setup-secret`, i.e. `wrangler secret put`). For local development,
  `worker:setup-dev-vars` reads it from `docs/.env.local` and writes `docs/worker/.dev.vars`; both are
  gitignored. `ci.yml` runs a secret scan that fails the build if a key value is committed.
- **One generated file must be committed in sync with `package.json`'s version:**
  `docs/src/lib/site-meta.ts`. The version bump arrives through `pnpm changeset:prepare-release` in the
  release pull request, which runs `pnpm sync-version` after `changeset version`; never bump by hand. CI
  hard-fails on drift via `git diff --exit-code`. Use the root `pnpm docs:dev`, not `pnpm --filter docs dev`
  — the former syncs the version first.
- **One lockfile, at the root.** There is no `.npmrc` — the one that pinned
  `shared-workspace-lockfile=true` was removed in 260eb2f, and pnpm's default keeps the behaviour. CI
  still fails the build if `docs/pnpm-lock.yaml` ever appears, so do not add one.
- **Never deploy from a workstation.** Worker and docs deploys belong to `worker-deploy.yml` and
  `docs-deploy.yml` — but `worker-deploy.yml` has never succeeded, for want of a Cloudflare token; see
  [`release.md`](release.md) before assuming a Worker change is live. `wrangler.toml` pins local dev to
  port 8787 and asks you to free the port rather than let it drift.
- **Console output is styled with chalk, so it is TTY-dependent.** Any test asserting on printed text has
  to control colour explicitly — see the `FORCE_COLOR=0` note in [`verify.md`](verify.md).

## Documentation

Where this project explains itself. **Every plan's §7 starts from this list**, and whatever a change makes
untrue on one of these surfaces is fixed by the phase that makes it untrue, not by a follow-up.

| Surface | Who reads it | What has to reach it |
|---|---|---|
| [`README.md`](../README.md) | someone deciding whether to install; npm renders it as the package page | the fast path — a new command, a renamed flag, a change to what the tool is for |
| `docs/src/app/docs/` | users looking something up, at https://northguild.github.io/worktree | any user-visible CLI behaviour. One page per command under `commands/` (7), plus `configuration/`, `getting-started/`, `faq/`, and `guides/` (6) |
| [`docs/README.md`](../docs/README.md) | someone working on the docs app | how the docs app is run or built |
| [`docs/worker/README.md`](../docs/worker/README.md) | someone working on the chat proxy | the Worker's routes, secrets or deploy |
| `skills/worktree/SKILL.md` | agents that install the skill with `npx skills add`; shipped in the npm package; also embedded in the docs chat system prompt | a command or flag change that the skill describes — **but see the caveat below** |
| `docs/src/app/docs/changelog/page.mdx` | users looking for release notes | the release-process steps, if the release flow changes — it states the "single latest-docs" policy and points at `CHANGELOG.md` |
| [`context7.json`](../context7.json) | Context7, which indexes a GitHub repository's markdown for coding agents to query | the folder lists, if `docs/src/app/docs/` or `skills/` moves; a new root-level `.md` file, which is indexed unless named in `excludeFiles`; and its `rules`, which restate passages of `skills/worktree/SKILL.md`, if one of those behaviours changes |

**Every surface above is sourced from this repository.** The GitHub Pages site is built from `docs/` by
`docs-deploy.yml`, npm's package page renders the root `README.md`, and `context7.json` fixes what Context7
may index from the tree. All of it is already in the tree, so sweeping the tree finds every surface. Context7
lists the repository as `/northguild/worktree`; the claim fields are below.

`context7.json` indexes `docs/src/app/docs/` (minus its `changelog/` page, which is release policy, not usage
docs), `skills/` and the root `README.md`, and nothing else: `folders` is a whitelist, and Context7 always
indexes root-level markdown, which is why `AGENTS.md`, `CLAUDE.md` and `CHANGELOG.md` are named in
`excludeFiles` (specifying `excludeFiles` or `excludeFolders` at all switches off Context7's default exclusions).

The same file carries the maintainer's ownership claim, `url` and `public_key`, which Context7 reads from the
default branch to verify it. Removing or changing either field breaks the claim; replacing the file with the
claim modal's two-field snippet drops the whitelist above, and the next refresh would index `context/` and
`.claude/` too.

### The two that are not ordinary docs

- **`.github/agents/` is not maintained.** Documentation only, nothing executes it, the `scripts/run-agents.js`
  runner it proposes was never written, and no workflow references the directory. **Do not propose updates
  to it as part of a feature** — treat it as a note to contributors. Its suggest-only commit rule was
  adopted by [`git.md`](git.md) in 2026-09-06 and **reversed there on 2026-09-09**: the agent now commits.
  The manifest is scoped to suggesting lint fixes on a PR, not to the phase loop, so the two disagree on
  paper and `git.md` is the executable answer.
- **`skills/worktree/SKILL.md` is hand-written throughout.** Nothing generates any part of it, so a command
  or flag change can make it untrue and the change that does so fixes it. The docs worker reads it by path
  (`docs/worker/build-context.mjs`), so moving it means repointing that script.

This project stated the standing rule itself, in `changelog/page.mdx`, before the workflow arrived:
*"Update relevant docs pages in the same change."*

## Agent customization lives in `.claude/` and `.agents/`

Project skills are in `.claude/skills/` and `.agents/skills/`; agents in `.claude/agents/`. Both trees are
tool-owned and replaced on update.

`.github/agents/` is **documentation only and nothing runs it.** Its own README says so, the
`scripts/run-agents.js` runner it proposes was never written, and no workflow references the directory.
`.github/prompts/` and `.github/instructions/`, recommended by the pre-overlay `AGENTS.md`, do not exist.
The directory is left in place; treat it as a note to contributors, not as a mechanism.

## `context/standards/` is project-owned

It no longer tracks the bundled default. Two deliberate changes were made on 2026-09-05:

- **PHP removed** — `standards/php/` and `docs/PHP-SPEC.md` deleted, and every reference to them dropped
  from `standards/README.md` and `standards/philosophy/ai-agent-behavior.md`. This repo has no PHP and the
  conditional table should not offer it.
- **`templates/biome.json` renamed to `biome-example.json`** — see [`verify.md`](verify.md).

Editing any file under `standards/` flips the whole tree to project-owned in
`@baldurpan/create-ai-workflow`'s manifest, which is what makes both changes stick: `update` now skips
every `context/standards/*` path rather than restoring it. The trade is that upstream standards fixes no
longer arrive automatically — refresh by re-vendoring with `standards add <git-url>` when you want them,
and expect to redo these two changes afterwards. Everything outside `standards/` is unaffected and still
updates normally.

**Two files carry that flip, and a deletion is not one of them.** Read from the updater's own source at
`dist/commands/update.js:37-41` (v0.4.0), the "edited" test is
`onDisk === null ? false : hash(onDisk) !== recorded` — **a file deleted from `standards/` counts as
unedited.** So the ten paths this project removed, `templates/biome.json` among them, contribute nothing.
The whole tree stays adopted because exactly two files still exist with a changed hash:

| File | Why it differs |
|---|---|
| `standards/README.md` | the PHP rows dropped from the conditional table |
| `standards/philosophy/ai-agent-behavior.md` | the PHP references dropped |

**Restoring either one to its bundled content re-arms the updater against this whole directory.**
`standardsAdopted` goes false, and `update.js:49-52` treats every deleted-but-recorded path as a `restore`
— which brings back `standards/templates/biome.json` and breaks `pnpm check`, `pnpm lint` and `pnpm format`
together, exactly as [`verify.md`](verify.md) describes, plus `standards/php/`'s eight files and
`standards/docs/PHP-SPEC.md`. If you ever need to revert a PHP-removal edit, delete the file instead of
restoring it, or re-check `manifest.json` afterwards.
Verified 2026-09-05: of the 78 `standards/` paths in `context/.state/manifest.json`, 66 match their recorded
hash, 10 are deleted, and those 2 are modified.

## Also in `context/`

| File | What it is |
|---|---|
| [`findings.md`](findings.md) | defects recorded by Gate 2 and by hand, last written 2026-09-11 (7e68aa4). **No longer part of the workflow** since `@baldurpan/create-ai-workflow` 0.22.0 — nothing reads or writes it, and nothing is blocked by it. It still holds open entries whose ends (a bug issue, a backlog entry, or dropped) nobody has decided yet; see [`tracking.md`](tracking.md) |

Index anything you add here — not in `context/README.md`, which is tool-owned and replaced on every update.

Verification commands are in [`verify.md`](verify.md), not here. Executor dispatch, and how a branch or
worktree is made, are in [`executors.md`](executors.md); who commits, where work lands and whether it is
pushed are in [`git.md`](git.md); where the backlog, the plans and the phase ledgers live is in
[`tracking.md`](tracking.md); and what a change announces, and what tags, publishes and deploys, is in
[`release.md`](release.md).
