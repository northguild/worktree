/// <reference types="vitest/config" />
import { resolve } from "node:path";
import { getViteConfig } from "astro/config";

// getViteConfig loads Astro's Vite plugins, which lets Vitest import `.astro` components
// (rendered through astro/container). Tests that touch no Astro file are unaffected.
export default getViteConfig({
  resolve: {
    alias: {
      // docs-context.ts is generated at build time and gitignored.
      // Redirect to a committed stub so worker tests run without a build step.
      "./docs-context.js": resolve(__dirname, "worker/docs-context.stub.ts"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test-setup.ts"],
  },
});
