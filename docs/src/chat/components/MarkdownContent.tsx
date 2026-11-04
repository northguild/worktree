"use client";

import React from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { VALID_DOC_ROUTES } from "../docs-routes.generated";

/** The docs site. Links from the model may carry this origin; it is stripped before the allow-list check. */
const SITE_ORIGIN = "https://northguild.dev";

/** The pre-rewrite GitHub Pages site, with its path. Still stripped, so an old link resolves instead of vanishing. */
const LEGACY_ORIGIN = "https://northguild.github.io/worktree";

/**
 * The site's base path without a trailing slash ("/worktree"). Astro does not add it to an href written by
 * hand, so every internal link is built from it; `import.meta.env.BASE_URL` is the one source.
 */
function basePath(): string {
  return import.meta.env.BASE_URL.replace(/\/$/, "");
}

/**
 * Allowed external origins. The site's own origins never reach this check (they are stripped to routes
 * above), so production allows none; localhost is included only during development.
 */
const ALLOWED_EXTERNAL_ORIGINS: string[] = import.meta.env.DEV
  ? ["http://localhost:4321"]
  : [];

/** Only these URL schemes are permitted in external links. */
const SAFE_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

/**
 * Remove `prefix` from the start of `value` when it ends there: the next character must be a path
 * separator, a fragment, a query or the end, so `https://northguild.dev.evil.example` is not stripped.
 */
function stripPrefix(value: string, prefix: string): string {
  if (!value.startsWith(prefix)) return value;
  const rest = value.slice(prefix.length);
  return rest === "" || /^[/?#]/.test(rest) ? rest || "/" : value;
}

/** An allow-listed route as a href that resolves on the site: `/commands/` → `/worktree/commands/`. */
function withBase(route: string): string {
  return `${basePath()}${route}`;
}

/**
 * Resolve a link href coming from the model to a known doc route, or null if
 * it should not be rendered as a link at all.
 */
function resolveHref(
  raw: string,
): { internal: true; href: string } | { internal: false; href: string } | null {
  // Strip the site origin (or the legacy one), then the base path, so every spelling of
  // a link ends up as the route form VALID_DOC_ROUTES holds.
  let href = stripPrefix(stripPrefix(raw, SITE_ORIGIN), LEGACY_ORIGIN);
  href = stripPrefix(href, basePath());

  // Strip any fragment — we don't have fragment-level routes.
  href = href.split("#")[0];

  // Internal relative path: only allow known routes.
  if (href.startsWith("/")) {
    return VALID_DOC_ROUTES.has(href)
      ? { internal: true, href: withBase(href) }
      : null;
  }

  // Validate absolute URL: must parse, must be a safe protocol, and must
  // originate from an allowed origin to prevent javascript:/data:/etc injection.
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    return null;
  }

  if (!SAFE_PROTOCOLS.has(parsed.protocol)) return null;

  // Compare the parsed origin only: a prefix test would accept https://northguild.dev.evil.example.
  if (!ALLOWED_EXTERNAL_ORIGINS.includes(parsed.origin)) return null;

  return { internal: false, href: raw };
}

/**
 * Map of display labels (lowercase) → doc page routes, in the VALID_DOC_ROUTES form (no base path).
 * Used to auto-link bold text in assistant responses.
 */
const DOCS_ROUTE_MAP: Record<string, string> = {
  // Top-level sections
  "getting started": "/getting-started/",
  commands: "/commands/",
  configuration: "/configuration/",
  guides: "/guides/",
  faq: "/faq/",
  changelog: "/changelog/",
  // Guides
  "github issue integration": "/guides/github-issue-integration/",
  "jira issue integration": "/guides/jira-integration/",
  "jira integration": "/guides/jira-integration/",
  "linear issue integration": "/guides/linear-integration/",
  "linear integration": "/guides/linear-integration/",
  "clickup task integration": "/guides/clickup-integration/",
  "clickup integration": "/guides/clickup-integration/",
  "context switching": "/guides/context-switching/",
  "team conventions": "/guides/team-conventions/",
  "environment files": "/guides/env-files/",
  "env files": "/guides/env-files/",
  "editor integration": "/guides/editor-integration/",
  // Commands
  "worktree branch": "/commands/branch/",
  "worktree checkout": "/commands/checkout/",
  "worktree cleanup": "/commands/cleanup/",
  "worktree config": "/commands/config/",
  "worktree list": "/commands/list/",
  "worktree open": "/commands/open/",
  "worktree remove": "/commands/remove/",
};

/** Recursively extract plain text from React children. */
function getTextContent(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join("");
  if (React.isValidElement(node)) {
    return getTextContent(
      (node.props as { children?: React.ReactNode }).children,
    );
  }
  return "";
}

const LINK_CLASS =
  "text-chat-accent-ink underline underline-offset-2 hover:text-chat-fg transition-colors";

const components: Components = {
  // Bold — auto-link if text matches a known doc page
  strong({ children }) {
    const text = getTextContent(children);
    const route = DOCS_ROUTE_MAP[text.toLowerCase().trim()];
    const inner = <strong className="font-semibold">{children}</strong>;
    if (route) {
      return (
        <a href={withBase(route)} className={LINK_CLASS}>
          {inner}
        </a>
      );
    }
    return inner;
  },

  // Inline code
  code({ children, className }) {
    if (className) {
      // Inside a <pre> code block — just pass through with mono styling
      return <code className="text-sm font-mono">{children}</code>;
    }
    return (
      <code className="bg-chat-raised text-chat-fg rounded px-1 py-0.5 text-[0.85em] font-mono border border-chat-border">
        {children}
      </code>
    );
  },

  // Fenced code blocks
  pre({ children }) {
    return (
      <pre className="my-2 overflow-x-auto rounded-md bg-chat-raised text-chat-fg border border-chat-border px-3 py-2 text-sm font-mono leading-relaxed">
        {children}
      </pre>
    );
  },

  // Paragraphs
  p({ children }) {
    return <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>;
  },

  // Lists
  ul({ children }) {
    return <ul className="mb-2 list-disc pl-5 space-y-1">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="mb-2 list-decimal pl-5 space-y-1">{children}</ol>;
  },
  li({ children }) {
    return <li className="leading-relaxed">{children}</li>;
  },

  // Explicit markdown links [text](url)
  a({ href, children }) {
    if (!href) return <>{children}</>;
    const resolved = resolveHref(href);
    if (!resolved) {
      // Unknown / hallucinated route — render text only, no link.
      return <>{children}</>;
    }
    if (resolved.internal) {
      return (
        <a href={resolved.href} className={LINK_CLASS}>
          {children}
        </a>
      );
    }
    return (
      <a
        href={resolved.href}
        target="_blank"
        rel="noopener noreferrer"
        className={LINK_CLASS}
      >
        {children}
      </a>
    );
  },
};

interface MarkdownContentProps {
  content: string;
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {content}
    </ReactMarkdown>
  );
}
