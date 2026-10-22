# Notes — linear-support (#107)

Non-blocking observations from the gates. Branch-local; `/feature-close` deletes this file.

- **Phase 1:** a non-2xx answer that is neither an auth error nor `RATELIMITED` drops Linear's GraphQL
  message and reports `Failed to fetch issue … <status>`. If Linear answers a missing issue with HTTP 400,
  the user loses the "Unable to find issue" wording. Unverified without a valid key — the §9 live run settles it.
- **Phase 1:** the test `API_KEY` in `src/integrations/linear.test.ts` is shorter than the 20-character
  redaction threshold, so it is not a realistic key; nothing asserts redaction with it today.
- **Phase 1:** `fetchLinear` re-throws a non-timeout error unchanged, and no test pins that.
- **Phase 1:** `linear.apiKey` is in `CONFIG_NAMES` before Phase 2 gives it a prompt; `--missing` lists it
  and asks nothing until then. Closed by Phase 2.
- **Phase 2:** the Linear key prompt does not say that Enter keeps a stored key; the GitHub group's
  instructions say what an empty answer does.
- **Phase 2:** a whitespace-only `linear.apiKey` hand-written into git config is kept by a non-interactive
  run and only fails later, at `branch --linear`.
- **Phase 2:** the test "asks one confirm for the group…" does not assert that only one confirm ran, and the
  empty-answer tests do not assert that the Linear prompt was reached.
- **Phase 3:** `branch.ts` checks for a missing `linear.apiKey` itself, to get `missing_value` / exit 2,
  because `resolveLinearApiKey` throws a plain `Error`. That function's empty-key check is now unreachable
  from `branch`; having `resolveLinearApiKey` throw `MissingValueError` would let the branch check go.
- **Phase 3:** a missing Linear key exits 2 (`missing_value`), and a missing Jira credential still exits 1
  (`failed`). Intended by the plan for Linear only.
- **Phase 3:** with no key *and* a malformed id, `branch --linear foo` reports `missing_value` before D5's
  `invalid_value`, because the key check runs before the id is validated.
- **Phase 3:** the reworded exclusivity and `--assign` messages are pinned only against the code; no plan
  text decides their wording.
- **Phase 4:** plan §8 says `pnpm docs:test` checks the new page through the route list; no docs test reads
  it. The route list is generated from disk, but nothing checks that each `DOCS_ROUTE_MAP` entry in
  `MarkdownContent.tsx` is a valid route. That gap predates this feature. Opening the page in
  `pnpm docs:dev` is still a person's pass.
- **Phase 4:** some added doc lines break the surrounding hard wrap (SKILL.md, branch page, README).
  Cosmetic once rendered.
