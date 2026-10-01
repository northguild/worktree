# Notes

Branch-local, advisory. Deleted whole by `/feature-close`.

- **Phase 1** — the `flag` string on the `herdr.focus` `askConfirm` (`src/commands/config.ts`) is unreachable: `fallback` is always defined, so `missing(site)` never fires there. Harmless.
- **Phase 1** — a non-interactive run with a stored `herdr.focus` other than `true`/`false` used to fail `isValidBoolean` and now reads as yes. Unreachable in practice (`validateConfigValue` only stores `true`/`false`) and it matches the runtime rule in `base-command.ts` (`focus !== "false"`).
- **Phase 1** — plan §8's interactive terminal pass is owed for every changed prompt; run once after the last prompt phase lands, since unit tests mock `@inquirer/prompts`.
- **Phase 2** — `askSelect` does not check its `fallback` against `config.choices` the way `askInput` validates its fallback; a caller must pass a normalised value (plan §4 already says so for `github.autoAssign`).
- **Phase 2** — the no-fallback select test in `src/lib/prompt.test.ts` asserts message and exit code via `toMatchObject` rather than `toBeInstanceOf(MissingValueError)`; behaviourally equivalent, class no longer pinned.
