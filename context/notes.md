# Notes — clickup-support (#129)

Non-blocking observations from the gates. Branch-local; `/feature-close` deletes this file.

- **Phase 1:** `getClickUpBranchNameFromTask(task, typedId)` takes the typed id as a second argument
  (D6 needs the shape the user typed); §4 shows `(task)`. It re-parses `typedId`, so it can throw
  `InvalidValueError` from a name builder; passing the parsed `ClickUpTaskId` would avoid that.
- **Phase 1:** `CU-9hx` is refused as invalid with no hint to drop `CU-`, and a numeric short id pasted
  as `CU-12345` is read as a custom id. Follows D3 as written; pasted forms are #127's.
- **Phase 1:** `clickup.ts` `(tag as { name: string }).name` is a type assertion, copied from
  `linear.ts`; a type-guard would remove it.
- **Phase 1:** the `AbortSignal.timeout` spy in `clickup.test.ts` is never restored (same as
  `linear.test.ts`); harmless while `stubFetch` ignores the signal.
- **Phase 1:** `pk_[A-Za-z0-9_]{20,}` can mask a long non-secret `pk_…` identifier; D10 accepted that.
- **Phase 2:** the token instructions' "Click 'Generate' (or 'Regenerate')" wording is unchecked against
  ClickUp's docs.
- **Phase 2:** `clickup.workspaceId` is optional but `--missing` lists it while unset, so a ClickUp user
  without custom ids sees that prompt on every interactive `--missing` run (Enter skips it), as with
  `herdr.agent` and `postCreate`.
- **Phase 2:** the "keeps the stored token for an empty answer" test does not assert the prompt was asked;
  the Jira twin's `expect(mockInput).toHaveBeenCalled()` would pin it. Two other test titles (prompt order,
  workspace id still listed) promise more than they assert.
- **Phase 3:** no `branch`-level test that a `pk_` token quoted in a ClickUp error is scrubbed from
  output (GitHub has one); redaction is pinned generically in `base-command.ts` and `redact.test.ts`.
- **Phase 3:** the workspace-id test's `vi.spyOn(globalThis, "fetch")` passes through, so a regression
  would make a real request before failing; `.mockRejectedValue(...)` would keep it offline.
- **Phase 3:** no `branch`-level test for an invalid id (exit 2, `invalid_value`) or for
  `--no-assign --clickup`; the first is pinned in `clickup.test.ts`, the second matches Linear.
- **Phase 4:** the guide's "without the `CU-` that ClickUp shows in the UI" and the branch page's "URL and
  ID field" describe ClickUp's UI without a source; the guide does not say where to find the workspace id.
- **Phase 4:** `CU-` plus an all-digit id (`CU-123`) parses as a custom id, not a refusal; worth checking
  in the live run.
- **Phase 4:** the guide says "any `pk_` token" is redacted, but the shape needs 20+ characters after
  `pk_`; the configuration page's "the Workspace your token belongs to" is unverified (a token can reach
  several).
- **Phase 4:** `src/lib/utils.ts:143` still names only `--jira` and `--linear` as cutting the slug.
