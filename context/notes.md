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
