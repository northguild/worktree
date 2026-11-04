# Notes — docs-deploy-on-release (#241)

Branch-local. Non-blocking observations from the review gate; nothing reads this file, and `/feature-close`
deletes it.

## Phase 1 (Gate 2: PASS WITH NOTES)

- A called workflow's token can only be narrowed: if the calling job does not grant `pages: write` and
  `id-token: write`, GitHub rejects the whole called run before `site` starts, not just `legacy-pages`.
- With no checkout `ref` (D4), a "Run workflow" recovery of Publish builds `main`'s head at that time, which
  may be past the release commit. Acceptable; worth a sentence where the recovery is documented.
- `environment: github-pages` in the called workflow sees the caller's ref; Publish's `guard` already
  requires `refs/heads/main`, so a dispatch from another branch stops before `docs`.
- The header line "Two deploys from one push (#235)" reads off once the workflow is callable.
- `publish.yml`'s workflow-level `concurrency: publish` does not clash with the called jobs' own groups
  (`docs-site`, `pages`), and nothing in `docs-deploy.yml` reads `github.event_name`/`github.workflow`.

## Phase 2 (Gate 2: FAIL, then PASS WITH NOTES after one loopback)

- Filed as bug #243: a `workflow_dispatch` of `docs-deploy.yml` from a non-main branch deploys `site` to
  production before `legacy-pages` fails on the environment policy. Predates this feature.
- `docs/README.md` *Deployment*: "Re-run failed jobs" on the same Publish run is a quieter recovery (the release
  commit, no Discord post); the README names only the Publish dispatch and the `docs-deploy.yml` dispatch.
- `docs/README.md`: "the last job of `publish.yml`": `docs` runs alongside `notify`, both after `publish`.
- `context/release.md`: the *Hold the first release* paragraph was kept as "the hold is lifted" rather than
  deleted; a few lines there and in `docs/README.md` run past the usual wrap width.
- `context/stack.md:71` says `worker-deploy.yml` "has never succeeded", against `release.md`'s "has succeeded
  once". Predates this feature.
