import {
  AmbiguousFieldError,
  type BranchTypeRule,
  evaluateBranchTypeRules,
  formatBranchTypeRule,
  type IssueField,
  pasteReadyLine,
} from "./branch-type.js";
import { InvalidValueError } from "./prompt.js";

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

  it("reports an ambiguous name as a bad file: exit 2, invalid_value", () => {
    const twin: IssueField = {
      id: "customfield_20000",
      name: "Work Category",
      values: [{ id: "1", name: "Maintenance" }],
    };
    const rules = [when({ "Work Category": "Maintenance" }, "chore")];

    const error = (() => {
      try {
        evaluateBranchTypeRules(rules, [workCategory, twin]);
      } catch (caught) {
        return caught;
      }
    })();

    expect(error).toBeInstanceOf(AmbiguousFieldError);
    expect(error).toBeInstanceOf(InvalidValueError);
    expect((error as InvalidValueError).oclif.exit).toBe(2);
    expect((error as InvalidValueError).code).toBe("invalid_value");
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

// Phase 5 (#181): the paste-ready lines of `branch --dry-run`. The form is the
// plan's Done-when line and the #181 example file, character for character:
// `- when: { <fieldId>: { id: "<optionId>" } }   # <Field name> = <Option name>`.
describe("pasteReadyLine", () => {
  it("writes a select option by id with the names as the comment", () => {
    expect(
      pasteReadyLine(workCategory, { id: "10301", name: "Maintenance" }),
    ).toBe(
      '- when: { customfield_10359: { id: "10301" } }   # Work Category = Maintenance',
    );
  });

  it("writes an issue type by id", () => {
    expect(pasteReadyLine(issueType, { id: "10008", name: "Bug" })).toBe(
      '- when: { issuetype: { id: "10008" } }   # Issue Type = Bug',
    );
  });

  it("writes a value with no id by name, as the example's `Type: Bug`", () => {
    const type: IssueField = { id: "Type", name: "Type", values: [] };
    expect(pasteReadyLine(type, { name: "Bug" })).toBe(
      "- when: { Type: Bug }   # Type = Bug",
    );
  });

  it("quotes a name YAML would read as something else", () => {
    // YAML 1.2 core schema: `yes`-like words stay strings, but a name with a
    // colon-space, a leading digit-only form or an apostrophe must be quoted.
    expect(pasteReadyLine(labels, { name: "needs: review" })).toBe(
      '- when: { labels: "needs: review" }   # Labels = needs: review',
    );
    expect(pasteReadyLine(labels, { name: "true" })).toBe(
      '- when: { labels: "true" }   # Labels = true',
    );
    expect(pasteReadyLine(labels, { name: "10301" })).toBe(
      '- when: { labels: "10301" }   # Labels = 10301',
    );
  });

  it("falls back to the id as the comment when the value has no name", () => {
    expect(pasteReadyLine(workCategory, { id: "7" })).toBe(
      '- when: { customfield_10359: { id: "7" } }   # Work Category = 7',
    );
  });
});

describe("formatBranchTypeRule", () => {
  it("shows a conditional rule as the file writes it", () => {
    expect(
      formatBranchTypeRule(
        when({ customfield_10359: { id: "10301" } }, "chore"),
      ),
    ).toBe('when: { customfield_10359: { id: "10301" } }, type: chore');
  });

  it("shows a list of values and several fields", () => {
    expect(
      formatBranchTypeRule(
        when({ Labels: ["chore", "maintenance"], Type: "Bug" }, "bugfix"),
      ),
    ).toBe("when: { Labels: [chore, maintenance], Type: Bug }, type: bugfix");
  });

  it("shows an otherwise rule", () => {
    expect(formatBranchTypeRule({ otherwise: "feature" })).toBe(
      "otherwise: feature",
    );
  });
});

// Phase 7 gate 2, B3: a `when` field name comes from the file and reaches a
// warning, so control characters in it are shown as escapes.
describe("rule warnings escape file-derived text", () => {
  it("shows ESC and CR in a field name as escapes", () => {
    const [rule] = [
      { when: { "bad\r\u001b[8m": "x" }, type: "bugfix" },
    ] as BranchTypeRule[];

    const result = evaluateBranchTypeRules(
      [rule as BranchTypeRule],
      [workCategory],
    );

    const text = result.warnings.join(" ");
    expect(text).not.toMatch(/[\p{Cc}\p{Cf}]/u);
    expect(text).toContain("bad\\x0d\\x1b[8m");
  });
});
