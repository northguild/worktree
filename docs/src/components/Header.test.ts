// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isInternalArrival } from "../lib/internal-arrival";

// Header.astro's internal-arrival script runs before the header paints and cannot import the pure function, so it
// carries the same test inline (plan #266, D7). This runs the script as written in the source against the cases the
// pure function is tested on (internal-arrival.test.ts, whose expected values are the user's rule of 2026-11-06) and
// requires it to agree: it marks the page (`data-entrance-off` on <html>) exactly when the referrer is internal.
const source = readFileSync(new URL("./Header.astro", import.meta.url), "utf8");
const script = source.match(
  /<script is:inline define:vars=\{\{ base \}\}>([\s\S]*?)<\/script>/,
)?.[1];

const ORIGIN = "https://northguild.dev";
const BASE = "/worktree/";

/** Runs the inline script as the browser would, and reports whether it marked <html>. */
function marks(
  referrer: string,
  type: string | undefined = "navigate",
  origin = ORIGIN,
): boolean {
  if (script === undefined)
    throw new Error("Header.astro has no inline script");
  let marked = false;
  const document = {
    referrer,
    documentElement: {
      setAttribute: (name: string) => {
        if (name === "data-entrance-off") marked = true;
      },
    },
  };
  const performance = {
    getEntriesByType: () => (type === undefined ? [] : [{ type }]),
  };
  new Function("document", "location", "URL", "performance", "base", script)(
    document,
    { origin },
    URL,
    performance,
    BASE,
  );
  return marked;
}

describe("Header.astro's inline internal-arrival script", () => {
  it("exists, is inline, and can only turn the entrance off", () => {
    expect(script).toBeDefined();
    expect(script).not.toMatch(/data-landing-entrance/);
  });

  it.each([
    "",
    "https://example.com/some/page/",
    "https://northguild.dev/",
    "https://northguild.dev/pricing/",
    "https://northguild.dev/worktreeX/",
    "https://example.com/worktree/faq/",
    "http://northguild.dev/worktree/faq/",
    "not a url",
    "https://northguild.dev/worktree/",
    "https://northguild.dev/worktree/faq/",
    "https://northguild.dev/worktree/faq/?q=1#x",
    "https://northguild.dev/worktree",
  ])("agrees with isInternalArrival for %j on every navigation type", (referrer) => {
    for (const type of [
      "navigate",
      "reload",
      "back_forward",
      "prerender",
      undefined,
    ])
      expect(marks(referrer, type)).toBe(
        isInternalArrival(referrer, ORIGIN, BASE, type),
      );
  });
});

// #309 phase 4 (D2). Header.astro imports Starlight's virtual modules and cannot be rendered here; the built page is held
// to these rules by `docs/scripts/audit-dist.mjs`, and this pins the source that produces them: the right group lists the
// Dox link, named "Chat with Dox", current on /dox alone (gmt's Header.astro), and ends with the settings gear (#352, D1:
// Dox, language select, GitHub and Discord, then the gear; the owner wants the three bars identical to GMT's).
describe("Header.astro's Dox link", () => {
  const right = source.slice(
    source.indexOf('<div class="sl-flex social-icons">'),
  );

  it("is the first of the right group, and the gear is the last: Dox, language select, GitHub and Discord, gear", () => {
    const at = (needle: string) => right.indexOf(needle);
    expect(at('class="header-chip dox-link"')).toBeGreaterThan(-1);
    expect(at("dox-link")).toBeLessThan(at("<LanguageSelect"));
    expect(at("<LanguageSelect")).toBeLessThan(at("<SocialIcons"));
    expect(at("<SocialIcons")).toBeLessThan(at("<SettingsControl"));
    expect(right).not.toMatch(/Theme\w*Select/);
  });

  it("is named Chat with Dox and goes to /dox/ under the site base", () => {
    expect(right).toContain('aria-label="Chat with Dox"');
    expect(right).toContain("href={`${base}dox/`}");
  });

  it("is the current page only on /dox", () => {
    expect(right).toContain('aria-current={onDox ? "page" : undefined}');
  });
});

// Phase 12 (Baldur, PR #354, Header.astro:84): the gear shows at every width, as GMT's does. The component cannot be
// rendered here, so the source is read: the expected structure is the review's, and the rendered result is checked by
// the audit (the gear is in no element hidden below md) and by the browser pass at 375px.
describe("Header.astro's right group", () => {
  const markup = source.slice(
    source.indexOf('<div class="header"'),
    source.indexOf("<style>"),
  );

  it("is not hidden below md, and holds Dox, the social icons and the gear in that order", () => {
    expect(markup).not.toMatch(/sl-hidden/);
    const order = [
      'class="header-chip dox-link"',
      "<SocialIcons />",
      "<SettingsControl />",
    ].map((part) => markup.indexOf(part));
    expect(order.every((at) => at > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("hides every chip but the gear below 50rem, by a rule that is not in a layer", () => {
    const rule = source.match(
      /<style>\s*(?:\/\*[\s\S]*?\*\/\s*)?@media \(max-width: 49\.9375rem\) \{\s*\.social-icons > :global\(:not\(\[data-settings-control\]\)\) \{\s*display: none;/,
    );
    expect(rule).not.toBeNull();
  });

  it("keeps three direct children of .header: title, search, right group", () => {
    const direct = [...markup.matchAll(/^ {2}<div class="([^"]*)"/gm)].map(
      (m) => m[1],
    );
    expect(direct).toEqual([
      "title-wrapper sl-flex",
      "sl-flex print:hidden",
      "sl-flex print:hidden right-group",
    ]);
  });
});
