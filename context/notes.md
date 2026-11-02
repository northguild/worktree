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
