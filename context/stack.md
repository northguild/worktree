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
| Package manager | pnpm 10.32.1, workspace with one member (`docs`) |
| Database | none |
| Storage | none |
| Hosting | CLI → npm; docs → GitHub Pages; chat proxy → Cloudflare Workers |

## Layout

```
bin/                  oclif entry point — bin/run.js, produced by tsc
src/commands/         one file per CLI command; each default-exports a BaseCommand subclass
src/lib/              CLI helpers — git integration, validators, env, types, constants, cli
src/integrations/     GitHub and Jira integrations
scripts/              version-sync scripts, run by `pnpm sync-version`
skills/               shipped inside the npm package (package.json `files`); generated — see below
docs/                 Next.js 16 + Nextra 4 docs app, React 19, Base UI; own package.json
docs/src/app/         docs content
docs/src/             UI, components, chat client, site metadata
docs/worker/          Cloudflare Worker proxying Gemini for the docs chat
context/              planning-workflow artifacts (this directory)
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
- **Three generated files must be committed in sync with `package.json`'s version:**
  `docs/src/lib/site-meta.ts`, `skills/core/SKILL.md`, `skills/_artifacts/skill_tree.yaml`. Run
  `pnpm sync-version` after a version bump; CI hard-fails on drift via `git diff --exit-code`. Use the
  root `pnpm docs:dev`, not `pnpm --filter docs dev` — the former syncs the version first.
- **One lockfile, at the root.** There is no `.npmrc` — the one that pinned
  `shared-workspace-lockfile=true` was removed in 260eb2f, and pnpm's default keeps the behaviour. CI
  still fails the build if `docs/pnpm-lock.yaml` ever appears, so do not add one.
- **Never deploy from a workstation.** Worker and docs deploys belong to `worker-deploy.yml` and
  `docs-deploy.yml`. `wrangler.toml` pins local dev to port 8787 and asks you to free the port rather than
  let it drift.
- **Console output is styled with chalk, so it is TTY-dependent.** Any test asserting on printed text has
  to control colour explicitly — see the `FORCE_COLOR=0` note in [`verify.md`](verify.md).

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

Nothing beyond what the tool installs. Index anything you add here — not in `context/README.md`, which is
tool-owned and replaced on every update.

Verification commands are in [`verify.md`](verify.md), not here. Executor dispatch is in
[`executors.md`](executors.md).
