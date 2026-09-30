# /feature-close — under the tracker answer

Read this after [`SKILL.md`](SKILL.md), and only where [`context/tracking.md`](../../../context/tracking.md)
names the tracker. Every step in that file holds; this says what changes.

## Under the tracker answer

Read [`context/tracking.md`](../../../context/tracking.md) first. **The refusal is unchanged** — every
phase finished — and so is everything about pushing.

| Above | Becomes |
|---|---|
| resolve from `roadmap.md` | resolve from the issues carrying the backlog label |
| every phase `done` | **unchanged** — every row in the body's ledger reads `done` |
| remove the entry, append a `history.md` row | **the issue is closed** — *completed* for shipped, *not planned* for `--dropped`. See *Who closes it* |
| the one-line why | the closing comment |
| `git mv` the plan to `archive/` | nothing moves; the issue keeps its body and its whole thread |
| rewrite the document header | nothing — a closed issue does not claim to be open |
| the reference sweep | **nothing to sweep.** No path changed, so no link broke |
| delete `context/notes.md` | **unchanged** — it is a file in a working tree under either answer, and it is deleted the same way |

**The archive is the closed issue**, and it is more than the file it replaces: the plan, the discussion
that shaped it, the finished ledger with every phase's Note, and the pull request, all at one id that
nothing had to rewrite. This is why the sweep and the header rewrite both disappear rather than being
ported.

### Who closes it

**Where [`context/git.md`](../../../context/git.md) says the agent pushes and opens a pull request**, put
`Closes #<issue>` in the pull request body and let the merge close it. The close then rides the same change
as the work — which is exactly what appending the `history.md` row does under the other answer.

**Where it says anything else, close the issue here**, with the closing comment, and say that is what
happened. Nothing else will: the trailer fires only when the commit reaches the default branch, and under
those answers it never gets there.

**`--dropped` always closes here, whatever `git.md` says.** A trailer closes an issue as *completed*, and
that is the wrong outcome for an idea that will not be built — the two close reasons are how this answer
records what `history.md`'s Outcome column used to.

This is the only place `git.md`'s answer changes what this command does, and it is why
[`context/tracking.md`](../../../context/tracking.md) recommends pairing this substrate with the push
answer rather than requiring it.

**The release note is unchanged.** It is an artifact of the change rather than workflow state, so it is a
file in this repository under both of [`context/tracking.md`](../../../context/tracking.md)'s answers —
written, confirmed and committed exactly as above, and carried by the same pull request that closes the
issue.

**Keep the label and keep the assignee.** The label is what makes retired features findable later, and the
assignee is the record of who ran it. Neither means anything once the issue is closed, and removing either
loses a fact for no gain.

**`--dropped` closes as *not planned*, and the reason goes in the comment**, verbatim in substance. That
comment is what stops the idea being re-proposed, so a vague one makes it worthless — exactly what the
`history.md` row was for.

**Say what this feature was blocking, before closing it.** A closed issue stops blocking whatever was
waiting on it — see [`context/tracking.md`](../../../context/tracking.md) — and for a shipped feature that
is the point: the wait is over and nothing has to be cleared. **For `--dropped` it is not.** Those issues
have just been freed by work nobody is going to do, and their entries may have been written expecting it.
Name them in the closing comment and in the report, and **leave the relationship alone** — the closed issue
and its reason are the only explanation a person will find when they open one of those issues next month.

**Then push, if `git.md` says so.** Unchanged, except that the pull request body links the issue rather
than an archived path, and carries the trailer described above.
