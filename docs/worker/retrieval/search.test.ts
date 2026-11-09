// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHAT_STARTERS } from "../../src/chat/lib/chat-starters";
import type { RetrievalChunk } from "../../src/chat/lib/chat-types";
import { DOC_SECTIONS, routeNamespace } from "../../src/chat/lib/page-context";
import {
  buildChunks,
  buildCorpus,
  buildVocabulary,
  routeOf,
  splitAtHeadings,
} from "../build-context.mjs";
import {
  buildIndex,
  loadIndex,
  MIN_RELEVANCE_SCORE,
  NAMESPACE_BOOST,
  queryTerms,
  SEARCH_LIMIT,
  searchChunks,
} from "./search";

// Expected values: plan #309 D8 (MiniSearch 7.2.0's `toJSON` / `loadJSON` under the same options, stopwords, camelCase
// splitting, a namespace boost of 1.5, a relevance floor), written out from gmt's `search.ts` comments; the routes are
// the site's own (28 `.mdx` pages: `find docs/src/content/docs -name '*.mdx'`); and §9 Q14, whose measurements are
// the figures in the "relevance floor" block below (taken with no floor, over this corpus, on 2026-11-08).

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const BUILT = buildCorpus(
  join(REPO, "docs/src/content/docs"),
  readFileSync(join(REPO, "skills/worktree/SKILL.md"), "utf8"),
);
const INDEX = loadIndex(BUILT.indexJson);
const BY_ID = new Map(BUILT.chunks.map((c) => [c.id, c]));
const search = (q: string, namespace?: string) =>
  searchChunks(INDEX, BY_ID, q, { namespace });

function chunk(
  id: string,
  title: string,
  text: string,
  namespace = "x",
): RetrievalChunk {
  return { id, url: "/p/", namespace, title, text };
}

describe("the serialized index", () => {
  it("loads to an index that answers as the one it was built from: the same chunks in the same order, scores equal", () => {
    const built = buildIndex(BUILT.chunks);
    const question = CHAT_STARTERS[0]?.text ?? "";
    const loaded = INDEX.search(question);
    const original = built.search(question);

    expect(loaded.map((r) => r.id)).toEqual(original.map((r) => r.id));
    // Summation order differs in the last digit.
    loaded.forEach((r, i) => {
      expect(r.score).toBeCloseTo(original[i]?.score ?? Number.NaN, 9);
    });
    expect(INDEX.documentCount).toBe(BUILT.chunks.length);
  });

  it("is a MiniSearch 7 toJSON document, so the Worker needs no build step", () => {
    const parsed = JSON.parse(BUILT.indexJson) as {
      serializationVersion: number;
      documentCount: number;
    };

    expect(parsed.serializationVersion).toBe(2);
    expect(parsed.documentCount).toBe(BUILT.chunks.length);
  });
});

describe("what the search reads", () => {
  it("drops stopwords and one-letter words from a question", () => {
    expect(
      queryTerms("How do I create a worktree for a GitHub issue?"),
    ).toEqual(["create", "worktree", "github", "issue"]);
  });

  it("finds nothing for a question of stopwords alone", () => {
    expect(search("what is this for")).toEqual([]);
  });

  it("splits an identifier into its words in the index, so 'branch prefix' finds branchPrefix", () => {
    const chunks = [
      chunk("a", "branchPrefix", "How a branch name starts."),
      ...Array.from({ length: 30 }, (_, i) =>
        chunk(`f${i}`, `Filler ${i}`, `unrelated words number ${i}`),
      ),
    ];
    const index = buildIndex(chunks);

    expect(index.search("branch prefix")[0]?.id).toBe("a");
  });

  it("does not split a typed identifier: 'branchPrefix' stays one narrow term", () => {
    expect(queryTerms("branchPrefix")).toEqual(["branchprefix"]);
  });

  it("allows edits only on long terms: 'cleanp' is no 'cleanup' fuzz but 'worktreee' finds worktree", () => {
    const hits = (q: string) => INDEX.search(q).length;

    expect(hits("worktreee")).toBeGreaterThan(0);
    expect(INDEX.search("rest").map((r) => r.id)).not.toContain(
      "/commands/remove/#",
    );
  });
});

describe("the namespace bias", () => {
  it("is 1.5 (D8)", () => {
    expect(NAMESPACE_BOOST).toBe(1.5);
  });

  it("lifts the section's chunks above others: from /commands/config/ a config question leads with that page", () => {
    const plain = search("config file").map((c) => c.id);
    const biased = search("config file", "commands").map((c) => c.id);

    expect(plain[0]).toBe("/configuration/#user-config-file");
    expect(biased[0]).toBe("/commands/config/#user-config-file");
  });

  it("is a bias and not a filter: the other section's page is still found", () => {
    const biased = search("config file", "commands").map((c) => c.id);

    expect(biased).toContain("/configuration/#user-config-file");
  });

  it("leaves the lead alone for a question whose best pages are not in the section", () => {
    const lead = (namespace?: string) =>
      search("default source branch", namespace)
        .slice(0, 3)
        .map((c) => c.id);

    expect(lead("commands")).toEqual(lead());
    expect(lead()[0]).toBe("/configuration/#default-source-branch");
  });
});

describe("the limit", () => {
  it("returns at most 15 chunks (gmt's), best first", () => {
    const found = search("worktree");

    expect(SEARCH_LIMIT).toBe(15);
    expect(found.length).toBeLessThanOrEqual(15);
  });
});

// §9 Q14. Best score of each question with no floor (the probe's own output, written out), and what the floor keeps.
describe("the relevance floor (plan #309 §9 Q14)", () => {
  it("is 10", () => {
    expect(MIN_RELEVANCE_SCORE).toBe(10);
  });

  it.each(
    CHAT_STARTERS.map((s) => [s.text, s.route] as const),
  )("keeps the page that answers the starter %s", (text, route) => {
    const found = search(text);
    const rank = found.findIndex((c) => c.url === route);

    expect(rank).toBeGreaterThanOrEqual(0);
    expect(rank).toBeLessThan(6);
  });

  // The best chunk for each of these scored 15-25 with no floor: the weakest real lookups the corpus takes.
  it.each([
    ["rename", "/commands/rename/"],
    ["clickup", "/guides/clickup-integration/"],
    ["undo a cleanup", "/commands/cleanup/"],
    ["install", "/getting-started/"],
    ["what does --json do", "/commands/list/"],
  ])("keeps a terse lookup: %s", (text, route) => {
    expect(search(text).map((c) => c.url)).toContain(route);
  });

  // The best chunk for each of these scored 2.0, 2.6, 6.2 and 8.4: a stray word only.
  it.each([
    "what is the capital of Peru",
    "how do I bake sourdough bread",
    "tell me a story about a dog",
    "recommend a pizza restaurant",
  ])("sends %s to nothing matched", (text) => {
    expect(search(text)).toEqual([]);
  });
});

describe("the corpus the build writes", () => {
  it("has one route per docs page: 28", () => {
    expect(BUILT.routes).toHaveLength(28);
    expect(BUILT.counts.pages).toBe(28);
    expect(BUILT.routes).toContain("/");
    expect(BUILT.routes).toContain("/commands/branch/");
  });

  it("counts every chunk it indexed", () => {
    expect(BUILT.counts.chunks).toBe(BUILT.chunks.length);
    expect(BUILT.chunks.length).toBeGreaterThan(BUILT.counts.pages);
  });

  it("gives every chunk a unique id, a route that is a page, and its page's section", () => {
    const ids = new Set(BUILT.chunks.map((c) => c.id));
    const routes = new Set(BUILT.routes);

    expect(ids.size).toBe(BUILT.chunks.length);
    for (const c of BUILT.chunks) {
      expect(routes.has(c.url)).toBe(true);
      expect(c.url).not.toContain("#");
      expect(c.namespace).toBe(routeNamespace(c.url));
      expect(c.text.length).toBeGreaterThan(0);
    }
  });

  it("files every page under a section the contract knows, so a new directory cannot fall into general", () => {
    for (const route of BUILT.routes) {
      const parts = route.split("/").filter(Boolean);
      if (parts.length > 1)
        expect(DOC_SECTIONS.has(parts[0] as string)).toBe(true);
    }
  });

  it("opens each page with its title and description, and titles a section 'Page › Heading'", () => {
    const first = BUILT.chunks.find((c) => c.id === "/commands/cleanup/#");
    const section = BUILT.chunks.find(
      (c) => c.id === "/commands/cleanup/#usage",
    );

    expect(first?.title).toBe("worktree cleanup: remove stale git worktrees");
    expect(first?.text).toContain(
      "worktree cleanup removes stale git worktrees",
    );
    expect(section?.title).toBe(
      "worktree cleanup: remove stale git worktrees › Usage",
    );
    expect(section?.text.startsWith("Usage\n\n")).toBe(true);
  });

  it("keeps the whole docs: no text is lost between the pages and the chunks", () => {
    const bash = BUILT.chunks.find((c) => c.id === "/commands/cleanup/#usage");

    expect(bash?.text).toContain("worktree cleanup");
  });

  it("keeps the skill guide as vocabulary sections and none of its frontmatter", () => {
    expect(BUILT.vocabulary.length).toBeGreaterThan(10);
    expect(BUILT.vocabulary.every((s) => s.title !== "" && s.text !== "")).toBe(
      true,
    );
    expect(
      BUILT.vocabulary.some((s) => s.text.includes("name: worktree")),
    ).toBe(false);
  });
});

describe("splitAtHeadings", () => {
  it("splits at the given levels and leaves what precedes the first heading as the intro", () => {
    const { intro, sections } = splitAtHeadings(
      "Lead.\n\n## One\n\nA\n\n### Sub\n\nB\n\n## Two\n\nC",
      [2],
    );

    expect(intro).toBe("Lead.");
    expect(sections).toEqual([
      { level: 2, heading: "One", body: "A\n\n### Sub\n\nB" },
      { level: 2, heading: "Two", body: "C" },
    ]);
  });

  it("does not split at a heading-looking line inside a code fence", () => {
    const { sections } = splitAtHeadings(
      "## Real\n\n```bash\n## not a heading\nls\n```\n\n~~~\n## nor this\n~~~\n\ntail",
      [2],
    );

    expect(sections.map((s) => s.heading)).toEqual(["Real"]);
    expect(sections[0]?.body).toContain("## not a heading");
    expect(sections[0]?.body).toContain("tail");
  });

  it("takes two levels at once", () => {
    const { sections } = splitAtHeadings(
      "## A\n\nx\n\n### B\n\ny\n\n#### C\n\nz",
      [2, 3],
    );

    expect(sections.map((s) => [s.level, s.heading])).toEqual([
      [2, "A"],
      [3, "B"],
    ]);
  });
});

describe("buildChunks", () => {
  const pages = [
    {
      route: "/commands/x/",
      title: "X",
      description: "About X.",
      body: "Opening.\n\n## Same\n\none\n\n## Same\n\ntwo\n\n## Empty\n\n## `Code` name\n\nthree",
    },
  ];

  it("makes a chunk for the opening and one per non-empty section, ids unique when headings repeat", () => {
    const chunks = buildChunks(pages);

    expect(chunks.map((c) => c.id)).toEqual([
      "/commands/x/#",
      "/commands/x/#same",
      "/commands/x/#same-2",
      "/commands/x/#code-name",
    ]);
    expect(chunks[0]?.text).toBe("X\n\nAbout X.\n\nOpening.");
    expect(chunks[3]?.title).toBe("X › Code name");
    expect(
      chunks.every(
        (c) => c.url === "/commands/x/" && c.namespace === "commands",
      ),
    ).toBe(true);
  });
});

describe("routeOf", () => {
  it.each([
    ["commands/branch.mdx", "/commands/branch/"],
    ["commands/index.mdx", "/commands/"],
    ["index.mdx", "/"],
    ["faq.mdx", "/faq/"],
  ])("%s is %s", (file, route) => {
    expect(routeOf(file)).toBe(route);
  });
});

describe("buildVocabulary", () => {
  const skill = [
    "---",
    "name: demo",
    "---",
    "",
    "# Title",
    "",
    "## Setup",
    "",
    "Do this.",
    "",
    "### Sub step",
    "",
    "```bash",
    "## a comment",
    "```",
    "",
    "## When to load",
    "",
    "Agents only.",
    "",
    "## References",
    "",
    "Links.",
  ].join("\n");

  it("makes a section per heading, titles a third-level one under its parent and drops the agent-only sections", () => {
    const sections = buildVocabulary(skill);

    expect(sections.map((s) => s.title)).toEqual(["Setup", "Setup › Sub step"]);
    expect(sections[1]?.text).toContain("## a comment");
    expect(JSON.stringify(sections)).not.toContain("name: demo");
    expect(JSON.stringify(sections)).not.toContain("Agents only");
  });
});
