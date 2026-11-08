/** A question offered in the empty transcript, and the docs page that answers it (plan #257 Phase 6). */
export interface ChatStarter {
  /** Sent as the reader's question, word for word. */
  text: string;
  /** The page that answers it: a member of `VALID_DOC_ROUTES`, so the assistant can link it. */
  route: string;
}

export const CHAT_STARTERS: ReadonlyArray<ChatStarter> = [
  {
    text: "How do I create a worktree for a GitHub issue?",
    route: "/guides/github-issue-integration/",
  },
  {
    text: "How do I copy my .env files into a new worktree?",
    route: "/guides/env-files/",
  },
  {
    text: "How do I clean up worktrees whose branches are merged?",
    route: "/commands/cleanup/",
  },
];
