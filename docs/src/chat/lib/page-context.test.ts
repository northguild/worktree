import { describe, expect, it } from "vitest";
import {
  MAX_PAGE_CONTEXT_LENGTH,
  namespaceFromPageContext,
  PAGE_CONTEXT_PATTERN,
  pageContextFromReferrer,
  routeNamespace,
} from "./page-context";

// Expected values: plan #309 D3 (the request's additive `pageContext`) and D8 (a bias toward the referrer's section).
// The routes are the site's own (`docs-routes.generated.ts`: `/commands/branch/`, `/guides/env-files/`, `/faq/`, `/`), the
// base is Astro's `base: "/worktree"`, and the rule "a page outside the base, `/dox/` itself, another origin or a
// referrer too long to send is no page context" is gmt's `page-context.ts`, written out here from its comment.

const ORIGIN = "https://northguild.dev";
const BASE = "/worktree";

describe("routeNamespace", () => {
  it("is the top directory of a page's route", () => {
    expect(routeNamespace("/commands/branch/")).toBe("commands");
    expect(routeNamespace("/guides/env-files/")).toBe("guides");
    expect(routeNamespace("/commands/")).toBe("commands");
  });

  it("groups the pages that sit at the root as general", () => {
    expect(routeNamespace("/faq/")).toBe("general");
    expect(routeNamespace("/configuration/")).toBe("general");
    expect(routeNamespace("/")).toBe("general");
  });
});

describe("pageContextFromReferrer", () => {
  it("is the referrer's path without the base", () => {
    expect(
      pageContextFromReferrer(
        `${ORIGIN}/worktree/commands/branch/`,
        ORIGIN,
        BASE,
      ),
    ).toBe("/commands/branch/");
  });

  it("is the root route for the landing page of the docs", () => {
    expect(pageContextFromReferrer(`${ORIGIN}/worktree/`, ORIGIN, BASE)).toBe(
      "/",
    );
  });

  it("is nothing without a referrer, from another origin, outside the base, or from /dox itself", () => {
    expect(pageContextFromReferrer("", ORIGIN, BASE)).toBeUndefined();
    expect(pageContextFromReferrer("not a url", ORIGIN, BASE)).toBeUndefined();
    expect(
      pageContextFromReferrer(
        "https://example.com/worktree/faq/",
        ORIGIN,
        BASE,
      ),
    ).toBeUndefined();
    expect(
      pageContextFromReferrer(`${ORIGIN}/other/faq/`, ORIGIN, BASE),
    ).toBeUndefined();
    expect(
      pageContextFromReferrer(`${ORIGIN}/worktreefaq/`, ORIGIN, BASE),
    ).toBeUndefined();
    expect(
      pageContextFromReferrer(`${ORIGIN}/worktree/dox/`, ORIGIN, BASE),
    ).toBeUndefined();
  });

  // `URL.pathname` is percent-encoded; the Worker's validator refuses these, and one refusal would fail every question.
  it.each([
    "/worktree/foo%20bar/",
    "/worktree/a(b)/",
    "/worktree/a:b/",
    "/worktree/a@b/",
    "/worktree/caf\u00e9/",
  ])("is nothing for %s, which the Worker would refuse", (path) => {
    expect(
      pageContextFromReferrer(`${ORIGIN}${path}`, ORIGIN, BASE),
    ).toBeUndefined();
  });

  it("agrees with the validator: whatever it returns, the Worker accepts", () => {
    const route = pageContextFromReferrer(
      `${ORIGIN}/worktree/commands/branch/`,
      ORIGIN,
      BASE,
    );
    expect(PAGE_CONTEXT_PATTERN.test(route ?? "")).toBe(true);
  });

  it("is nothing for a path the Worker would refuse as too long", () => {
    const long = `${ORIGIN}/worktree/${"a".repeat(MAX_PAGE_CONTEXT_LENGTH)}/`;
    expect(pageContextFromReferrer(long, ORIGIN, BASE)).toBeUndefined();
  });
});

describe("namespaceFromPageContext", () => {
  it("names the section of the page the reader came from", () => {
    expect(namespaceFromPageContext("/commands/branch/")).toBe("commands");
    expect(namespaceFromPageContext("/faq/")).toBe("general");
  });

  it("names nothing without a page context", () => {
    expect(namespaceFromPageContext(undefined)).toBeUndefined();
    expect(namespaceFromPageContext("")).toBeUndefined();
  });
});
