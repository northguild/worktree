# Notes — #112 linear-start-on-branch

Branch-local and advisory. Nothing reads this file; `/feature-close` deletes it.

## Phase 1 — `startLinearIssue`

- The "no Write hint on a 5xx" rule (`linear.ts`, `response.status < 500`) applies only when a 5xx body
  carries `errors`, and no test sends one: a 503 with `{ errors: [{ message: "Service unavailable" }] }` on
  the write, expecting `"Linear: Failed to move issue ENG-123. 503. Service unavailable."`, would pin it.
- `startLinearIssue`'s read failure ends `"… 502."` (through `sentence`), where `fetchLinearIssue` ends
  `"… 500 Internal Server Error"` with no full stop. Both keep the status; cosmetic only.
- A 403 on the write is classified by the shared `readLinearAnswer` as "Authentication failed", with no
  Write-permission hint (D7 reuses that text). The §8 live pass should record which status Linear returns
  for a read-only key; if it is 403, the hint never reaches that person.
- D3 checks the write's error *messages*, not the `errors` array itself: an entry with no string `message`
  would not fail on its own. The GraphQL spec requires `message`, so this is theoretical.
- On the read, GraphQL `errors` are reported only when `data.issue` is null; a partial answer with errors
  and an issue is used. Same as `fetchLinearIssue`.
- `fetchLinearIssue` still builds its error-message list inline, while `errorMessages` / `withMessages` now
  do the same for `startLinearIssue`. Left alone to keep the extraction behaviour-preserving.
