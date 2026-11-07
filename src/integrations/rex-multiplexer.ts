import { gitGetWorktrees } from "../lib/git.js";
import type { Multiplexer } from "../lib/multiplexer.js";
import {
  closeRexSession,
  findRexSessions,
  isRexInstalled,
  renameRexSession,
} from "./rex.js";

export const rexMultiplexer: Multiplexer = {
  displayName: "Rex",
  spaceNoun: "session",
  isInstalled: () => isRexInstalled(),
  // Rex has no worktree listing, so the worktrees come from git, and D11 says a
  // session is closed only when every shell it has sits inside the one
  // worktree being removed. `findRexSessions` already leaves out a session
  // whose shells sit in two of the roots it is given, so the main checkout
  // (`gitRootPath`) and the current worktree are given too: a shell in either
  // makes the session someone else's, and it is left open; so is a shell in
  // any other directory, which `everyShellInside` asks the lookup to count. They are then
  // dropped from the answer, because neither is ever a candidate for closing.
  async findSpaces(gitRootPath) {
    const worktrees = await gitGetWorktrees({ includeCurrent: true });
    const keep = worktrees.filter(({ isCurrent }) => !isCurrent);
    const guards = [
      gitRootPath,
      ...worktrees.filter(({ isCurrent }) => isCurrent).map(({ path }) => path),
    ];
    const sessions = await findRexSessions({
      paths: [...new Set([...keep.map(({ path }) => path), ...guards])],
      everyShellInside: true,
    });

    // D8 — the session the CLI itself runs in is never offered for closing,
    // the exact parallel of Herdr's `source_workspace_id` (#52 D7). Closing it
    // would take down the terminal this process is running in.
    const own = process.env.REX_SESSION;
    const candidates = new Set(keep.map(({ path }) => path));

    return new Map(
      [...sessions].filter(
        ([path, sessionId]) => candidates.has(path) && sessionId !== own,
      ),
    );
  },
  closeSpace: (spaceId) => closeRexSession(spaceId),
  renameSpace: (spaceId, label) => renameRexSession(spaceId, label),
};
