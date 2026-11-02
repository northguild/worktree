# Notes — #127 issue-url-arguments

Branch-local, advisory. `/feature-close` deletes this file.

## From Phase 1 (Gate 2, PASS WITH NOTES)

- `quotablePastedUrl` is copied into `github.ts`, `jira.ts` and `linear.ts`. It is redaction, not parsing, so
  D1's rationale does not cover it; `src/lib/redact.ts` is its natural home if a fourth copy appears.
- The parsers' regexes carry `/i`, so path literals (`/ISSUES/`, `/BROWSE/`, `/ISSUE/`) match case-insensitively
  too, beyond §4's regexes. No test asserts any case-insensitivity, nor Linear's `http://` or
  `getLinearWorkspace`'s `/i`.
- Userinfo holding a raw `/` or `#` (invalid per RFC 3986) is quoted partly or whole in a refusal.
- The Jira test titled "keeps the host of a self-hosted site" is really a Cloud custom domain; Data Center is #126.
- A URL with a trailing space is refused; one with a leading space falls through to the existing validator,
  which echoes it whole, query included — today's behaviour, kept by D1.

## From Phase 2 (Gate 2, FAIL → loopback 1 → PASS WITH NOTES)

- The Jira refusal test guards only the exact wording "set jira.host to evil.example.com"; asserting no
  "set jira.host" at all would be stronger.
- Untested: `--jira <url>` with `jira.host` unset (the `if (configured && …)` skip, then the missing-config
  error and no `fetch`) — worth pinning, since a fallback to the pasted host there would be the D4 leak.
- Untested end to end in `branch`: a `/pull/<n>` URL reaching the existing `worktree checkout` refusal (§8 row;
  parser side covered in `github.test.ts`); a Linear workspace mismatch under `--dry-run`; D7 for Linear (the
  pasted and API URL are the same fixture string) and for Jira (no `--json` URL test).
- `(await getTeamConfigValue("jira.host")) ?? ""` in `branch.ts` — the `?? ""` is dead; the value is typed `string`.
- `pastedLinearWorkspace` is instance state carried from `normalizeIssueUrls` to `getLinearIssueBranchName`
  rather than a passed value.
- The coder wrote the implementation before the tests; the four expectations it then corrected all trace to
  the docs or to tests on main.

## From Phase 3 (Gate 2, FAIL → loopback 1 → PASS WITH NOTES)

- `branch/page.mdx` Linear section says "after the one fetch", which the page's step 1 and `branch.ts`'s comment
  use for `git fetch`; "after the issue is fetched" would be unambiguous.
- `skills/worktree/SKILL.md` says a Linear URL for another workspace is refused, but not that the run only warns
  when Linear's API returns no `url`.
- The GitHub bullet in `branch/page.mdx` is long and its line 80 overruns the surrounding wrap width; cosmetic.
- The changeset the plan put in Phase 3 is owed at `/feature-close` (release.md: once per feature), `minor`,
  covering `src/**` and `skills/**`.
