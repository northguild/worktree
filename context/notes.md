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
