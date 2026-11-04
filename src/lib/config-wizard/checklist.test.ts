import { CONFIG_NAMES, UNPROMPTED_CONFIG_NAMES } from "../constants.js";
import type { ConfigName } from "../types.js";
import {
  CHECKLIST_ITEMS,
  listChecklistItems,
  preTickedIds,
} from "./checklist.js";

// Every key a bare run can be asked: CONFIG_NAMES minus the keys the wizard
// never asks and the internal marker.
const ALL_PROMPTED: readonly ConfigName[] = CONFIG_NAMES.filter(
  (name) =>
    name !== "has-called-config" &&
    !(UNPROMPTED_CONFIG_NAMES as readonly string[]).includes(name),
);

describe("the setup checklist", () => {
  // Order and membership: plan D2 (#236), "GitHub, Jira, Linear, ClickUp, How
  // worktrees open, Coding agent for `--agent`, Branch prefixes, Command to
  // run after creating a worktree".
  it("lists the eight items in D2's order when every key is still to ask", () => {
    expect(listChecklistItems(ALL_PROMPTED).map((item) => item.id)).toEqual([
      "github",
      "jira",
      "linear",
      "clickup",
      "opening",
      "agent",
      "branchPrefixes",
      "postCreate",
    ]);
  });

  it("lists nothing when no key is left to ask", () => {
    expect(listChecklistItems([])).toEqual([]);
  });

  it("lists only the items that have a key left, keeping the order", () => {
    expect(
      listChecklistItems([
        "postCreate",
        "linear.apiKey",
        "branchPrefix.chore",
      ]).map((item) => item.id),
    ).toEqual(["linear", "branchPrefixes", "postCreate"]);
  });

  it("does not list defaultSourceBranch, which is always asked on its own", () => {
    expect(listChecklistItems(["defaultSourceBranch"])).toEqual([]);
  });

  it("covers every key the wizard can ask except defaultSourceBranch", () => {
    const covered = CHECKLIST_ITEMS.flatMap((item) => item.keys);
    expect(
      ALL_PROMPTED.filter((name) => name !== "defaultSourceBranch").sort(),
    ).toEqual([...covered].sort());
  });

  it("gives every item a label that names no config key", () => {
    for (const item of CHECKLIST_ITEMS) {
      for (const name of CONFIG_NAMES) {
        expect(item.label).not.toContain(name);
      }
    }
  });
});

describe("what is pre-ticked", () => {
  const reader =
    (stored: Partial<Record<ConfigName, string>>) => async (name: ConfigName) =>
      stored[name] ?? "";

  it("ticks nothing on a clean config", async () => {
    expect([...(await preTickedIds(CHECKLIST_ITEMS, reader({})))]).toEqual([]);
  });

  it("ticks an item once any of its keys holds a value", async () => {
    const ticked = await preTickedIds(
      CHECKLIST_ITEMS,
      reader({
        "jira.host": "https://x.atlassian.net",
        "branchPrefix.bugfix": "fix/",
        postCreate: "pnpm install",
      }),
    );
    expect([...ticked].sort()).toEqual([
      "branchPrefixes",
      "jira",
      "postCreate",
    ]);
  });

  // D2 and §9 Q3: GitHub's token is optional (`gh auth token` supplies one),
  // so only `github.token` or `github.autoAssign` counts.
  it("ticks GitHub for a token or for autoAssign", async () => {
    expect([
      ...(await preTickedIds(CHECKLIST_ITEMS, reader({ "github.token": "t" }))),
    ]).toEqual(["github"]);
    expect([
      ...(await preTickedIds(
        CHECKLIST_ITEMS,
        reader({ "github.autoAssign": "false" }),
      )),
    ]).toEqual(["github"]);
  });

  it("does not tick GitHub for keys it never asks", async () => {
    expect([
      ...(await preTickedIds(
        CHECKLIST_ITEMS,
        reader({ "github.repository": "a/b", "github.host": "ghe.example" }),
      )),
    ]).toEqual([]);
  });
});
