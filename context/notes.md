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

## Phase 2 — `linear.autoStart`

- `configuration/page.mdx:245`'s parenthetical leaves out "already started", which
  `commands/config/page.mdx:167` includes. Not wrong, but the two pages word D1 differently.
- D10's "in the Linear group" is not pinned: the declined-group test (`config.test.ts`, "skips the key
  prompt when the group is declined") would still pass if the select moved outside the Linear block.
  `expect(mockSelect).not.toHaveBeenCalled()` there would pin it.
- Uneven wrapping: `skills/worktree/SKILL.md:428-430` leaves a short middle line, and
  `commands/config/page.mdx:167` runs past the page's width.
- The new config tests use `(config as any).parse`, the file's existing pattern.
- The select's wording ("Should `branch --linear` move the issue to started once the worktree exists?") is
  the implementation's own; it belongs with §9's names question.

## Phase 3 — one decision helper

- The precedence docstring still sits on `shouldAssignIssue` (`branch.ts:520-534`), while the logic it
  describes is in `decideIssueAction`, which has none.
- The seam test reaches the private `shouldStartIssue` through `(branch as any)`, copying the jira seam
  test; phase 4's command-level tests are what cover it through `run()`.
- `decideIssueAction`'s `prompt` parameter is an inline object type rather than an interface. Style only.
- `shouldStartIssue` has no production caller until phase 4, and the phase mixes an extraction with an
  addition. Both are what D9 asked for.
- The start prompt text "Move this issue to started?" is pinned by the seam test; docs that quote it should
  quote it exactly.
