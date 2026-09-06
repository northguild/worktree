---
name: onboard
description: "Fill in this project's own workflow stubs — context/verify.md, context/executors.md, context/git.md and context/stack.md — by adopting what the repository already documented, asking wherever a claim's destination is unclear, and running each candidate verification command so only the ones that pass are written down. Explicit invocation only — run this when the user types /onboard. Do NOT match on 'set up the project', 'get started', or general setup requests."
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
| [`context/git.md`](../../../context/git.md) | who commits the work, and at what granularity |
| [`context/stack.md`](../../../context/stack.md) | runtime, layout, conventions, and the index of where this project documents itself |
| [`AGENTS.md`](../../../AGENTS.md) | pruned, on confirmation, of what moved into those four. The region between the `ai-workflow` markers is never touched |

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
| a lint, typecheck, build or test command | a **candidate** for `context/verify.md` — Step 6 still has to run it |
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

**Nothing is deleted here.** Pruning is Step 8, after the destination files exist.

On a re-run, a claim its destination file already states is already adopted. Say so in a line and move on.

**If an `update` named a missing section** — `context/stack.md` with no Documentation section, a stub that
is not there at all — add the heading in the shipped stub's order, then fill it through the step below that
owns it. Do not rewrite what is already there to match a newer stub: the section is the part that is new,
not the prose someone wrote about their own project.

## Step 2 — Coder dispatch

Ask whether implementation runs **in-host** or is **offloaded** to an external coder CLI.

- **In-host** is the default, and a valid configuration rather than a gap. Leave the Coder section of
  `context/executors.md` saying so.
- **Offloaded** — the user names the invocation. Write it into `context/executors.md` verbatim, including
  any directory or permission scoping it needs on this machine. Its system prompt is
  [`context/roles/coder.md`](../../../context/roles/coder.md).

If an external coder is named, **test one assumption before writing it down**: that it can read this
repository unaided. Briefs cite paths rather than pasting file contents, so everything downstream depends
on that being true, and it is true of some executors and not others.

1. Pick a fact only available by opening a file here — a heading partway down `context/workflow.md` does.
2. Send a one-line brief that cites the path and asks for that fact. Nothing else.
3. If the fact comes back, record in `context/executors.md` that repository reads were verified, and when.
4. If it comes back empty, guessed, or refused, record that **this executor needs content inline** — the
   one case where a brief carries file contents instead of paths.

Never write down an invocation you have not run. This is the same rule as Step 6, for the same reason.

## Step 3 — Reviewer dispatch

Ask how Gate 2 should get a review:

- **The host reviews the diff itself** against the plan's review checklist and the standards. That is the
  default. It is weaker than an independent reviewer, and any command that runs the gate must say which one
  it ran.
- **An external reviewer** — the user names the invocation. Write it into `context/executors.md` verbatim,
  including any scoping it needs on this machine.

A host that offers review usually offers more than one shape of it — a review subcommand, a review skill it
can be asked to run, or both — and they do not review alike. **Find out what this host actually provides
rather than assuming**, show the user what you found, and let them choose. Nothing shipped here names a
winner: it differs per host and changes underneath you. What ships is the contract, not the command.

Whatever is chosen, that contract stands: a review happens, every blocking finding carries a `P0`–`P3`
severity, and a `FAIL` writes a finding before the loopback.

## Step 4 — Who commits

**Ask this one. It is the question the workflow used to answer by inference.**

Every command that lands code closes out by updating a ledger row *as part of the same change as the work*,
and `done` has always meant the scope landed and the gates passed. Given no policy, an agent resolves that
the only way it can — by committing, every phase, in someone else's repository. That is a call for the
project to make, so ask it and write the answer to [`context/git.md`](../../../context/git.md).

Ask, using your runtime's question mechanism if it has one:

- **The user commits** — the default, and what the stub ships saying. A phase ends verified, with its
  ledger row updated, left in the working tree. The agent reports and stops.
- **The agent commits** — one commit per phase, the code and its ledger row together.

Then confirm the granularity if the agent commits, and **say plainly what is not being decided**: nothing in
this workflow branches, pushes, or opens a pull request under either answer, and choosing one does not start
that.

Write the answer as the surviving line under **Who commits**, and delete the other. If `context/git.md` does
not exist — an install from before it shipped — create it, with a `## Who commits` section holding the
chosen line, a `## Granularity` section, and a line recording that branches and pushes are out of scope.

If Step 1 turned up an existing rule about committing, quote it here and let it win unless the user says
otherwise. Prose someone wrote about their own repository beats a default.

## Step 5 — Standards source

`context/standards/` ships with a bundled default. Ask whether that is right for this project.

- **Keep it** — nothing to do. It stays tool-owned and updates with the tool.
- **Swap it** — the user gives a git URL, and the swap is
  `npx @baldurpan/create-ai-workflow standards add <git-url>`. Tell them that command rather than cloning
  it yourself: it validates that the tree has a usable conditional-loading table, and whatever lands
  becomes project-owned from that point.

Say plainly what the default is and that a wrong set is not inert — agents load from that README's
conditional table unprompted, on every task. If Step 1 turned up house rules that the bundled set already
covers, this is the moment that matters: keeping both means the project has two answers.

## Step 6 — Verification commands

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

## Step 7 — Stack

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

## Step 8 — Prune the sources

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
