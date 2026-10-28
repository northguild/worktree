import {
  type BranchTypeRule,
  evaluateBranchTypeRules,
  type IssueField,
} from "./branch-type.js";

// Expected values come from the plan's D8-D11 and the #181 example file, not
// from the engine: first match wins, `when` fields all match, a list matches
// any, ids exact and names case-insensitive, `otherwise` closes the list, and
// no match with no `otherwise` is no kind (no prefix).

const workCategory: IssueField = {
  id: "customfield_10359",
  name: "Work Category",
  values: [{ id: "10301", name: "Maintenance" }],
};
const issueType: IssueField = {
  id: "issuetype",
  name: "Issue Type",
  values: [{ id: "10008", name: "Bug" }],
};
const labels: IssueField = {
  id: "labels",
  name: "Labels",
  values: [{ name: "backend" }, { name: "Chore" }],
};

function when(
  conditions: Record<string, unknown>,
  type: "feature" | "bugfix" | "chore",
) {
  return { when: conditions, type } as BranchTypeRule;
}

describe("evaluateBranchTypeRules", () => {
  it("returns the kind of the first rule that matches, with its position", () => {
    const rules = [
      when({ "Issue Type": "Story" }, "feature"),
      when({ "Issue Type": "Bug" }, "bugfix"),
      when({ "Work Category": "Maintenance" }, "chore"),
    ];

    const result = evaluateBranchTypeRules(rules, [workCategory, issueType]);

    expect(result.kind).toBe("bugfix");
    expect(result.position).toBe(2);
    expect(result.rule).toBe(rules[1]);
    expect(result.warnings).toEqual([]);
  });

  it("needs every field of a when to match", () => {
    const rules = [
      when({ "Issue Type": "Bug", "Work Category": "Bug" }, "bugfix"),
      when({ "Issue Type": "Bug", "Work Category": "Maintenance" }, "chore"),
    ];

    expect(evaluateBranchTypeRules(rules, [workCategory, issueType]).kind).toBe(
      "chore",
    );
  });

  it("matches a list of values when any of them matches", () => {
    const rules = [when({ Priority: ["High", "Highest"] }, "bugfix")];
    const priority: IssueField = {
      id: "priority",
      name: "Priority",
      values: [{ id: "2", name: "Highest" }],
    };

    expect(evaluateBranchTypeRules(rules, [priority]).kind).toBe("bugfix");
  });

  it("matches a list field on any of its elements", () => {
    const rules = [when({ Labels: "chore" }, "chore")];

    expect(evaluateBranchTypeRules(rules, [labels]).kind).toBe("chore");
  });

  it("names a field by id or by name, and a value by name or by id", () => {
    const byId = [when({ customfield_10359: { id: "10301" } }, "chore")];
    const byName = [when({ "Work Category": "Maintenance" }, "chore")];

    expect(evaluateBranchTypeRules(byId, [workCategory]).kind).toBe("chore");
    expect(evaluateBranchTypeRules(byName, [workCategory]).kind).toBe("chore");
  });

  it("compares ids exactly, so an id differing only in case does not match", () => {
    const rules = [when({ CustomField_10359: "Maintenance" }, "chore")];

    // Not an id match; as a name it is not "Work Category" either.
    const result = evaluateBranchTypeRules(rules, [workCategory]);

    expect(result.kind).toBeUndefined();
  });

  it("compares names case-insensitively", () => {
    const rules = [when({ "work category": "MAINTENANCE" }, "chore")];

    expect(evaluateBranchTypeRules(rules, [workCategory]).kind).toBe("chore");
  });

  it("does not take a plain value for an id", () => {
    const rules = [when({ "Work Category": "10301" }, "chore")];

    expect(evaluateBranchTypeRules(rules, [workCategory]).kind).toBeUndefined();
  });

  it("accepts an unquoted YAML number as an id", () => {
    const rules = [when({ customfield_10359: { id: 10301 } }, "chore")];

    expect(evaluateBranchTypeRules(rules, [workCategory]).kind).toBe("chore");
  });

  it("uses otherwise when no rule matched", () => {
    const rules = [
      when({ "Issue Type": "Story" }, "bugfix"),
      { otherwise: "feature" },
    ] as BranchTypeRule[];

    const result = evaluateBranchTypeRules(rules, [issueType]);

    expect(result.kind).toBe("feature");
    expect(result.position).toBe(2);
  });

  it("gives no kind when nothing matched and there is no otherwise", () => {
    const rules = [when({ "Issue Type": "Story" }, "bugfix")];

    const result = evaluateBranchTypeRules(rules, [issueType]);

    expect(result.kind).toBeUndefined();
    expect(result.rule).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it("treats an empty field as matching nothing, without a warning", () => {
    const emptyCategory: IssueField = { ...workCategory, values: [] };
    const rules = [when({ "Work Category": "Maintenance" }, "chore")];

    const result = evaluateBranchTypeRules(rules, [emptyCategory]);

    expect(result.kind).toBeUndefined();
    expect(result.warnings).toEqual([]);
  });

  it("warns, naming the field and the rule's position, when the issue lacks a field, and the rule does not match", () => {
    const rules = [
      when({ "Issue Type": "Story" }, "feature"),
      when({ "Work Categroy": "Maintenance" }, "chore"),
      { otherwise: "bugfix" },
    ] as BranchTypeRule[];

    const result = evaluateBranchTypeRules(
      rules,
      [issueType],
      "jira.branchType",
    );

    expect(result.kind).toBe("bugfix");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("jira.branchType");
    expect(result.warnings[0]).toContain("Rule 2");
    expect(result.warnings[0]).toContain('"Work Categroy"');
  });

  it("does not evaluate, and so does not warn about, rules after the first match", () => {
    const rules = [
      when({ "Issue Type": "Bug" }, "bugfix"),
      when({ Nonexistent: "x" }, "chore"),
    ];

    expect(evaluateBranchTypeRules(rules, [issueType]).warnings).toEqual([]);
  });

  it("fails naming both ids when a display name belongs to two fields", () => {
    const twin: IssueField = {
      id: "customfield_20000",
      name: "Work Category",
      values: [{ id: "1", name: "Maintenance" }],
    };
    const rules = [when({ "Work Category": "Maintenance" }, "chore")];

    expect(() => evaluateBranchTypeRules(rules, [workCategory, twin])).toThrow(
      /customfield_10359.*customfield_20000|customfield_20000.*customfield_10359/,
    );
  });

  it("lets an id name a field even when another field shares its display name", () => {
    const twin: IssueField = {
      id: "customfield_20000",
      name: "Work Category",
      values: [{ id: "1", name: "Bug" }],
    };
    const rules = [when({ customfield_20000: "Bug" }, "bugfix")];

    expect(evaluateBranchTypeRules(rules, [workCategory, twin]).kind).toBe(
      "bugfix",
    );
  });
});
