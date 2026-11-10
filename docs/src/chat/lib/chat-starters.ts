/** A question offered as an example in the rail, and the docs page that answers it (plan #257 Phase 6). */
export interface ChatStarter {
  /** Sent as the reader's question, word for word. */
  text: string;
  /** The page that answers it: a member of `VALID_DOC_ROUTES`, so the assistant can link it. */
  route: string;
  /** The heading the rail files it under (plan #309 Phase 3): the topic of the page that answers it, in plain words. */
  area: string;
}

export const CHAT_STARTERS: ReadonlyArray<ChatStarter> = [
  {
    text: "How do I create a worktree for a GitHub issue?",
    route: "/guides/github-issue-integration/",
    area: "Issues",
  },
  {
    text: "How do I copy my .env files into a new worktree?",
    route: "/guides/env-files/",
    area: "Environment files",
  },
  {
    text: "How do I clean up worktrees whose branches are merged?",
    route: "/commands/cleanup/",
    area: "Cleanup",
  },
];

/** One heading of the rail and the starters filed under it. */
export interface StarterGroup {
  area: string;
  starters: ChatStarter[];
}

/** The starters under their areas, areas in the order each first appears, so the rail reads as the list is written. */
export function startersByArea(
  starters: ReadonlyArray<ChatStarter> = CHAT_STARTERS,
): StarterGroup[] {
  const groups: StarterGroup[] = [];
  for (const starter of starters) {
    const group = groups.find((g) => g.area === starter.area);
    if (group) group.starters.push(starter);
    else groups.push({ area: starter.area, starters: [starter] });
  }
  return groups;
}
