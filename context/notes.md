# Notes — #121 branch-reopen-existing-worktree

Non-blocking observations from the phase gates. Branch-local; `/feature-close` deletes this file.

## Phase 1 — Find the worktree a branch name already has

- `gitFindBranchCheckout` tests stub `fs.existsSync` to a constant, so nothing asserts it is called with
  the matched record's path (`src/lib/git.test.ts`, the missing-directory case).
- `isCurrent` is `false` when the caller's own tree is on a detached HEAD. Correct, but untested.
- `gitFindBranchCheckout("(detached HEAD)")` would match a detached record. §4 accepts this, since no real
  branch name can equal `DETACHED_LABEL`. No test pins it.
- The detached-record and path-with-spaces tests would pass for most implementations. The spaces fixture's
  root has no space in it, unlike the neighbouring `gitGetWorktrees` suite's.
- The three `run` calls are awaited one after another, mirroring `gitGetWorktrees`. `error-handling.md`
  prefers `Promise.all` for independent calls, but the tests' mock order depends on the sequence.

## Phase 2 — `branch` reopens or refuses, with docs

- `docs/.../branch/page.mdx:284` (*Non-interactive runs*) and `context7.json`'s new rule describe every taken
  name with case A's message ("names the path and `worktree open <branch>`"). B names `git branch -d`,
  and D names `git worktree prune`. The table in the new section is correct.
- `page.mdx:155` says a re-run "reopens the worktree (on a terminal)" without saying it asks first. The
  linked section says so.
- The reopen behaviour went into a new "A branch name that is already taken" section, not into *What It
  Does* as §7 planned. *What It Does* step 1 still doesn't mention the check that comes before it.
- The Done-when grep hits only `page.mdx`. `SKILL.md` carries the same content in "already taken" wording.
- The "final name" test passes `"feat"` both as the CLI argument and as the edited name, so checking the
  argument instead of the final name would still pass. Checking the derived name is caught.
- The non-interactive `--github` test is titled "no assignment prompt or save", but in that mode it pins
  only "no assignment call".
- In `branch.test.ts`, the comment at about `:95-101` is now separated from the spies it explains by the
  new `gitFindBranchCheckout`/`gitGetLocalBranches` stubs.
- `const reopen` in `reopenOrRefuseTakenBranch` breaks the boolean-prefix rule (`naming.md:24`). It
  matches the local `proceed`.
- No test covers case A with `isCurrent: true`.
- Neither coder worked test-first. Every expected value traces to the plan, apart from the exact
  message wording.
- §8.1 was run against real git with the built CLI. Cases A to D exit 2 with no `fatal:`, and the proceed
  path creates a worktree. §8.2, the prompt on a real terminal, still needs a person.
