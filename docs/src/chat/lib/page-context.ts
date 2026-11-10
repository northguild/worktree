// The page a reader asked from, and the section a page belongs to (plan #309 D3, D8; ported from gmt's
// `page-context.ts` and `namespace-from-page.ts`). Nothing here imports React, the DOM or another module: the Worker
// bundles it and `build-context.mjs` runs it under Node.

/** The longest `pageContext` the Worker accepts. The client sends nothing rather than a longer one. */
export const MAX_PAGE_CONTEXT_LENGTH = 200;

/**
 * The directories of the docs tree that hold pages. `build-context.mjs`'s tests fail when a route's top directory is not
 * listed, so a new section cannot silently fall into `general`.
 */
export const DOC_SECTIONS: ReadonlySet<string> = new Set([
  "commands",
  "guides",
]);

/**
 * What a `pageContext` may be: a route of letters, digits and `._~-`, slash-separated. The one definition: the client sends
 * only what matches it and the Worker's validator refuses what does not.
 */
export const PAGE_CONTEXT_PATTERN = /^\/[A-Za-z0-9._~/-]*$/;

/**
 * The section a docs route belongs to: its top directory (`/commands/branch/` is `commands`, and so is `/commands/`), or
 * `general` for the pages at the root (`/faq/`, `/`). `build-context.mjs` stamps it on each chunk; a question's referrer
 * is matched against it.
 */
export function routeNamespace(route: string): string {
  const top = route.split("/").filter(Boolean)[0];
  return top !== undefined && DOC_SECTIONS.has(top) ? top : "general";
}

/**
 * The page the reader was on before `/dox/`, as a route without the base (the form the corpus uses), or `undefined` when
 * there is none worth sending: no referrer, another origin, a page outside the base, `/dox/` itself (a reload), or a
 * path the Worker would refuse (too long, or outside `PAGE_CONTEXT_PATTERN`, as a percent-encoded `/foo%20bar/` is) (sending nothing costs only the bias; sending it would cost the answer).
 */
export function pageContextFromReferrer(
  referrer: string,
  origin: string,
  base: string,
): string | undefined {
  if (!referrer) return undefined;
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return undefined;
  }
  if (url.origin !== origin) return undefined;
  const prefix = base.replace(/\/$/, "");
  const { pathname } = url;
  if (pathname !== prefix && !pathname.startsWith(`${prefix}/`))
    return undefined;
  const route = pathname.slice(prefix.length) || "/";
  if (/^\/dox(\/|$)/.test(route)) return undefined;
  if (route.length > MAX_PAGE_CONTEXT_LENGTH) return undefined;
  if (!PAGE_CONTEXT_PATTERN.test(route)) return undefined;
  return route;
}

/** The section a question's `pageContext` names, for the search's bias, or `undefined` for no bias. */
export function namespaceFromPageContext(
  pageContext: string | undefined,
): string | undefined {
  return pageContext ? routeNamespace(pageContext) : undefined;
}
