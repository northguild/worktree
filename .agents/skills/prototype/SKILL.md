---
name: prototype
description: "Mock one screen or interaction as throwaway HTML and CSS under prototypes/, to settle a layout or look-and-feel question before a plan commits to it. Writes no application code and runs no gates. Explicit invocation only — run this when the user types /prototype. Do NOT match on 'mock this up', 'try a layout', 'what should this look like', or any request to build, style or restyle real UI."
---

# /prototype

A cheap, disposable sketch of something that will be built properly later. **No roadmap entry, no ledger,
no gates, no tier boundary crossed** — and no application source is touched.

It exists because some questions are only answerable by looking at the thing. Arguing about a layout in a
plan document is slow and inconclusive; two static files answer it in minutes, and the answer then goes
into the plan as a decision rather than a paragraph of hedging. **Nothing in the workflow requires this
command** — skip it and every other command behaves identically.

Read [`context/workflow.md`](../../../context/workflow.md) for the tier model and the feature/task rule.

## Usage

```
/prototype "<what to mock>"     # a screen, a flow, an interaction
/prototype "<entry name>"       # mock what a roadmap entry describes
```

## 0. Refuse, before anything else

1. **Refuse to build the real thing.** This command produces throwaway files outside the application. The
   moment the request is "now wire it up" or "put this in the app", it belongs to `/orchestrate` if it is
   commit-sized, or to `/feature-plan` and `/feature-implement` if it is a feature. Name the one that
   applies and stop.
2. **Refuse to sketch the whole application.** A screen or two, chosen because something about them is
   actually in question. If the answer is "all of them", ask which decision is being made and mock the two
   screens that decide it.

Say which question the mockup exists to answer, in one line, before writing anything.

## 1. Read what this project already looks like

**Borrow before inventing.** This repository exists already, so most of the look is decided — and a mockup
built from values the project does not have is a picture of an app nobody is going to build.

Read `context/stack.md`, then find the real thing: the stylesheet or token file, the design system or
component library, and two or three existing screens close to what is being mocked. Copy the actual token
names, spacing scale, radii and type stack out of them.

Invent only where there is genuinely nothing to borrow — a new surface, or a project with no styling of its
own yet. **Mark every invented value**, so the plan that reads this knows which parts are proposals and
which are already true.

## 2. Agree the sketch, then stop

Ask a short set of questions — which screens, which states, and what specifically is undecided. Use your
runtime's question mechanism if it has one, or a plain numbered question if it does not.

Then propose, and **wait**:

- the screens, one line each on what each one shows,
- the states each will exercise, and
- which values are borrowed and which are invented.

**Write nothing until the user approves.** Adjust the proposal if they push back. Generating five files
before anyone has agreed what is being asked is how a fast tool becomes a slow one.

## 3. Write the mockups

Everything goes under `prototypes/<NAME>/` at the repository root, where `<NAME>` is the kebab-case subject
— matching the roadmap entry's name when there is one.

| File | Holds |
|---|---|
| `theme.css` | every value the mockups use, in one place — the project's real tokens copied in, and invented ones marked with a comment |
| `<screen>.html` | one self-contained page per screen, linking `theme.css` |
| `NOTES.md` | the question this exists to answer, what it settled, what is still open, and which values were invented |

- **Plain HTML and CSS. No framework, no build step, no dependencies.** A few lines of inline script for a
  view toggle is fine; anything more means this stopped being a sketch.
- **Every colour, font and spacing value comes from a `theme.css` variable**, never hard-coded — that is
  what makes tweaking one file restyle every screen at once.
- **Realistic content and the states that matter** — the empty list, the error, the mid-action moment, the
  name that is too long. An empty shell full of lorem ipsum answers nothing. Desktop-first is enough unless
  the question is about small screens.
- Never transcribe a credential. Placeholder content is invented, and a real key is never realistic detail.

`NOTES.md` is the durable part. The HTML is scaffolding for a conversation; the notes are what a plan reads.

## 4. It gets committed

`prototypes/` is yours, not the tool's — nothing installs it, nothing updates it, nothing validates it.
**It gets committed anyway.** Until a plan absorbs `NOTES.md` its conclusions live nowhere else, and neither
the notes nor the mockups survive a cleared context or a second machine if they were never tracked.

Who does the committing is [`context/git.md`](../../../context/git.md)'s answer, not this command's. Where
the user commits, say plainly that these files are worth tracking rather than leaving them to be mistaken
for scratch output.

## 5. Hand off and stop

Report the folder path, and tell the user to open the files in a browser and iterate on the look — that
iteration is the point, and it costs nothing.

Then name exactly one next step, and **do not run it**:

- **No roadmap entry yet** → `/roadmap "<idea>"`, citing `prototypes/<NAME>/`.
- **An entry exists** → `/feature-plan "<NAME>"`, which reads the folder and carries what it settled into
  the plan's Design section.

## Rules

- **Nothing outside `prototypes/` is written.** Not application source, not `context/`, not `roadmap.md`.
  This command creates no entry, marks nothing active, and touches no ledger row.
- **No gates.** Nothing here is verified or reviewed, because there is nothing to verify — no test covers
  a throwaway file, and review time spent on one is time wasted. Work that needs a gate is not a mockup.
- **Throwaway means throwaway.** When the feature ships, delete `prototypes/<NAME>/` and the citation that
  pointed at it. A mockup that no longer matches the app is worse than no mockup, because someone will
  believe it.
