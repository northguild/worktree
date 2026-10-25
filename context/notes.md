# Notes

Branch-local observations from the gates. `/feature-close` deletes this file.

- **Phase 1 (Gate 2):** two `jira.apiToken` prompt rules predate this feature and have no test, though
  `github.token` pins both — no default or prefill (`config.test.ts`, the GitHub case near `:1325`), and the
  non-interactive `MissingValueError` (`:663-680`). The new *Jira API token prompt* describe block is the
  natural home if anyone adds them.
- **Phase 1 (Gate 2):** `docs/src/app/docs/commands/config/page.mdx:84` calls `linear.apiKey` a "token"
  where the Linear guide says "key"; cosmetic.
- **Phase 2 (Gate 2):** the non-`Error` autoAssign case in `branch.test.ts` (~`:1124`) copies its
  sibling's comment rather than saying it pins the `String(error)` branch, and omits the opener assertion
  the sibling has; both cosmetic.
- **Phase 2 (Gate 2):** `branch.test.ts` spies `warn` with `(input: any) => input`, against
  `typescript/rules.md:18`. The pattern predates this feature (`:743`, `:1201`); a cleanup would be
  file-wide.
