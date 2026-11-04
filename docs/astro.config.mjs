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
      // Placeholder until the pages are ported.
      sidebar: [{ label: "Getting Started", link: "/" }],
      // Tailwind here serves the chat's utility classes only; preflight is left out of globals.css.
      customCss: ["./src/styles/globals.css"],
    }),
    react(),
  ],
  vite: { plugins: [tailwindcss()] },
});
