---
name: onboard
description: "Fill in this project's own workflow stubs — context/verify.md, context/executors.md, context/git.md, context/tracking.md and context/stack.md — by adopting what the repository already documented, asking wherever a claim's destination is unclear, and running each candidate verification command so only the ones that pass are written down. Explicit invocation only — run this when the user types /onboard. Do NOT match on 'set up the project', 'get started', or general setup requests."
disable-model-invocation: true
---

# /onboard

Fills the project-owned stubs the installer deliberately left empty, and folds whatever the repository
already documented into them. **Re-runnable** — run it again after the stack changes, and it re-proposes
against what is there now.

**Run it after an `update`, too.** The updater replaces tool-owned files only; the stubs are project-owned
and it cannot reach them, so a section a new version's stub gained arrives only through this command. The
update prints the gaps it found under **Next** — every one of them is this command's work. Until it runs,
a command can be pointed at a section of a file that does not have it.

**Asking is not guessing.** The installer could have detected a test command and written it in; that is
exactly how a file ends up naming a command that has never run. This command asks, and where it can, it
*checks*.

Read [`context/workflow.md`](../../../context/workflow.md) for the tier model.

## What it writes

| File | Gets |
|---|---|
| [`context/verify.md`](../../../context/verify.md) | the real Lint / Typecheck / Build / Test commands — **only ones that exited 0** |
| [`context/executors.md`](../../../context/executors.md) | how this project dispatches a coder and a reviewer |
| [`context/git.md`](../../../context/git.md) | who commits, where work lands, whether it is pushed, and at what granularity |
| [`context/tracking.md`](../../../context/tracking.md) | where the backlog, the plans and the phase ledgers live |
| [`context/stack.md`](../../../context/stack.md) | runtime, layout, conventions, and the index of where this project documents itself |
| [`AGENTS.md`](../../../AGENTS.md) | pruned, on confirmation, of what moved into those five. The region between the `ai-workflow` markers is never touched |

Show every proposed edit before writing it, and **do not commit.** The user reviews and commits.

## Step 1 — Adopt what the repository already says

The installer appends its block to `AGENTS.md` and leaves the rest of that file alone, so a repository that
documented itself before the overlay arrived now states some of the same things twice, in two places, with
no rule about which wins. Resolving that is this step, and it runs first because what turns up here is the
raw material for every step below.

**Read, in this order:** everything in `AGENTS.md` *outside* the `ai-workflow` markers, then `CLAUDE.md`
apart from its import line. If the repository carries other agent-instruction files — a nested `AGENTS.md`
under a subdirectory, a directory of per-host instruction files — **list them and stop there.** Say they
exist and that this command left them alone. A nested file usually scopes to its own subtree, and moving it
up is a decision rather than a cleanup.

Break what you read into claims — a paragraph, a table row, a bullet — and propose a destination for each:

| A claim about | Goes to |
|---|---|
| what the project is, its layout, its conventions | `context/stack.md` |
| where the project's own documentation lives, or how it is published | `context/stack.md`, its Documentation section |
| a lint, typecheck, build or test command | a **candidate** for `context/verify.md` — Step 7 still has to run it |
| how a coder or a reviewer is dispatched | `context/executors.md` |
| a rule about who commits, or when work is committed | `context/git.md` |
| a rule the bundled standards already state | nowhere — the standards own it. Ask before dropping |
| planning or review process this workflow now owns | nowhere — superseded. Ask before dropping |
| anything else — ownership, contacts, external links | stays in `AGENTS.md`, outside the block |

**Show the whole table before moving anything**, one row per claim, and let the user correct any
destination. Two kinds of row are never decided alone:

- **Unsure** — a claim you cannot place, or that fits two files equally well. Ask. Do not quietly pick the
  likelier one: a misfiled convention is a rule nobody reads again.
- **Contradicts** — the existing prose and the installed workflow give different answers to the same
  question. Where project-local skills live, what the review process is, which file is authoritative.
  **Quote both and ask which stands.** Never resolve one silently in either direction — the older text is
  often right about this project and wrong only about the overlay.

An adopted claim is an *input* to the steps below, not a substitute for them. A command lifted out of the
old file is a candidate like any other and still has to run.

**Nothing is deleted here.** Pruning is Step 9, after the destination files exist.

On a re-run, a claim its destination file already states is already adopted. Say so in a line and move on.

**If an `update` named a missing section** — `context/stack.md` with no Documentation section, a stub that
is not there at all — add the heading in the shipped stub's order, then fill it through the step below that
owns it. Do not rewrite what is already there to match a newer stub: the section is the part that is new,
not the prose someone wrote about their own project.

## Step 2 — Coder dispatch

Ask which of three ways implementation runs. **Find out what this host actually offers before asking** —
the middle answer is only real if there is a mechanism behind it.

- **In-host** is the default, and a valid configuration rather than a gap. Leave the Coder section of
  `context/executors.md` saying so.
- **In a subagent**, briefed with [`context/roles/coder.md`](../../../context/roles/coder.md). Offer this
  only where the host has such a mechanism. It needs no invocation written down — the brief is a file that
  is already in the repository. What it buys is a caller that keeps the ledger, the gates and
  `findings.md` while the implementation's file reads stay elsewhere; what it does not buy is better code.
  Say both.
- **Offloaded** — the user names the invocation. Write it into `context/executors.md` verbatim, including
  any directory or permission scoping it needs on this machine. Its system prompt is
  [`context/roles/coder.md`](../../../context/roles/coder.md) as well: one prompt, three ways to dispatch
  it.

If an external coder is named, **test one assumption before writing it down**: that it can read this
repository unaided. Briefs cite paths rather than pasting file contents, so everything downstream depends
on that being true, and it is true of some executors and not others.

1. Pick a fact only available by opening a file here — a heading partway down `context/workflow.md` does.
2. Send a one-line brief that cites the path and asks for that fact. Nothing else.
3. If the fact comes back, record in `context/executors.md` that repository reads were verified, and when.
4. If it comes back empty, guessed, or refused, record that **this executor needs content inline** — the
   one case where a brief carries file contents instead of paths.

Never write down an invocation you have not run. This is the same rule as Step 7, for the same reason.

## Step 3 — Reviewer dispatch

Ask how Gate 2 should get a review, from three answers:

- **The host reviews the diff itself** against the plan's review checklist and the standards. That is the
  default because it always works, not because it is good: it is the session that wrote the code judging
  whether the code is good. Any command that runs the gate must say which one it ran.
- **A reviewer subagent** — an independent reader that never saw the implementation being written. Offer
  this wherever the host has the mechanism, and **look for one this installation already put on disk**: a
  host-specific agent directory is exactly where a review contract would have been written, and a reviewer
  sitting there unnamed is the default silently winning over the better answer. It needs no invocation.
- **An external reviewer** — the user names the invocation. Write it into `context/executors.md` verbatim,
  including any scoping it needs on this machine.

A host that offers review usually offers more than one shape of it — a review subcommand, a review skill it
can be asked to run, a subagent it installs — and they do not review alike. **Find out what this host
actually provides rather than assuming**, show the user what you found, and let them choose. Nothing
shipped here names a winner: it differs per host and changes underneath you. What ships is the contract,
not the command.

**Say plainly what the default costs.** The first answer is the one every other gate in this workflow is
weakest under, and it is the one a user gets by not answering. Where either of the other two is available,
recommend it.

Whatever is chosen, that contract stands: a review happens, every blocking finding carries a `P0`–`P3`
severity, and a `FAIL` writes a finding before the loopback.

## Step 4 — Git: who commits, where work lands, and whether it is pushed

**Ask these. They are the questions the workflow used to answer by inference.**

Every command that lands code closes out by updating a ledger row *as part of the same change as the work*,
and `done` has always meant the scope landed and the gates passed. Given no policy, an agent resolves that
the only way it can — by committing, every phase, in someone else's repository. That is a call for the
project to make, so ask it and write the answer to [`context/git.md`](../../../context/git.md).

**Ask who commits first.** It is independent of everything below, and it is the one the workflow got wrong
by inference:

- **The user commits** — the default, and what the stub ships saying. A phase ends verified, with its
  ledger row updated, left in the working tree. The agent reports and stops.
- **The agent commits** — one commit per phase, the code and its ledger row together. Confirm the
  granularity if this is the answer.

**Then ask where work lands and whether it is pushed.** They are two independent answers, but most projects
want one of three combinations. Offer these by name, using your runtime's question mechanism if it has one,
and say that either answer can be set on its own if none of the three fits:

| Shape | *Where work lands* | *Push and pull request* |
|---|---|---|
| **Straight to main** — enough where you push to `main` and pull requests are not required | the main working tree | neither |
| **A branch per feature** — one feature at a time, reviewed before it lands | a branch per feature | the agent pushes and opens a pull request |
| **A worktree per feature** — several features in flight at once, each in its own tree | a worktree per feature | the agent pushes and opens a pull request |

**Anything past the first shape needs the agent to commit.** A branch nobody commits to is an empty branch.
If the answers collide, say so and ask again rather than writing a pair that cannot both be true.

Write the surviving line in each of the four sections and delete the others, including the commented-out
alternatives. Keep the **Under the worktree answer** subsection only under that answer; delete it otherwise.
If `context/git.md` does not exist — an install from before it shipped — create it with all four sections
and the rules that hold either way.

**Two things to settle out loud under the branch and worktree answers:**

- **How a branch or a worktree is created is not this file's answer** — it is `executors.md`'s, for the same
  reason the reviewer's invocation is. Collect the invocation and record it there alongside Step 3's, and
  under the worktree answer collect how to ask whether an agent session is live in a tree, if there is a way
  — `/feature-status` reports it when there is and says it cannot tell when there is not.
- **`context/history.md` will conflict on every merge**, because every `/feature-close` appends to its end.
  Offer to add `context/history.md merge=union` to the repository's `.gitattributes`. **Do not offer the
  same for `findings.md`** — closed findings leave that file, and a union merge resurrects deleted lines.

Then **say plainly what is not being decided**: nothing in this workflow merges a pull request, deletes a
branch, or removes a worktree, under any answer above.

If Step 1 turned up an existing rule about committing, branching or pushing, quote it here and let it win
unless the user says otherwise. Prose someone wrote about their own repository beats a default.

## Step 5 — Tracking: where workflow state lives

Ask where the backlog, the plans and the phase ledgers live, and write the answer to
[`context/tracking.md`](../../../context/tracking.md). Two answers:

- **In the working tree** — the default, and what the workflow has always done. `roadmap.md` is the
  backlog, a plan is a document under `plans/` carrying its own phase ledger, retired features are indexed
  in `history.md` with their documents in `archive/`. One tree, one reader at a time.
- **In an issue tracker** — a feature is an issue, a phase is a sub-issue of it, and the tracker is the
  shared home every working tree can reach. This is the answer for **several agents working several
  features at once**: the tracker is the only thing outside every worktree that all of them can write to.

**Check the precondition before you ask, and state it inside the question.** The tracker answer needs a git
repository with a GitHub remote. Find out first — a repository check and a remote check — and where either
comes back empty, **say so in the question and do not offer that answer**: *"tracking in an issue tracker
requires this project to be a git repository with a GitHub remote, and it is neither, so the working-tree
answer is the only one available."* Offering an answer that cannot be carried out is worse than not
offering it, and this is the same shape as Step 2's *"offer this only where the host has such a mechanism."*

**Refuse the impossible pair.** The tracker answer depends on Step 4's *Push and pull request* answer being
*the agent pushes and opens a pull request* — a phase closes its sub-issue through `Closes #N` on the
commit, which only fires once the branch reaches the default branch. If Step 4 said *neither*, say plainly
that the two cannot both hold and ask which one changes. **Do not write a pair that cannot both be true.**

### Under the tracker answer

Collect these and write them into the file, then delete the answer that was not chosen along with this
subsection's heading:

1. **The repository**, as `OWNER/REPO`. Confirm it against the remote rather than asking blind.
2. **The two label names.** They ship as `workflow:feature` and `workflow:blocked`. **List the
   repository's existing labels first** and say what you found: a project that already uses one of these
   names for something else needs a different one, and a project with an `enhancement` or `feature` label
   is exactly why these are namespaced. Say that `feature` here is [`workflow.md`](../../../context/workflow.md)'s
   word — work you would want a history row for — and not a claim that the issue is not a bug.
3. **Create the labels if they are absent**, and say so before doing it. This is the first thing this
   command does that is visible to anyone else with access to the repository.

Then say plainly what the workflow will **not** touch: this project's own labels, its Projects, and its
milestones. Nothing in the loop reads or writes any of them, so a board or a release milestone can be used
alongside the workflow without interference.

### Then offer to remove what the answer makes dead

Under the tracker answer five installed files have nothing to write to them — `roadmap.md`, `history.md`,
and the `drafts/`, `plans/` and `archive/` directories. The installer wrote them before this question
existed and could not have known.

**Offer to remove them, and only where they are empty.** An empty file is a stub nobody used; a file with
entries or rows in it is the record of the work done before the switch, and that record stays. Show the
removal the way Step 9 shows its pruning — as a diff, applied on confirmation — and never remove one you
cannot show is empty.

**`findings.md` stays under both answers.** A finding is raised and swept inside a single branch's life, so
it is never the thing two agents contend over.

## Step 6 — Standards source

`context/standards/` ships with a bundled default. Ask whether that is right for this project.

- **Keep it** — nothing to do. It stays tool-owned and updates with the tool.
- **Swap it** — the user gives a git URL, and the swap is
  `npx @baldurpan/create-ai-workflow standards add <git-url>`. Tell them that command rather than cloning
  it yourself: it validates that the tree has a usable conditional-loading table, and whatever lands
  becomes project-owned from that point.

Say plainly what the default is and that a wrong set is not inert — agents load from that README's
conditional table unprompted, on every task. If Step 1 turned up house rules that the bundled set already
covers, this is the moment that matters: keeping both means the project has two answers.

## Step 7 — Verification commands

**This is the most valuable step in this command.** Do it properly.

1. **Propose candidates.** Take the command claims Step 1 adopted, then read `package.json` scripts, or the
   stack's equivalent — `Makefile`, `composer.json`, `pyproject.toml`, `Cargo.toml`, the CI workflow. The
   CI config is the best source available: it lists commands that demonstrably run in a clean checkout. A
   command the old file named and CI does not is worth asking about — one of the two is stale.
2. **Show the candidates and ask** which belong in Lint, Typecheck, Build and Test, and whether anything is
   missing. Ask about prerequisites too — a package manager version, an install step, a service that must
   be up.
3. **Run each one.** Actually run it, from the repo root.
4. **Write only the commands that exited 0.** For each one that failed, show the output and ask: fix it,
   replace it, or leave that section empty. **Never write a command that has not passed** — an inherited
   one least of all, since it is the likeliest to have rotted. An empty section is skipped by Gate 1 and
   says so; a wrong command fails a gate on every task until someone notices.
5. Put anything that needs Docker, a cloud account or a deploy target under **Not run by Gate 1**, so
   nobody promotes it into a gate section by mistake.

Explain what you are doing: this turns `verify.md` from someone's guess into something verified at install
time, which is the one moment it is cheap to catch.

## Step 8 — Stack

Start from what Step 1 routed here, show it back as a draft, and ask only for the gaps:

- What does this project do, in a paragraph — and anything about its history that explains its shape.
- Runtime, package manager, database, storage, hosting.
- The directories that matter, one line each.
- **The conventions that would not be guessed** — what breaks in this runtime, what is deliberately kept
  separate, where local secrets live, what must never be run against production. This section is the one
  that earns its keep; the rest is discoverable. Inherited prose is usually strongest here and weakest at
  describing layout, which drifts.

Then fill in the **Documentation** section, which is the one every later plan reads:

1. **Sweep the repository.** The root `README`, a `README` in every package, `docs/`, a docs site or
   landing page built from this repo, an API reference or OpenAPI document, a changelog, a `man` page or
   `--help` text that lives in the code, a comment that is the only description of a file format.
2. **Ask what is published elsewhere** — a wiki, a hosted docs site built from another repository, a
   support centre, a public API reference. Nothing in the tree can reveal those, and they are the surfaces
   that rot longest without anyone noticing.
3. **Ask which of them are actually maintained.** A directory nobody has touched in two years is worth
   recording as exactly that; a plan can then say so instead of proposing an update to a dead file.
4. **Write "none" if there is none.** An empty section reads as "nobody checked", and `/feature-plan`
   cannot tell those apart — it sweeps the tree itself when the section is empty, which finds files but
   never finds the docs site nobody mentioned.

Say what this is for: every plan's §7 starts from this list, and whatever a feature makes untrue there is
fixed by the phase that makes it untrue.

Point out that anything else added under `context/` should be indexed in `stack.md`, not in
`context/README.md`, which is tool-owned and replaced on update.

## Step 9 — Prune the sources

Only now, with the four stubs written, remove from `AGENTS.md` and `CLAUDE.md` what has landed elsewhere.
Duplication left standing is the failure this step exists to prevent: two statements of one fact drift, and
the stale copy is indistinguishable from the live one.

- **Show the removal as a diff and ask before applying it.** Whole sections at a time, not scattered lines.
- **Remove only what you can point at.** For each deletion name the file and section that now holds it. A
  claim you could not place stays exactly where it is — an unpruned file is a smaller problem than a lost
  rule.
- **Never touch the region between the `ai-workflow` markers.** It is tool-owned and replaced on update, so
  an edit there is an edit lost, and nothing migrates into it.
- What should be left is what only `AGENTS.md` can say: the repository's own front matter, and the block's
  pointer into `context/`.

Keeping the original prose in place is a valid answer. If the user chooses it, write one line in
`context/stack.md` saying which file is authoritative, so the next reader is not left to guess.

## Rules

- **Copy before cut.** Nothing leaves `AGENTS.md` until the file that replaces it is written and shown.
- **Never write a credential.** Write `$SENTRY_DSN`-style placeholders and name where the real value lives
  — this command collects shell commands, which is the most likely place a token appears inline. Inherited
  prose gets the same read before it moves. See the standing rule in
  [`context/workflow.md`](../../../context/workflow.md).
- **Never write a command you have not run.**
- **Never delete a claim you could not place.**
- **Never touch a tool-owned file.** `README.md`, `workflow.md`, `plan-template*.md` and `roles/` are
  replaced on the next update; an edit there is an edit lost.
- **Do not commit.**
