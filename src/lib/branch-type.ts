import type { BranchKind, BranchTypeRule } from "./project-config.js";

export type { BranchKind, BranchTypeRule };

// The pure branch-type rules engine (D8-D11). Each integration turns the issue
// it fetched into `IssueField`s; this file never sees a provider's response,
// and imports neither git nor an integration.

/** One value of a field. A select option has both; a label has only a name. */
export interface FieldValue {
  id?: string;
  name?: string;
}

/**
 * A field of an issue in the shape the rules compare. A list field has one
 * entry per element; an empty field has none and so matches nothing.
 */
export interface IssueField {
  id: string;
  name: string;
  values: FieldValue[];
}

export interface BranchTypeResult {
  kind: BranchKind | undefined;
  /** The rule that decided, or `undefined` when nothing did. */
  rule: BranchTypeRule | undefined;
  /** 1-based, as a person counts the entries of the list. */
  position: number | undefined;
  warnings: string[];
}

/** Two fields answer to one display name; the rule must use an id (D11). */
export class AmbiguousFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmbiguousFieldError";
  }
}

type WhenValue = string | number | { id: string | number };

function sameName(left: string, right: string) {
  return left.toLowerCase() === right.toLowerCase();
}

function valueMatches(want: WhenValue, values: FieldValue[]) {
  if (typeof want === "object") {
    const id = String(want.id);
    return values.some((value) => value.id === id);
  }
  const name = String(want);
  return values.some(
    (value) => value.name !== undefined && sameName(value.name, name),
  );
}

// An id names exactly one field. A name is looked up case-insensitively, and
// two fields sharing it is an error rather than a guess.
function findField(key: string, fields: IssueField[], where: string) {
  const byId = fields.find((field) => field.id === key);
  if (byId) {
    return byId;
  }
  const byName = fields.filter((field) => sameName(field.name, key));
  if (byName.length > 1) {
    const ids = byName.map((field) => field.id).join(" and ");
    throw new AmbiguousFieldError(
      `${where} names the field "${key}", which is the display name of ${ids}. Name the field by its id instead.`,
    );
  }
  return byName[0];
}

/**
 * First matching rule wins. A rule with a `when` matches when every field in
 * it matches; a list of values matches when any one does. `otherwise` matches
 * whatever is left. No match and no `otherwise` is no kind, so no prefix.
 * `listName` (such as `jira.branchType`) only words the warnings.
 */
export function evaluateBranchTypeRules(
  rules: readonly BranchTypeRule[],
  fields: IssueField[],
  listName = "branchType",
): BranchTypeResult {
  const warnings: string[] = [];

  for (const [index, rule] of rules.entries()) {
    const position = index + 1;
    if ("otherwise" in rule) {
      return { kind: rule.otherwise, rule, position, warnings };
    }

    const where = `Rule ${position} of ${listName}`;
    let allMatch = true;
    for (const [key, wanted] of Object.entries(rule.when)) {
      const field = findField(key, fields, where);
      if (!field) {
        warnings.push(
          `${where} names the field "${key}", which this issue does not have, so the rule did not match. Check the spelling, or use the field's id.`,
        );
        allMatch = false;
        continue;
      }
      const options: WhenValue[] = Array.isArray(wanted) ? wanted : [wanted];
      if (!options.some((option) => valueMatches(option, field.values))) {
        allMatch = false;
      }
    }
    if (allMatch) {
      return { kind: rule.type, rule, position, warnings };
    }
  }

  return { kind: undefined, rule: undefined, position: undefined, warnings };
}
