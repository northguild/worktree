// @vitest-environment node

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LLMS_TXT_URL, renderLlmsTxt } from "./llms-txt";

// Expected values do not come from the endpoint. The URLs come from D3 (`https://northguild.dev/worktree/<path>/`,
// the root page at `/worktree/`) applied to each source file's path; titles and descriptions are read straight
// from the frontmatter as written in the .mdx files (double-quoted one-liners, so JSON.parse reads them). The
// format is llmstxt.org (v2, read 2026-11-04): an H1, a blockquote summary, then H2 sections holding
// `- [name](url): notes` list items.
const CONTENT = fileURLToPath(new URL("../content/docs", import.meta.url));
const ORIGIN = "https://northguild.dev/worktree/";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? sourceFiles(join(dir, entry.name))
      : [join(dir, entry.name)],
  );
}

function expectedPages() {
  return sourceFiles(CONTENT)
    .filter((file) => file.endsWith(".mdx"))
    .map((file) => {
      const path = relative(CONTENT, file)
        .replace(/\.mdx$/, "")
        .replace(/(^|\/)index$/, "");
      const field = (name: string) => {
        const line = readFileSync(file, "utf8")
          .split("\n")
          .find((l) => l.startsWith(`${name}: `));
        if (!line) throw new Error(`${file} has no ${name}:`);
        return JSON.parse(line.slice(name.length + 2)) as string;
      };
      return {
        id: relative(CONTENT, file).replace(/\.mdx$/, ""),
        url: path === "" ? ORIGIN : `${ORIGIN}${path}/`,
        title: field("title"),
        description: field("description"),
      };
    });
}

// `getCollection` returns nothing under Vitest (no content store), so the renderer is tested on the source files'
// own frontmatter; the audit checks the built file, collection and all, against the same 28 URLs.
const body = () => ({ text: renderLlmsTxt(expectedPages()) });

describe("llms.txt", () => {
  it("opens with an H1 naming the site and a blockquote summary (llmstxt.org)", () => {
    const { text } = body();
    const [h1, blank, quote] = text.split("\n");
    expect(h1).toBe("# @northguild/worktree");
    expect(blank).toBe("");
    expect(quote).toMatch(/^> \S/);
  });

  it("lists each of the 28 pages once, as a link with its title and description", async () => {
    const pages = expectedPages();
    expect(pages).toHaveLength(28);
    const { text } = body();
    const items = text.split("\n").filter((line) => line.startsWith("- "));
    expect([...items].sort()).toEqual(
      pages.map((p) => `- [${p.title}](${p.url}): ${p.description}`).sort(),
    );
  });

  it("puts every list item under an H2 section, as the format requires", () => {
    const { text } = body();
    const lines = text.split("\n");
    const firstItem = lines.findIndex((l) => l.startsWith("- "));
    const firstH2 = lines.findIndex((l) => l.startsWith("## "));
    expect(firstH2).toBeGreaterThan(0);
    expect(firstH2).toBeLessThan(firstItem);
  });

  // D9 / llmstxt.org: "Optional" is the section for "secondary information: links an agent can skip when a shorter
  // context is needed" (read 2026-11-08). The changelog is the one page that is history, not how to use the tool.
  it("puts the changelog alone under ## Optional and the other 27 under ## Documentation", () => {
    const { text } = body();
    const sections = new Map<string, string[]>();
    let current = "";
    for (const line of text.split("\n")) {
      if (line.startsWith("## ")) {
        current = line;
        sections.set(current, []);
      } else if (line.startsWith("- ")) sections.get(current)?.push(line);
    }
    expect([...sections.keys()]).toEqual(["## Documentation", "## Optional"]);
    expect(sections.get("## Optional")).toHaveLength(1);
    expect(sections.get("## Optional")?.[0]).toContain(
      `](${ORIGIN}changelog/):`,
    );
    expect(sections.get("## Documentation")).toHaveLength(27);
    expect(
      sections.get("## Documentation")?.some((l) => l.includes("/changelog/")),
    ).toBe(false);
  });

  // D8: the page head links this exact URL (the audit checks the link against it).
  it("exports the absolute URL of the file it renders", () => {
    expect(LLMS_TXT_URL).toBe("https://northguild.dev/worktree/llms.txt");
  });

  it("lists the root page first, as the site's entry point", () => {
    const { text } = body();
    const first = text.split("\n").find((l) => l.startsWith("- "));
    expect(first).toContain(`](${ORIGIN}):`);
  });

  // The content collection also holds 404.md (the custom 404). It is not a page of the site, so a crawler told
  // to read it would be sent to a URL that answers 404.
  it("leaves the 404 out, whichever way the collection names it", () => {
    const text = renderLlmsTxt([
      ...expectedPages(),
      { id: "404", title: "Page not found", description: "Not a page." },
    ]);
    expect(text).not.toContain("404");
    expect(text).toBe(body().text);
  });
});
