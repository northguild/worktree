// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildStructuredData, headTitle } from "./structured-data";

// Expected values come from plan §4.4 (the SoftwareApplication block, verbatim) and D10 (which types go
// where), with URLs from D3 (https://northguild.dev/worktree/<path>/). `softwareVersion` is the root
// package.json version, read here independently of site-meta (plan §8, "What decides each value").
function readRootVersion(): string {
  const raw: unknown = JSON.parse(
    readFileSync(
      fileURLToPath(new URL("../../../package.json", import.meta.url)),
      "utf8",
    ),
  );
  if (
    typeof raw !== "object" ||
    raw === null ||
    !("version" in raw) ||
    typeof raw.version !== "string"
  ) {
    throw new Error("root package.json has no version");
  }
  return raw.version;
}

const VERSION = readRootVersion();

const SOFTWARE_APPLICATION = {
  "@type": "SoftwareApplication",
  name: "Worktree",
  alternateName: "@northguild/worktree",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "macOS, Linux",
  softwareVersion: VERSION,
  downloadUrl: "https://www.npmjs.com/package/@northguild/worktree",
  isAccessibleForFree: true,
  license: "https://opensource.org/licenses/MIT",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  sameAs: [
    "https://github.com/northguild/worktree",
    "https://www.npmjs.com/package/@northguild/worktree",
  ],
};

function types(graph: readonly { "@type": string }[]): string[] {
  return graph.map((node) => node["@type"]);
}

describe("buildStructuredData", () => {
  it("wraps the nodes in one schema.org @graph", () => {
    const data = buildStructuredData({ path: "", title: "Home" }, VERSION);
    expect(data["@context"]).toBe("https://schema.org");
    expect(Array.isArray(data["@graph"])).toBe(true);
  });

  it("puts SoftwareApplication, WebSite and Organization on the root, and no BreadcrumbList", () => {
    const { "@graph": graph } = buildStructuredData(
      { path: "", title: "Getting Started" },
      VERSION,
    );
    expect(types(graph)).toEqual([
      "SoftwareApplication",
      "WebSite",
      "Organization",
    ]);
  });

  it("emits the SoftwareApplication block of §4.4 with the CLI version filled in", () => {
    const { "@graph": graph } = buildStructuredData(
      { path: "", title: "Getting Started" },
      VERSION,
    );
    expect(graph[0]).toEqual(SOFTWARE_APPLICATION);
  });

  it("names the site and the organisation by their D3 and §4.4 URLs", () => {
    const { "@graph": graph } = buildStructuredData(
      { path: "", title: "Getting Started" },
      VERSION,
    );
    expect(graph[1]).toMatchObject({
      "@type": "WebSite",
      name: "@northguild/worktree",
      url: "https://northguild.dev/worktree/",
    });
    expect(graph[2]).toMatchObject({
      "@type": "Organization",
      name: "northguild",
      url: "https://northguild.dev/",
      sameAs: ["https://github.com/northguild"],
    });
  });

  it("puts SoftwareApplication and a BreadcrumbList on a nested page, and no WebSite or Organization", () => {
    const { "@graph": graph } = buildStructuredData(
      { path: "faq", title: "FAQ" },
      VERSION,
    );
    expect(types(graph)).toEqual(["SoftwareApplication", "BreadcrumbList"]);
    expect(graph[0]).toEqual(SOFTWARE_APPLICATION);
  });

  // D17: Getting Started is a nested page like any other (`/getting-started/`), so it carries a BreadcrumbList.
  it("puts a BreadcrumbList on Getting Started, which is no longer the root", () => {
    const { "@graph": graph } = buildStructuredData(
      { path: "getting-started", title: "Getting Started" },
      VERSION,
    );
    expect(types(graph)).toEqual(["SoftwareApplication", "BreadcrumbList"]);
    expect(graph[1]).toMatchObject({
      itemListElement: [
        { position: 1, item: "https://northguild.dev/worktree/" },
        {
          position: 2,
          name: "Getting Started",
          item: "https://northguild.dev/worktree/getting-started/",
        },
      ],
    });
  });

  // Google's breadcrumb documentation: ListItem entries with a 1-based position, a name and an item URL.
  it("lists the root, then the page, for a top-level page", () => {
    const { "@graph": graph } = buildStructuredData(
      { path: "faq", title: "FAQ" },
      VERSION,
    );
    expect(graph[1]).toEqual({
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "@northguild/worktree",
          item: "https://northguild.dev/worktree/",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "FAQ",
          item: "https://northguild.dev/worktree/faq/",
        },
      ],
    });
  });

  it("includes the section index between the root and a page inside a section", () => {
    const { "@graph": graph } = buildStructuredData(
      { path: "commands/branch", title: "worktree branch" },
      VERSION,
    );
    expect(graph[1]).toEqual({
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "@northguild/worktree",
          item: "https://northguild.dev/worktree/",
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Commands",
          item: "https://northguild.dev/worktree/commands/",
        },
        {
          "@type": "ListItem",
          position: 3,
          name: "worktree branch",
          item: "https://northguild.dev/worktree/commands/branch/",
        },
      ],
    });
  });

  it("does not repeat the section when the page is the section index", () => {
    const { "@graph": graph } = buildStructuredData(
      { path: "guides", title: "Guides" },
      VERSION,
    );
    expect(graph[1]).toMatchObject({
      itemListElement: [
        { position: 1, item: "https://northguild.dev/worktree/" },
        {
          position: 2,
          name: "Guides",
          item: "https://northguild.dev/worktree/guides/",
        },
      ],
    });
  });

  it("carries no HowTo or FAQPage node anywhere (D10)", () => {
    for (const path of ["", "faq", "guides/env-files"]) {
      const { "@graph": graph } = buildStructuredData(
        { path, title: "t" },
        VERSION,
      );
      expect(types(graph)).not.toContain("HowTo");
      expect(types(graph)).not.toContain("FAQPage");
    }
  });
});

// D9: titles read `<page> | <site title>`. A page whose own title already names the site would repeat it.
describe("headTitle", () => {
  it("joins the page title and the site title with the delimiter", () => {
    expect(
      headTitle(
        "worktree list: see every git worktree",
        "@northguild/worktree",
        "|",
      ),
    ).toBe("worktree list: see every git worktree | @northguild/worktree");
  });

  it("leaves a title that already names the site as it is", () => {
    expect(
      headTitle(
        "Getting Started with @northguild/worktree",
        "@northguild/worktree",
        "|",
      ),
    ).toBe("Getting Started with @northguild/worktree");
  });
});
