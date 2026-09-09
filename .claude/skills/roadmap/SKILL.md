---
name: roadmap
description: "Print the Tier-1 feature backlog, or append one new pending entry to it — in context/roadmap.md, or in the issue tracker where context/tracking.md says so. Explicit invocation only — run this when the user types /roadmap. Do NOT match on general planning talk, 'what should we build next', or any request to design, plan, or implement a feature."
disable-model-invocation: true
---

# /roadmap

Maintains **Tier 1** — the backlog in `context/roadmap.md`. It never promotes anything, never writes a
plan, never marks anything `active`, and never removes an entry.

It *may* write a **draft** in `context/drafts/` — raw reference material the user supplied, which
`/feature-plan` later turns into a plan. Keep that line straight: capturing what someone told you is not
designing.

Read [`context/workflow.md`](../../../context/workflow.md) for the tier model, and
[`context/tracking.md`](../../../context/tracking.md) for where the backlog lives. **Everything below is
written for the working-tree answer**, which is the default and the one a missing file means; *Under the
tracker answer* at the end says what changes.

## Usage

```
/roadmap              # print the backlog — read-only
/roadmap "some idea"  # append one pending entry
/roadmap #123         # adopt an existing issue — tracker answer only
```

## No arguments — print the backlog

1. Read `context/roadmap.md`.
2. Print every entry: name, marker, size, the one-line why, and what its **Doc** field points at.
3. Say which entries have a plan (**Doc** into `plans/`) and which do not. Those are different facts from
   the `pending`/`active` marker, and reporting them as one is the mistake the two fields exist to prevent.
4. If nothing is `active`, name `/feature-plan` as the way to get there. **Do not pick a candidate** — that
   command ranks the backlog and asks.

**Do not** read a plan's ledger or report phase status. That is `/feature-status`. This command answers
"what is on the list", not "what is next".

## With an argument — append an entry

1. Read `context/roadmap.md` for the existing entries and the format already in the file.
2. **Check for an entry that already covers the idea.** If one exists, say so, show it, and stop — do not
   add a near-duplicate. Also check `context/history.md`: an idea previously `dropped` has a recorded
   reason, and re-proposing it needs that reason addressed, not ignored.
3. Derive a **kebab-case name**. It becomes the entry's identity and is what `/feature-plan`,
   `/feature-implement` and `/feature-close` are given later, so make it specific and stable.
4. Append to the end of the **Features** list, matching the file's format. It is always `pending` — the
   marker in the heading is the entry's status, and this command never sets any other value:

```markdown
### <kebab-case-name> — `pending`

<One or two lines: the problem, or what becomes possible. Not a design.>

- **Size:** <small | medium | large> — <what drives the size, a few words>
- **Doc:** none yet
```

5. **If the user supplied reference material, capture it** — see below. Otherwise leave `**Doc:** none yet`.
6. Show the appended entry, and the draft if you wrote one, then stop.

### Capturing reference material

**Capture beats summarise.** When the user gives you more than the idea — a screenshot of documentation, a
pasted setup guide, a URL, an error dump, a long explanation of how they want it to work — that material
does not go in the entry and must not be thrown away. Write it to `context/drafts/<NAME>.md` and point the
entry's **Doc** field at it:

```markdown
- **Doc:** [`drafts/<NAME>.md`](drafts/<NAME>.md) — <what it is, a few words>
```

`drafts/` is the right directory and `plans/` is not. A draft is notes: no ledger, no template sections,
nothing executable. `/feature-plan` moves it into `plans/` when it writes the plan, which is also why you
never write directly into `plans/` from here.

What to write in it:

- **The specifics that are expensive to re-derive** — exact package names, version or compatibility
  requirements, config keys, the shape of an API call, the wording of an error.
- **Where it came from, and when.** A screenshot of vendor docs on a date is worth more than the same facts
  with no provenance, because docs move.
- **What it means for *this* repo.** Check the relevant config or source and say what already holds and
  what would have to change. This is the part a screenshot cannot tell you, and the part that rots slowest.
- **Never transcribe a credential.** See the standing rule in
  [`context/workflow.md`](../../../context/workflow.md): a DSN, token or key gets described and pointed at
  the secret store, never copied into a tracked file.

Keep the entry itself one or two lines regardless.

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

Everything the *Capturing reference material* section says still holds, including the credential rule:
**an issue body is a tracked file for that purpose and probably a more public one.**

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
- **The title may not be a kebab-case name**, and other people's issue titles are not yours to rewrite. Say
  what name the workflow will use for it and put that name in your comment.

## Rules

- **One or two lines of why. No more.** If you find yourself writing a third paragraph, that is a signal the
  idea is ready for `/feature-plan`, not that the entry should be longer.
- **Never guess at a design.** The entry records that a thing is wanted, not how it would work.
- **Never mark anything `active`.** Only `/feature-plan --activate` and `/feature-implement` do that.
- **Never remove an entry**, and under the tracker answer never close an issue. Entries leave only via
  `/feature-close`, which records why. Losing that reason is the whole point of `history.md` — and of the
  close reason that replaces it.
- If the idea is really several ideas, say so and offer to add them as separate entries rather than writing
  one vague entry covering all of them.
