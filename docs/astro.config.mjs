import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// What the share preview shows, for readers who cannot see it (og:image:alt, twitter:image:alt).
const PREVIEW_ALT =
  "The worktree docs landing: “A git worktree for every branch” beside a git graph drawn in green leaves.";

// One URL form: https://northguild.dev/worktree/<path>/ — no /docs/ prefix.
// `site` is what makes Starlight emit a sitemap.
export default defineConfig({
  site: "https://northguild.dev",
  base: "/worktree",
  trailingSlash: "always",
  build: { format: "directory" },
  integrations: [
    starlight({
      title: "@northguild/worktree",
      // The delimiter in `<title>`: `<page> · @northguild/worktree`, the middle dot GMT's pages use (`Core Rules · GMT`; the
      // user, 2026-11-04, replacing D9's ` | `). Head.astro builds the title itself and passes the same character.
      titleDelimiter: "·",
      // "Edit this page" links: baseUrl + the page's path from the docs root (D11's sibling; `docs/` is the Astro root).
      editLink: {
        baseUrl: "https://github.com/northguild/worktree/edit/main/docs/",
      },
      // "Last updated" from git (D11). Needs full history: `fetch-depth: 0` in CI. Pages where git is wrong carry a
      // `lastUpdated:` frontmatter date.
      lastUpdated: true,
      // The site-wide default description: §4.3's index row (also the landing's own, D17); pages with their own `description:` override it.
      description:
        "Docs for worktree, an open-source CLI that manages git worktrees: one per branch or issue, with env files copied and your editor opened.",
      sidebar: [
        { label: "Getting Started", slug: "getting-started" },
        {
          label: "Commands",
          items: [
            { label: "Overview", slug: "commands" },
            { label: "branch", slug: "commands/branch" },
            { label: "checkout", slug: "commands/checkout" },
            { label: "config", slug: "commands/config" },
            { label: "list", slug: "commands/list" },
            { label: "open", slug: "commands/open" },
            { label: "remove", slug: "commands/remove" },
            { label: "cleanup", slug: "commands/cleanup" },
            { label: "linear-listen", slug: "commands/linear-listen" },
          ],
        },
        { label: "Configuration", slug: "configuration" },
        { label: "Project Configuration", slug: "project-configuration" },
        {
          label: "Guides",
          items: [
            { label: "Overview", slug: "guides" },
            {
              label: "GitHub Issue Integration",
              slug: "guides/github-issue-integration",
            },
            {
              label: "Jira Issue Integration",
              slug: "guides/jira-integration",
            },
            {
              label: "Linear Issue Integration",
              slug: "guides/linear-integration",
            },
            {
              label: "Linear Agent Delegation",
              slug: "guides/linear-agent-delegation",
            },
            {
              label: "ClickUp Task Integration",
              slug: "guides/clickup-integration",
            },
            { label: "Context Switching", slug: "guides/context-switching" },
            { label: "Team Conventions", slug: "guides/team-conventions" },
            { label: "Environment Files", slug: "guides/env-files" },
            { label: "Editor Integration", slug: "guides/editor-integration" },
            { label: "Herdr Spaces", slug: "guides/herdr-spaces" },
          ],
        },
        { label: "FAQ", slug: "faq" },
        { label: "Changelog", slug: "changelog" },
      ],
      // Tailwind here serves the chat's utility classes only; preflight is left out of globals.css.
      customCss: [
        "./src/styles/northguild/tokens.css",
        "./src/styles/northguild/tokens-light.css",
        "./src/styles/northguild/primitives.css",
        "./src/styles/theme.css",
        "./src/styles/globals.css",
        "./src/styles/custom.css",
      ],
      components: {
        // The product header (D17): SiteTitle is "mark NorthGuild / worktree" (two links); SocialIcons is the GitHub and
        // Discord pair. Starlight's Header renders both, and the mobile menu renders SocialIcons again, so search, the
        // theme picker, the language select and the menu keep working untouched.
        SiteTitle: "./src/components/SiteTitle.astro",
        SocialIcons: "./src/components/SocialIcons.astro",
        Footer: "./src/components/Footer.astro",
        Head: "./src/components/Head.astro",
        // The landing (D17) sets its copy beside the leaf-particle hero; every other splash page (the 404) keeps Starlight's Hero.
        Hero: "./src/components/Hero.astro",
      },
      // The hero's leaf (public/favicon.svg, drawn from src/hero/geometry.ts). Starlight prefixes `base` onto this one.
      favicon: "/favicon.svg",
      // Every href below carries `base`, and the social images are absolute: Starlight does not prefix `head` entries.
      head: [
        // Preload the display face so the title and headings do not reflow out of the mono fallback.
        {
          tag: "link",
          attrs: {
            rel: "preload",
            href: "/worktree/fonts/michroma-latin-400-normal.woff2",
            as: "font",
            type: "font/woff2",
            crossorigin: "",
          },
        },
        // The leaf for browsers without SVG favicons, and for iOS's home screen (on the site's dark ground).
        {
          tag: "link",
          attrs: { rel: "icon", href: "/worktree/favicon.ico", sizes: "32x32" },
        },
        {
          tag: "link",
          attrs: {
            rel: "apple-touch-icon",
            href: "/worktree/apple-touch-icon.png",
          },
        },
        // The share preview (plan §9 Q3; the user, 2026-11-04: the landing with one of the hero's shapes): the landing in
        // the dark theme with the hero formed as the git graph. A screenshot of `astro preview` at 1440×756 (DPR 2), the chat launcher and the CLI
        // version hidden so it does not age with a release, scaled to 1200×630. Retake it when the landing changes.
        ...[
          ["og:image", "https://northguild.dev/worktree/og-image.jpg"],
          ["og:image:type", "image/jpeg"],
          ["og:image:width", "1200"],
          ["og:image:height", "630"],
          ["og:image:alt", PREVIEW_ALT],
        ].map(([property, content]) => ({
          tag: "meta",
          attrs: { property, content },
        })),
        ...[
          ["twitter:image", "https://northguild.dev/worktree/og-image.jpg"],
          ["twitter:image:alt", PREVIEW_ALT],
        ].map(([name, content]) => ({ tag: "meta", attrs: { name, content } })),
      ],
      // Frame colours come from the --sl-* variables (the default), so the code blocks follow the theme picker.
      expressiveCode: {
        useStarlightUiThemeColors: true,
        styleOverrides: {
          borderRadius: "var(--gmt-radius-md)",
          borderColor: "var(--gmt-hairline)",
          codeFontFamily: "var(--gmt-font-mono)",
          uiFontFamily: "var(--gmt-font-mono)",
        },
      },
    }),
    react(),
  ],
  vite: { plugins: [tailwindcss()] },
});
