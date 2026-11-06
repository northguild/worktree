import type { Multiplexer } from "../lib/multiplexer.js";
import {
  closeHerdrWorkspace,
  isHerdrInstalled,
  listHerdrWorktrees,
} from "./herdr.js";

export const herdrMultiplexer: Multiplexer = {
  displayName: "Herdr",
  isInstalled: () => isHerdrInstalled(),
  async findSpaces(gitRootPath) {
    const { worktrees, sourceWorkspaceId } = await listHerdrWorktrees({
      gitRootPath,
    });

    // flatMap rather than filter-then-map so the narrowing is the compiler's:
    // `workspaceId` is `string | undefined`, and inside this branch it is a
    // string. A filter needs an assertion to say the same thing, and an
    // assertion keeps compiling if the first guard below is ever dropped —
    // which is exactly the regression these two guards exist to prevent.
    return new Map(
      worktrees.flatMap((worktree) =>
        // #52 D9 — a worktree with no space open is not an error and is
        // nothing to close.
        worktree.workspaceId !== undefined &&
        // #52 D7 — the repository's own checkout is in this listing like any
        // other, and closing it would take down the window the user is
        // sitting in. Both removal paths already exclude the current
        // worktree, so this guards a future caller rather than a live defect.
        worktree.workspaceId !== sourceWorkspaceId
          ? [[worktree.path, worktree.workspaceId] as const]
          : [],
      ),
    );
  },
  closeSpace: (spaceId) => closeHerdrWorkspace(spaceId),
};
