# Verification commands

This project's real verification stack. **Gate 1 reads this file** — no skill, agent prompt or role file
carries a copy of these commands, because a hardcoded stack rots the moment the project changes shape.

This is the single home for every command in this project. If you find a command written down anywhere else
in `context/`, that copy is the one that is wrong.

Keep it in step with CI. If a command here fails while CI is green, this file is the one that is wrong.

**Every command below was run from the repo root on 2026-09-09 and exited 0** (re-verified by `/onboard`; first verified 2026-09-06). Anything that did not is
recorded as such rather than written into a section.

## Prerequisites

- **Node 24** (`.github/workflows/ci.yml` pins `node-version: 24`) and **pnpm 10.32.1** (the
  `packageManager` field in `package.json`).
- **`pnpm install --frozen-lockfile` already run.** A stale `node_modules` is the first thing to suspect
  when lint or the docs tests fail on a clean checkout: this repo moved from the `@burglekitt` org to
  `@northguild` in 35fc08f, and an install predating that leaves `@northguild/gmt-biome` and
  `@northguild/gmt` absent while the lockfile already names them. The symptoms are a biome
  `Cannot read file` plugin error and `Failed to resolve import "@northguild/gmt"` in the docs suite.

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

## Typecheck

```bash
pnpm typecheck
```

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

`pnpm test` covers `src/`; `pnpm docs:test` covers the `docs` workspace including the Cloudflare Worker.
CI runs both. As of 2026-09-11 that is 491 and 49 tests respectively — a snapshot for recognising a suite
that did not run, not a figure to assert against. It goes stale on any commit that adds a test, so correct
it in passing rather than treating a mismatch as a failure.

## Not run by Gate 1

- **`pnpm sync-version`** — generation, not verification. It *writes* `docs/src/lib/site-meta.ts`,
  `skills/core/SKILL.md` and `skills/_artifacts/skill_tree.yaml` from `package.json`'s version, so it must
  never sit in a gate section: Gate 1 does not mutate the working tree. Run it after a version bump and
  commit the result — `ci.yml` runs it and then hard-fails on drift via `git diff --exit-code`.
- **`pnpm docs:build`** — needs the `GEMINI_WORKER_URL` repository variable baked in at build time.
  Deploy concern; `docs-deploy.yml` owns it.
- **`pnpm --filter docs worker:deploy`** and any `wrangler deploy` — need `CLOUDFLARE_API_TOKEN` and
  `CLOUDFLARE_ACCOUNT_ID`. Never run against production from a workstation; `worker-deploy.yml` owns it.
- **`pnpm intent:validate` / `pnpm intent:stale`** — both shell out to `npx @tanstack/intent@latest`,
  so they need network access and are not version-pinned. Not a per-task gate.

## Rules

- **A missing entry is skipped, never faked.** An empty section above means there is no such step. Gate 1
  skips it and says so; it never substitutes a command it invented.
- **Docs-only changes run Lint only**, plus a read of the diff. Skip build and test for changes that touch
  no application code.
- **Exit 0 is the verdict.** A non-zero exit is a Gate 1 failure regardless of what the summary text says.
- **If this file has no filled-in section at all, Gate 1 stops and says so.** It does not guess.
