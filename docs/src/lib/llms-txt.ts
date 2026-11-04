/**
 * The text of /worktree/llms.txt (D13), per llmstxt.org: an H1, a blockquote summary, then H2 sections of
 * `- [name](url): notes` items. Pure, so it is tested without the content collection.
 */
const ORIGIN = "https://northguild.dev/worktree/";
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

export function renderLlmsTxt(pages: LlmsPage[]): string {
  const items = pages
    .map((page) => ({ ...page, path: pathOf(page.id) }))
    // The root page first, then alphabetical, so the file is stable between builds.
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(
      ({ path, title, description }) =>
        `- [${title}](${urlOf(path)}): ${description}`,
    );
  return [
    `# ${SITE_NAME}`,
    "",
    `> ${SUMMARY}`,
    "",
    "## Documentation",
    "",
    ...items,
    "",
  ].join("\n");
}
