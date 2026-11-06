import { gitGetWorktrees } from "../lib/git.js";
import type { Multiplexer } from "../lib/multiplexer.js";
import { closeRexSession, findRexSessions, isRexInstalled } from "./rex.js";

export const rexMultiplexer: Multiplexer = {
  displayName: "Rex",
  isInstalled: () => isRexInstalled(),
  // Rex has no worktree listing, so the worktrees come from git: the linked
  // checkouts under the repository's worktrees directory, as `gitGetWorktrees`
  // already answers for the repository the command runs in. That excludes the
  // repository's own checkout and the current worktree, so neither is offered.
  // `gitRootPath` is not read for that reason; it is the seam's parameter and
  // Herdr's `--cwd`, and git resolves the same repository from the process's.
  async findSpaces() {
    const worktrees = await gitGetWorktrees();
    const sessions = await findRexSessions({
      paths: worktrees.map(({ path }) => path),
    });

    // D8 — the session the CLI itself runs in is never offered for closing,
    // the exact parallel of Herdr's `source_workspace_id` (#52 D7). Closing it
    // would take down the terminal this process is running in.
    const own = process.env.REX_SESSION;

    return new Map([...sessions].filter(([, sessionId]) => sessionId !== own));
  },
  closeSpace: (spaceId) => closeRexSession(spaceId),
};
