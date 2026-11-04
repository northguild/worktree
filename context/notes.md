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
