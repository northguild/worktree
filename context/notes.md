# Notes

Branch-local observations from the gates. `/feature-close` deletes this file.

- **Phase 1 (Gate 2):** two `jira.apiToken` prompt rules predate this feature and have no test, though
  `github.token` pins both — no default or prefill (`config.test.ts`, the GitHub case near `:1325`), and the
  non-interactive `MissingValueError` (`:663-680`). The new *Jira API token prompt* describe block is the
  natural home if anyone adds them.
- **Phase 1 (Gate 2):** `docs/src/app/docs/commands/config/page.mdx:84` calls `linear.apiKey` a "token"
  where the Linear guide says "key"; cosmetic.
