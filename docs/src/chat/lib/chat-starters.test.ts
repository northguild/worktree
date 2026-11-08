import { VALID_DOC_ROUTES } from "../docs-routes.generated";
import { CHAT_STARTERS } from "./chat-starters";

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
