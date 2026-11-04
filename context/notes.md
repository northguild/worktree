# Notes

Branch-local, advisory, deleted whole by `/feature-close`. Nothing reads this file.

## From phase 1's review (Astro + Starlight scaffold)

- `docs/astro.config.mjs` pins `server: { port: 3000 }` because the Worker's CORS still allows only
  `localhost:3000`. Phase 6 moves CORS to 4321 (D7), but its Files line names neither `astro.config.mjs` nor
  `docs/README.md`, `docs/worker/README.md` (3000 mentions) or `MarkdownContent.tsx`'s dev allow-list.
- `next/link` → `<a>` dropped Next's base-path prefixing: the chat's internal links (`MarkdownContent.tsx`
  renderers, `DOCS_ROUTE_MAP`) render `/docs/...` without `/worktree`. Harmless while the chat is unmounted;
  phase 6's scope strips origin and base from incoming links but does not say it adds the base to rendered
  hrefs. Pin with a test asserting internal hrefs start with `import.meta.env.BASE_URL`.
- `process.env.NODE_ENV === "development"` → `import.meta.env.DEV` (`MarkdownContent.tsx`, `FormContext.tsx`):
  under Vitest DEV is true, so the dev allow-list includes `localhost:3000` in tests. Unverified.
- Tailwind `dark:` variant: the deleted `tailwind.config.js` keyed dark mode on `[data-theme="dark"]` (probably
  never loaded under v4). `globals.css` has no `@custom-variant dark`, so the chat's `dark:` classes follow the
  OS, not Starlight's theme picker. Q13 says the visitor's system decides — but the picker can override it.
- Tailwind preflight is dropped on purpose; the chat's buttons and inputs lose their reset. Look in phase 5's
  browser pass.
- Stale "Nextra theme" / "Next.js" comments in `ChatInput.tsx`, `ChatSubmitButton.tsx`, `build-context.mjs`,
  `worker.ts` — files later phases own.
- `verify.md`'s provenance line for `pnpm docs:build` does not say it was never run in a fresh clone, while
  *Prepare a fresh tree* claims every gate section passed in one. CI does not run `docs:build` yet (phase 11).
- Rules nothing tests yet: D3's URL settings (pinned by §8's sitemap and canonical rows later); the API key
  staying out of `dist` (only Astro's `PUBLIC_` default; a grep in phase 7's audit would pin it); the
  maintainers/avatar behaviour the deleted Footer and ProfileAvatarLink tests asserted (until phase 4).
- `verify.md`'s `pnpm sync-version` bullet still says it "must never sit in a gate section" while Build now
  runs it through `pnpm docs:build` as a no-op; the bullet could name that exception (re-review of phase 1).
- `astro` is a caret range though `tooling/dependencies.md` suggests exact pins for build tools; the repo's
  convention has been carets (Next was `^16.4.3`).

## From phase 2's review (NorthGuild theme)

- The font's provenance is recorded nowhere: a woff2 carries no header, yet `docs/README.md` and
  `context/stack.md` say it was "taken at the commit each file's header names". Name its path and sha
  (`packages/theme/fonts/michroma-latin-400-normal.woff2`, `ade22a5`) in the README or in `theme.css`'s
  `@font-face` comment.
- The `--gmt-*` coverage and 4.5:1 contrast checks live in a scratch script that dies with the session; the
  README's refresh steps then ask a person to check by reading. A docs Vitest test parsing `src/styles`,
  order-aware and covering inverted pairs (text-invert on text-accent) and translucent surfaces, would pin it.
- The mobile "On this page" bar uses `--sl-color-bg-nav` (82% void, no blur), so body text shows through at
  18%; `option` backgrounds in Starlight's `Select` are translucent too. Look in the browser pass.
- `docs/README.md` calls `SiteTitle.astro` "copied the same way" — it is an adaptation naming its source, not
  a never-edit copy, and the refresh steps do not cover the mark. The README documents the Vite warning for
  the `./fonts/` path only; the coder reported one for `/worktree/fonts/` too.
- `/worktree` is hard-coded in `astro.config.mjs` (`base`, the preload href) and `theme.css`'s `@font-face`;
  gmt uses `withBase(...)`.
- `docs/src/assets/logo.svg` is on phase 2's Files line, referenced by nothing, and left in place.
- `theme.css`'s comments overstate two things: the header is "as on northguild.dev" (the apex uses
  `.gmt-glass`, 4px blur, teal tint — this is lighter, after it), and "every `--sl-*` points at a `--gmt-*`
  token that tokens-light.css re-tints" (not true of `--gmt-hairline`, `--gmt-font-mono` or the literals).
- The light code-block background is Starlight's unmapped `--sl-color-gray-7`; syntax colours are Expressive
  Code defaults.
- `context/stack.md` says Biome owns formatting and linting; it could mention `docs/src/styles/northguild/` is
  excluded (`biome.json`), for the byte-for-byte rule.
- No browser pass or LCP/CLS measurement yet (R12); Michroma title truncation at phone width unseen.

## From phase 10's review (legacy Pages bundle)

- `build-legacy-pages.mjs` hands its CLI `outDir` argument straight to `rm(out, { recursive: true, force:
  true })`; a wrong argument such as `.` or `~` deletes that tree. Phase 11 calls it from CI — worth refusing
  a path outside `docs/`, or one that does not look like a previous bundle.
- The exported `targetFor` can leave `https://northguild.dev/worktree/` on hostile input (`/docs///evil.com/x`
  → `https://evil.com/x/`); its only input today is the frozen route list. A guard that throws unless the
  result starts with the root would make the property hold for any input.
- Test gaps: the only-D3-URLs assertion is not applied to the root stub or `404.html`; an extra route in
  `OLD_ROUTES` fails nothing; nothing pins D5 (the script not importing from `src/`).
- `escapeAttr` and the test's `read` are const arrows where `typescript/rules.md` asks for `function`
  declarations; other `.mjs` scripts here do the same.
- `build:legacy` is in no `docs/README.md` table and `docs/scripts/` / `docs/legacy/` are not in
  `context/stack.md`'s layout block — phase 11, which wires the bundle into `docs-deploy.yml`, is the place.
- Old explicit `.html` URLs (`/worktree/docs/commands/branch.html`) land on `404.html` and go to the new root,
  not the matching page; nothing is known to link that form.

## From phase 3's review (top-level and command pages)

- `/worktree/favicon.svg` is referenced by every page (Starlight's default favicon) and supplied by no phase;
  the old site had none either. Phase 7 (head) or phase 9 (the 404 and a11y pass) could take it.
- In `commands/branch.mdx` the moved Jira subsection's "decide in the same order … the write happens at the
  same point" (≈300-302) now refers to `### Moving the issue to started`, which sits below it (≈371). A link to
  `#moving-the-issue-to-started` would repair it; D12 left it alone.
- No rule checks that internal `/worktree/…` links and anchors resolve (Astro does not prefix `base` onto
  markdown links, so they are written out); nothing pins a page's `description:` to §4.3 either. Seam:
  `docs/scripts/audit-dist.mjs` (phase 7).
- FAQ `description:` departs from §4.3: the row was stale after #233 (the FAQ has a Jira Data Center entry);
  used "Answers on worktree vs git stash, private repos, GitHub Enterprise, Jira Data Center, editors, Herdr,
  Windows and where to find every command option." (149 chars).
- Once phase 7 sets the site title to `@northguild/worktree`, the root `<title>` reads "Getting Started with
  @northguild/worktree | @northguild/worktree".
- `docs/src/chat/docs-routes.generated.ts` lost the 12 ported routes (its generator still reads
  `docs/src/app/docs/`), and the chat's `docs-context.ts` lacks these pages — phase 6's.
- `docs/src/styles/custom.css` (on the Files line) was not created; the content needed no styles.
- `docs/src/app/docs/commands/_meta.ts`'s comment is stale until phase 4 deletes `docs/src/app/`.
- Phase 3 is two commits by the user's choice (2026-11-04): the stub's deletion with eleven pure renames,
  then Getting Started's move onto `index.mdx` with every edit — so all 12 pages keep `git log --follow`.

## From phase 4's review (guides, changelog, footer)

- `scripts/engines.test.mjs:27` tells a developer to edit `docs/src/app/docs/getting-started/page.mdx` when the
  engines range changes, and line 57 asserts that text; the range now lives in
  `docs/src/content/docs/index.mdx` (≈131). Same kind: comments at `src/commands/branch.test.ts` ≈1422 and
  ≈6867. Branch-local (phase 3 moved the page) — fix within this feature before close.
- The licence/version/maintainers block renders as a plain `<div class="project-footer">` after Starlight's
  `<footer>`, inside `<main>`; the old one sat in Nextra's footer. "Maintainers:" text plus
  `aria-label="Maintainers"` say it twice (`aria-labelledby` is cleaner); a one-item `<ul aria-label="Owner">`
  is heavy; new-tab links give no warning (as before). For phase 9's a11y pass.
- Nothing asserts the footer's content any more (`CLI Version: v…`, `MIT <year> © northguild`, the owner
  link), which the old `Footer.test.tsx` did. Render `Footer.astro` via `astro/container` with Starlight's
  `Default` mocked, or check it in phase 7's dist audit.
- `MaintainersList.test.ts:7` cites the old tests for "the avatar's alt is the name"; the empty-alt-when-named
  case comes from `react/accessibility.md` (decorative images), not from them.
- `docs/vitest.config.ts` now wraps `getViteConfig`, so every docs suite (the Worker's included) loads the
  whole Astro config — slower setup, and a broken `astro.config.mjs` fails every suite.
- `docs-routes.generated.ts` is `new Set([])` until phase 6: `MarkdownContent` fails closed (drops every
  internal chat link). `docs/README.md` ≈76 and `docs/worker/README.md` ≈240 describe a scan that now finds
  nothing — phase 6's, with `context7.json`.
- `pnpm check` prints 8 Biome warnings: false "unused import" reports on `.astro` frontmatter (`Footer.astro`,
  `MaintainersList.astro`). Applying the suggested fixes would delete used imports.
- Phase 4 is split into a rename-only commit and an edits commit (user, 2026-11-04) so `guides/index.mdx`
  (18 lines, below the 50% rename threshold after its edits) keeps its history.

## From phase 5's review (chat on demand)

- Focus on drawer close is unverified: the drawer opens without `Drawer.Trigger`, so Base UI may return focus
  to the hidden launcher button and land on `<body>`. Setting `finalFocus` on `Drawer.Popup` to the
  `ChatTrigger` would make it certain — §8's browser pass at the latest.
- `.chat-launcher-status:empty { display: none; }` makes the live region appear with its message, which some
  screen readers announce unreliably — phase 9's a11y pass.
- A render error in the chat after mount escapes `launcher.ts`'s try/catch, leaving the launcher hidden and
  no trigger at all.
- Rules nothing asserts: D6 at the built-output level (a static `import` of `Chat` in another `.astro` file
  would pass every test — pin it with a dist scan beside `build-legacy-pages.test.mjs`); no `dark:` in
  `docs/src/chat`; the loaded trigger's name returning to "Open chat" after close.
- `ChatLauncher.test.tsx:184`'s handover assertion proves little (a modal dialog hides everything outside it);
  the mocked test at ≈95–109 is what pins the handover. The new tests use `fireEvent` where
  `react/testing.md` prefers `userEvent`. The error text is pinned by its own wording.
- `useLocalStorage.getSnapshot` reads `window.localStorage` outside its try/catch (pre-existing).
- Re-review of phase 5: Alt+Shift+C calls `preventDefault` wherever focus is, so on a Mac (where
  Option+Shift+C types "Ç") nobody can type "Ç" on the site — not in the chat's field, not in search. Ignoring
  the shortcut when focus is in `input`/`textarea`/`[contenteditable]`, or a key that types nothing, would fix
  it. Raised with the user. Screen-reader and OS bindings for Alt+Shift+C are unverified (§8 browser pass with
  NVDA and VoiceOver). `aria-keyshortcuts="Alt+Shift+C"` on both launcher buttons would announce it (phase 9).
  Where `color-mix` is unsupported, `bg-chat-danger-wash` falls back to a solid `--gmt-danger` fill.

## From phase 12's review (CLI schema URL, links, homepage)

- Phase 12's Done-when grep is not literally met: `docs/README.md:130` still names `northguild.github.io`. The
  line is true — it documents `GH_PAGES_ORIGIN` in `MarkdownContent.tsx`, which phase 6 keeps as the legacy
  strip — so rewording it would make the docs false. A plan defect: the grep should exclude that table, and
  the table's new-origin row belongs to phase 6 (which changes `MarkdownContent`), not phases 1 and 11 as §7
  says.
- `src/lib/project-config.test.ts` ≈1563 is titled "holds the schema line from #181 verbatim" and the comment
  at ≈59-60 says "verbatim" from #181; the value now comes from #235 §8 / D5.
- `scripts/sync-docs-version.test.mjs` ≈20-30 makes a `mkdtempSync` tree per case and never removes it.
- The `getRepositoryUrl` reorder: a non-GitHub `repository` with a github.com `homepage` now falls back to
  `https://github.com` (was the homepage). Not this repo; unpinned.
- Until phase 11 deploys, README's links point at a host that answers 404 at `/worktree` — the feature has to
  merge and deploy together; confirm at `/feature-close`.
- Release note drafted for `/feature-close` (proposed patch): "`.worktree.yml` files that `worktree config
  --project` generates now start with `# yaml-language-server: $schema=https://northguild.dev/worktree/schema/v1.json`,
  and the package `homepage` points to the new docs site at https://northguild.dev/worktree/. Existing files
  keep working, because the old schema URL continues to serve the same schema."

## From phase 6's review (chat knowledge and Worker origins)

- `MarkdownContent.tsx` lists `mailto:` in `SAFE_PROTOCOLS`, but the origin check always rejects it (opaque
  origin `"null"`), as before; the test pins rejection. Drop it from the set or comment that it never passes.
- A slashless absolute link (`https://northguild.dev/worktree/commands/branch`) renders as plain text (exact
  match, as before); appending `/` before the lookup would recover it without widening the allow-list.
- Phase 6's Done-when grep prints two lines after commit: the legacy strip in `MarkdownContent.tsx` and the
  test fixture at `MarkdownContent.test.tsx:9` that pins it. Plan wording defect, like phase 12's.
- Unpinned: refusal of the retired `https://northguild.github.io` origin (only `localhost:3000` is tested);
  `build-context.mjs` keeping Tabs content (the install commands) in the prompt; the general JSX strippers
  are gone, so a future `<Aside>` or `<Card>` would leave raw tags in the prompt.
- `MarkdownContent.tsx:12`'s comment ("an old link resolves instead of vanishing") overstates: a real old
  link `…github.io/worktree/docs/commands/branch` strips to `/docs/commands/branch` and is rejected; only
  legacy-host links in the new path form resolve. Reword, or apply D3's `/docs/<p>` → `/<p>/` after the strip.
- Leniencies: `https://northguild.dev/commands/branch/` (no `/worktree`) also resolves; `{…}` stripping
  still runs inside code fences.
- After Gate 2 the caller fixed two stale one-liners the reviewer found: `docs/README.md:103` (~30 KB →
  ~260 KB worker bundle) and `docs/worker/README.md:67` (`next dev` → `astro dev`).

## From phase 7's review (head tags, JSON-LD, the dist audit)

- The 404 page gets JSON-LD (SoftwareApplication plus a `BreadcrumbList` whose item is
  `https://northguild.dev/worktree/404/`, which does not exist) and that canonical too. Harmless (search
  engines ignore 404s); emit no JSON-LD on the 404 — phase 9 owns the 404.
- `Head.astro` hard-codes the `"|"` delimiter instead of reading `titleDelimiter`.
- The audit's chat rule keys on a chunk named `Chat.*` and follows one level of static import; a rename
  would pass everything silently. Asserting that a `Chat.*` chunk exists would make that loud.
- `audit-dist.test.mjs` ≈221-230 ("no BreadcrumbList") checks only `length > 0`, not which rule failed.
- `structured-data.ts`: `interface Node` shadows the DOM global; index signatures on `Node` and
  `BreadcrumbList` weaken the typing. `Head.astro` writes `JSON.stringify` through `set:html` unescaped — a
  title containing `</script>` would break out (titles are repo-authored; escape `<` as the JSON escape `\u003c`).
- Unsourced expected values: breadcrumb section names "Commands"/"Guides" come from `capitalise(segment)`
  (the `/commands/` page itself is titled "worktree commands: every command at a glance"), and
  Organization `sameAs: ["https://github.com/northguild"]` has no plan source.
- Unasserted: breadcrumb item URLs, the built page titles (no duplicated site title), the sitemap duplicate
  rule (works, untested).
- D10 read as SoftwareApplication on every page; it could be read as root only.
- `verify.md`'s "Docs-only changes run Lint only" sits awkwardly with D8: an edit to `docs/src/content` could
  count as docs-only and skip the build and the audit.
- CI runs neither `docs:build` nor `docs:audit-dist` — phase 11 adds them.
- The site default description is written twice: Starlight's `description` in `docs/astro.config.mjs` and
  `SITE_DEFAULT_DESCRIPTION` in `audit-dist.mjs`; change one alone and the audit's site-default rule goes
  quiet. A comment in the config pointing at the audit constant would keep them together. Each page's
  description is still not pinned to its §4.3 row.
