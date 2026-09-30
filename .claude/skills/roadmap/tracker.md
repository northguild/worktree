# /roadmap — under the tracker answer

Read this after [`SKILL.md`](SKILL.md), and only where [`context/tracking.md`](../../../context/tracking.md)
names the tracker. Every step in that file holds; this says what changes.

## Under the tracker answer

Read [`context/tracking.md`](../../../context/tracking.md) first — it names the repository and the labels,
and its table is the only place the tracker's own vocabulary appears. The tier model does not change; the
backlog is a set of issues rather than a file.

| Above | Becomes |
|---|---|
| read `context/roadmap.md` | list the open issues carrying the backlog label |
| append an entry | open one issue: the title is the kebab-case name, the body is the one or two lines |
| a `drafts/<NAME>.md` file | the same material, in that issue's body |
| set **Doc:** | nothing — a plan is the observation that the issue body holds a phase ledger |
| the entry's `Size:` field | a `Size:` line in the body, joined by a `Priority:` line |
| check `context/history.md` for a dropped idea | search **closed** issues; *closed as not planned* is the dropped case, and its closing comment is the reason |
| the print's **name** | the issue's number and title |
| the print's `pending` / `active` **marker** | the assignee — assigned is being worked, unassigned is not |
| the print's **Doc** field | nothing to print; *has a plan* is read off the body, and the shape below says how |
| the print's *nothing is `active`* | no issue carrying the backlog label is assigned |

**The print has its own shape under this answer**, because three of its four steps name things this
substrate does not have. *The backlog, printed* below replaces steps 2 to 4; step 1 becomes the listing
above, and everything under *With an argument* is unaffected.

**Write no file.** No entry, no draft, no `Doc` field. The issue body carries the one or two lines, and the
reference material goes into that same body under a heading rather than into a separate document — the
draft and the plan are one object here, edited in place, which is why `/feature-plan` can keep the id.

**Set two things the file answer has no room for**, both named in
[`context/tracking.md`](../../../context/tracking.md) and neither read by anything in this workflow's loop:

- **A `Priority:` line in the body.** Ask for it if the user's wording does not imply one, and write
  `Medium` if they have no view. An issues list has no manual order, so this is the only place *what
  matters more* can be said under this answer — `/feature-plan`'s ranking reads it and nothing else does.
- **The issue's type**, if this project has types configured. It is a **guess from one or two lines** and
  it is meant to be: `/feature-plan` corrects it once there is research to correct it from. Where the
  project has no types, or the write is silently dropped for want of push access, skip it and say so once
  — it is metadata, not a gate.

**Do not branch on either one.** Neither the type nor the priority changes what this command does; they are
recorded for the tracker's readers, and a command that started reading them would be adding a vocabulary
[`context/workflow.md`](../../../context/workflow.md) does not have.

**Never apply the planned label.** [`context/tracking.md`](../../../context/tracking.md) names a second
label, for features that have a plan. **Everything this command opens is an idea by definition** — that is
what Tier 1 is — so the backlog label is the whole of what it applies, and `/feature-plan` adds the other
one when there is a plan behind it. A backlog entry that arrives looking planned is the one way this
command could lie about a tier, and it is the tier the label exists to show.

Everything the *Capturing reference material* section says still holds, including the credential rule:
**an issue body is a tracked file for that purpose and probably a more public one.**

### The backlog, printed

**One read answers all of it.** The listing that carries the open backlog issues carries each one's body,
its assignee and what it waits on, so this whole print is a single query — no per-issue fetch, and nothing
cached between runs.

**Group by tier, because that is the question this command answers.** Planned first, ideas second, and
each row on one line:

```
PLANNED (2)
  #12  export-api      Large · High · assigned    exports blocked on manual CSV
  #17  audit-log       Medium · Medium            compliance asked for a trail

IDEAS (3)
  #24  webhook-retry   Small · High               deliveries drop silently
  #19  dark-mode       Small · Medium             the most-asked thing in support
  #21  billing-export  Large · Medium             waits on #12 export-api

2 planned · 3 ideas · 1 waiting
```

- **`Size:` and `Priority:` come off the body**, and an issue carrying no `Priority:` line reads as
  `Medium` — the same default the ranking uses, so the print and `/feature-plan` never disagree about what
  an unmarked entry is.
- **`assigned` is the marker's replacement**, and it is the whole of what this command says about who is
  working on what. No name, no duration, no staleness — that is `/feature-status`.
- **`waits on #N` is the relationship**, printed on the row it constrains and in whichever group the entry
  belongs to. **Do not lift a waiting entry into a group of its own**: what tier it is in and what it is
  waiting on are different facts, and collapsing them is what the two groups exist to prevent. A cycle, or
  a backlog where everything is waiting, is worth one line under the count and no more.
- **An empty group still prints, with `(0)`.** *No plans at all* and *no ideas left* are both answers
  somebody came here for, and a heading that vanishes reads as a backlog that was not looked at.

#### A plan is a ledger in the body — presence, and nothing past it

**Look for the phase ledger. Do not read it.** Whether the body holds one is the tier fact and the only
thing this print needs. The Status column, how many phases are `done`, which one is next — all of it is
sitting right there in the body you have already fetched, and **none of it belongs in this output.**
`/feature-status` answers *where does it stand*; this command answers *what is on the list*, and the
temptation to cross that line is much stronger here than under the working-tree answer, where knowing a
plan exists never meant holding it open.

**Do not read the planned label, and do not print it.**
[`context/tracking.md`](../../../context/tracking.md) puts a label on a planned feature so the **issues
list** can be read without opening anything. It is a rendering of the ledger, not a second answer, and a
report that consulted it would be deriving a fact from a copy while the original was already in hand. The
body decides, every time. A label that has gone out of step with a body is real, and finding it is
`/feature-status`'s job, not this command's.

**If nothing is assigned, name `/feature-plan`** — and **do not pick a candidate.** That command ranks the
backlog and asks, and a name suggested here would either duplicate its ranking or quietly contradict it.

### The order between entries, where the idea names one

**A backlog that says which entries are waiting on which is the one this command can produce and the file
answer cannot.** [`context/tracking.md`](../../../context/tracking.md) says how this tracker records it —
a relationship on the issue that has to wait, not a line in anybody's body. Set it while you are opening
the issue, because nothing later in the loop goes looking for what an entry was always waiting on.

Two cases, and no third:

- **The idea's own wording names a prerequisite** — *after the export API*, *once auth lands*, *needs the
  new schema*. Match it against the backlog you have already read for the duplicate check. If it names an
  open issue there, record the dependency.
- **One invocation became several entries.** The *several ideas* rule at the bottom of this file splits
  them; if they have an order, record it between them as you open them. This is where an order is most
  obvious to the person describing it and most reliably lost — they said it once, in a sentence that became
  three issues.

**Do not go looking for one.** A dependency you inferred from what you know about the domain, rather than
from what the user said, is a guess with consequences: a blocked entry drops out of *what to pick up next*,
so a wrong one hides work and nobody is told why. Where the wording is ambiguous, ask, or leave it — the
same call `/feature-plan` makes with the research to back it.

**Say what you set, next to the entry you set it on.** One line naming both issues. A wrong relationship
costs one edit to remove, and only if the user can see it.

### Adoption — a second way to append

Someone else's issue can enter the backlog without being retyped:

```
/roadmap #123          # adopt an existing issue into the backlog
```

Apply the backlog label to it and stop. **Copy nothing and rewrite nothing** — the reporter's wording, the
discussion and everyone subscribed are the reason this is better than opening a second issue about the same
thing. Add a comment saying it has entered the backlog, and leave the body alone until `/feature-plan`.

- **Check it is worth adopting first.** [`context/workflow.md`](../../../context/workflow.md)'s test is
  unchanged: adopt it only if you would want a history row for it. An issue smaller than that is
  `/orchestrate` work — fixed and closed by the commit, never labelled, never in the backlog.
- **The label says nothing about kind.** A bug large enough to plan is a feature in this workflow's
  vocabulary. Leave every label the issue already carries exactly where it is.
- **Never overwrite a type someone else set**, and never retype an adopted issue. Whoever filed it
  classified it, and the same argument that keeps their wording keeps their type. Set one only where the
  field is empty.
- **Ask for a priority rather than inventing one.** An adopted issue arrives with no view on where it sits
  against the rest of the backlog, and guessing puts a stranger's work in your ranking's top slot.
- **Leave its relationships exactly as they are**, for the reason that keeps its wording and its type:
  whoever filed it may have recorded what it waits on, and adopting an issue is not a licence to re-say
  what it already says. Add one only where the user names it.
- **The title may not be a kebab-case name**, and other people's issue titles are not yours to rewrite. Say
  what name the workflow will use for it and put that name in your comment.
- **An adopted issue is never planned**, whatever its body already holds. Somebody else's write-up can look
  a great deal like a plan; it has not been through `/feature-plan`, it has no ledger this workflow wrote,
  and applying the planned label to it would put a feature in Tier 2 on the strength of a stranger's prose.
  The backlog label is the one bit adoption adds.
