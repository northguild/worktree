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

## Phase 2

- **`config --list` and `config <key> <value>` treat `issueProvider.name` per key, not as a pair**
  (`src/commands/config.ts:287`, `:330`): a git-config name beside the file's command lists as overriding the
  file, though the resolver ignores it; a file name beside a git-config command lists as set but resolves to
  `null`. Contradicts `project-configuration.mdx`'s pair sentence. Branch-local and user-visible; fix by
  Phase 4 at the latest.
- **`commands/config.mdx` has no key entries for `issueProvider.name`/`.command`** (every other key has one);
  §7 assigned no row for it.
- **Docs say the command's "head must be a program that exists"** — true for `worktree config`, not for a
  command in `.worktree.yml`, which only the `step` rule checks.
- **§5's process-list risk** is only implied by "a token never goes in this section"; Phase 6's guide should say it.
- **Smaller:** the git-config path's name lookup still reads (and can throw on) lower layers; an invalid
  git-config name is dropped silently (documented); the test at `project-config.test.ts:2461` does not assert
  `token` is absent; the name's error text is written three times.

## Phase 3

- **User-visible doc/wording slips, one line each:** `README.md:96` lists `issueProvider.command` under "The
  setup flow can configure:" though the wizard never asks for it; `commands/config.mdx:122-124`'s list of local
  keys that stay omits the kept local `issueProvider.command`; `project-configuration.mdx:365` still says
  `--approve` "asks the same question ahead of time" (the paragraph below it is right); the unapproved-command
  error reads "…; pass approving it once in a terminal with `worktree config --approve`" because of
  `MissingValueError`'s fixed `no default for X; pass Y` shape.
- **`approvePostCreate`'s new "already approved" skip** (`project-config.ts:984-987`) has no test.
- **Phase 4:** "exits 2 before the provider is spawned" must check `mockRunCapturing`, not `mockRun` — the
  Phase 3 "nothing spawned" test checks only `mockRun`.
- **The provider-approval text is a bold-led paragraph under *Approving the steps*, not its own heading**, so it
  is missing from the page's table of contents, and `config.mdx:312`'s "Approving the provider command" link
  points at `#approving-the-steps`. Cause: `docs/scripts/audit-dist.mjs:934`'s `withoutElements` stops after 20
  removals (also on main), so a page with more aria-hidden heading-anchor icons than that fails the audit
  falsely. Any later heading added to `project-configuration.mdx` hits it; making the loop run until nothing
  matches would lift it (Phase 6 has `audit-dist.mjs` on its Files line).
- **Smaller:** `const readApproval = () => …` at `project-config.ts:885` breaks `typescript/rules.md:27`
  (function declarations for named functions); the "escaped" test names exercise no escape; `--approve` with
  only a provider command first prints "…has no postCreate steps."
