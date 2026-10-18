# Notes

Branch-local and advisory. Nothing reads this file, and `/feature-close` deletes it.

## Phase 1 — Swap the navbar logo for a repository asset (Gate 2, PASS WITH NOTES)

- **Dark theme.** The shield's outer fill `#184165` is roughly 1.8:1 against Nextra's near-black navbar
  (estimated from the SVG's colours, not a rendered page). The inner marks stand out, but the shield outline
  barely shows. The image is decorative and the artwork was supplied, so nothing fails; a dark-theme
  variant or a light outline would be an artwork change.
- `docs/src/assets/logo.svg` carries `role="img" aria-label="Northguild logo"`. These attributes do nothing
  through `<img alt="">`, and would only matter if the SVG were ever inlined.
- `logo` is typed `any` by Next's ambient `*.svg` declaration (`next/image-types/global`). No code here
  wrote `any`.
- `Navbar.test.tsx` still finds the image with `getByTestId`, which `react/testing.md` calls a last resort.
  It is unchanged from before, since the `next/image` mock renders a `<span>` that no role query matches.
- The new `data-src` test can tell the logo from the avatar only because Vitest loads the SVG as a URL
  string. A test setup that loaded it as Next's `StaticImageData` object would make both sides
  `"[object Object]"`, and the test would pass whatever the source was.
