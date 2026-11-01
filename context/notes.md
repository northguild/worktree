# Notes

Branch-local, for a person. Nothing reads this; `/feature-close` deletes it.

## Phase 1 — `startClickUpTask`

- Thin test pins: status-type case exactness (`"Open"`), a 2xx with a status but no id, a non-string `err`, `list.id === ""`, a non-JSON 2xx on the write, and a generic non-2xx on Get Task or Get List.
- A 401 or 403 on the write gets the auth text with no edit-access hint. A real "may not edit" refusal may well arrive as one of those, so look for it in the §8 live pass.
- `{ cause: error }` in `startClickUpTask`'s `send` can hold an error quoting the token. Safe while nothing prints the error object; Linear and Jira keep a cause on timeouts only, so this is the first of its kind.
- `describe("startClickUpTask")` sits under the unrelated "shared branchType list" describe; "keeps the Get Task not-found text word for word" now duplicates a `describe.each` row; the custom-id query block is duplicated (two instances, under the incremental-abstraction bar). Messages the coder worded have no source beyond the code.
