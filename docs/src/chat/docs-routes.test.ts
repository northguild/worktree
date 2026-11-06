import { VALID_DOC_ROUTES } from "./docs-routes.generated";

// Derived by hand from issue #235 §4.2 (the 24 old routes, and the two 5c741ee added) and D3's rule:
// D17 (2026-11-04, revising D3's root): `/docs` becomes the landing `/`, `/docs/getting-started` becomes
// `/getting-started/`, and every other `/docs/<p>` becomes `/<p>/`: 26 routes, one per old route.
// Routes are stored without the `/worktree` base (MarkdownContent strips it before the check)
// and with a trailing slash (`trailingSlash: "always"`).
const OLD_ROUTES = [
  "/docs",
  "/docs/changelog",
  "/docs/commands",
  "/docs/commands/branch",
  "/docs/commands/checkout",
  "/docs/commands/cleanup",
  "/docs/commands/config",
  "/docs/commands/linear-listen",
  "/docs/commands/list",
  "/docs/commands/open",
  "/docs/commands/remove",
  "/docs/configuration",
  "/docs/faq",
  "/docs/getting-started",
  "/docs/guides",
  "/docs/guides/clickup-integration",
  "/docs/guides/context-switching",
  "/docs/guides/editor-integration",
  "/docs/guides/env-files",
  "/docs/guides/github-issue-integration",
  "/docs/guides/herdr-spaces",
  "/docs/guides/jira-integration",
  "/docs/guides/linear-agent-delegation",
  "/docs/guides/linear-integration",
  "/docs/guides/team-conventions",
  "/docs/project-configuration",
];

// Pages added since the move, which have no old route: the Rex Sessions guide (#270).
const ADDED_ROUTES = ["/guides/rex-sessions/"];

function toNewRoute(old: string): string {
  if (old === "/docs") return "/";
  return `${old.slice("/docs".length)}/`;
}

describe("VALID_DOC_ROUTES", () => {
  it("holds the 26 routes D17 maps the 26 old ones to, and the pages added since", () => {
    const mapped = [...new Set(OLD_ROUTES.map(toNewRoute))];
    const expected = [...mapped, ...ADDED_ROUTES].sort();

    expect(OLD_ROUTES).toHaveLength(26);
    expect(mapped).toHaveLength(26);
    expect(expected).toHaveLength(27);
    expect([...VALID_DOC_ROUTES].sort()).toEqual(expected);
  });
});
