// A secret has no place in any output (security/secrets.md), and some messages
// come from places that echo what they were given: a remote URL with
// credentials in it is the realistic one (github.ts quotes the origin it could
// not parse). Redacted at the point of output, so every route to stdout or
// stderr is covered by one rule instead of each message being checked: the
// error line, the `--json` document, `BaseCommand.warn`, and — through
// `createSpinner` — every spinner `warn` and `fail`.
//
// Its own module because `progress.ts` needs it and `base-command.ts` imports
// `progress.ts`; living in either would make the other a cycle.
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/gi;
const TOKEN_SHAPES =
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|lin_api_[A-Za-z0-9]{20,}|pk_[A-Za-z0-9_]{20,})/g;

export function redactSecrets(text: string): string {
  return text.replace(URL_CREDENTIALS, "$1***@").replace(TOKEN_SHAPES, "***");
}

/**
 * A pasted URL as it may be quoted in a refusal: no query or fragment, which
 * can hold a token, and no `user:secret@`, which `redactSecrets` masks only
 * for some shapes (#127 D8). Shared by the `--github`, `--jira` and `--linear`
 * URL parsers, so a fix to what it strips reaches all three refusals.
 */
export function quotablePastedUrl(input: string): string {
  return input.replace(/[?#].*$/s, "").replace(/^(https?:\/\/)[^/]*@/i, "$1");
}
