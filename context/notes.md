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

## Phase 3 — The opener decides its follow-ups (#236)

- A bare `--missing` run with `opener` already set now lets the stored opener decide the follow-ups, so `--missing --list` can still list `codeEditor` for a `herdr` or `none` user while `--missing` asks nothing for it. Constraint 7 lets `--list` keep the hiding rule alone; constraint 1 says `--missing` keeps its meaning — the maintainer should accept the divergence explicitly.
- §8 item 1, read literally, is crossed again: "asks the Herdr questions too when herdr is installed" passes `missing: true` (unnamed) and was edited, because under D3 `editor` no longer asks the Herdr keys. Forced, not weakening; no named, `list` or set-by-name test changed.
- `guides/herdr-spaces/page.mdx` says that without the `herdr` CLI `opener` offers `editor` and `none` only, leaving out the stored-value and `opener=herdr` exceptions; `commands/config/page.mdx` states the full rule.
- `opening.test.ts` "defaults to editor when the stored opener is not offered" sets a state the code says cannot happen, and its expected value comes from the code's own `?? "editor"`.
- `opening.test.ts` "does not ask a Herdr key that --missing removed" runs with `hiddenNames` empty, so it tests only `shouldPrompt`; the rule it names is unreachable.
- An `opening.test.ts` test asserts a constant against a literal.
- After the loopback, `commands/config/page.mdx` Opener Keys says "a `codeEditor` is only missing under `editor`, and the Herdr keys only under `herdr`" — true of the wizard, but `--missing --list` still lists them as missing; "only asked" would be the exact word.

## Phase 4 — One agent question and one Herdr yes/no (#236)

- §8 item 1, read literally, is crossed again: "asks the Herdr questions too when herdr is installed" (bare `missing: true`) now expects no `herdr.agent` kind input. Forced by D4; no named, `list` or set-by-name test changed.
- The Coding agent item can be listed and ask nothing: bare `--missing` with `opener` unset, Herdr on PATH, `agent.command` set, `herdr.agent` unset — the item is listed only for `herdr.agent`, and choosing `editor`/`none` in the same run leaves it asking nothing. The reverse: Herdr binary absent, `herdr.agent` hidden, so the item is not listed and choosing `herdr` in that run never offers the confirm. Both narrow.
- The Herdr confirm's default (yes only when `herdr.agent` is already set) is not pinned by any test.
- Clearing a prefilled input takes an extra Backspace in `@inquirer/input` (Enter on an emptied line returns the default; Backspace on the empty line clears it). True of every prefilled input; "leave it empty for no agent" holds only with that extra key.
- The docs say "no leaves `herdr.agent` empty"; no clears an existing value.
- The tally comment above the 22-question test in `config.test.ts` says "ClickUp 1" and adds to 12; the assertion of 13 inputs is right.
- D4 cites `listRuntimeSessions`' raw-head first-word rule; `branch`'s kind fallback uses `basename(head)` (`src/lib/base-command.ts`), the closer precedent for a kind — put to the maintainer.
- `agent.ts` comment "No default" means no fallback default; the input is prefilled.
- A stored `herdr.agent` alone now pre-ticks Coding agent; its label does not mention `herdr.agent`; "Nothing is asked behind a yes/no" on the config page reads ambiguously now that the item has a yes/no.
- After the loopback: no test pins "no invalid-kind hint when the opener is not `herdr`" — it holds only by the order of the early return and the kind check in `agent.ts`.
- The config page's "a first word that is not a valid kind … is not stored" parenthetical sits after "which it keeps" and can read as applying when `herdr.agent` is already set, where the question is still asked.
- A bare `--missing` run with `opener=herdr`, a path-headed stored `agent.command` and only `herdr.agent` missing lists Coding agent, asks nothing, and prints the hint — another narrow "listed, asks nothing" case.

## Phase 5 — Headings and the closing summary (#236)

- A listed, ticked item can print its heading and then ask nothing: `--missing` with `agent.command` stored, `herdr.agent` unset (Herdr on PATH) and `opener=editor`; or `opener=editor` and `codeEditor` stored with only `herdr.focus` unset. §4's "nothing left to ask → not listed" holds; the config page's "an item with nothing to ask prints none" slightly overstates this case.
- The `has-called-config` exclusion assertion in `config.test.ts` cannot fail: both tests seed it as `"true"` before the run. Seeding it `""` would pin the rule.
- The summary's key order (first-write order) is pinned in `run.test.ts` with no source beyond the implementation; D7 names no order.
- `run.test.ts` "prints no heading for an item with nothing to ask" never ticks the item it checks; the `config.test.ts` counterpart does pin the rule.
- `src/lib/config-wizard/written.ts` keeps module-level recording state (scoped by try/finally, one caller); a `save` on `WizardContext` would make the coupling explicit. Nested runs record only in the inner map; concurrent runs would mis-attribute — neither happens today.
- Files touched outside the Files line: `written.ts`, `checklist.ts` (`title`), and the five section modules (`gitSetConfigValue` → `saveConfigValue`).
- Writing `""` to an unset key is not listed in the summary (unset reads as `""`); clearing a stored value is.
- During this phase's Gate 1, `src/commands/linear-listen.test.ts` failed intermittently with write ECONNRESET under full-suite load (pre-existing on main since #238; filed as #242).

## Phase 6 — Reconcile the documentation sweep (#236)

- `commands/config` page: the heading-then-nothing case needs `--missing` and the opener acting together (the opener may be one chosen earlier in the same run); the sentence's "or" makes either sound sufficient.
- The `run.ts` comment "A listed item has a key left to ask (checklist.ts)" is contradicted by the (correct) config page sentence about a heading followed by nothing.
- `configuration` page "`opener` itself is always shown" and `skills/worktree/SKILL.md` "opener itself is always offered" are loose under `--missing`; acceptable in their hiding-rule context.
- `guides/herdr-spaces` "neither lists nor prompts for any of the keys below" leaves out the stored-value and `opener=herdr` exceptions; its `--missing --names opener  # prompts for it regardless` means "regardless of Herdr" and is false once `opener` is set (predates this feature, also on main).
- #235 merged to main as `c0cc821` (#240) during this run and moved every docs page this feature edited from `docs/src/app/docs/**/page.mdx` to `docs/src/content/docs/**.mdx`; Git sees them as 87–97% renames. Plan §9 Q9: whichever lands second carries the new text — this branch.
