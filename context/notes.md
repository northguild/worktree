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
