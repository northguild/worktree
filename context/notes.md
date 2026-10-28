# Notes — #181 project config

Non-blocking Gate 2 observations, branch-local. Read by no command; `/feature-close` deletes this file.

## From Phase 1

- **Defect, branch-local:** a section with a null value (`jira:` whose only child is commented out, or a bare
  `copy:`) is refused as `expected object, received null`. Treating null as absent matters before Phase 8's
  D20 `--project` writer emits commented files.
- **Defect, branch-local:** a blob over `runCapturing`'s `maxBuffer` makes `gitReadBlobAtRef` pass through the
  raw buffer error rather than naming `.worktree.yml` (§5 risk).
- Phases 7 and 8 must add the D22 internal keys outside `CONFIG_NAMES`, with a test that they are not in it.
  Phase 1 left `src/lib/constants.ts` untouched because nothing read them yet.
- `PERSONAL_KEYS` and `TEAM_SECTIONS` in `project-config.ts` are hand-kept copies of `CONFIG_NAMES`'
  classification; no test pins that every `CONFIG_NAMES` key has a D3 class, so a new personal key would warn
  as "unknown".
- `clickup.workspaceId` is typed `string | number`; Phase 2 has to normalise it before comparing with the git
  config string (or a `.transform(String)` in the schema settles it).
- The `copy` and `branchName` rules are `.refine`s, so `v1.json` carries no `pattern` for them and editors do
  not flag them; `z.string().regex(...)` would. "`otherwise` only last" cannot be expressed in JSON Schema.
- No hint when the ref has no `.worktree.yml` but the worktree has an uncommitted one — worth a sentence on
  the Phase 2 docs page.
- On a found file the loader makes three git calls (symbolic-ref, show, rev-parse --show-toplevel); §8's
  hot-path row says two. Phase 2 reconciles.
- The drift test regenerates the committed schema when `UPDATE_PROJECT_SCHEMA` is set, so a run with it set
  passes unconditionally; CI must never set it.
- One test asserts `line [23]` (a range); pin it to one number. `$id` is never asserted against the literal
  published URL independently of the code.
- `yaml` and `zod` are pinned exactly while the other runtime dependencies use carets, which stops consumers
  deduplicating.

## From Phase 2

- The early `gitFetch()` in `branch` has no spinner (one broke agent-mode's one-stderr-line test), so an
  interactive slow fetch shows nothing. A spinner gated on `isProgressEnabled()`, as `git.ts` does elsewhere,
  would add feedback without stderr lines.
- The early fetch is `git fetch --prune` on runs without `--source`, and the taken-branch refuse/reopen path
  now fetches where it did not (D7 allows it; up to 60 s).
- A personal empty prefix cannot override a file prefix (`gitGetConfigValue` returns `""` for unset and
  empty), and the project-configuration page does not say so.
- `configuration/page.mdx`'s *Recommended Team Baseline* says labels and tags "stay personal"; they are
  built-in mappings the file takes over in Phase 4. Fix when Phase 4 lands.
- Getting-started sends readers to the `worktree config` wizard, which still asks for keys the file sets and
  so writes personal overrides until Phase 8 (D19).
- The page does not say a file's `defaultSourceBranch` never sets the unpushed-work base for `list`,
  `cleanup` and `remove` (§4 *Not affected*).
- §5 says a broken file's error names `WORKTREE_PROJECT_CONFIG` as the escape; the Phase 1 loader's error
  does not.
- No test pins git config beating the file for `clickup.workspaceId` when both are set; the
  "never reads a file's defaultSourceBranch" test cannot tell its two sources apart (both `origin/main`).
- `guides/jira-integration/page.mdx` item 1 says `jira.host` is used "with no prompt"; that holds for a file host
  only — with neither source set, `branch --jira` still offers `worktree config` (item 2). Reword to "a host
  from the file is used with no prompt".

## From Phase 3

- **Defect, branch-local:** `AmbiguousFieldError` extends `Error`, so a duplicate display name in a rule exits
  `1` / `failed` through `branch`, where D4 maps a malformed rule to `2` / `invalid_value`; its message names
  `jira.branchType` but not `.worktree.yml`. No test pins the exit through `branch`.
- `jira.branchType: []` counts as "rules set" and gives every Jira issue no prefix; the plan is silent
  (D15 treats an empty `postCreate` as unset).
- Cascading-select `child` and the user `accountId`/`displayName` normalisation in `getJiraIssueFields` have no
  test. Fixture shapes were checked against Jira Cloud's v3 OpenAPI spec (`IssueTypeDetails`, `UserDetails`,
  `ProjectComponent`, `IssueBean.names`); multi-select arrays and cascading `child` are not in the spec — the §9
  recorded-response gap. The fixture comment still says "from memory".
- A field absent from `names` takes its id as its name, so a case-variant id matches case-insensitively.
- `jira-integration/page.mdx` lines on "issue type" decide the prefix are qualified, not quite true with rules;
  the `normalizeJiraFieldValue` comment says dates normalise to nothing (they are strings); the page's "Find an
  id" covers field ids only, not option or issue-type ids (Phase 5's `--dry-run` may cover it).
- `jira.ts` uses `raw as Record<string, unknown>` after narrowing third-party data.

## From Phase 4

- `branchName: ""` passes the schema (only braces are checked) and renders an empty name, refused as
  `missing_value` rather than `invalid_value`; a `.min(1)` would say what is wrong.
- `linear.ts` casts label nodes to `{ id; name }[]` even when ids were not asked for; only `name` is read on
  that path, but narrowing is preferred over the assertion.
- The project-configuration page's "Ids or names" is written for Jira only; it does not say where to find a
  GitHub or Linear label id.
- Rule warnings print while a spinner is running in `branch`, which can garble the spinner line on a terminal
  (same as Phase 3's Jira path).
- GitHub guide steps 1 and 4 ("Read issue number and title", "based on issue type") leave out labels, which
  are now read and can decide the prefix under rules; the *Prefix mapping* paragraph covers it.

## From Phase 5

- **Defect, branch-local:** a dry run does not pass the derived name through `isValidBranchName`, so a
  `branchName` template that renders an invalid name prints as `Branch name: …` on a dry run while a real run
  refuses it.
- The branch page's Jira dry-run example shows two fields; a real issue lists every non-empty one (summary,
  status, priority, …), and the JSON example lists one. Mark both as shortened or make them agree.
- `branch.ts`'s dry-run help paragraph has an 80-column line that leaves "issue" alone on its own line in
  `--help`.
- `getGitHubIssueFields` guards `issue.labels ?? []` though the type declares it required and the parser
  normalises it; only older `as any` fixtures in `branch.test.ts` omit it. Fix the fixtures, or compute fields
  only with rules or a dry run.
- The `branch.ts` comment "`log` is silent under --json" is wrong (it goes to stderr); behaviour is right.
- `getGitHubBranchNameFromIssue`, `getLinearBranchNameFromIssue` and `getClickUpBranchNameFromTask` now have
  no production caller; Jira's two-path call in `branch.ts` could be one call with `{ onWarning, dryRun }`.
- Not pinned: the `--dry-run` usage error's exit 2 / `invalid_value`, and no `git config` write in a
  non-interactive dry run. Phases 7 and 8 should pin that a dry run runs no approval and no nudge.
- `BranchDryRunMatch`'s kind spells out `"feature" | "bugfix" | "chore"` instead of reusing `BranchKind`.
- The human rule-text format is the coder's own, pinned to the formatter.
