import * as git from "../lib/git.js";
import * as rex from "./rex.js";
import { rexMultiplexer } from "./rex-multiplexer.js";

vi.mock("./rex.js");
vi.mock("../lib/git.js");

const mockFind = vi.mocked(rex.findRexSessions);
const mockWorktrees = vi.mocked(git.gitGetWorktrees);

function worktree(path: string) {
  return { path, branchName: "b", pathExists: true, isCurrent: false };
}

describe("rexMultiplexer", () => {
  afterEach(() => {
    delete process.env.REX_SESSION;
  });

  it("is named for the spinner text", () => {
    expect(rexMultiplexer.displayName).toBe("Rex");
  });

  it("is installed when the CLI can be found", async () => {
    vi.mocked(rex.isRexInstalled).mockResolvedValue(false);

    await expect(rexMultiplexer.isInstalled()).resolves.toBe(false);
  });

  it("asks Rex about the git worktrees and returns what it finds", async () => {
    mockWorktrees.mockResolvedValue([worktree("/r.w/a"), worktree("/r.w/b")]);
    mockFind.mockResolvedValue(new Map([["/r.w/a", "session:A"]]));

    await expect(rexMultiplexer.findSpaces("/r")).resolves.toEqual(
      new Map([["/r.w/a", "session:A"]]),
    );
    expect(mockFind).toHaveBeenCalledWith({ paths: ["/r.w/a", "/r.w/b"] });
  });

  // D8: the session named by REX_SESSION is the terminal this process runs in.
  it("leaves out the session the CLI itself runs in", async () => {
    process.env.REX_SESSION = "session:OWN";
    mockWorktrees.mockResolvedValue([worktree("/r.w/a"), worktree("/r.w/b")]);
    mockFind.mockResolvedValue(
      new Map([
        ["/r.w/a", "session:OWN"],
        ["/r.w/b", "session:B"],
      ]),
    );

    await expect(rexMultiplexer.findSpaces("/r")).resolves.toEqual(
      new Map([["/r.w/b", "session:B"]]),
    );
  });

  it("keeps every session when REX_SESSION is not set", async () => {
    mockWorktrees.mockResolvedValue([worktree("/r.w/a")]);
    mockFind.mockResolvedValue(new Map([["/r.w/a", "session:A"]]));

    await expect(rexMultiplexer.findSpaces("/r")).resolves.toEqual(
      new Map([["/r.w/a", "session:A"]]),
    );
  });

  it("rejects when Rex cannot answer", async () => {
    mockWorktrees.mockResolvedValue([worktree("/r.w/a")]);
    mockFind.mockRejectedValue(new Error("Rex: down"));

    await expect(rexMultiplexer.findSpaces("/r")).rejects.toThrow("Rex: down");
  });

  it("closes a space with rex kill", async () => {
    await rexMultiplexer.closeSpace("session:A");

    expect(rex.closeRexSession).toHaveBeenCalledWith("session:A");
  });
});
