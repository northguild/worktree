# /feature-status — under the tracker answer

Read this after [`SKILL.md`](SKILL.md), and only where [`context/tracking.md`](../../../context/tracking.md)
names the tracker. Every step in that file holds; this says what changes.

## Under the tracker answer

Read [`context/tracking.md`](../../../context/tracking.md) first. This command still writes nothing and
still ends with exactly one next action.

| Above | Becomes |
|---|---|
| step 1's `roadmap.md` | the open issues carrying the backlog label |
| step 1's status ledger | **unchanged** — it is the same table, in the issue body |
| step 1's git state | unchanged — it is still this tree's |
| step 2's worktree sweep | **one query: the assigned issues** |
| nothing — the tree cannot say what a feature is waiting on | **the backlog's blocked by relationships**, which the same listing already carries |

**Step 2 gets shorter and stronger, and it is the clearest payoff of this answer.** The sweep exists
because `roadmap.md` on the default branch cannot see what is in flight, so it walks every tree and reads
each one's files. That only ever worked for trees **on this machine**. The tracker is outside every tree:
one query for the assigned issues answers what is in flight across every machine, and it answers it for
agents this checkout has never heard of.

Keep `git worktree list` anyway, and report the two side by side. They answer different questions — which
trees exist *here*, and which features are claimed *anywhere* — and the interesting line is where they
disagree:

- **Assigned with no local tree** — normal. Someone else's agent has it.
- **A local tree whose feature is unassigned** — a claim that was dropped, or a tree left behind after a
  close. Report it; do not assign anything.

### What the backlog is waiting on

[`context/tracking.md`](../../../context/tracking.md) says how this tracker records that one feature waits
on another, and the listing that answers *what is the backlog* carries it already. So add one line above
**Next**, and nothing for a repository whose backlog has no relationships in it:

```
Waiting: <n> of <n> pending
  <issue>  <name>  on <issue> <name>
```

**This is the line the question is usually about.** *What should I pick up next* has two halves — what is
ranked highest, and what is not available at all — and under the working-tree answer the second half is
unanswerable, so it is simply missing. Nothing else in this report changes: the next action is still
exactly one, and it is still named by the same order.

**Waiting is not a discrepancy.** An entry with an open blocker is the ordinary state of a backlog that has
been read honestly, and a blocker that is closed has been satisfied — nothing clears a relationship on the
way out.

**Two states here are worth stopping on**, and both are invisible under the other answer:

- **An assigned issue with an open blocker.** Work is under way on ground that has not landed. Say which
  blocker, and leave it; deciding is the user's.
- **A cycle** — two issues waiting on each other, directly or around a loop. Nothing in the backlog is
  runnable and no ranking will say why. Name the loop.

### The reconciliations that only exist here

Add these to step 3, and stop on them the same way:

- **A planned label that disagrees with the body.**
  [`context/tracking.md`](../../../context/tracking.md) names the label that says a feature has a plan, and
  it is a rendering of the ledger rather than a second answer — so **the body wins, always**, and this
  command reports the disagreement rather than resolving it. Two shapes: a body holding a ledger with no
  label, which is an interrupted `/feature-plan` or a plan written by hand; and a label on a body with no
  ledger, which is a label applied by hand. Say which issue and which way round. **This command writes
  nothing, so it does not fix either one** — naming it is the whole of the job, and the fix is a person's.
  **This is the only place the label is looked at at all**, and looking is not reading: no next action, no
  ranking and no report line anywhere else may be derived from it.
- **A stale claim.** An issue assigned whose last comment is old — the phase opened and nothing since. The
  heartbeat is what makes this visible; say how long, and that reclaiming is a person's decision. **Never
  un-assign someone else's agent.**
- **A `done` row carrying no evidence in its Note** — neither a commit sha, nor, under
  [`context/git.md`](../../../context/git.md)'s *the user commits*, a statement that the change is
  uncommitted and where. A body edit cannot ride the commit under this answer, so the Note is the only
  thing tying the row to the repository. A sha that is not in the branch is the same disagreement one
  substrate over; **no evidence at all is one the working-tree answer cannot produce**, because there the
  row travels inside the commit.

**A `done` row whose commit is unpushed is not a discrepancy** — the same way a `done` row with
uncommitted changes is not. It is the normal state between the gates passing and the branch landing.
