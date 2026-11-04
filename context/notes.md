# Notes

Branch-local, advisory, read by nothing. `/feature-close` deletes this file.

## Phase 1 — Extract the wizard into section modules (#236)

- `src/lib/config-wizard/context.test.ts` was on the phase's Files line but not added: the move added no behaviour, and the rules in `context.ts` are already pinned at the command level in `config.test.ts`.
- `WizardContext` in `src/lib/config-wizard/context.ts` is an `export type … = {}` where `context/standards/typescript/rules.md` prefers `interface` for object shapes; every other exported shape in `src/lib` is an interface.
- The bare-run group order is not pinned by any test — `config.test.ts` asserts order only between pairs of prompts — so the reviewer's diff against `HEAD`, not the suite, is what established the order for this phase.
- D5's per-key `ask` functions do not exist yet; each key's question is still inline in its group function.

## Phase 2 — One setup checklist replaces the ten gates (#236)

- §8 item 1 was not met as written: two `missing: true` tests in `config.test.ts` ("asks the opener confirm but not the Herdr one when herdr is absent", "asks both confirms when herdr is installed") were rewritten, because they asserted gate messages D6 deletes and a bare `--missing` run now gets the checklist (§4). The reviewer judged the change forced and the rewritten tests no weaker. No `names`, `list` or set-by-name test changed.
- The Linear and ClickUp integration guides described the deleted group question; §7's "checked and not changed" had cleared "the other integration guides". Both were fixed in this phase, outside its Files line.
- `config.test.ts` "lists no item, and shows no checklist, when every key is already answered" returns at "No missing config found." before `runWizard`, so it never reaches the `items.length > 0` guard in `run.ts`; its `bare({ missing: false })` line is dead. That guard is reachable (e.g. `--missing` with only `defaultSourceBranch` unset) and unpinned, and a real checkbox with no choices throws.
- "`gh auth` alone does not pre-tick GitHub" holds only because `run.ts` passes `gitGetConfigValue` to `preTickedIds`; no test fails if a reader that resolves `gh auth token` is passed instead.
- Unchanged `--missing` tests still mock confirms for the deleted gate messages (Linear and ClickUp `--missing` tests), and a `--names codeEditor` test asserts a gate message that no longer exists is not asked — vacuous now, kept untouched under D9.
- The checklist message's "(space to tick or untick, enter to continue)" repeats `@inquirer/checkbox`'s own help line.
- `config.test.ts:29` says the tick-all default "is the old 'answer every group yes' behaviour"; the old `confirm` mock had no default answer.
- `trackers.ts` still has a comment saying "in the shape the Jira and Herdr groups use"; Herdr is no longer a group.
- The `--yes` bullet in `commands/config/page.mdx` says a run without `--names` fails; a `--missing --yes` run that lists no item succeeds (true before this phase too).
