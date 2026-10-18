# /feature-plan — a plan over its budget

Read this from step 5 of [`SKILL.md`](SKILL.md), and only when the measurement there came out over the
budget in [`context/tracking.md`](../../../context/tracking.md). Nothing else needs it, which is why it is
not in the body.

## Over the budget, the feature is more than one feature

A plan that reaches the ceiling holds the design, the phases and the risks of **more than one piece of
work** — which is already a defect by *Feature or task?* in
[`context/workflow.md`](../../../context/workflow.md), since a feature is work you would want one
`history.md` row for. Under the working-tree answer nothing else in the repository will ever say so.

**The only honest response is to split the feature.** The budget is not the thing to argue with: it was
telling you something true about the scope, and every way of satisfying it other than the split costs more
than the split does.

## Three ways out are refused

Naming them matters because each looks reasonable at the moment it is reached.

| Workaround | What it costs |
|---|---|
| **Trimming the plan until it fits** | Discards exactly the research the plan was written to hold. And a trimmed plan reads identically to one that was small enough, so nothing downstream can tell them apart |
| **Continuing the plan into a second document** | The plan stops having a single home, and a reader cannot tell which half is current |
| **Linking out to a gist or a paste** | The same, plus a second object to keep in step |

## Propose, then ask

**The phase list is already the seam.** Phases are commit-sized units with real `Depends on` values, so a
cut across a dependency boundary is one the research has already justified. The plan's own structure is the
split proposal; you are not inventing a boundary, you are reading one.

Offer the split as a numbered list — each chunk with the phases it carries and what it waits on — and
**write nothing until the user answers.** Splitting one feature into three is a scope decision, and this
command asks before it commits to far less than that.

## Once they agree

- **The entry being planned keeps the first chunk**, and its plan is written as normal. Do not retire it
  and open replacements: it is the entry the user chose, and under the tracker answer it is also a thread
  with a reporter and subscribers on it.
- **Every other chunk becomes a new Tier-1 backlog entry** — `pending`, with the one or two lines of why
  and a size. **No plan and no ledger**: each gets its own `/feature-plan` run when its turn comes, and a
  ledger written now would be a plan nobody wrote.
- **Record the order between the chunks** the way [`context/tracking.md`](../../../context/tracking.md)
  says. The cut has just established which chunk waits on which, and that is the strongest dependency this
  workflow ever knows about.
- **No parent entry, and no entry whose phases are separate objects.** The ledger lives in the plan; a
  hierarchy laid over the chunks puts the phase ordering into a second home.

Then plan the first chunk only, and **report the split first** — what was cut where, what was opened, and
which chunk this plan covers. That is the most consequential thing the run did.

## If the user declines

Say plainly that the plan cannot be written as one feature, and **stop**. Do not write a shortened version
as a compromise: a plan trimmed to fit reads exactly like a plan that was small enough, and nothing
downstream can tell the two apart.

The research is not wasted. It is in the transcript, and the entry is still there to plan once it has been
cut down to one feature.
