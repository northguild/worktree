import { render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { MarkdownContent } from "./MarkdownContent";

// Contract (issue #235 D3, D7, phase 6): the allow-list holds routes without the `/worktree` base and with a
// trailing slash. Incoming links may carry the site origin and the base; the legacy GitHub Pages origin is
// still stripped. Internal links render WITH the base, because Astro does not add it to a hand-built href.
const SITE = "https://northguild.dev/worktree";
const LEGACY = "https://northguild.github.io/worktree";

// Vitest's BASE_URL is "/", not the site's; the value astro.config.mjs sets is stubbed in.
beforeEach(() => {
  vi.stubEnv("BASE_URL", "/worktree/");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function link(href: string, text = "the link") {
  render(<MarkdownContent content={`[${text}](${href})`} />);
  return screen.queryByRole("link", { name: text });
}

describe("MarkdownContent links", () => {
  it("renders a known route under the base path", () => {
    expect(link("/commands/branch/")).toHaveAttribute(
      "href",
      "/worktree/commands/branch/",
    );
  });

  it("renders the root route as the base path itself", () => {
    expect(link("/")).toHaveAttribute("href", "/worktree/");
  });

  it.each([
    [`${SITE}/commands/branch/`, "/worktree/commands/branch/"],
    [`${SITE}/commands/branch/#flags`, "/worktree/commands/branch/"],
    [`${SITE}/`, "/worktree/"],
    [SITE, "/worktree/"],
    ["/worktree/guides/env-files/", "/worktree/guides/env-files/"],
    [`${LEGACY}/commands/branch/`, "/worktree/commands/branch/"],
  ])("strips the origin and base from %s", (raw, rendered) => {
    expect(link(raw)).toHaveAttribute("href", rendered);
  });

  it.each([
    "/commands/nope/",
    "/docs/commands/branch",
    "/commands/branch",
    `${SITE}/nope/`,
    "https://northguild.dev/commands/branch/x",
    "https://northguild.dev.evil.example/commands/branch/",
    "https://northguild.dev@evil.example/",
    "https://github.com/northguild/worktree#install",
    "https://example.com/",
  ])("renders %s as plain text", (raw) => {
    expect(link(raw)).toBeNull();
    expect(screen.getByText("the link")).toBeInTheDocument();
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<b>x</b>",
    "ftp://northguild.dev/worktree/",
    "mailto:someone@example.com",
  ])("renders the %s scheme as plain text", (raw) => {
    expect(link(raw)).toBeNull();
  });

  it("links a bold page name under the base path", () => {
    render(<MarkdownContent content="See **worktree branch** and **FAQ**." />);

    expect(
      screen.getByRole("link", { name: "worktree branch" }),
    ).toHaveAttribute("href", "/worktree/commands/branch/");
    expect(screen.getByRole("link", { name: "FAQ" })).toHaveAttribute(
      "href",
      "/worktree/faq/",
    );
  });

  // D17: Getting Started is /getting-started/; the root is the landing, so a bold "Getting Started" must not go there.
  it("links a bold Getting Started to /getting-started/, not to the landing", () => {
    render(<MarkdownContent content="Read **Getting Started** first." />);

    expect(
      screen.getByRole("link", { name: "Getting Started" }),
    ).toHaveAttribute("href", "/worktree/getting-started/");
  });
});
