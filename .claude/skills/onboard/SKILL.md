---
name: onboard
description: "Fill in this project's own workflow stubs — context/verify.md, context/executors.md, context/git.md, context/tracking.md, context/release.md and context/stack.md — by adopting what the repository already documented, asking wherever a claim's destination is unclear, and running each candidate verification command so only the ones that pass are written down. Explicit invocation only — run this when the user types /onboard. Do NOT match on 'set up the project', 'get started', or general setup requests."
disable-model-invocation: true
model: opus
effort: high
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

**An answer already written is not re-asked.** On a re-run, a section that holds something other than its
shipped answer — an executor somebody wired, a git policy somebody chose — is reported in a line and left
alone unless the user asks to change it. This command fills gaps; it does not re-open decisions.

Each stub has a `<stub>.notes.md` beside it — what each section takes, and the alternative answers written
out so the chosen one can be pasted in. Those notes are tool-owned and read here; nothing in the loop reads
them.

Read [`context/workflow.md`](../../../context/workflow.md) for the tier model.

## What it writes

| File | Gets |
|---|---|
| [`context/verify.md`](../../../context/verify.md) | the real Lint / Typecheck / Build / Test commands, plus whatever else a phase should pass — **only ones that exited 0** |
| [`context/executors.md`](../../../context/executors.md) | how this project dispatches a coder and a reviewer, and the exact command that makes a branch or a worktree |
| [`context/git.md`](../../../context/git.md) | who commits, where work lands, whether it is pushed, and at what granularity |
| [`context/tracking.md`](../../../context/tracking.md) | where the backlog, the plans and the phase ledgers live |
| [`context/release.md`](../../../context/release.md) | what a change here announces and to whom, what records a note, and how often |
| [`context/stack.md`](../../../context/stack.md) | runtime, layout, conventions, and the index of where this project documents itself |
| [`AGENTS.md`](../../../AGENTS.md) | pruned, on confirmation, of what moved into those six. The region between the `ai-workflow` markers is never touched |

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
| a rule about who commits, when work is committed, or what may be pushed | `context/git.md` |
| the command this project uses to make a branch or a worktree | `context/executors.md` |
| a rule about what deserves a changelog entry or a release note, or what is published where | `context/release.md` |
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

**Nothing is deleted here.** Pruning is Step 10, after the destination files exist.

On a re-run, a claim its destination file already states is already adopted. Say so in a line and move on.

**If an `update` named a missing section** — `context/stack.md` with no Documentation section, a stub that
is not there at all — add the heading in the shipped stub's order, then fill it through the step below that
owns it. Do not rewrite what is already there to match a newer stub: the section is the part that is new,
not the prose someone wrote about their own project.

## Step 2 — Coder dispatch

Ask which of three ways implementation runs. **Find out what this host actually offers before asking** —
the subagent answer is only real if there is a mechanism behind it. The answers are written out in
[`context/executors.notes.md`](../../../context/executors.notes.md); paste the chosen one.

**If the Coder section already names something other than the shipped answer, say what it names and move
on** unless the user asks to change it. An executor somebody wired into this project — a CLI, a tool, a
tier they chose — is not this command's to re-ask, and a re-run that did would undo that decision every
time the stack changed.

- **In a subagent**, briefed with [`context/roles/coder.md`](../../../context/roles/coder.md), on the tier
  the section names — `sonnet` as shipped. This is what ships, and it is the answer wherever the host has
  such a mechanism. It needs no invocation written down — the brief is a file that is already in the
  repository. What it buys is a caller that keeps the ledger and the gates while the implementation's file
  reads stay elsewhere; what it does not buy is better code. Say both. Confirm the tier, and write it as an
  alias the runtime resolves, never a dated model id.
- **In-host** — what a host without a subagent mechanism falls back to, and a valid answer to choose
  outright rather than a gap. Write it in if it is chosen.
- **Offloaded** — the user names the invocation, a CLI or a tool. Write it into `context/executors.md`
  verbatim, including any directory or permission scoping it needs on this machine. Its system prompt is
  [`context/roles/coder.md`](../../../context/roles/coder.md) as well: one prompt, three ways to dispatch
  it.

If an external executor is named, **test one assumption before writing it down**: that it can read this
repository unaided. Briefs cite paths rather than pasting file contents, so everything downstream depends
on that being true, and it is true of some executors and not others.

1. Pick a fact only available by opening a file here — a heading partway down `context/workflow.md` does.
2. Send a one-line brief that cites the path and asks for that fact. Nothing else.
3. If the fact comes back, record in `context/executors.md` that repository reads were verified, and when.
4. If it comes back empty, guessed, or refused, record that **this executor needs content inline** — the
   one case where a brief carries file contents instead of paths.

Never write down an invocation you have not run. This is the same rule as Step 7, for the same reason.

## Step 3 — Reviewer dispatch

Ask how Gate 2 should get a review, from three answers. As in Step 2, **a Reviewer section that already
names something other than the shipped answer is reported in a line and left alone** unless the user asks
to change it, and the answers are written out in
[`context/executors.notes.md`](../../../context/executors.notes.md).

- **A reviewer subagent** — an independent reader that never saw the implementation being written. This is
  what ships, wherever the host has the mechanism, and **look for one this installation already put on
  disk**: a host-specific agent directory is exactly where a review contract would have been written, and a
  reviewer sitting there unnamed is the fallback silently winning over the better answer. It needs no
  invocation.
- **The host reviews the diff itself** against the plan's review checklist and the standards. That is the
  fallback because it always works, not because it is good: it is the session that wrote the code judging
  whether the code is good. Any command that runs the gate must say which one it ran.
- **An external reviewer** — the user names the invocation, a CLI or a tool. Write it into
  `context/executors.md` verbatim, including any scoping it needs on this machine.

A host that offers review usually offers more than one shape of it — a review subcommand, a review skill it
can be asked to run, a subagent it installs — and they do not review alike. **Find out what this host
actually provides rather than assuming**, show the user what you found, and let them choose. Nothing
shipped here names a winner: it differs per host and changes underneath you. What ships is the contract,
not the command.

**Say plainly what the fallback costs.** The host reviewing its own diff is the answer every other gate in
this workflow is weakest under, and it is what a host with no subagent mechanism gets. Where either of the
other two is available, recommend it.

Whatever is chosen, that contract stands: a review happens, every item in it is marked blocking or
not, and a `FAIL` is looped back on.

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

Write the chosen answer in each of the four sections — the shipped line where it stands, and the paragraph
pasted from [`context/git.notes.md`](../../../context/git.notes.md) where it does not — and delete what it
replaces. Keep the **Under the worktree answer** subsection only under that answer; delete it otherwise. If
`context/git.md` does not exist — an install from before it shipped — create it from those notes with all
four sections, **What no answer here authorises**, and the rules that hold either way.

**Never negotiate away *What no answer here authorises*.** It is not one of the questions. Whatever is
chosen above, that section is written out as shipped: the answers cover the workflow's own commands at the
point each one names, permission is never inferred from an approved plan or a chosen option or an urgent
incident, and force-pushing, pushing to the default branch, rewriting published history and discarding
uncommitted work are asked for by name every time. **Say in one line that it was written and what it
means** — a user who just chose *the agent commits* has every reason to think they authorised more than
they did, and this is the one moment to correct that.

**Two things to settle out loud under the branch and worktree answers:**

- **How a branch or a worktree is created is not `git.md`'s answer** — it is `executors.md`'s *Branch and
  worktree* section, for the same reason the reviewer's invocation is. **Collect the exact invocation and
  write it there**, alongside Step 3's. Under the worktree answer also collect how the tree is *removed*,
  and how to ask whether an agent session is live in one — `/feature-status` reports that where there is a
  way and says it cannot tell where there is not.

  **Do not let this be answered with "`git worktree add`".** A worktree CLI copies the gitignored env
  files, enforces the naming, puts the directory somewhere predictable and hands the tree to an editor or
  an agent; the bare git command does none of it, and a tree made that way is missing the half that made
  the answer worth choosing. If the user has no such command, say so plainly — a shipped **Not
  configured** here means the workflow makes no worktree at all, which is a real answer and a safe one.
  One that exists is [`@northguild/worktree`](https://github.com/northguild/worktree) —
  `npx @northguild/worktree branch <name>` to create, `remove` to delete, `list --agents` for the
  live-session probe. Offer it as a known option, not as the answer; any command the user names wins.
- **`context/history.md` will conflict on every merge**, because every `/feature-close` appends to its end.
  Offer to add `context/history.md merge=union` to the repository's `.gitattributes`. It is the only file
  in the tree with that shape — a plan's ledger is edited in place rather than appended to, so a union
  merge there would resurrect rows instead of resolving them.

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
- **In an issue tracker** — a feature is an issue, its plan is that issue's body, and the phase ledger is
  a table inside that body. The tracker is the shared home every working tree can reach. This is the answer
  for **several agents working several features at once**: it is the only thing outside every worktree that
  all of them can write to.

**Say which answer this project got, and why, in one line — always, including when only one was
available.** This step is silent in exactly the case it most needs to speak: a brand-new repository often
has no remote yet, and Step 4's shipped answer is *neither* a push nor a pull request, so both of the
checks below can close at once and leave nothing to ask. A step that asks nothing must still **report**,
or the user never learns the second answer exists.

**Check the precondition first.** The tracker answer needs a git repository with a GitHub remote — a
repository check and a remote check. Where either comes back empty, do not offer that answer, and **name
what would make it available**: *"tracking in an issue tracker needs a GitHub remote and this project has
none yet — add one and re-run `/onboard` if you want it."* Offering an answer that cannot be carried out is
worse than not offering it; leaving unsaid that it exists is worse than both.

**Step 4's answer does not constrain this one, and never removes it.** The tracker answer works under
every *Push and pull request* answer — nothing in it waits for a commit to reach the default branch. What
the pairing buys is not mechanical: this substrate exists so several agents in several trees can share
state, and **work that is never pushed is visible to exactly one of them.**

So where Step 4 said *neither* — which is what it ships saying — offer the tracker answer anyway, say
plainly that the pair is weaker than it looks and why, and **offer to change Step 4's answer along with
it**. A default taken three questions ago is not a decision about this question. Either pair may be
written; only the silent one is forbidden.

### Look at what the tree already holds before writing the answer

**This is a check, not a question, and it runs before the answer is written.** Read `roadmap.md`, `drafts/`
and `plans/`, and say what is there — the entry count, which entry is `active`, which entries hold a plan.
**Always say it**, including when the answer is *nothing*, for the same reason this step reports at all.

Setting the answer does not move the work. A repository whose `tracking.md` says *tracker* while its
entries sit in `roadmap.md` reads as an **empty backlog** to every command in this workflow: `/roadmap`
prints nothing, `/feature-plan` says the backlog is empty, and the active feature and its ledger become
invisible. That is not a mixed state anyone chose — it is the state a switch produces if nobody says so.

Three outcomes, and only the first writes the answer alone:

- **The tree holds nothing** — no entries, no drafts, no plans. The switch is free, because there is
  nothing to migrate. Write the answer and carry on.
- **The tree holds entries, drafts or plans, and no phase is `in progress`.** Write the answer, then **name
  `/tracking-migrate` as the required next step** and say plainly that until it runs the backlog reads as
  empty. Record that in `context/tracking.md` too: a split that is written down is a task, and one that is
  not is a trap. **Remove nothing** — the removal is the migration's last act, not this command's.
- **A phase is `in progress`.** **Refuse the tracker answer**, name the feature and the phase, and leave
  the working-tree answer standing. An agent may be inside that phase right now, in this tree or another,
  and [`workflow.md`](../../../context/workflow.md)'s read-fresh model assumes the substrate does not move
  underneath a running phase. Say the answer is available once the phase finishes or is parked back to
  `not started` — that is a person's decision, not this command's.

**Never write the tracker answer and delete the tree files in the same run.** Removal is what makes the
migration irreversible, and this command has no way to show a remote write as a diff first.

### Under the tracker answer

Write the tracker answer's paragraph from
[`context/tracking.notes.md`](../../../context/tracking.notes.md) in place of the shipped one, then collect
these and write them into the file's own *Under the tracker answer* subsection, which stays — it is the
answer's vocabulary. Under the working-tree answer that subsection is deleted instead, as the stub says.

1. **The repository**, as `OWNER/REPO`. Confirm it against the remote rather than asking blind.
2. **Two label names.** They ship as `workflow:feature` for the backlog and `workflow:planned` for a
   feature that has a plan, and there is no third — phase status lives in the ledger's Status column, so
   nothing needs a label for `blocked`. **List the repository's existing labels first** and say what you
   found: a project already using either name for something else needs a different one, and a project with
   an `enhancement` or `feature` label is exactly why these are namespaced. Say that `feature` here is
   [`workflow.md`](../../../context/workflow.md)'s word — work you would want a history row for — and not
   a claim that the issue is not a bug.

   Say what the second one is **for**, because it is the only part of this answer aimed at a person rather
   than an agent: both labels render on the issues list, so the backlog can be read at a glance — one chip
   is an idea, two is planned, two and an assignee is being worked. **Nothing in the workflow reads it.**
   *Whether a feature has a plan* is the ledger in its body, under every command, every time.
3. **Whether this project has issue types**, and their names. Look rather than asking: a project with none
   gets no `Types:` line and the workflow simply records no kind. Where it has them, say which, and say
   that the workflow **sets a type and never reads one** — no refusal, ranking or report branches on it.
   Warn about the collision if the set includes `Task`: that word means work too small for this loop in
   [`workflow.md`](../../../context/workflow.md), and an issue typed `Task` is still a workflow feature.
4. **Create either label if it is absent**, and say so before doing it. This is the first thing this
   command does that is visible to anyone else with access to the repository — which is why the check
   above runs first: a refusal that fires after the label exists is a refusal that already wrote.

   **This command is the only one that creates a label, and that is a permission fact rather than a
   convention.** [`context/tracking.md`](../../../context/tracking.md) records the split: creating a label
   needs write access while applying an existing one needs only triage, and applying a name that does not
   exist fails rather than creating it. So both labels are made once, here, before any work — after which
   every other command only ever applies what it finds, and an agent with triage alone can run the loop.
   Where creating is refused for want of access, say which label is missing and that `/feature-plan` will
   not be able to apply it until somebody with write access creates it. It is not a gate on this step.

Then say plainly what the workflow will **not** touch: this project's own labels, its Projects, and its
milestones. Nothing in the loop reads or writes any of them, so a board or a release milestone can be used
alongside the workflow without interference.

### Then say what the answer makes dead — and remove only what is already empty

Under the tracker answer five installed files have nothing to write to them — `roadmap.md`, `history.md`,
and the `drafts/`, `plans/` and `archive/` directories. The installer wrote them before this question
existed and could not have known.

**Offer to remove them, and only where they are empty.** An empty file is a stub nobody used. Show the
removal the way Step 10 shows its pruning — as a diff, applied on confirmation — and never remove one you
cannot show is empty.

**A non-empty one is not this command's to touch, and the reason differs by file:**

| Non-empty | Belongs to |
|---|---|
| `roadmap.md`, `drafts/`, `plans/` | `/tracking-migrate` — the entries and documents move, then the files go |
| `history.md`, `archive/` | nobody. They are the frozen record of the era before the switch and are never converted, in either direction — fabricating closed issues for features shipped months ago produces wrong dates, empty threads, and an audit trail that looks real and is not |

**Nothing else in the tree needs an answer here.** A blocking defect lives in its phase's ledger row, which
moves with the ledger under either answer, so there is no third file to place.

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

**This is the most valuable step in this command.** Do it properly. What each section of the file takes is
in [`context/verify.notes.md`](../../../context/verify.notes.md).

1. **Propose candidates.** Take the command claims Step 1 adopted, then read `package.json` scripts, or the
   stack's equivalent — `Makefile`, `composer.json`, `pyproject.toml`, `Cargo.toml`, the CI workflow. The
   CI config is the best source available: it lists commands that demonstrably run in a clean checkout. A
   command the old file named and CI does not is worth asking about — one of the two is stale.
   **A script that writes is not a candidate.** Anything that moves a version, records a release note,
   tags, publishes or deploys belongs to [`context/release.md`](../../../context/release.md), and Gate 1
   never runs it. Do not propose one, and **do not run one to find out what it does** — step 4 runs every
   candidate, so a wrong candidate here bumps versions or publishes rather than failing politely. A
   *check* that a release note exists is a real check and still not this file's: it belongs on the pull
   request, because Gate 1 runs per phase and would flag every docs-only change.
2. **Show the candidates and ask** which belong in Lint, Typecheck, Build and Test, and whether anything is
   missing. Ask about prerequisites too — a package manager version, an install step, a service that must
   be up.
3. **Ask what else this project runs to prove a change is good.** The four headings are the ones every
   project has, not the whole of what one checks — an end-to-end run, an accessibility suite, a size
   budget, a coverage floor, a visual snapshot, a dependency audit. **Ask specifically about the end-to-end
   one wherever this project has a user interface**, because it is the check most often configured, run in
   one pipeline, and never written down anywhere a per-task gate can see it. A project with such a check
   and nowhere to record it is a project where Gate 1 reports green for a change that broke it.
   **Then sort each one by whether Gate 1 can afford it.** Gate 1 runs on every phase, so anything measured
   in minutes, or needing a browser, a running server, a built artifact or a deploy, goes under **Not run
   by Gate 1**. Anything faster goes in whichever of the four it belongs to — a lint rule that reads markup
   is Lint, an assertion inside the test run is Test — or under **a heading of its own**, above *Not run by
   Gate 1*, where it fits none of them. Gate 1 runs every section above that one.
   **Then ask of everything still bound for a gate section whether a change is what makes it fail.** A
   dependency audit is cheap enough for any gate and still belongs under *Not run by Gate 1*: it turns red
   when an advisory is published against a lockfile nobody touched, and a phase gate cannot tell that from
   a defect the phase introduced. Ask before sorting one there — a project that holds the check clean as a
   standing invariant has decided the opposite, and for that project a red one is this change's problem.
4. **Run every candidate bound for a gate section.** Actually run it, from the repo root. One sorted
   under *Not run by Gate 1* is not run here — this command has no Docker, no deploy target and no
   reason to spend minutes driving a browser — and step 6 says what is recorded in its place.
5. **Write only the commands that exited 0.** For each one that failed, show the output and ask: fix it,
   replace it, or leave that section empty. **Never write a command that has not passed** — an inherited
   one least of all, since it is the likeliest to have rotted. An empty section is skipped by Gate 1 and
   says so; a wrong command fails a gate on every task until someone notices.
6. Put anything that needs Docker, a cloud account or a deploy target under **Not run by Gate 1**, along
   with whatever step 3 sorted there, so nobody promotes it into a gate section by mistake. **Name what
   does run each one** — the pipeline, the deploy, a person before a release. That section is the record of
   a check this project has and this gate does not run; without the name it reads as a check nobody runs,
   which is a different and much worse fact.

Explain what you are doing: this turns `verify.md` from someone's guess into something verified at install
time, which is the one moment it is cheap to catch.

## Step 8 — Stack

What each section takes is in [`context/stack.notes.md`](../../../context/stack.notes.md), including the
rule that a generated changelog is an output rather than a documentation surface. Start from what Step 1
routed here, show it back as a draft, and ask only for the gaps:

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

## Step 9 — Release: what a change announces, and to whom

Ask what a change here announces, and write the answer to
[`context/release.md`](../../../context/release.md). **It runs after Stack** because it needs the layout
that step settled, and because it may send you back to the Documentation index that step just wrote.

What each section takes, the alternative answers, the mechanism's settings and the wires are written out in
[`context/release.notes.md`](../../../context/release.notes.md); the stub itself holds only the answers.

**This one answer is unlike the other five, and the difference decides the whole step.**
[`context/verify.md`](../../../context/verify.md) can say *no lint step* and be accurate — a project with
no linter chose that. This file cannot. *"A change is announced by writing a note"* is **false** in a
repository where nothing records one, and a false answer here is the same defect as a `done` row whose
**Files:** do not exist. So there are only two endings to this step: **the true answer, or the true answer
plus a named gap.** Never a mechanism that is not on disk.

**This step installs nothing.** It does not add a dependency, create a notes directory, or write a
workflow. Where the mechanism is absent, it says exactly what is missing, names the command that would
close it, and stops — naming an installer is not running one, and nothing below is conditional on the
user taking the offer.

### Look first, and say what you found — always

**A check, not a question**, and like Step 5 it reports even when there is nothing to ask:

1. **The publishable and deployable paths.** Read each `package.json`, or this stack's equivalent, and
   note which declare themselves private and which do not. Take the layout from `context/stack.md` rather
   than re-deriving it.
2. **Whatever already records notes** — a notes directory, an `## Unreleased` heading in a changelog, a
   fragment directory. Name what you found, or say there is none.
3. **Whether a changelog is generated or hand-maintained.** It matters twice: a generated one is an output
   rather than a documentation surface, so if Step 8 listed it in `stack.md`'s Documentation index, take it
   out and say why.
4. **Whether anything publishes or deploys, and on what event.** A workflow, a job or a hook, plus the line
   that says when it runs. It decides whether a *yes* here would be honest, and it is where the one
   contradiction worth catching shows up: **a deploy wired to every merge of the base branch, in a
   repository that records notes, ships whatever unreleased work is in the tree at the time** — other
   people's included — and announces itself with a changelog a release behind. Report it as the defect it
   is, in the words above. Do not rewire it: what fires a deploy is the user's, and this step changes no
   workflow.
5. **Whether anything tags or cuts a release, and what this repository already has.** Two different
   questions and both are cheap: read the workflows for a step that tags, and **look at the repository's
   existing tags**. A repository that has been deploying for a while and has no tags at all is the finding —
   it means nothing has ever recorded what went live, and it is invisible from inside the tree because the
   deploys all succeeded. **Do not report this as working because the deploy works.** Where the mechanism
   from step 2 has a tagging setting, read it and say what it is set to: a deployed app is usually a private
   package, and these settings commonly leave private packages untagged, so the answer is *off* unless
   somebody chose otherwise.

6. **Whatever asks for a note on a change, and what it does on the release commit.** Where step 2 found a
   mechanism there is usually a job asking *did this change get a note* — find it, and then read what it
   does on the commit where the notes were **consumed**. That commit has none pending, because they became
   the changelog, so a check asking only *are there pending notes* fails on the one push that owes nothing,
   every time. **The finding is not the red square.** These mechanisms offer a placeholder note carrying no
   change, for the case of a change that genuinely announces nothing — so there is a one-command way out,
   and a repository that has hit this will often have **written that command into its own instructions as a
   step**. Look for that too, in the contributing notes, the release docs and `CLAUDE.md`: a documented
   step that writes an empty note is this same finding, already paid for and mistaken for a procedure.
   Report it, and name the condition that resolves it — the one step 4 just established, *this path's own
   version moved*. **Do not rewire it**, the same as step 4: what this step changes is the answer file.

**Where any of those named a workflow, a job or a hook, say whether it has ever run, and what it left
behind.** A file that reads correctly is a **claim** about a mechanism, not the mechanism — and the worst
answers this file has ever carried lived in that gap.

- **Never run is a real answer.** Record it as *written, never run*, and say so in the file. That is honest
  and it is what the answer should say until the day it runs.
- **Ran is evidence only of what it produced.** The tags item above already says this in its own words: a
  working deploy does not tell you anything was recorded.
- **A workflow that fails to load is inert in its entirety, and reading it will not show you.** One
  unresolvable reference anywhere in the file kills **every job in it** — including jobs that have nothing
  to do with the change and were passing yesterday. It reports as a failed run with no job inside to open,
  which reads as *nothing ran* rather than *something is broken*, and the file itself can be perfectly
  sensible. **If the latest run of a workflow you are about to name failed with no job inside it, name
  that instead**: the mechanism is not wired whatever the file says, and this project's verification gate
  is probably down with it.

Say all six back in a line each, including the empty ones.

### Then ask, per path

**If the sweep found nothing that records a note, skip this section** and go straight to the one below.
Collecting a table of paths whose answer nothing can carry out spends the user's time on a file that would
read as configured and do nothing.

**The table is per path, not per repository.** A repository can publish one artifact, deploy another and
say nothing about a third, and a repo-wide yes/no cannot express that. For each path from the sweep above,
ask three things — *who it announces to*, *when a change to it deserves a note*, and *what a bump of it
means*. **A single-package repository gets one row and that is a real answer**, exactly as `git.md`'s *the
main working tree* is.

The *deserves a note when* column is the one that earns its keep: it is where "an internal refactor to the
app gets no note" is written down once instead of being re-argued on every pull request.

### Then the answer that can be false — what records a note

- **Something on disk already records notes** → write it down: the exact path, the format of one file, and
  the script name for any check it offers, never the raw command — **plus what exempts the release commit
  from that check**, from the sweep's sixth line. Write the exemption even where the check does not have
  one yet, as the gap it is: the answer file is what the next person reads before deciding that an empty
  note is the way out. Confirm all of it by opening what is there rather than by asking.
- **Nothing does** → **write *nothing here announces a change*, name what is missing, and stop.** Say what
  the user would have to put in place, and that re-running this command afterwards will pick it up. Do not
  write a table of paths above an answer that nothing can carry out.
  **Where step 1 found a `package.json`, name the one command that closes this gap**:
  `npx @baldurpan/create-ai-workflow release-init` sets up a note mechanism and writes nothing into
  `context/release.md` — it is the installer, and you are the writer. Pass it what step 1 already
  established: `--private-packages version` where a private package here is deployed, `ignore` where they
  are all fixtures. **Offer it; do not run it.** It mutates `package.json`, and that is the user's call.
  Where there is no `package.json`, name the shape instead of a tool, and leave it there.
  **Say plainly what that answer means where the sweep found something publishable**: it records that this
  project has not said how a change is announced, not that it announces nothing. The two read alike in the
  file and are not the same, and the second is the one a publishing repository will assume.

**Never leave the file saying changes are announced while nothing consumes the notes.** That is the same
failure as a `tracking.md` naming a tracker while the entries are still files: it reads as configured,
every command dutifully writes a note, and no version ever moves. If step 4 of the sweep found nothing that
publishes or deploys, say so plainly and write it into the *what a release ships* section rather than
leaving it implied.

### Then granularity, and what a release ships

- **Granularity** — *once per feature* (the shipped answer, written by `/feature-close`) or *per phase*
  (written by `/feature-implement`, for a repository that cuts a release about as often as it merges, so one
  phase is one entry somebody reads). It is one answer for the project, not a column in the table: it says
  what leaves this repository as a unit. Say that `/orchestrate` has neither value and treats the change as
  the unit.
- **What a release ships, and on what event** — fill in what bumps a version, what tags, what cuts a
  release, what publishes and what deploys, one line each, and write "nothing yet" where that is the truth.
  **Nothing in this workflow does any of the five**, and this section is what stops the answer being read as
  "releases happen automatically".

  Then, from the sweep's fourth line, **the event and what it ships per path**. There is **one event, not
  one per artifact kind**: the merge of the pull request where the notes were consumed and the versions
  moved. Publishing a package and deploying an app are two consequences of that same merge, so ask about
  them together and write one answer — a row per path saying what the merge does to it: publishes it,
  deploys it, or nothing. **A feature's merge lands a note and ships nothing**, and that sentence belongs in
  the file rather than in this conversation.

  Then **what that merge leaves behind**, which is the same for every path it ships: a tag and a release.
  The tag says which commit went live; the release is where the note is finally read by whoever it was
  written for. Ask what creates each, and write "nothing yet" where that is the truth.

  **A repository that only deploys is the one that needs asking.** Where something publishes, the command
  that publishes usually tags as a side effect, so the tags exist without anyone deciding they should. A
  deploy has no such command in its path and therefore no such accident: nothing tags, nothing cuts a
  release, and every individual step reports success. Do not let the working deploy answer this question.

  Three things to get written down while the user is here, because all three are silent when wrong:

  - **The condition is that path's own version moving**, never *a release happened*. A release that bumped
    only the package must not deploy the app.
  - **A path that deploys has to be versioned at all.** A deployed app is usually a private package, and a
    note mechanism commonly leaves those unversioned — so ask whether this one's version actually moves. If
    it does not, the deploy has nothing to key on: say so in the file as the gap it is.
  - **A path that deploys has to be tagged, too**, and that is a second setting which is off by default in
    the same place and for the same reason. Versioning it and tagging it are one decision: the reason to
    version a deployed app is that it ships, and a deploy with no tag leaves no record that it did. If the
    two disagree here, say so — it is the state where everything works and nothing is written down.

**Name the release job as the gap it is, and do not generate one.** Accumulating notes, versioning them,
tagging and publishing is a uniform sequence right up to the last step — and the last step plus its
credentials depends on branch protections, registry auth and who is allowed to press the button. A
generated workflow there does damage. Say what is missing; let the user write it.

**That covers the deploy exactly as much as the publish, and they are one gap rather than two.** The event
is uniform and belongs in the file; the credentials that put an app in front of users are no more guessable
than a registry token. So name both halves, name the single merge they hang off, and stop — an answer that
records the event with the job still missing is true, and it is the answer this step is for.

**The tag and the release are part of that gap and are named with it.** They are not a third half: they are
what the one event leaves behind, they need no registry credential, and the step that writes them is
ordinarily the same job that publishes or deploys. **Name them even where the user is not going to write
that job today** — this is the half that is otherwise discovered months later, by someone opening a releases
page and finding it empty.

If Step 1 turned up an existing rule about what deserves a changelog entry, quote it here and let it win
unless the user says otherwise.

## Step 10 — Prune the sources

Only now, with the six stubs written, remove from `AGENTS.md` and `CLAUDE.md` what has landed elsewhere.
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
- **Never touch a tool-owned file.** `README.md`, `workflow.md`, `plan-template*.md`, every `*.notes.md`
  and `roles/` are replaced on the next update; an edit there is an edit lost.
- **Do not commit.**
