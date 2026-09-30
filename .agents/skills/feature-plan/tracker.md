# /feature-plan — under the tracker answer

Read this after [`SKILL.md`](SKILL.md), and only where [`context/tracking.md`](../../../context/tracking.md)
names the tracker. Every step in that file holds; this says what changes.

## Under the tracker answer

Read [`context/tracking.md`](../../../context/tracking.md) first. The steps above hold — pick, check,
research, write, report — and only where the plan lands changes.

| Above | Becomes |
|---|---|
| `/feature-plan "<name>"` | `/feature-plan #<issue>` — the number is the name under this answer |
| pick from `context/roadmap.md` | pick from the open issues carrying the backlog label |
| the ranking's first key | **the issue's `Priority:` line**, above everything below it |
| ranking's *has a draft* | the issue body already holds researched material rather than one or two lines |
| ranking's *unblocked by what just shipped* | **the issue's blocked by relationships** — and an issue with an open blocker is not offered at all |
| ranking's *backlog order* | nothing — an issues list has no manual order, which is what `Priority:` replaces |
| `git mv` a draft into `plans/` | nothing moves — **the plan replaces the body of the same issue** |
| copy `plan-template.md` to a new path | write the template's sections into that issue's body |
| the phase ledger, Status column and all | **unchanged** — the same table, written into the body |
| step 6, repoint **Doc** | nothing — a plan is the observation that the body holds a ledger, plus the planned label, which is a rendering of it and is read by nothing |
| step 2's *already planned* check | the body already holds a phase ledger |
| nothing — a plan document has no size limit | **the body does**, and a plan that overflows it is split rather than trimmed |

**The ledger does not change shape.** `#`, `Phase`, `Depends on`, `Status`, `Note` — the table a plan
document carries, written into the body with every row `not started`. There is no second object to create,
nothing to reconcile it against, and **no window in which a plan is half-written: the body is one write.**

### A plan that will not fit is a plan for too much

That one write has a ceiling. [`context/tracking.md`](../../../context/tracking.md) says how large a body
may be; **measure the plan against it before writing, not after a write fails.**

The plan must fit with **room to spare**, because the same body is edited for the feature's whole life:
each phase row moves to `in progress` and then to `done`, gaining a commit sha and a note as it closes. A
plan that only just fits has already failed — the last phase would not land.

**Overflow is a scope signal, and the only honest response is to split the feature.** A filled plan is a
few thousand characters. One that reaches the ceiling is the design, the phases and the risks of more than
one piece of work written into a single document, and the substrate is the first thing that has said so.

**Three ways out are refused, and naming them matters because each looks reasonable at the moment it is
reached:**

- **Trimming the plan until it fits.** That discards exactly the research the plan was written to hold, to
  satisfy a limit that was telling you something true.
- **Continuing the plan into comments.** The plan would then have no single home, and a reader could not
  tell which half is current — the thing putting the ledger back in the body settled.
- **Linking out to a document or a paste.** Same failure, plus a second place to keep in step.

#### How to split

**Propose, then ask.** The phase list is already the seam — phases are commit-sized units with real
`Depends on` values, so a cut across a dependency boundary is a cut the research has already justified.
Offer the split as a numbered list, each chunk with the phases it carries and what it depends on, and
**write nothing until the user answers.** Splitting a feature in two is a scope decision, and this command
asks before it commits far less than that.

Once they agree:

- **The issue being planned keeps the first chunk**, and its plan is written into the body as normal. Keep
  the id: the thread, the reporter and everyone subscribed are the same reason adoption does not open a
  second issue about one thing.
- **Every other chunk becomes a new backlog issue** — carrying the backlog label, `pending`, with the one
  or two lines of why, a `Size:` and a `Priority:`. No plan and no ledger: they are Tier-1 entries, and each
  gets its own `/feature-plan` run when its turn comes.
- **The order between the chunks is a relationship, not a sentence.** A cut along a dependency boundary has
  just established which chunk waits on which, so record it the way
  [`context/tracking.md`](../../../context/tracking.md) says — one write per edge, visible from both ends.
  This is the strongest dependency the workflow ever knows about, and writing it into a body instead would
  leave the backlog's next reader to notice it by eye.
- **Cross-link anything the relationship does not carry**, so the split is visible from any one of them.
  Two chunks that share a subject without either waiting on the other get a mention in each body and **no
  relationship** — recording one there would hide runnable work behind nothing.
- **No parent issue, and no issue whose phases are separate objects.** The ledger lives in a body; a
  hierarchy laid over that is a second home for the same ordering.

Then plan the first chunk only, and **report the split first** — what was cut where, which issues were
opened, and which one this plan covers. That is the most consequential thing the run did.

**If the user declines the split**, say plainly that the plan cannot be written into this substrate as one
feature, and stop. Do not write a shortened version as a compromise: a plan trimmed to fit reads exactly
like a plan that was small enough, and nothing downstream can tell the two apart.

### What it waits on — read before the ranking, set after the research

[`context/tracking.md`](../../../context/tracking.md) says how this tracker records that one feature waits
on another. This command is both the main reader of that and the best-placed writer of it, at two different
moments.

**Read it before ranking.** One listing carries every open backlog issue's blockers, so this costs nothing
and changes what gets offered. **It is a filter and not a key** — it runs first, and `Priority:` then orders
what is left. An `Urgent` issue waiting on an open blocker is still waiting, and saying so is more useful
than ranking it first:

- **An issue with an open blocker is not a candidate.** Leave it out of the four, and list what was left
  out under them — one line each, naming the issue it waits on. A backlog where three of eight entries are
  waiting is a fact the user wants to see, not one to silently filter.
- **A blocker that is closed has been satisfied**, and the issue is an ordinary candidate. Nothing is
  removed on the way out; a closed issue does not block.
- **Every pending issue blocked** is a real state and the answer is not to pick one anyway. Say so, name
  what each is waiting on, and stop — where the blockers are themselves in the backlog something has been
  recorded in a circle, and where they are not, the next move is outside this workflow.
- **A named entry is planned even when it is blocked.** Planning is not activation, and planning ahead is
  what the split between them is for — say it is blocked and by what, and write the plan.

**Set it after the research.** Step 4 goes looking for what this feature is built on, so its brief gains one
question: **which open issues have to land before this one?** That is the moment the dependency is known
with evidence behind it rather than guessed from a sentence, which is why this command corrects what
`/roadmap` recorded rather than the other way round.

- **Record what the research found**, on the issue being planned.
- **Remove one the research disproves** — an entry `/roadmap` marked as waiting on something it turns out
  not to need. Say that you removed it and why; it is the same correction the type gets, on a field that
  actually changes what gets picked up.
- **Name both in the report.** What this feature waits on is as much a part of the plan as its phases, and
  it is the part nothing downstream re-derives.

### Priority leads the ranking

`Priority:` is read **above *has a draft***, and that is the only place this command's ranking changes.
Overriding the default order is the entire purpose of marking something urgent, so a key that only broke
ties between equally-prepared entries would not do the job it was added for. An issue carrying no
`Priority:` line ranks as `Medium`.

**Name the priority in the entry's one-line reason**, alongside whatever else put it where it is. The cost
of this placement is that the top candidate can now be unresearched — acceptable only because this command
still **asks**, and it would not be if it silently took the top entry.

### The planned label, applied here

[`context/tracking.md`](../../../context/tracking.md) names the label that says a feature has a plan.
**Apply it in this same run, immediately after the body write**, and say that you did.

**It is a rendering and never an answer.** *Whether this feature has a plan* is the ledger in the body,
which is what this command checks in step 2 and what every other command reads. The label exists so that a
person scanning the issues list can see the tier boundary without opening anything, and **nothing in this
workflow may start reading it** — not this command's ranking, not a refusal, not a report.

- **After the body, not before it.** The plan is the fact; a label on an issue whose body is still one or
  two lines is a sticker with nothing behind it. Where the body write fails, no label.
- **Best-effort, like the type.** Applying a label needs triage on the repository, and where the write is
  refused say so once and carry on. The plan landed; the plan is what matters.
- **Never apply it to anything else.** Not to the chunks a split opens — those are Tier-1 entries with no
  plan — and not to an issue this run did not plan.
- **Never remove one.** Nothing in this workflow takes it off, including a close.

### The type, corrected here

`/roadmap` guessed the issue's type from one or two lines. **You have the research it lacked: correct the
type if the guess was wrong, and leave it alone if it was right.** That is the whole of this command's
involvement with it. Nothing here reads it, and no refusal, ranking or report may start to.

Where the project has no types configured, or the write is silently dropped for want of push access, skip
it and say so once — it is metadata, not a gate.

### The rest

**`--activate` assigns the issue** rather than editing a marker, subject to the same one-active-feature
rule and the same outcome when the slot is held: write the plan, skip the activation, name the holder.

**Step 7's ordering problem disappears, and that is worth knowing.** Under the working-tree answer the plan
has to be committed and pushed *before* a worktree exists, because a tree carries only what its source ref
holds. An issue is in no ref: it is visible from every tree the moment it exists. Plan, then create the
tree, in whatever order suits — nothing here has to land first.

**Step 5's `**Status:**` rule applies to the issue body verbatim, and only to the feature.** The body holds
the plan and never a line claiming where the *feature* stands; that fact is the assignee. The ledger's
Status column answers a different question at a different scope, and it belongs in the body exactly as it
belongs in a plan document.
