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
