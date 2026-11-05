# Notes — clickup-assign-on-branch (#130)

Non-blocking observations from the gates. Branch-local; `/feature-close` deletes this file.

## Phase 1 — `assignClickUpTask`

- D2's concurrency has no test: `["GET","GET","PUT"]` would still pass with sequential reads. A stub that
  holds `/user` until `/task/9hx` is requested would pin it.
- The authorized-user and "not assigned to you" message texts are the coder's wording; the plan delegates it.
  Get User's generic non-2xx text and a PUT echo with a non-integer assignee id have no direct test.
- The PUT echo check accepts any record with a valid `assignees`; `startClickUpTask` also requires a string
  `id`. Matches §4's guard list.
- Style against `typescript/rules.md`: `type ClickUpRequestOptions` could be an interface; `const send` in
  `startClickUpTask` is an arrow; `parseAssigneeIds` ends in an `as` after an `every` guard (as the existing
  tag parser does).
- The custom-id workspace block now appears three times in `clickup.ts`.
- Tests were written in the same pass as the code, not first.
