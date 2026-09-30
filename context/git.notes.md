# Filling in `git.md`

The guidance for filling [`git.md`](git.md), read by `/onboard` and by anyone filling the file by hand. The
stub is the answer; this file is never read by a command in the loop. Each heading below mirrors a section
of the stub, in the stub's order.

## Who commits

Exactly one of the two answers below is this project's. Keep it, delete the other.

**Shipped as:** the user commits. A tool installed into a repository it knows nothing about does not get to
write that repository's history unasked.

### The two answers, copy-ready

**The user commits.** A phase ends with the work verified and its ledger row updated, left **unstaged** in
the working tree. The agent reports what changed and stops there — no `git add`, no `git commit`, no
`git push`, nothing that rewrites history. Staging is not a helpful head start: it is the first half of a
commit, and it edits what the user's own `git commit` would capture.

**The agent commits.** A phase ends committed: the code and its ledger row in one commit, so the two
cannot disagree.

## Where work lands

Exactly one of the three answers below is this project's. Keep it, delete the other two.

**Shipped as:** the main working tree. It is what this workflow did before this section existed, and a
tool installed into someone else's repository does not start creating branches unasked.

Keep the **Under the worktree answer** subsection only under the worktree answer; delete it otherwise.

### The three answers, copy-ready

**The main working tree.** The agent works on whatever branch is already checked out and creates none.
Enough for a repository you push to `main`, and for one where you make the branch yourself before starting.

**A branch per feature.** One branch, created from the default branch before the feature's first phase
and reused by every phase after it. It lives in the main working tree, so one feature is in flight at a
time.

**A worktree per feature.** Each feature gets its own branch in its own working tree, so several are in
flight at once. The tree is created before the first phase and removed after its branch merges, **only by
the invocation `executors.md` names under *Branch and worktree*** — a bare `git worktree add` is not a
fallback when that section is empty. *Which* invocation is not this file's business — that is
`executors.md`, for the same reason the reviewer's invocation is.

## Push and pull request

Exactly one of the two answers below is this project's. Keep it, delete the other.

**Shipped as:** neither. Pushing is the first thing an agent does that other people can see.

### The two answers, copy-ready

**Neither.** Nothing here pushes a branch or opens a pull request. Work reaches the remote when you send
it.

**The agent pushes and opens a pull request.** Once, at `/feature-close` — never per phase. By then the
branch carries the whole feature: every phase's code, the documentation each one made true again, the
finished ledger, the `archive/` move and the `history.md` row. The pull request's body is the plan's
summary and the phases it landed.

## Granularity

One answer ships and it is the only one this workflow knows: one commit per phase. Confirm it where the
agent commits; where the user commits it describes the shape the tree is left in.

## What this file does not decide

Nothing to fill in. Live prose in the stub.

## What no answer here authorises

Nothing to fill in, and nothing to negotiate. `/onboard` writes this section out as shipped whatever the
four answers above were, and says in one line that it did and what it means — a user who just chose *the
agent commits* has every reason to think they authorised more than they did.

## The rules that hold either way

Nothing to fill in. Live prose in the stub.
