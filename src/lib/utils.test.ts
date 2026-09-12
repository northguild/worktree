import type { WorktreeAgent, WorktreeListEntry } from "./types.js";
import {
  conjoin,
  splitCommandValue,
  worktreeListEntryToListName,
} from "./utils.js";

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

  // This used to assert `Ahead: 5, Behind: 0`. That zero was fabricated: the
  // entry carries no `behind` at all, and under D4 an absent one is the normal
  // state for a worktree with no upstream rather than a count of nothing. The
  // detail now names only the counts that were taken.
  it("shows only the ahead count when behind was never counted", () => {
    const result = worktreeListEntryToListName({
      path: "/path/to/worktree",
      branchName: "feature/test",
      remote: "origin/feature/test",
      pathExists: true,
      remoteExists: true,
      ahead: 5,
    });

    expect(result).toContain("Ahead: 5");
    expect(result).not.toContain("Behind");
  });

  // The detail list says what a removal would cost, and for a branch whose every
  // change is already in the base the honest answer is nothing. `Ahead: 7` next
  // to `Remote removed` is exactly how a squash-merged worktree came to look
  // like one carrying work nobody else has.
  it("names the base a merged branch landed in instead of its ahead count", () => {
    const result = worktreeListEntryToListName({
      path: "/path/to/worktree",
      branchName: "feature/test",
      remote: "origin/feature/test",
      pathExists: true,
      remoteExists: false,
      ahead: 7,
      mergedInto: "origin/main",
    });

    expect(result).toContain("Remote removed, Merged into origin/main");
    expect(result).not.toContain("Ahead");
  });

  it("shows only the behind count when ahead is zero", () => {
    const result = worktreeListEntryToListName({
      path: "/path/to/worktree",
      branchName: "feature/test",
      remote: "origin/feature/test",
      pathExists: true,
      remoteExists: true,
      behind: 4,
    });

    expect(result).toContain("Behind: 4");
    expect(result).not.toContain("Ahead");
  });

  // The reason rides the entry, so every command that renders through this
  // function discloses it — `list`, `cleanup` and `remove` alike. Without it a
  // worktree whose ahead count could not be taken is indistinguishable from
  // one that is genuinely empty, which is the disclosure half of the incident.
  it("names why the ahead count is missing when a reason is carried", () => {
    const result = worktreeListEntryToListName({
      path: "/path/to/worktree",
      branchName: "feature/test",
      remote: "",
      pathExists: true,
      remoteExists: false,
      aheadUnknownReason: "origin/gone could not be resolved",
    });

    expect(result).toContain(
      "Unpushed commits unknown: origin/gone could not be resolved",
    );
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

describe("splitCommandValue", () => {
  it.each`
    value                                   | expected
    ${""}                                   | ${[]}
    ${"   "}                                | ${[]}
    ${"code"}                               | ${["code"]}
    ${"  code  "}                           | ${["code"]}
    ${"code -n"}                            | ${["code", "-n"]}
    ${"code\t-n\n-w"}                       | ${["code", "-n", "-w"]}
    ${'open -a "Sublime Text"'}             | ${["open", "-a", "Sublime Text"]}
    ${"open -a 'Sublime Text'"}             | ${["open", "-a", "Sublime Text"]}
    ${'--flag="a b"'}                       | ${["--flag=a b"]}
    ${`code "it's here"`}                   | ${["code", "it's here"]}
    ${"code 'say \"hi\"'"}                  | ${["code", 'say "hi"']}
    ${'code ""'}                            | ${["code", ""]}
    ${'open -a "Sublime Text'}              | ${["open", "-a", "Sublime Text"]}
    ${"herdr worktree open --focus --path"} | ${["herdr", "worktree", "open", "--focus", "--path"]}
  `("splits $value", ({ value, expected }) => {
    expect(splitCommandValue(value)).toEqual(expected);
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
