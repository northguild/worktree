/**
 * The removal side of a terminal multiplexer, which is all the closer needs
 * (#270 D1). Opening a worktree and handing it an agent stay per tool, because
 * the tools differ exactly there.
 */
export interface Multiplexer {
  /** What the user sees in spinner text: "Closing <displayName> space <label>". */
  displayName: string;
  /** Whether the tool can be found. A tool that is not installed has nothing to close. */
  isInstalled(): Promise<boolean>;
  /**
   * Maps the absolute path of each worktree that has a space open to that
   * space's id. Worktrees with no space, and the repository's own checkout,
   * are left out: nothing in the map is safe to leave open and none of it is
   * the window the user is sitting in. Rejects when the tool cannot answer.
   */
  findSpaces(gitRootPath: string): Promise<Map<string, string>>;
  /** Closes one space by the id `findSpaces` gave. Rejects when it cannot. */
  closeSpace(spaceId: string): Promise<void>;
}
