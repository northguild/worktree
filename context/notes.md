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
