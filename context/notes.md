# Notes — feature/70-headless-agent-mode

Branch-local, advisory, read by nothing. `/feature-close` deletes this file.

- **Phase 1.** `BaseCommand.catch` reads only `error.oclif.exit`, not `CommandError.exitCode`, which oclif's
  own `catch` also honours. Harmless today (nothing sets `exitCode`); an error class meant to exit non-1
  has to carry `oclif.exit`.
- **Phase 1.** `this.exit(n)` would now print `Error: EEXIT: n` on stderr (it printed the same on stdout
  before). No caller exists.
- **Phase 1.** The `console.error` / `console.log` spies in `base-command.test.ts` are never restored;
  `vi.clearAllMocks()` keeps the silencing for the rest of that file. Same pattern as `config.test.ts`.
- **Phase 1.** `dispatchAgent`'s `onError` (`base-command.ts:379`) still writes `Error: …` to stdout — a
  fire-and-forget spawn failure outside `catch`.
- **Phase 2.** The `--non-interactive` / `--yes` help text (`base-command.ts:77,81`) describes Phase 3's
  behaviour; until Phase 3 lands, `remove -y` still prompts. Phase 3 has to make that text true.
- **Phase 2.** `interaction.ts` holds the mode as module state (one writer, `init()`), which
  `philosophy/maintainability.md` would query; accepted because the git/env helpers have no command to ask.
- **Phase 2.** The flags `init()` reads come back from an options-less `this.parse()` typed `any`;
  harmless at runtime (`=== true`), unchecked by the types.
- **Phase 2.** Untested: the cli-progress bar being skipped when progress is disabled, and `config -y`
  leaving the mode interactive.
- **Phase 2.** Intended, visible: stdin piped with a TTY stderr now gets plain `- text` lines, and `-y` on a
  TTY gets no removal progress bar.
