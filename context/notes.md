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
