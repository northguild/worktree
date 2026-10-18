# Filling in `tracking.md`

The guidance for filling [`tracking.md`](tracking.md), read by `/onboard` Step 5 and by anyone filling the
file by hand. The stub is the answer; this file is never read by a command in the loop. Each heading below
mirrors a section of the stub, in the stub's order.

Most of the stub is live prose under either answer. Only the first section holds a choice, and the
subsection under it is kept or deleted with that choice.

## Where tracking lives

Exactly one of the two answers below is this project's. Keep it, delete the other.

**Shipped as:** in the working tree. It is what this workflow did before this section existed, and it is
the only answer that needs nothing outside the repository.

### The two answers, copy-ready

**In the working tree.** The backlog is `roadmap.md`, a plan is a document under `plans/` with its own
phase status ledger, retired features are indexed in `history.md` with their documents in `archive/`, and
notes before a plan exists live in `drafts/`. One tree, one reader at a time, and every answer is a file
read.

**In an issue tracker.** A feature is an issue, its plan is that issue's body, and the phase ledger is a
table inside that body. The tracker is the shared home every working tree can reach — choose it when
several agents work several features at once, since it is the only thing outside every worktree that all
of them can write to.

**Requires a git repository with a GitHub remote.** It requires no particular answer in `git.md`, and is
worth pairing with *the agent pushes and opens a pull request* for a reason that is not mechanical: this
answer exists for several agents in several trees, and work that is never pushed is visible to exactly one
of them.

### Under the tracker answer

Keep this subsection of the stub only under the tracker answer, and delete it — heading and all — under
the working-tree answer. It is the one place the tracker's own vocabulary appears, which is what keeps a
different tracker a rewrite of that subsection rather than of the skills.

Under the tracker answer, fill in its three parameters and check its one optional line:

- **Repository**, as `OWNER/REPO`. Confirm it against the remote rather than asking blind.
- **Backlog label** and **Planned label.** They ship as `workflow:feature` and `workflow:planned`. List the
  repository's existing labels first: a project already using either name for something else needs a
  different one.
- **Types.** Where the project has issue types configured, name them; where it has none, delete the
  `**Types:**` line. The workflow sets a type and never reads one.

Everything else in that subsection — the primitive table, the planned label, priority, `blocked by`, and
what the body's ceiling costs when it is reached — is live prose and stays as it is.

## How much a plan may hold

Two numbers, and both ship with an answer already in them: a **ceiling** of 65,536 characters and a
**reserve** of 500 characters per phase row. They hold under both answers above, so this section stays
either way — which is why it is a `##` of its own, below the subsection deleted under the tree answer and
not inside it.

**Leave them alone unless the project has a reason.** The ceiling is the issue body's hard limit under the
tracker answer, and the working-tree answer takes the same number on purpose — a plan that fits one
substrate fits the other, so adopting a tracker later never forces a split that the tree had already
passed. Raising it in the tree is the one edit that breaks that, so a project that raises it should know
it is choosing plans a tracker will not accept.

The reserve is how much the ledger is expected to grow after the plan lands: one sha and a one-line Note
per row, written twice. It is the number to change if this project's phases are unusually many or its
Notes unusually long — and a Note long enough to matter is the thing to fix instead.

## What this file does not decide

Nothing to fill in. Live prose in the stub.

## The rules that hold either way

Nothing to fill in. Live prose in the stub, and it holds under both answers.
