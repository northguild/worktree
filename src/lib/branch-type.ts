import {
  type BranchKind,
  type BranchTypeRule,
  ProjectConfigError,
  showVisibly,
} from "./project-config.js";

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

/**
 * Two fields answer to one display name; the rule must use an id (D11). A
 * problem in the file like any other, so it exits 2 with `invalid_value`.
 */
export class AmbiguousFieldError extends ProjectConfigError {
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
      `${where} names the field "${showVisibly(key)}", which is the display name of ${showVisibly(ids)}. Name the field by its id instead.`,
    );
  }
  return byName[0];
}

/**
 * First matching rule wins. A rule with a `when` matches when every field in
 * it matches; a list of values matches when any one does. `otherwise` matches
 * whatever is left. No match and no `otherwise` is no kind, so no prefix.
 * `listName` (such as `jira.branchType`) only words the warnings. `shared`
 * marks the top-level list (D5): written for several providers, so a field
 * this issue lacks is not worth a warning there. The ambiguity error stays.
 */
export function evaluateBranchTypeRules(
  rules: readonly BranchTypeRule[],
  fields: IssueField[],
  listName = "branchType",
  { shared = false }: { shared?: boolean } = {},
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
        if (!shared) {
          warnings.push(
            `${where} names the field "${showVisibly(key)}", which this issue does not have, so the rule did not match. Check the spelling, or use the field's id.`,
          );
        }
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

// ---------------------------------------------------------------------------
// What a dry run shows (D13)
// ---------------------------------------------------------------------------

/**
 * Why a name got the prefix it did: a rule of the project file, the built-in
 * mapping (no rules for the provider), or nothing (rules, none matched).
 */
export type BranchMatch =
  | { source: "rule"; position: number; rule: BranchTypeRule }
  | { source: "built-in" }
  | { source: "none" };

/** A branch name with everything that decided it, for `branch --dry-run`. */
export interface BranchNaming {
  branchName: string;
  kind: BranchKind | undefined;
  fields: IssueField[];
  match: BranchMatch;
}

export function matchOfResult(result: BranchTypeResult): BranchMatch {
  return result.rule && result.position !== undefined
    ? { source: "rule", position: result.position, rule: result.rule }
    : { source: "none" };
}

// A bare word is written bare, as in the #181 example (`Type: Bug`); anything
// YAML could read as another type or as structure is double-quoted. JSON
// string syntax is valid YAML, so JSON.stringify does the quoting.
const YAML_RESERVED_WORDS = new Set([
  "true",
  "false",
  "null",
  "yes",
  "no",
  "on",
  "off",
  "y",
  "n",
]);

function yamlScalar(text: string) {
  return /^[A-Za-z][\w.-]*$/.test(text) &&
    !YAML_RESERVED_WORDS.has(text.toLowerCase())
    ? text
    : JSON.stringify(text);
}

function formatWhenValue(value: WhenValue): string {
  return typeof value === "object"
    ? `{ id: ${JSON.stringify(String(value.id))} }`
    : yamlScalar(String(value));
}

/** A rule as the file writes it, for naming the one that matched. */
export function formatBranchTypeRule(rule: BranchTypeRule) {
  if ("otherwise" in rule) {
    return `otherwise: ${rule.otherwise}`;
  }
  const conditions = Object.entries(rule.when).map(([key, wanted]) => {
    const text = Array.isArray(wanted)
      ? `[${wanted.map(formatWhenValue).join(", ")}]`
      : formatWhenValue(wanted);
    return `${yamlScalar(key)}: ${text}`;
  });
  return `when: { ${conditions.join(", ")} }, type: ${rule.type}`;
}

/**
 * `Type` and `Labels` mean the same on every provider, so a shared `branchType`
 * rule may name them. Any other field is one provider's own. Case does not
 * count: an English Jira's only labels field has the id `labels`, and a rule
 * naming it finds every other provider's `Labels` by name (`findField`).
 */
export function isPortableField(field: IssueField) {
  return sameName(field.id, "Type") || sameName(field.id, "Labels");
}

/**
 * One line to paste into a `branchType` list: the value by id when it has one
 * (ids survive a renamed option and another language), by name when it does
 * not, with the names as a comment. For the shared list (`shared`), the
 * portable `Type` and `Labels` fields use the name too, because an id belongs
 * to one provider and fails silently on the others.
 */
export function pasteReadyLine(
  field: IssueField,
  value: FieldValue,
  shared = false,
) {
  const byName = shared && value.name !== undefined && isPortableField(field);
  const wanted =
    value.id !== undefined && !byName
      ? formatWhenValue({ id: value.id })
      : yamlScalar(value.name ?? "");
  const label = value.name ?? value.id ?? "";
  return `- when: { ${yamlScalar(field.id)}: ${wanted} }   # ${field.name} = ${label}`;
}
