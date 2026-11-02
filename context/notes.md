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

## Phase 3 — Route `--github` to the host in `github.host`

- **§4 deviation, accepted at Gate 2.** `ResolvedGitHubRepository.host` is optional — present only off
  github.com, read through `hostOf()` — where §4 says the result always carries `host`. It keeps the
  pre-existing github.com `toEqual` assertions and `branch.test.ts` mocks unchanged and is never serialised.
- **Guide paragraph order.** The Enterprise token paragraph sits before "A token that came from `gh` gets a
  shorter hint…", which then reads as if it covered Enterprise; Phase 4 rewrites that guide anyway.
- **Untested redaction.** The `redactSecrets` on `unreachableError`'s cause and on the invalid-`github.host`
  value have no test that fails without them (defence in depth; output is redacted at print too).
- **No Enterprise test runs the pull-request head lookup with a stored token present** — covered indirectly
  by sharing the read's `token`.
- **One assertion pins the exact mismatch sentence** where D9 fixes only what it must name.
- **`MissingValueError` reads "pass `gh auth login --hostname …`"** — the class's format, odd for a command.
- **Nested brackets** in `configuration/page.mdx:26` and `project-configuration/page.mdx:83`.
- **Naming.** `hostOf`, `repositoryOnHost`, `unreachableError`, `unableToDetermineMessage` are not verb-first.
- **Dangling `#github-enterprise` links** until Phase 4 adds the section; a pasted github.com URL under an
  Enterprise host is read from that host (never requested) until Phase 5.
- Phase 1's two notes aimed here are met: Enterprise URL tests pin `fetchGitHub` to `githubApiBaseUrl`, and
  the unparseable-remote message now goes through `redactSecrets`, with a test.
