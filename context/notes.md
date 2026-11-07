# Notes — locale-aware-cleanup-stats (#283)

Non-blocking observations from the gates. Branch-local; `/feature-close` deletes this file.

- **Phase 1:** `formatCount`'s parameter is `n`, which `standards/typescript/naming.md:31` discourages; kept because plan D2 spells the signature that way.
- **Phase 1:** D1 (omitted locale means the runtime default) and D3 (no styling in the helper) have no test of their own; the helper is one line, so a regression there is unlikely but would pass.
- **Phase 1:** the coder wrote the implementation before the tests, against `roles/coder.md`'s test-first ask. The expected values were then checked against CLDR independently by the reviewer.
