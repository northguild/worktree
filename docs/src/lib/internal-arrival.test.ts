// @vitest-environment node
import { describe, expect, it } from "vitest";
import { isInternalArrival, isInternalReferrer } from "./internal-arrival";

// Expected values come from the user's rule of 2026-11-06 (plan #266, D7): the entrance is skipped only when the
// visitor comes from another page of the docs site, i.e. a page under https://northguild.dev/worktree/. No referrer
// counts as external, and northguild.dev itself (same origin, not the docs site) counts as external, so the path is
// checked, not just the origin. "/worktreeX/" is the prefix trap: it shares the base's characters, not its path.
const ORIGIN = "https://northguild.dev";
const BASE = "/worktree/";

describe("isInternalReferrer", () => {
  it.each([
    ["no referrer (typed URL, bookmark)", "", false],
    ["an external site", "https://example.com/some/page/", false],
    ["northguild.dev's apex", "https://northguild.dev/", false],
    ["another northguild.dev path", "https://northguild.dev/pricing/", false],
    [
      "a path that merely starts with the base's letters",
      "https://northguild.dev/worktreeX/",
      false,
    ],
    [
      "the same path on a different origin",
      "https://example.com/worktree/faq/",
      false,
    ],
    ["the same path on http", "http://northguild.dev/worktree/faq/", false],
    ["an unparseable referrer", "not a url", false],
    ["the docs landing", "https://northguild.dev/worktree/", true],
    ["an inner docs page", "https://northguild.dev/worktree/faq/", true],
    [
      "an inner docs page with query and hash",
      "https://northguild.dev/worktree/faq/?q=1#x",
      true,
    ],
    [
      "the base without its trailing slash",
      "https://northguild.dev/worktree",
      true,
    ],
  ])("%s", (_name, referrer, expected) => {
    expect(isInternalReferrer(referrer, ORIGIN, BASE)).toBe(expected);
  });

  it("reads the origin and base it is given (dev and preview run elsewhere)", () => {
    expect(
      isInternalReferrer(
        "http://localhost:4322/worktree/faq/",
        "http://localhost:4322",
        BASE,
      ),
    ).toBe(true);
    expect(
      isInternalReferrer(
        "https://northguild.dev/worktree/faq/",
        "http://localhost:4322",
        BASE,
      ),
    ).toBe(false);
  });
});

// D7 as amended by the user, 2026-11-06: a reload always plays the entrance (a reload keeps the original referrer, so a tab
// that first reached the landing from a docs page would never play it again). The entrance is skipped only when the
// navigation followed a link ("navigate") or used history ("back_forward") from a page of the docs site. An unknown
// navigation type is read as "navigate", as is a missing one (the Navigation Timing `type` values are the spec's).
describe("isInternalArrival", () => {
  const INTERNAL = "https://northguild.dev/worktree/faq/";
  const EXTERNAL = "https://example.com/";
  it.each([
    ["reload with an internal referrer plays", INTERNAL, "reload", false],
    [
      "navigate with an internal referrer is skipped",
      INTERNAL,
      "navigate",
      true,
    ],
    [
      "back_forward with an internal referrer is skipped",
      INTERNAL,
      "back_forward",
      true,
    ],
    ["reload with an external referrer plays", EXTERNAL, "reload", false],
    ["navigate with an external referrer plays", EXTERNAL, "navigate", false],
    ["navigate with no referrer plays", "", "navigate", false],
    ["reload with no referrer plays", "", "reload", false],
    [
      "an unknown type with an internal referrer is read as navigate: skipped",
      INTERNAL,
      "prerender",
      true,
    ],
    [
      "an unavailable type with an internal referrer is read as navigate: skipped",
      INTERNAL,
      undefined,
      true,
    ],
    ["an unavailable type with no referrer plays", "", undefined, false],
  ])("%s", (_name, referrer, type, expected) => {
    expect(isInternalArrival(referrer, ORIGIN, BASE, type)).toBe(expected);
  });
});
