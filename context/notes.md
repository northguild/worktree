# Notes — #120 github-enterprise-hosts

Non-blocking observations from the gates. Branch-local; `/feature-close` deletes this file.

## Phase 1 — Host-aware remote parser and API base

- **Untested D6 rule.** "scp-like only when no `/` precedes the first `:`" holds in `SCP_REMOTE`
  (`src/integrations/github.ts`), but no test can fail on it — add `/srv/git:acme/widgets` and
  `./a:acme/widgets` to the "finds no repository" `it.each`.
- **`fetchGitHub` is not pinned to `githubApiBaseUrl`.** The `api.github.com` assertions would pass if the
  literal came back; Phase 3's Enterprise request tests are what pin it.
- **github.com remotes that resolved before and now throw** (branch-only, not on `main`): `git+ssh://` /
  `ssh+git://`, the malformed `ssh://git@github.com:acme/widgets.git`, `www.github.com` remotes, and an
  upper-case `.GIT` suffix (the strip is case-sensitive while the validator's `.git` refusal is not). None is
  a D6 form; `refactoring.md` says preserve behaviour, so decide before release whether any is kept.
- **Naming.** `githubApiBaseUrl` is a noun phrase where `naming.md` asks verb-first; the repo has precedent
  (`quotablePastedUrl`, `projectFileValue`).
- **Credentials in the unparseable-remote message.** It echoes the remote whole, `user:password@` included —
  HEAD's behaviour, not new, but Phase 3's new messages should honour §8's no-token-shaped-string row.

## Phase 2 — Ask gh for github.com's token by name

- **The stored-token-wins negative assertion is narrower than it reads.** `not.toHaveBeenCalledWith("gh",
  [<exact argv>], …)` rules out one argv only; the test is sound because of `toHaveBeenCalledTimes(1)`
  beside it. Asserting no call has `"gh"` as its file would survive that count being relaxed.
- **Stale `expectCommands` strings.** Six declarations in `github.test.ts` still say `"gh auth token"`
  while `describeRunCall` renders `gh auth token --hostname github.com`; it only feeds the afterEach
  `console.warn`, but the text names the old argv.
- **Two plans' `D`-labels side by side** in `github.ts`: the new `// D4` comment sits under another plan's
  `// D5` (the gh timeout). Naming the plan (`#120 D4`) would disambiguate.
