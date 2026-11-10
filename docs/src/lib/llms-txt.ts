/**
 * The text of /worktree/llms.txt (D13), per llmstxt.org: an H1, a blockquote summary, then H2 sections of
 * `- [name](url): notes` items. Pure, so it is tested without the content collection.
 */
const ORIGIN = "https://northguild.dev/worktree/";
/** The absolute URL of this file; the page head's `describedby` link (D8) names it from here. */
export const LLMS_TXT_URL = `${ORIGIN}llms.txt`;
const SITE_NAME = "@northguild/worktree";
const SUMMARY =
  "Documentation for worktree, an open-source CLI that manages git worktrees: one per branch or issue, with env files copied and your editor opened.";

/** An entry id such as `index`, `faq` or `commands/index` is the page's path under /worktree/. */
const pathOf = (id: string) => id.replace(/(^|\/)index$/, "");
const urlOf = (path: string) => (path === "" ? ORIGIN : `${ORIGIN}${path}/`);

/** A page as the file lists it: `id` is the collection entry id. */
export interface LlmsPage {
  id: string;
  title: string;
  description: string;
}

/** `404.md` is in the content collection (it makes the custom 404) but is not a page of the site. */
const NOT_FOUND_PATH = "404";

/** llmstxt.org's `## Optional` holds links an agent can skip when context is short (D9): the changelog is history. */
const OPTIONAL_PATHS = new Set(["changelog"]);

function itemOf({
  path,
  title,
  description,
}: LlmsPage & { path: string }): string {
  return `- [${title}](${urlOf(path)}): ${description}`;
}

export function renderLlmsTxt(pages: LlmsPage[]): string {
  const entries = pages
    .map((page) => ({ ...page, path: pathOf(page.id) }))
    .filter(({ path }) => path !== NOT_FOUND_PATH)
    // The root page first, then alphabetical, so the file is stable between builds.
    .sort((a, b) => a.path.localeCompare(b.path));
  const optional = entries.filter(({ path }) => OPTIONAL_PATHS.has(path));
  const documentation = entries.filter(({ path }) => !OPTIONAL_PATHS.has(path));
  return [
    `# ${SITE_NAME}`,
    "",
    `> ${SUMMARY}`,
    "",
    "## Documentation",
    "",
    ...documentation.map(itemOf),
    "",
    "## Optional",
    "",
    ...optional.map(itemOf),
    "",
  ].join("\n");
}
