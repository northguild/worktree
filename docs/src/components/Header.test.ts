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
