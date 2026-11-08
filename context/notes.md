# Notes — search-and-answer-engines (#287)

Non-blocking observations from the gates, for a person. Branch-local; `/feature-close` deletes this file.

## Phase 1 — Sitemap `<lastmod>` from the footer date

- Nothing asserts the sitemap index's `<lastmod>`. `@astrojs/sitemap` sets it to the newest page `lastmod`
  (`write-sitemap.js:45`), so it is accurate today, but no audit rule pins it.
- The audit's skip for a sitemap URL with no built page (`continue` in `lastmodFailures`) is not pinned by a
  test of its own; the missing-page test matches with `.some(...)`.
- Plan §9 Q4: the Google Search Central wording on `lastmod` was not read in this phase. No code depends on it.
- The lib and audit tests were written alongside the code rather than strictly test-first; their expected
  values trace to Starlight's `toISOString()` footer, D1/D2 and the W3C Datetime profile.
- Plan §8's `grep -c "<lastmod>"` counts lines, and `sitemap-0.xml` is one line; `grep -o "<lastmod>" | wc -l`
  is the working form (prints 27; `<loc>` prints 28).
- `sitemap-lastmod.test.ts` defines its two module-level helpers as arrow consts (`typescript/rules.md:27`).
- `sitemapEntries` reads only the first `<lastmod>` in a `<url>`, and `footerDate` the first `<time>` on the
  page rather than one inside `<footer>` — the same `times[0]` the audit's date rule uses.

## Phase 2 — Long caching for hashed assets, `noindex` for text files

- `deploy-smoke.mjs` runs its retry loop at import, so its `check` functions have no unit tests; the header
  rows are proven only by a run against `wrangler dev --local` (and by the release's live run). Moving
  `buildRows`/`run` behind an entry-point guard would give them a seam. The audit's "`_astro/` cannot be read"
  branch is also untested.
- The hash-name rule checks a pattern (a dot-delimited segment of five or more characters), not a real
  content hash, so `foo.module.css` would pass. It is what §4.2 asked for.
- The audit fixture's hash names were lengthened (`.abc.` → `.abcabc.`) in the same commit as the rule that
  forces it (`tooling/ci.md` warns against mixing renames and behaviour); the commit message says so.
- `docs-deploy.yml`'s comments on the stage and smoke steps (lines 63, 75) do not mention `_headers` or the
  header rows; §7 left them unchanged and they are incomplete rather than untrue.
- The smoke's hashed asset is the first sorted `_astro/` entry — today `Chat.*.js`, about 850 KB, fetched up to
  six times — and `readdir` there does not skip a subdirectory that might sort first.

## Phase 3 — `llms.txt` Optional section and the `describedby` link

- The audit test "fails on every page when the file it names is not in the build" checks two pages, not all
  28, and not the site-level "llms.txt is missing from the build" line beside them.
- The `describedby` match splits `rel` on whitespace, so `rel="describedby alternate"` counts; no test uses a
  multi-word `rel`. The predicate is written twice in `audit-dist.mjs` (the per-page rule and the 404 rule).
- The llmstxt.org wording on `## Optional` quoted in `llms-txt.test.ts` was fetched by the coder; the reviewer
  had no web access to compare it word for word. The meaning matches D9 either way.
- Biome reports the new `LLMS_TXT_URL` import in `Head.astro` as unused (the 35th `pnpm check` warning): it
  cannot see the Astro template, the same false positive as the file's two older `noUnusedVariables`.

## Phase 4 — Page-size gate

- `PAGE_SIZE_LIMIT` sits directly above its own rule (`pageSizeFailures`), not beside `HERO_LOADER_BUDGET` as
  plan §4.4 says — the same colocation `HERO_LOADER_BUDGET` itself follows.
- That the rule counts bytes rather than characters is pinned only because the fixture title's `·` is two
  bytes; a multibyte padding character in the boundary tests would pin it on purpose.
- TN3156 says "1 MB" without saying 10^6 or 2^20 bytes; D10's 1,048,576 is kept (plan §9 Q4). The largest
  page today is `commands/branch/` at 178,908 bytes, so both readings pass.
