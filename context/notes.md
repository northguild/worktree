# Notes — github-fork-upstream-issues (#119)

Non-blocking review observations. Branch-local; `/feature-close` deletes this file.

## Phase 1 — The `github.repository` key

- `worktree config github.repository ""` reads the value rather than refusing it (`src/commands/config.ts:893`
  treats a falsy value as a read for every key); the empty-value refusal is proven at `validateConfigValue`
  and the file schema instead.
- `docs/public/schema/v1.json` carries `repository` as a plain string: the `.refine` does not export to JSON
  Schema, so editors will not flag a bad value; the loader still enforces it. A `pattern`/`description` via
  `.meta()` would carry it.
- `worktree config --names github.repository` drops the key and prints "No missing config found." — reads
  oddly when it was named explicitly; untested.
- `(UNPROMPTED_CONFIG_NAMES as readonly string[]).includes(...)` at `config.ts:153` and `:227` — a type guard
  like `isTeamConfigKey` would avoid the casts.
- The wizard banner may say it "does not ask for" `github.repository` when the file sets it — true but
  redundant.
- The owner rule refuses `--` and a trailing hyphen; any legacy GitHub account with such a name would be
  refused. The hyphen rule rests on the sign-up form's wording, not a docs page.
- `worktree config --project` writes a personal `github.repository` into the team file, as for every team
  key — a fork user pinning their own fork would commit it.
