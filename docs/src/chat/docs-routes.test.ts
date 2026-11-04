import { VALID_DOC_ROUTES } from "./docs-routes.generated";

// Derived by hand from issue #235 §4.2 (the 24 old routes) and D3's rule:
// `/docs` and `/docs/getting-started` both become `/`, every other `/docs/<p>` becomes `/<p>/`.
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
  "/docs/guides/linear-integration",
  "/docs/guides/team-conventions",
  "/docs/project-configuration",
];

function toNewRoute(old: string): string {
  if (old === "/docs" || old === "/docs/getting-started") return "/";
  return `${old.slice("/docs".length)}/`;
}

describe("VALID_DOC_ROUTES", () => {
  it("holds the 23 routes D3 maps the 24 old ones to", () => {
    const expected = [...new Set(OLD_ROUTES.map(toNewRoute))].sort();

    expect(OLD_ROUTES).toHaveLength(24);
    expect(expected).toHaveLength(23);
    expect([...VALID_DOC_ROUTES].sort()).toEqual(expected);
  });
});
