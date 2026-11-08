/**
 * The `<lastmod>` of a sitemap entry is the `datetime` of the `<time>` in the page's built footer (D1), read from the
 * build output inside `sitemap({ serialize })`, which runs once the pages are written. The footer and the sitemap
 * cannot then disagree. The landing has no footer date and so no `lastmod` (D2). Free of `astro:` imports so Vitest
 * reads it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SitemapItem } from "@astrojs/sitemap";

const SITE = "https://northguild.dev/worktree/";

/** The `datetime` of the first `<time>` in the page, or undefined where there is none (the landing). */
export function footerDate(html: string): string | undefined {
  return /<time\b[^>]*\sdatetime="([^"]+)"/.exec(html)?.[1];
}

/**
 * The built file for a page URL. `astro build` writes `dist/` without the `/worktree` base, so
 * `https://northguild.dev/worktree/<path>/` is `<outDir>/<path>/index.html`.
 */
export function builtPage(outDir: string, url: string): string | undefined {
  if (!url.startsWith(SITE)) return undefined;
  return join(outDir, url.slice(SITE.length), "index.html");
}

/** The item with `lastmod` set from its built footer; a page with no footer date or no built file has none. */
export function sitemapLastmod(outDir: string, item: SitemapItem): SitemapItem {
  const { lastmod: _dropped, ...rest } = item;
  const file = builtPage(outDir, item.url);
  if (file === undefined) return rest;
  let html: string;
  try {
    html = readFileSync(file, "utf8");
  } catch {
    return rest;
  }
  const lastmod = footerDate(html);
  return lastmod === undefined ? rest : { ...rest, lastmod };
}
