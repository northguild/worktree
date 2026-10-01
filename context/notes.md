# Notes — docs-landing-to-getting-started (#84)

Branch-local. `/feature-close` deletes this file.

- **Phase 1 — the `/docs` index page is now unlinked and slightly odd.** Hiding the navbar link needed
  `type: "doc", display: "children"` on the `docs` folder plus dropping `asIndexPage` from
  `docs/src/app/docs/page.mdx`, because `display: "hidden"` emptied the sidebar (R1) and the first fallback
  shifted pagination by one. As a side effect the "Documentation" breadcrumb now links to Getting Started
  instead of `/docs`, and `/docs` itself gains a sidebar, a doubled "Documentation > Documentation"
  breadcrumb and a "Next" of Commands. Nothing links to `/docs` any more; it matters only for §9 Q2 (what
  to do with that page). A `theme: { breadcrumb: false, pagination: false }` on its `index` entry was
  suggested by the reviewer and not tried.
