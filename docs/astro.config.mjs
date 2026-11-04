import react from "@astrojs/react";
import starlight from "@astrojs/starlight";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

// One URL form: https://northguild.dev/worktree/<path>/ — no /docs/ prefix.
// `site` is what makes Starlight emit a sitemap.
export default defineConfig({
  site: "https://northguild.dev",
  base: "/worktree",
  trailingSlash: "always",
  build: { format: "directory" },
  // The Worker allows CORS from http://localhost:3000 only (worker/worker.ts), so the dev server stays on 3000.
  server: { port: 3000 },
  integrations: [
    starlight({
      title: "Worktree",
      // The Guides group and the Changelog join in the guides phase: a sidebar link to a page that does not exist is broken.
      sidebar: [
        { label: "Getting Started", link: "/" },
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
          ],
        },
        { label: "Configuration", slug: "configuration" },
        { label: "Project Configuration", slug: "project-configuration" },
        { label: "FAQ", slug: "faq" },
      ],
      // Tailwind here serves the chat's utility classes only; preflight is left out of globals.css.
      customCss: [
        "./src/styles/northguild/tokens.css",
        "./src/styles/northguild/tokens-light.css",
        "./src/styles/northguild/primitives.css",
        "./src/styles/theme.css",
        "./src/styles/globals.css",
      ],
      components: { SiteTitle: "./src/components/SiteTitle.astro" },
      // Preload the display face so the title and headings do not reflow out of the mono fallback.
      // The href carries `base`: Starlight does not prefix `head` entries.
      head: [
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
