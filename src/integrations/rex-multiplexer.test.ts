import * as git from "../lib/git.js";
import * as rex from "./rex.js";
import { rexMultiplexer } from "./rex-multiplexer.js";

vi.mock("./rex.js");
vi.mock("../lib/git.js");

const mockFind = vi.mocked(rex.findRexSessions);
const mockWorktrees = vi.mocked(git.gitGetWorktrees);

function worktree(path: string, isCurrent = false) {
  return { path, branchName: "b", pathExists: true, isCurrent };
}

describe("rexMultiplexer", () => {
  // Cleared before as well as after, so a REX_SESSION in the environment the
  // suite runs in cannot leak into the tests that expect none.
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.REX_SESSION;
  });
  afterEach(() => {
    delete process.env.REX_SESSION;
  });

  it("is named for the spinner text", () => {
    expect(rexMultiplexer.displayName).toBe("Rex");
    expect(rexMultiplexer.spaceNoun).toBe("session");
  });

  it("is installed when the CLI can be found", async () => {
    vi.mocked(rex.isRexInstalled).mockResolvedValue(false);

    await expect(rexMultiplexer.isInstalled()).resolves.toBe(false);
  });

  it("asks Rex about the worktrees and the main checkout, and returns what it finds", async () => {
    mockWorktrees.mockResolvedValue([worktree("/r.w/a"), worktree("/r.w/b")]);
    mockFind.mockResolvedValue(new Map([["/r.w/a", "session:A"]]));

    await expect(rexMultiplexer.findSpaces("/r")).resolves.toEqual(
      new Map([["/r.w/a", "session:A"]]),
    );
    expect(mockWorktrees).toHaveBeenCalledWith({ includeCurrent: true });
    expect(mockFind).toHaveBeenCalledWith({
      paths: ["/r.w/a", "/r.w/b", "/r"],
      everyShellInside: true,
    });
  });

  // D11: a shell in the main checkout or the current worktree disqualifies a
  // session, which only works if Rex is asked about those roots too.
  it("gives Rex the current worktree as a root, so a shell there disqualifies a session", async () => {
    mockWorktrees.mockResolvedValue([
      worktree("/r.w/a"),
      worktree("/r.w/here", true),
    ]);
    mockFind.mockResolvedValue(new Map());

    await rexMultiplexer.findSpaces("/r");

    expect(mockFind).toHaveBeenCalledWith({
      paths: ["/r.w/a", "/r", "/r.w/here"],
      everyShellInside: true,
    });
  });

  it("drops the main checkout's and the current worktree's own sessions from the answer", async () => {
    mockWorktrees.mockResolvedValue([
      worktree("/r.w/a"),
      worktree("/r.w/here", true),
    ]);
    mockFind.mockResolvedValue(
      new Map([
        ["/r", "session:MAIN"],
        ["/r.w/here", "session:HERE"],
        ["/r.w/a", "session:A"],
      ]),
    );

    await expect(rexMultiplexer.findSpaces("/r")).resolves.toEqual(
      new Map([["/r.w/a", "session:A"]]),
    );
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
