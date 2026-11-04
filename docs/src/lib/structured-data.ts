/**
 * What the page head says about a page: its JSON-LD (D10) and its `<title>` text (D9).
 *
 * Pure functions of the page and the site's own metadata, so the Head override holds no logic. URLs follow D3:
 * `https://northguild.dev/worktree/<path>/`.
 */
import {
  projectLink,
  projectOwnerName,
  projectOwnerProfileUrl,
} from "./site-meta";

const ORIGIN = "https://northguild.dev/";
const ROOT_URL = `${ORIGIN}worktree/`;
const SITE_NAME = "@northguild/worktree";

/** A page as the structured data sees it: `path` is relative to the site root (`""`, `faq`, `commands/branch`). */
export interface PageInput {
  path: string;
  title: string;
}

interface ListItem {
  "@type": "ListItem";
  position: number;
  name: string;
  item: string;
}

interface BreadcrumbList {
  "@type": "BreadcrumbList";
  itemListElement: ListItem[];
  [key: string]: unknown;
}

interface Node {
  "@type": string;
  [key: string]: unknown;
}

export interface StructuredData {
  "@context": "https://schema.org";
  "@graph": Node[];
}

function pageUrl(path: string): string {
  return path === "" ? ROOT_URL : `${ROOT_URL}${path}/`;
}

function capitalise(segment: string): string {
  return segment.charAt(0).toUpperCase() + segment.slice(1);
}

function softwareApplication(cliVersion: string): Node {
  return {
    "@type": "SoftwareApplication",
    name: "Worktree",
    alternateName: SITE_NAME,
    applicationCategory: "DeveloperApplication",
    operatingSystem: "macOS, Linux",
    softwareVersion: cliVersion,
    downloadUrl: "https://www.npmjs.com/package/@northguild/worktree",
    isAccessibleForFree: true,
    license: "https://opensource.org/licenses/MIT",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    sameAs: [projectLink, "https://www.npmjs.com/package/@northguild/worktree"],
  };
}

/** The root, each ancestor section index, then the page itself. */
function breadcrumbs({ path, title }: PageInput): BreadcrumbList {
  const segments = path.split("/");
  const sections = segments.slice(0, -1).map((segment, index) => ({
    name: capitalise(segment),
    item: pageUrl(segments.slice(0, index + 1).join("/")),
  }));
  const crumbs = [
    { name: SITE_NAME, item: ROOT_URL },
    ...sections,
    { name: title, item: pageUrl(path) },
  ];
  return {
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((crumb, index) => ({
      "@type": "ListItem",
      position: index + 1,
      ...crumb,
    })),
  };
}

export function buildStructuredData(
  page: PageInput,
  cliVersion: string,
): StructuredData {
  const graph: Node[] = [softwareApplication(cliVersion)];
  if (page.path === "") {
    graph.push(
      { "@type": "WebSite", name: SITE_NAME, url: ROOT_URL },
      {
        "@type": "Organization",
        name: projectOwnerName,
        url: ORIGIN,
        sameAs: [projectOwnerProfileUrl],
      },
    );
  } else {
    graph.push(breadcrumbs(page));
  }
  return { "@context": "https://schema.org", "@graph": graph };
}

/** `<page> | <site>`; a page whose own title already names the site is left as it is, not repeated. */
export function headTitle(
  pageTitle: string,
  siteTitle: string,
  delimiter: string,
): string {
  return pageTitle.includes(siteTitle)
    ? pageTitle
    : `${pageTitle} ${delimiter} ${siteTitle}`;
}
