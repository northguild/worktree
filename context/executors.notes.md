# Filling in `executors.md`

The guidance for filling [`executors.md`](executors.md), read by `/onboard` and by anyone filling the file
by hand. The stub is the answer; this file is never read by a command in the loop, so nothing here costs a
phase anything. Each heading below mirrors a section of the stub, in the stub's order.

## Coder

Exactly one of the three answers below is this project's. Keep it, delete the others.

**Shipped as:** the subagent answer, with in-host as its own fallback. That is a valid configuration, not a
gap: a runtime with no subagent mechanism reads the shipped line and implements in-host.

The subagent answer needs no invocation written down — the brief is `context/roles/coder.md`, which is
already in this repository. Keep it only if this host actually has such a mechanism. Its tier is written
as an alias the runtime resolves, never a dated model id, because a subagent has no config of its own to
take a model from — see the exception under *Standing rules for any external executor* in the stub.

For an external coder, write its exact invocation, including any directory or permission scoping it needs
on this machine. Its system prompt is `context/roles/coder.md` too — one prompt, whichever way it is
dispatched.

Record alongside an external one whether it was actually observed reading this repository unaided, and
when. `/onboard` tests it; the standing rule in the stub says why the answer changes how briefs are
written.

### The three answers, copy-ready

**Not configured — implement in-host.**

**A subagent, briefed with [`roles/coder.md`](roles/coder.md), on `sonnet` where this runtime lets you
choose a subagent's model — otherwise implement in-host.** The phase's implementation runs in its own
context and returns that file's output contract; the ledger and the gates stay with the caller. A runtime
with no subagent mechanism reads this answer, implements in-host, and says so. Same code, smaller caller —
worth most on long plans, where the alternative is a context window carrying every file read of every
phase.

**Offloaded to `<the exact invocation>`.** Repository reads verified: `<yes / needs content inline>`,
`<when>`.

### One optional line a project may add to its Coder answer

On a loopback, re-dispatch on the reviewer's tier rather than retrying the same one — a phase that reaches
the cap costs more than one strong run would have.

## Reviewer

Exactly one of the three answers below is this project's. Keep it, delete the others.

**Shipped as:** the reviewer subagent, with the host reviewing its own diff as its own fallback. The
fallback is the weakest of the three and the only one that always works, which is why it is the fallback
rather than the recommendation.

A host that offers review often offers more than one shape of it — a review subcommand, a review skill it
can be asked to run, a subagent it installs — and they do not review alike. Whichever was chosen, write it
down. Nothing shipped with this tool names an invocation, because the winner differs per host.

### The three answers, copy-ready

**Not configured — the host reviews the diff against the plan's review checklist, and says so.**

**A reviewer subagent, where this runtime provides one — otherwise the host reviews the diff against the
plan's review checklist, and says so.** An independent reader that never saw the implementation being
written is the cheapest real independence available. `/onboard` finds what this host installs or offers;
where this tool wrote a reviewer into a host-specific directory, that is what this answer means.

**Offloaded to `<the exact invocation>`.**

## Branch and worktree

Fill this in only where [`git.md`](git.md)'s *Where work lands* is a branch or a worktree per feature.
Under the main-working-tree answer the workflow creates neither, and this section stays as shipped.

**Shipped as:** not configured — the workflow creates no branch and no worktree.

Write the exact invocation, the way the coder's is written. A worktree CLI usually also handles the
env-file copying, the editor, and the removal — record those too, and anything it needs configured on this
machine before it works. `/onboard` asks for all of it.

If there is a way to ask whether an agent session is live in a tree, record that command as well:
`/feature-status` reports it where there is one and says it cannot tell where there is not.

### The answers, copy-ready

**A branch is created by `<the exact invocation>`.**

**A worktree is created by `<the exact invocation>`**, removed by `<the exact invocation>`, and the
live-session probe is `<the exact invocation, or none>`.

## The contract, whatever is configured

Nothing to fill in. The contract is live prose in the stub and holds under every answer above.

## Standing rules for any external executor

Nothing to fill in. The rules are live prose in the stub. The one that bears on this file's answers is the
model rule: an external executor's model comes from its own config, and a subagent's tier is written in the
Coder answer as an alias, because a subagent has nowhere else to carry one.
