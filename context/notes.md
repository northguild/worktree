# Notes — custom issue providers (#357)

Non-blocking observations from the gates. Branch-local; `/feature-close` deletes this file.

## Phase 1

- **Signal death that is not a timeout is misreported** (`custom-provider.ts`, the fall-through after the
  `killed` check): a provider killed by an outside signal reads "could not be run", and the text embeds Node's
  `Command failed: …` with the start of stderr, not its last line. Branch-local; fix before the feature closes.
- **Defaults for omitted `type`, `labels`, `fields`, `kind`, `can`** (null / empty) are the coder's choice, not
  the plan's — they become contract once released, so Phase 6's guide must state them. `can` is in the fetch
  schema because §4.2's example carries it.
- **Errors rebuilt without `cause`** in `describeRunFailure`, and a type assertion on Node's error there;
  `CommandResult` could replace `Awaited<ReturnType<typeof runCapturing>>`; the test file holds literal U+202E
  and U+200B where `\u` escapes would read better.
- **`runCapturing`'s timeout message** (`<file> was killed after <n>ms`) does not match base-command's timeout
  pattern; harmless while every caller builds its own message.
- **For Phase 4's printers:** the title may hold control characters (D6 allows it) and must be escaped
  wherever printed; a `url` with `user:token@` passes the http(s) check and would reach `--json`; `not_found`
  gives `--json` code `failed`, which `branch.mdx`'s table should say.
