import * as herdr from "./herdr.js";
import { herdrMultiplexer } from "./herdr-multiplexer.js";

vi.mock("./herdr.js");

const mockList = vi.mocked(herdr.listHerdrWorktrees);

// Expected values come from the guards' documented rules (#52 D7 and D9), not
// from the adapter: a checkout with no space is nothing to close, and the
// repository's own checkout is never offered for closing.
describe("herdrMultiplexer.findSpaces", () => {
  it("maps each worktree path to its space, leaving out the unopened and the source checkout", async () => {
    mockList.mockResolvedValue({
      sourceWorkspaceId: "wS",
      worktrees: [
        { path: "/r", workspaceId: "wS" },
        { path: "/r.worktrees/a", workspaceId: "wA" },
        { path: "/r.worktrees/b" },
      ],
    });

    await expect(herdrMultiplexer.findSpaces("/r")).resolves.toEqual(
      new Map([["/r.worktrees/a", "wA"]]),
    );
    expect(mockList).toHaveBeenCalledWith({ gitRootPath: "/r" });
  });

  it("keeps every opened worktree when Herdr reports no source space", async () => {
    mockList.mockResolvedValue({
      worktrees: [{ path: "/r.worktrees/a", workspaceId: "wA" }],
    });

    await expect(herdrMultiplexer.findSpaces("/r")).resolves.toEqual(
      new Map([["/r.worktrees/a", "wA"]]),
    );
  });
});
