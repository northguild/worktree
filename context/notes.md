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
