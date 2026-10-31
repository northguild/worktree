# Notes

Branch-local and advisory. `/feature-close` deletes this file.

## Phase 1 of #113

- `listAssignedLinearIssues` returns success for a 200 with valid data and an `errors` entry that has no string `message` and no auth or rate-limit code. No test covers it. `startLinearIssue`'s write path behaves the same way.
- The doc comment says "a network failure is rethrown as is", but `fetchLinear` turns a timeout into a `Linear:` error.
- D3's one page is pinned only in the `hasNextPage: false` test: the `true` row does not assert the fetch count. The node field tests use absent values only, so no row has a wrong-typed field.
- The comments at `linear.ts` and `linear.test.ts` cite Apollo schema reference URLs. The arguments were actually confirmed in Linear's `packages/sdk/src/schema.graphql`, so that is the better citation.
- "D2-D4" and "D8" in `linear.ts` name this plan's decisions, while other comments in the file use other plans' numbering.
- Linear's parsing in `linear.ts` is hand-written narrowing, against the Zod rule in `typescript/validation.md`. D4 follows the file's stance; changing it would be a whole-file decision.
