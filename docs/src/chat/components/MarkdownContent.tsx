"use client";

import Link from "next/link";
import React from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { VALID_DOC_ROUTES } from "../docs-routes.generated";

/** GitHub Pages base — strip this prefix if the model accidentally emits full URLs. */
const GH_PAGES_ORIGIN = "https://northguild.github.io/worktree";

/** Allowed external origins. Localhost is included only during development. */
const ALLOWED_EXTERNAL_ORIGINS: string[] =
  process.env.NODE_ENV === "development"
    ? [GH_PAGES_ORIGIN, "http://localhost:3000"]
    : [GH_PAGES_ORIGIN];

/** Only these URL schemes are permitted in external links. */
const SAFE_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

/**
 * Resolve a link href coming from the model to a known doc route, or null if
 * it should not be rendered as a link at all.
 */
function resolveHref(
  raw: string,
): { internal: true; href: string } | { internal: false; href: string } | null {
  // Strip the GH Pages origin so full URLs become relative paths.
  let href = raw.startsWith(GH_PAGES_ORIGIN)
    ? raw.slice(GH_PAGES_ORIGIN.length) || "/"
    : raw;

  // Strip any fragment — we don't have fragment-level routes.
  href = href.split("#")[0];

  // Internal relative path: only allow known routes.
  if (href.startsWith("/")) {
    return VALID_DOC_ROUTES.has(href) ? { internal: true, href } : null;
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

  const origin = parsed.origin;
  if (
    !ALLOWED_EXTERNAL_ORIGINS.some((o) => origin === o || href.startsWith(o))
  ) {
    return null;
  }

  return { internal: false, href: raw };
}

/**
 * Map of display labels (lowercase) → doc page routes.
 * Used to auto-link bold text in assistant responses.
 */
const DOCS_ROUTE_MAP: Record<string, string> = {
  // Top-level sections
  "getting started": "/docs/getting-started",
  commands: "/docs/commands",
  configuration: "/docs/configuration",
  guides: "/docs/guides",
  faq: "/docs/faq",
  changelog: "/docs/changelog",
  // Guides
  "github issue integration": "/docs/guides/github-issue-integration",
  "jira issue integration": "/docs/guides/jira-integration",
  "jira integration": "/docs/guides/jira-integration",
  "linear issue integration": "/docs/guides/linear-integration",
  "linear integration": "/docs/guides/linear-integration",
  "context switching": "/docs/guides/context-switching",
  "team conventions": "/docs/guides/team-conventions",
  "environment files": "/docs/guides/env-files",
  "env files": "/docs/guides/env-files",
  "editor integration": "/docs/guides/editor-integration",
  // Commands
  "worktree branch": "/docs/commands/branch",
  "worktree checkout": "/docs/commands/checkout",
  "worktree cleanup": "/docs/commands/cleanup",
  "worktree config": "/docs/commands/config",
  "worktree list": "/docs/commands/list",
  "worktree open": "/docs/commands/open",
  "worktree remove": "/docs/commands/remove",
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
  "text-blue-600 dark:text-blue-400 underline underline-offset-2 hover:text-blue-500 dark:hover:text-blue-300 transition-colors";

const components: Components = {
  // Bold — auto-link if text matches a known doc page
  strong({ children }) {
    const text = getTextContent(children);
    const route = DOCS_ROUTE_MAP[text.toLowerCase().trim()];
    const inner = <strong className="font-semibold">{children}</strong>;
    if (route) {
      return (
        <Link href={route} className={LINK_CLASS}>
          {inner}
        </Link>
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
      <code className="bg-blue-50 dark:bg-blue-950/50 text-blue-900 dark:text-blue-200 rounded px-1 py-0.5 text-[0.85em] font-mono border border-blue-200 dark:border-neutral-700">
        {children}
      </code>
    );
  },

  // Fenced code blocks
  pre({ children }) {
    return (
      <pre className="my-2 overflow-x-auto rounded-md bg-neutral-900 dark:bg-neutral-950 text-gray-100 px-3 py-2 text-sm font-mono leading-relaxed">
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
        <Link href={resolved.href} className={LINK_CLASS}>
          {children}
        </Link>
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
