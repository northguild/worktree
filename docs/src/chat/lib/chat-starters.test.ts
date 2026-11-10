import { VALID_DOC_ROUTES } from "../docs-routes.generated";
import { CHAT_STARTERS, startersByArea } from "./chat-starters";

// Expected values: plan #257 Phase 6 (three starters, each with a route that answers it) and
// VALID_DOC_ROUTES, which the docs build writes from the pages on disk and is independent of this module.

describe("CHAT_STARTERS", () => {
  it("offers exactly three", () => {
    expect(CHAT_STARTERS).toHaveLength(3);
  });

  it("points every starter at a page that exists", () => {
    for (const starter of CHAT_STARTERS) {
      expect(VALID_DOC_ROUTES.has(starter.route), starter.route).toBe(true);
    }
  });

  it("asks three different questions, each ending in a question mark", () => {
    const texts = CHAT_STARTERS.map((starter) => starter.text);
    expect(new Set(texts).size).toBe(3);
    for (const text of texts) expect(text.endsWith("?"), text).toBe(true);
  });

  it("asks the questions and answers them from the pages the plan names", () => {
    expect(CHAT_STARTERS.map((s) => [s.text, s.route])).toEqual([
      [
        "How do I create a worktree for a GitHub issue?",
        "/guides/github-issue-integration/",
      ],
      [
        "How do I copy my .env files into a new worktree?",
        "/guides/env-files/",
      ],
      [
        "How do I clean up worktrees whose branches are merged?",
        "/commands/cleanup/",
      ],
    ]);
  });
});

// Expected values: plan #309 Phase 3 ("Each starter gains an area") and §9 Q7's default (the three existing starters, each
// given an area). Which area each question belongs to is read off the page that answers it (its `route`): the GitHub-issue
// guide is about Issues, the env-files guide about Environment files, the cleanup command about Cleanup.

describe("CHAT_STARTERS routes", () => {
  it("answers each starter from its own page: no two share a route, so a route can key a card", () => {
    const routes = CHAT_STARTERS.map((s) => s.route);
    expect(new Set(routes).size).toBe(routes.length);
  });
});

describe("CHAT_STARTERS areas", () => {
  it("gives every starter an area, named in plain words", () => {
    expect(CHAT_STARTERS.map((s) => [s.route, s.area])).toEqual([
      ["/guides/github-issue-integration/", "Issues"],
      ["/guides/env-files/", "Environment files"],
      ["/commands/cleanup/", "Cleanup"],
    ]);
  });
});

describe("startersByArea", () => {
  it("groups the starters by area, in the order each area first appears, keeping every starter once", () => {
    const groups = startersByArea();
    expect(groups.map((g) => g.area)).toEqual([
      "Issues",
      "Environment files",
      "Cleanup",
    ]);
    expect(groups.flatMap((g) => g.starters)).toEqual([...CHAT_STARTERS]);
  });

  it("puts two starters of one area under one heading", () => {
    const [first] = CHAT_STARTERS;
    const twin = { ...first, text: "How do I link an issue to a branch?" };
    const groups = startersByArea([first, CHAT_STARTERS[1], twin]);
    expect(groups.map((g) => [g.area, g.starters.length])).toEqual([
      ["Issues", 2],
      ["Environment files", 1],
    ]);
  });
});
