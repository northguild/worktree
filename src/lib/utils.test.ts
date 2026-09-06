import type { WorktreeAgent, WorktreeListEntry } from "./types.js";
import { conjoin, worktreeListEntryToListName } from "./utils.js";

describe("conjoin", () => {
  it.each`
    input                              | conjunction  | expected
    ${[]}                              | ${undefined} | ${""}
    ${["apple"]}                       | ${undefined} | ${"apple"}
    ${[42]}                            | ${undefined} | ${"42"}
    ${["apple", "banana"]}             | ${undefined} | ${"apple and banana"}
    ${[1, 2]}                          | ${undefined} | ${"1 and 2"}
    ${["apple", "banana"]}             | ${"or"}      | ${"apple or banana"}
    ${[1, 2]}                          | ${"or"}      | ${"1 or 2"}
    ${["apple", "banana", "cherry"]}   | ${undefined} | ${"apple, banana and cherry"}
    ${[1, 2, 3, 4]}                    | ${undefined} | ${"1, 2, 3 and 4"}
    ${["apple", "banana", "cherry"]}   | ${"or"}      | ${"apple, banana or cherry"}
    ${[1, 2, 3, 4, 5]}                 | ${"or"}      | ${"1, 2, 3, 4 or 5"}
    ${["item1", 2, "item3"]}           | ${undefined} | ${"item1, 2 and item3"}
    ${[100, "apples", 200, "oranges"]} | ${"or"}      | ${"100, apples, 200 or oranges"}
  `(
    'should return "$expected" for input $input with conjunction "$conjunction"',
    ({ input, conjunction, expected }) => {
      const result = conjunction ? conjoin(input, conjunction) : conjoin(input);

      expect(result).toBe(expected);
    },
  );
});

describe("worktreeListEntryToListName", () => {
  it("should include branch name", () => {
    const result = worktreeListEntryToListName({
      path: "/path/to/worktree",
      branchName: "feature/test",
      remote: "origin/feature/test",
      pathExists: true,
      remoteExists: true,
    });

    expect(result).toContain("feature/test");
  });

  it("should show path does not exist", () => {
    const result = worktreeListEntryToListName({
      path: "/path/to/worktree",
      branchName: "feature/test",
      remote: "origin/feature/test",
      pathExists: false,
    });

    expect(result).toContain("Path does not exist");
  });

  it("should show remote branch does not exist when remote exists but is not found", () => {
    const result = worktreeListEntryToListName({
      path: "/path/to/worktree",
      branchName: "feature/test",
      remote: "origin/feature/test",
      remoteExists: false,
    });

    expect(result).toContain("Remote removed");
  });

  it("should not show remote branch error when remote is empty", () => {
    const result = worktreeListEntryToListName({
      path: "/path/to/worktree",
      branchName: "feature/test",
      remote: "",
      remoteExists: false,
    });

    expect(result).not.toContain("Remote branch");
  });

  it("should show ahead and behind counts", () => {
    const result = worktreeListEntryToListName({
      path: "/path/to/worktree",
      branchName: "feature/test",
      remote: "origin/feature/test",
      pathExists: true,
      remoteExists: true,
      ahead: 3,
      behind: 2,
    });

    expect(result).toContain("Ahead: 3, Behind: 2");
  });

  it("should show ahead count with default behind value", () => {
    const result = worktreeListEntryToListName({
      path: "/path/to/worktree",
      branchName: "feature/test",
      remote: "origin/feature/test",
      pathExists: true,
      remoteExists: true,
      ahead: 5,
    });

    expect(result).toContain("Ahead: 5, Behind: 0");
  });

  it("should show behind count with default ahead value", () => {
    const result = worktreeListEntryToListName({
      path: "/path/to/worktree",
      branchName: "feature/test",
      remote: "origin/feature/test",
      pathExists: true,
      remoteExists: true,
      behind: 4,
    });

    expect(result).toContain("Ahead: 0, Behind: 4");
  });

  it("should show uncommitted changes count", () => {
    const result = worktreeListEntryToListName({
      path: "/path/to/worktree",
      branchName: "feature/test",
      remote: "origin/feature/test",
      pathExists: true,
      remoteExists: true,
      uncommittedChanges: 7,
    });

    expect(result).toContain("7 uncommitted changes");
  });

  it("should combine multiple issues", () => {
    const result = worktreeListEntryToListName({
      path: "/path/to/worktree",
      branchName: "feature/test",
      remote: "origin/feature/test",
      pathExists: false,
      remoteExists: false,
      ahead: 2,
      behind: 1,
      uncommittedChanges: 1,
    });

    expect(result).toContain("Path does not exist");
    expect(result).toContain("Remote removed");
    expect(result).toContain("Ahead: 2, Behind: 1");
    expect(result).not.toContain("uncommitted changes"); // Should not be plural
    expect(result).toContain("1 uncommitted change");
  });

  it("should handle zero ahead/behind counts", () => {
    const result = worktreeListEntryToListName({
      path: "/path/to/worktree",
      branchName: "main",
      remote: "origin/main",
      pathExists: true,
      remoteExists: true,
      ahead: 0,
      behind: 0,
    });

    expect(result).not.toContain("Ahead:");
    expect(result).not.toContain("Behind:");
  });

  it("should handle zero uncommitted changes", () => {
    const result = worktreeListEntryToListName({
      path: "/path/to/worktree",
      branchName: "main",
      remote: "origin/main",
      pathExists: true,
      remoteExists: true,
      uncommittedChanges: 0,
    });

    // Zero value is falsy, so uncommitted changes won't be shown
    expect(result).not.toContain("uncommitted changes");
    expect(result).not.toContain("Behind:");
  });

  it("should handle zero uncommitted changes", () => {
    const result = worktreeListEntryToListName({
      path: "/path/to/worktree",
      branchName: "main",
      remote: "origin/main",
      pathExists: true,
      remoteExists: true,
      uncommittedChanges: 0,
    });

    // Zero value is falsy, so uncommitted changes won't be shown
    expect(result).not.toContain("uncommitted changes");
  });

  it("should not show ahead/behind when neither are set", () => {
    const result = worktreeListEntryToListName({
      path: "/path/to/worktree",
      branchName: "main",
      remote: "origin/main",
      pathExists: true,
      remoteExists: true,
    });

    expect(result).not.toContain("Ahead:");
    expect(result).not.toContain("Behind:");
  });

  it("should not show uncommitted changes when not set", () => {
    const result = worktreeListEntryToListName({
      path: "/path/to/worktree",
      branchName: "main",
      remote: "origin/main",
      pathExists: true,
      remoteExists: true,
    });

    expect(result).not.toContain("uncommitted changes");
  });
});

describe("worktreeListEntryToListName agent details", () => {
  function entry(agent?: WorktreeAgent): WorktreeListEntry {
    return {
      path: "/path/to/worktree",
      branchName: "feature/test",
      remote: "origin/feature/test",
      pathExists: true,
      remoteExists: true,
      agent,
    };
  }

  it("shows the agent name for a background session that is working", () => {
    const result = worktreeListEntryToListName(
      entry({ name: "feature-test-1f", pid: 9187 }),
      "gray",
      { agents: true },
    );

    expect(result).toContain("Agent: feature-test-1f");
    expect(result).not.toContain("[interactive]");
    expect(result).not.toContain("[waiting]");
  });

  it("marks an interactive session so a human's own terminal is distinguishable", () => {
    const result = worktreeListEntryToListName(
      entry({ name: "notes-1f", pid: 4021, interactive: true }),
      "gray",
      { agents: true },
    );

    expect(result).toContain("Agent: notes-1f [interactive]");
  });

  it("marks a waiting session distinguishably from one that is working", () => {
    const working = worktreeListEntryToListName(
      entry({ name: "feature-test-1f", pid: 9187, waiting: false }),
      "gray",
      { agents: true },
    );
    const waiting = worktreeListEntryToListName(
      entry({ name: "feature-test-1f", pid: 9187, waiting: true }),
      "gray",
      { agents: true },
    );

    expect(waiting).toContain("Agent: feature-test-1f [waiting]");
    expect(waiting).not.toBe(working);
  });

  // The guard for D8: cleanup shares this renderer and asks for no agents, so
  // its output must not change even once cleanup starts populating the field.
  it("renders nothing about an agent when the caller did not ask", () => {
    const agent: WorktreeAgent = {
      name: "feature-test-1f",
      pid: 9187,
      interactive: true,
    };

    expect(worktreeListEntryToListName(entry(agent), "yellow")).toBe(
      worktreeListEntryToListName(entry(), "yellow"),
    );
    expect(worktreeListEntryToListName(entry(agent), "yellow")).not.toContain(
      "Agent:",
    );
  });

  it("renders nothing about an agent when the entry carries none", () => {
    const result = worktreeListEntryToListName(entry(), "gray", {
      agents: true,
    });

    expect(result).not.toContain("Agent:");
    expect(result).toBe("feature/test");
  });

  it("appends the agent after the existing details rather than replacing them", () => {
    const result = worktreeListEntryToListName(
      {
        ...entry({ name: "feature-test-1f", pid: 9187 }),
        ahead: 2,
        behind: 1,
        uncommittedChanges: 3,
      },
      "gray",
      { agents: true },
    );

    expect(result).toBe(
      "feature/test (Ahead: 2, Behind: 1, 3 uncommitted changes, Agent: feature-test-1f)",
    );
  });
});
