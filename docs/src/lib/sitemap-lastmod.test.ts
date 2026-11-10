// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { builtPage, footerDate, sitemapLastmod } from "./sitemap-lastmod";

// Expected values come from (a) Starlight's footer, which prints `<time datetime={date.toISOString()}>`, so a
// datetime is `YYYY-MM-DDThh:mm:ss.sssZ`, a W3C Datetime (sitemaps.org protocol, "lastmod": W3C Datetime, the time
// portion optional); (b) D1/D2: the footer's datetime is the lastmod, the landing (no footer) has none; (c)
// wrangler.jsonc: `astro build` writes dist/ without the /worktree base, so
// https://northguild.dev/worktree/<path>/ is <outDir>/<path>/index.html.
const SITE = "https://northguild.dev/worktree/";
const DATETIME = "2026-11-04T10:00:00.000Z";
const footer = (datetime: string) =>
  `<footer><p>Last updated: <time datetime="${datetime}">Nov 4, 2026</time></p></footer>`;

let outDir: string;
const write = (relative: string, content: string) => {
  const target = join(outDir, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
};

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), "sitemap-lastmod-"));
});
afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("footerDate", () => {
  it("reads the datetime of the footer's <time>", () => {
    expect(footerDate(footer(DATETIME))).toBe(DATETIME);
  });

  it("reads the first <time> when a page has several", () => {
    expect(
      footerDate(`${footer(DATETIME)}<time datetime="2020-01-01">x</time>`),
    ).toBe(DATETIME);
  });

  it("returns undefined for a page with no <time> (the landing)", () => {
    expect(footerDate("<main><h1>worktree</h1></main>")).toBeUndefined();
  });

  it("returns undefined for a <time> with no datetime", () => {
    expect(footerDate("<time>Nov 4, 2026</time>")).toBeUndefined();
  });
});

describe("builtPage", () => {
  it("maps a page URL to its index.html, without the /worktree base", () => {
    expect(builtPage("/out", `${SITE}faq/`)).toBe(
      join("/out", "faq", "index.html"),
    );
    expect(builtPage("/out", `${SITE}commands/branch/`)).toBe(
      join("/out", "commands", "branch", "index.html"),
    );
  });

  it("maps the landing to the root index.html", () => {
    expect(builtPage("/out", SITE)).toBe(join("/out", "index.html"));
  });

  it("returns undefined for a URL outside the site", () => {
    expect(builtPage("/out", "https://example.com/faq/")).toBeUndefined();
  });
});

describe("sitemapLastmod", () => {
  it("sets lastmod to the built footer's datetime, keeping the rest of the item", () => {
    write("faq/index.html", footer(DATETIME));
    expect(
      sitemapLastmod(outDir, { url: `${SITE}faq/`, priority: 0.5 }),
    ).toEqual({ url: `${SITE}faq/`, priority: 0.5, lastmod: DATETIME });
  });

  it("gives the landing no lastmod: it has no footer date", () => {
    write("index.html", "<main><h1>worktree</h1></main>");
    const item = sitemapLastmod(outDir, { url: SITE });
    expect(item).toEqual({ url: SITE });
    expect("lastmod" in item).toBe(false);
  });

  it("gives a page with no built file no lastmod", () => {
    expect(sitemapLastmod(outDir, { url: `${SITE}missing/` })).toEqual({
      url: `${SITE}missing/`,
    });
  });

  it("drops a lastmod the item already carried when the page has no date", () => {
    write("index.html", "<main></main>");
    expect(
      "lastmod" in sitemapLastmod(outDir, { url: SITE, lastmod: DATETIME }),
    ).toBe(false);
  });
});
