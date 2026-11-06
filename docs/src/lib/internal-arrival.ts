/**
 * Is this referrer a page of the docs site itself? (plan #266, D7). The landing's header entrance plays only on an
 * arrival from outside the site, so an internal arrival turns it off. northguild.dev shares the docs' origin, so the
 * origin alone does not decide it: the referrer's path must be under the site base. No referrer is external.
 *
 * Header.astro inlines `isInternalArrival` (its script must run before the header paints and so cannot import this);
 * Header.test.ts runs that inline script against it to keep the two in step.
 */
export function isInternalReferrer(
  referrer: string,
  origin: string,
  base: string,
): boolean {
  let url: URL;
  try {
    url = new URL(referrer);
  } catch {
    return false;
  }
  return url.origin === origin && `${url.pathname}/`.startsWith(base);
}

/**
 * Does the entrance get skipped? Only when this navigation came from another page of the docs site by following a link
 * ("navigate") or by history ("back_forward"). A reload always plays it: it keeps the original referrer, so a tab that
 * first reached the landing from a docs page would otherwise never play it again (the user, 2026-11-06). A missing or
 * unknown navigation type (Navigation Timing's `type`) is read as "navigate".
 */
export function isInternalArrival(
  referrer: string,
  origin: string,
  base: string,
  navigationType: string | undefined,
): boolean {
  return (
    navigationType !== "reload" && isInternalReferrer(referrer, origin, base)
  );
}
