import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["worker.ts"],
  format: ["esm"],
  target: "es2022",
  outDir: "dist",
  clean: true,
  dts: false,
  minify: false,
  sourcemap: false,
  splitting: false,
  shims: false,
  outExtension: () => ({ js: ".js" }),
  // The TanStack AI packages stay out of this bundle. wrangler bundles
  // dist/worker.js again, and only that second pass resolves a package's
  // "workerd" / "browser" export conditions; tsup resolves for Node and would
  // inline a build that hangs under workerd (plan #257 phase 3, seen under
  // `wrangler dev --local`). Everything else is bundled here, as before.
  external: ["@tanstack/ai", "@tanstack/ai-gemini", "@tanstack/ai-cloudflare"],
});
