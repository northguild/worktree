# Verification commands

This project's real verification stack. **Gate 1 reads this file** — no skill, agent prompt or role file
carries a copy of these commands, because a hardcoded stack rots the moment the project changes shape.

This is the single home for every command in this project. If you find a command written down anywhere else
in `context/`, that copy is the one that is wrong.

Keep it in step with CI. If a command here fails while CI is green, this file is the one that is wrong.

**Every command below was run from the repo root on 2026-10-18 and exited 0** (re-verified by `/onboard`
under `@baldurpan/create-ai-workflow` 0.26.0, in this worktree and in a fresh clone; first verified
2026-09-06). Anything that did not is recorded as such rather than written into a section. The one
later addition, `pnpm --filter docs typecheck`, was added on 2026-10-26 for #152 and run from the repo
root of a worktree that day, exiting 0; it has not been run in a fresh clone.

## Prerequisites

- **Node 26.12.1** (`devEngines.runtime` in `package.json`; every workflow reads it through
  `node-version-file: package.json`, and pnpm downloads it for a local install) and **pnpm 12.15.0** (the
  `packageManager` field in `package.json`; an older pnpm that manages package-manager versions switches to
  it on its own). **npm does not download it**: any `npm` command run in the repo on another Node exits with
  `EBADDEVENGINES`, so use pnpm, or switch the shell to 26.12.1 first.
- **The tree is prepared** — see *Prepare a fresh tree* below. A worktree made by `worktree branch` starts
  with no `node_modules`, and every section here then fails with `command not found`. A *stale*
  `node_modules` is the next thing to suspect when lint or the docs tests fail: this repo moved from the
  `@burglekitt` org to `@northguild` in 35fc08f, and an install predating that leaves
  `@northguild/gmt-biome` and `@northguild/gmt` absent while the lockfile already names them. The symptoms
  are a biome `Cannot read file` plugin error and `Failed to resolve import "@northguild/gmt"` in the docs
  suite.

## Lint

```bash
pnpm check
```

`biome check` runs format, lint and assist rules in one pass. CI runs `pnpm format` and `pnpm lint` as two
separate steps; `check` is a superset of both, so a green `check` here means both CI steps pass.

**If lint ever dies with a configuration error, read this before debugging your own config.** Biome 2
discovers *any* file named `biome.json` or `biome.jsonc` anywhere in the tree and loads it as a nested
config — and it does so before `files.includes` is consulted, so no exclusion in the root config can
prevent it. Fourteen exclusion shapes were tested on 2026-09-05 and none work; the only fix is that no such
filename exists in the tree. The standards bundle ships a Biome starter template that originally landed as
`context/standards/templates/biome.json` and broke `check`, `lint` and `format` together. It is renamed to
`biome-example.json` here, and that rename is permanent: `context/standards/` is project-owned (see
[`stack.md`](stack.md)), so `update` no longer writes to it. Keep it that way — never let a file named
`biome.json` or `biome.jsonc` back into the tree.

**The one exclusion that does work is `.gitignore`**, through `vcs.useIgnoreFile`. Every phase tree under
`.phase-trees/` is a full checkout carrying its own `biome.json`, and `/onboard` showed on 2026-10-18 that
without the `.phase-trees/` entry in `.gitignore` this command dies with *Found a nested root
configuration*; with it, a planted lint error, type error and failing tests there were invisible to every
section of this file. Keep that entry.

## Typecheck

```bash
pnpm typecheck
pnpm --filter docs typecheck
```

The root `tsconfig.json` includes only `src/`, so the second command is what type-checks the `docs`
workspace, `docs/worker/` included. It first runs `worker:build-context`, which regenerates the gitignored
`docs/worker/docs-context.ts` (`tsc` cannot resolve `worker.ts`'s import of it otherwise) and rewrites the
tracked `docs/src/chat/docs-routes.generated.ts` in place, then runs `tsc --noEmit`. That rewrite changes
nothing while the committed routes file is current. If a docs page was added without regenerating it, the
file shows as modified after this section, as it would after `pnpm docs:build`, and the regenerated file
belongs in the change. It needs no `GEMINI_WORKER_URL`, which is why it sits here while `pnpm docs:build`
sits below *Not run by Gate 1*. CI runs both typecheck commands.

## Build

```bash
pnpm build
```

## Test

```bash
pnpm test
pnpm docs:test
```

No environment prefix is needed. `vitest.config.ts` pins `env: { FORCE_COLOR: "0" }`, which is load-bearing:
`src/commands/cleanup.ts:37` wraps a count in `chalk.bold` while `src/commands/cleanup.test.ts:176-178`
asserts the *unstyled* string, so before that pin the suite passed in CI (no TTY) and failed in any
interactive shell. If a console assertion ever starts failing only on someone's machine, check that pin
first.

`pnpm test` covers `src/` and `scripts/`; `pnpm docs:test` covers the `docs` workspace including the Cloudflare Worker.
CI runs both. As of 2026-10-26 that is 1181 and 69 tests respectively — a snapshot for recognising a suite
that did not run, not a figure to assert against. It goes stale on any commit that adds a test, so correct
it in passing rather than treating a mismatch as a failure.

## Test markers

```bash
! git grep --untracked -nE '(^|[^A-Za-z0-9_.])(it|test|describe|suite)(\.[A-Za-z]+)*\.(only|skip|todo|fails|skipIf|runIf)([^A-Za-z0-9_]|$)' -- '*.test.ts' '*.test.tsx' '*.test.mjs'
```

Fails when any test file — tracked or new — holds a focused, skipped, todo or expected-to-fail test,
including chained forms such as `it.concurrent.skip` and conditional ones such as `describe.skipIf(…)`.
Vitest reports a skipped test as a pass and a focused one silences every test beside it, so *Test* above
can exit 0 while asserting almost nothing. **Biome does not cover this:** `noFocusedTests` reports `it.only`
but `pnpm check` still exits 0, and nothing in the recommended set sees `.skip`, `.todo` or `.fails`.

`--untracked` is what makes it see a test a phase has just written, and it still honours `.gitignore`, so
`node_modules` and `.phase-trees/` stay out. The portable character classes are deliberate: `git grep -E`
on macOS does not honour `\b`, and a version of this command using it matched nothing at all. A property
access such as `expect(x.only)` inside a test does not trip it. Adopted by `/onboard` on 2026-10-18; a
test that genuinely has to be skipped is a conversation, not an edit to this pattern.

## Not run by Gate 1

- **`pnpm sync-version`** — generation, not verification. It *writes* `docs/src/lib/site-meta.ts`
  from `package.json`'s version, so it must never sit in a gate section: Gate 1 does not mutate the working
  tree. `pnpm changeset:prepare-release` runs it after `changeset version`, so the release pull request
  carries the result; run it by hand only to repair drift. `ci.yml` runs it and then hard-fails on drift via
  `git diff --exit-code`.
- **`pnpm changeset:add`** — not a gate: interactive (it prompts for a bump level and a description) and it
  writes a `.changeset/*.md` file. Run it when a change owes a release note, per [`release.md`](release.md).
- **`pnpm changeset:status`** — not a gate: it compares against `origin/main`, so it needs that ref and a
  full-depth clone (`fetch-depth: 0`), and a local result is meaningless without them. It is the
  `release-note.yml` pull request check; Gate 1 runs per phase while a note is owed once per feature.
- **`pnpm changeset:prepare-release`** — not a gate: it mutates the tree (bumps `package.json`, writes
  `CHANGELOG.md`, deletes the consumed notes) and is run once, by a maintainer, to make a release pull
  request. Never run it to verify anything.
- **`pnpm docs:build`** — needs the `GEMINI_WORKER_URL` repository variable baked in at build time.
  Deploy concern; `docs-deploy.yml` owns it. The TypeScript errors it would report outside Next's generated
  route types are caught earlier, by `pnpm --filter docs typecheck` under *Typecheck*.
- **`pnpm --filter docs worker:deploy`** and any `wrangler deploy` — need `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID`. Never run against production from a workstation; `worker-deploy.yml` owns it.

## Prepare a fresh tree

```bash
pnpm install --frozen-lockfile
```

What makes a clean checkout of this repository runnable — and here it is the whole of it. **Gate 1 does
not run it**, which is why it sits below that line: an ordinary phase works in a tree that is already
prepared. `/feature-implement` runs it in each fresh checkout it makes for a round of phases.

Verified by `/onboard` on 2026-10-18 in a `git clone --no-hardlinks` of this repository: after this one
command every gate section above exited 0, and `git status --porcelain` printed nothing. Nothing else is
needed — `pnpm build` is not a prerequisite of the tests, and the Worker's generated `docs-context.ts` is
aliased to a committed stub in `docs/vitest.config.ts`. `--frozen-lockfile` is the form that reads the
lockfile instead of rewriting it, the same one CI uses; plain `pnpm install` could dirty the tree and cost
the round.

## Rules

- **A missing entry is skipped, never faked.** An empty section above means there is no such step. Gate 1
  skips it and says so; it never substitutes a command it invented.
- **Docs-only changes run Lint only**, plus a read of the diff. Skip build and test for changes that touch
  no application code.
- **Exit 0 is the verdict.** A non-zero exit is a Gate 1 failure regardless of what the summary text says.
- **If this file has no filled-in section at all, Gate 1 stops and says so.** It does not guess.
