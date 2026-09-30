# /feature-implement — under the tracker answer

Read this after [`SKILL.md`](SKILL.md), and only where [`context/tracking.md`](../../../context/tracking.md)
names the tracker. Every step in that file holds; this says what changes.

## Under the tracker answer

Read [`context/tracking.md`](../../../context/tracking.md) first. Every step above holds — the approval
checkpoint, both gates, the loopback cap, the refusal to mark `done` on a self-report — and **the ledger is
the same table it always was.** What changes is that the table lives in the issue body, plus two mechanisms
that exist because more than one agent can be running.

| Above | Becomes |
|---|---|
| the `active` marker | the issue's assignee |
| the plan, its phase list, its `Depends on` and its ledger | the issue body — **unchanged**, it is still the plan and still the same table |
| step 1's *dependencies shipped* | **the issue's blocked by relationships** — readable before anything ships, and in step 2 a stop rather than a ranking key |
| step 6, open the row | edit that row's Status to `in progress` in the body |
| step 11, close the row | edit that row again, naming the commit's sha in the Note |

**Step 3 reads one place.** The body holds the phase list, the dependencies and the status together,
exactly as a plan document does. Pick the same way — the lowest-numbered phase that is not `done` and whose
`Depends on` are all `done` — and step 5's disagreement rule reads unchanged.

### An open blocker, in steps 1 and 2

[`context/tracking.md`](../../../context/tracking.md) says how this tracker records that one feature waits
on another, and under this answer step 1 can read it rather than inferring it. *Dependencies shipped* is a
`history.md` row under the other answer — knowable only afterwards. Here the same fact is on the issue
before either feature starts.

- **Step 1 does not offer a blocked issue.** Rank what is runnable; name what was left out and what each is
  waiting on, in one line each. An issue whose blockers are all closed is ordinary — nothing has to clear
  them, because a closed issue does not block.
- **Step 2 stops on one.** The checkpoint already refuses to start work the ground has moved under; an open
  blocker is that, stated by the backlog rather than discovered in the tree. Name the blocker and stop. If
  the user overrides after being told, say plainly what is being overridden, then proceed — the plan is
  theirs and the relationship is a claim about order, not a lock.
- **A blocker closed as *not planned* is satisfied and should still be said out loud.** The tracker's rule
  is that a closed issue does not block, and a dropped feature is closed — so the plan in front of you may
  be built on work that is never going to exist. This is the one place where *unblocked* and *ready* come
  apart, and nothing else in the loop looks at it.

**This command writes no relationship.** `/roadmap` records the order the user named and `/feature-plan`
corrects it with research behind it; discovering one here means the plan was wrong about its own ground,
which is a fact for the report and for the user, not a quiet edit at the moment work starts.

### The body is a read-modify-write

**Re-read the body immediately before editing it, and change only the row.** The body is text a person may
be editing at the same time — refining the plan while you flip a status — and a stale copy written back
loses their edit with no trace. This hazard does not exist under the working-tree answer, where the plan
sits in a tree only you are working in.

**The body has a size limit, and the row outranks everything else in it.**
[`context/tracking.md`](../../../context/tracking.md) says what it is. `/feature-plan` leaves room for the
rows this command writes, so reaching the limit here means the body grew after the plan landed. If a write
would overflow, **shorten your own Note until the row fits and say the body is at its limit** — the Status
column is the phase's only home and a row that never lands is state that is simply gone. Never drop a row,
never delete someone else's text to make space, and never move a row or a note out of the body.

### Claiming, in step 2

**Assignment is not compare-and-swap** — two agents can both read *unassigned* and both assign. So:
**assign, re-read, confirm you are the sole assignee, and back off if you are not.** Say which happened. An
issue that already has a different assignee is held; name the holder and stop, exactly as the
one-active-feature rule does above.

**The rule is per working tree and per agent, not per repository.** Several features may be assigned at
once — that is the point of this answer. What must not happen is two agents on one feature, which is also
what makes the body safe to edit: a feature has exactly one writer, and it is whoever holds the assignee.

### The heartbeat, at every phase boundary

**Comment on the issue when a phase opens and when it closes**, naming the phase and, once there is one,
the commit. Two lines is enough.

An assignee is a lock with no expiry: an agent that dies holding one leaves the issue assigned and nothing
reclaims it. The comment cannot prevent that — it makes it **visible**, from a machine that is not the one
that died. *"Phase 2 opened six hours ago and nothing since"* is a reclaimable state; an assignee alone is
not. This is step 6's argument for the opening row write, one level up.

**Reclaiming is not this command's job.** If you find a stale claim, say so and stop. Do not un-assign
someone else's agent.

**Under `--all` the heartbeat is the only thing outside the run that can see it.** A loop that dies four
phases deep leaves the same assignee it would have left after one, and nothing in the transcript reached
anyone. Comment at every boundary the loop crosses, not once at the end.

### The closing write, in steps 11 and 12

**The row cannot ride the commit here, and the sha is what replaces it.** Under the working-tree answer the
row is a line in a file that travels inside the commit, so the row and the code can never disagree. A body
edit is a remote write and cannot be part of a commit — so the evidence goes into the row instead:

- **`done`** → make the commit, then edit the row immediately, **with that commit's sha in the Note.** A
  `done` row whose sha is in the branch is checkable against the repository; **a `done` row with no sha is
  a disagreement, and step 5 stops on it.**
- **stays `in progress`** → rewrite the Note to name exactly what remains, and leave the issue assigned.
- **`blocked`** → write `blocked` in the Status column and the blocker in the Note. There is no label for
  this and none is needed: the column carries all four values.

**Where [`context/git.md`](../../../context/git.md) says the user commits, there is no sha to write.** Say
so in the Note — the change is in a named working tree and uncommitted — and write the row anyway. A row
that is never written is worse than one whose evidence is still owed, and this is the pairing
[`context/tracking.md`](../../../context/tracking.md) says is worth avoiding: under it, a phase reads
`done` from every machine while its code exists on exactly one.

**Never edit a row to get past a refusal**, exactly as no phase is marked `done` to get past one.

**A blocking defect is unchanged too**, because it was never a separate object: it is fixed, or it is the
`blocked` status in the row this section already describes, or it is an issue. Under this answer the third
of those is an issue in the same tracker as everything else, which is the one place the file answer had to
reach for a different substrate and no longer does.

**[`context/release.md`](../../../context/release.md) is unchanged too, and so is step 7.** A release note
is an artifact of the change rather than workflow state, so it is a file in this repository under both of
[`context/tracking.md`](../../../context/tracking.md)'s answers. It lands in the phase's commit, whose sha
the closing row names.
