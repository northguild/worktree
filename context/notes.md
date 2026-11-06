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

## Phase 2 — `clickup.autoAssign`

- Between phases 2 and 3 the config docs say `--clickup` assigns while `branch.mdx` still says it is not
  supported; phase 3's `branch.mdx` row closes that.
- The ClickUp `--list --missing` test (`config.test.ts`) asserts only `apiToken` and `workspaceId`; one
  `toHaveBeenCalledWith("clickup.autoAssign")` would pin the new key there. Its `CONFIG_NAMES` position is
  untested (cosmetic, `--list` order only).
- `trackers.ts` group comment says both selects are "shaped like Jira's"; the autoStart block says
  `linear.autoStart`. Same shape, wording only.
- The prompt text and the checklist label "whether to assign and start tasks" have no source beyond the Jira
  analogy; the plan fixes no wording.

## Phase 3 — `branch --clickup` assigns

- `branch.ts` doc comment above the private `assignClickUpTask` says a custom id with no workspace id is a
  `ClickUp:` error; it is a `MissingValueError`, and on a real run the naming fetch throws it first.
- The `branch.test.ts` it.each case "a custom id with no workspace id" rejects with a message no code produces,
  not a `MissingValueError`, so it does not cover the path its label names (unreachable on a real run).
- `branch.mdx`'s idempotency bullet names GitHub and Jira only, not ClickUp's already-yours path; the
  `branch.ts` comment above the assignment block still has GitHub's "does not replace existing assignees".
- The JSON help's `assigned` line still says "held by someone else" without tying it to Jira.
- The "Could not assign <key>. " warning prefix follows the GitHub/Jira convention, not §4.
- Gate 2 loopback 1: the ClickUp guide claimed a custom id without a workspace id warns and still creates the
  worktree; it exits 2 at the naming fetch. Sentence removed.
