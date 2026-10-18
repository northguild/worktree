# Filling in `verify.md`

The guidance for filling [`verify.md`](verify.md), read by `/onboard` Step 7 and by anyone filling the file
by hand. The stub is the answer; this file is never read by a command in the loop, and Gate 1 reads the stub
alone. Each heading below mirrors a section of the stub, in the stub's order.

## Before the first section

Write the prerequisites, if any, as a short paragraph above `## Lint`: node version, package manager,
services up. Facts a person reads. The commands that *make* a clean checkout pass go in *Prepare a fresh
tree* below, where something can run them.

## Lint, Typecheck, Build, Test

One fenced `bash` block each, holding the real command, exactly as it is run from the repository root.
**Only a command that exited 0 goes in.** `/onboard` runs every candidate before writing it; filling in by
hand, run it first. An empty block is a real answer — no such step — and Gate 1 skips it and says so.

**Shipped as:** every block empty. The installer does not detect commands, because detection is how a file
ends up naming a command that has never run.

## A heading of your own

Add a `##` heading of your own above *Not run by Gate 1* for anything the four do not cover, that Gate 1
can still afford on every phase, and that fails because of the change rather than because of the calendar
— an accessibility suite, a size budget, a coverage floor. Gate 1 runs every section above *Not run by
Gate 1*, in order, so a heading placed there is run like any of the four.

**One of them is offered by `/onboard`, and is worth adding by hand if that offer was declined or never
made: a check that no test in the suite is skipped, focused or expected to fail.** A runner reports a
skipped test as a pass and a focused one silences every test beside it, so *Test* above can exit 0 while
the suite asserts almost nothing — and no other section here can see it, which makes this the gap the four
headings leave. **Optional on purpose:** a project that uses a skip to mark work in progress has chosen
something this check forbids, and declining it is a real answer. Where it is wanted, it goes in *Test* if
this project's runner or its lint rules can assert it there, otherwise under a heading of its own; either
way the command belongs in [`verify.md`](verify.md)'s block and nowhere else.

## Not run by Gate 1

Three kinds of command go here: ones that need Docker, a cloud account or a deploy target; ones Gate 1
cannot afford on every phase — an end-to-end run against a browser, a full performance pass, a visual
snapshot; and ones a change is not what makes fail, like a dependency audit. **Name what does run each
one**: the pipeline, the deploy, a person before a release. Without that name this section reads as a
check nobody runs rather than one this gate does not. List them here so nobody promotes one into a gate
section by mistake.

**Shipped as:** empty.

## Prepare a fresh tree

The commands that turn a clean checkout into one where the sections above pass — the dependency install
first, then anything else: a generated client, a built artifact a test imports, a local service. One fenced
`bash` block, from the repository root, in order. **Run them in a fresh checkout before writing them
down**; a command that only works in a tree somebody has been living in is what this section exists to
catch.

**These commands have to leave the tree clean**, which rules two things in. **Use the install form that
reads the lockfile rather than rewriting it** — every package manager has one, usually a `--frozen-lockfile`
or `--immutable` flag or an install subcommand of its own, and it is the form CI already uses — and
**gitignore anything a step here generates**: a client, a built artifact a test imports, a schema.
`/feature-implement` checks `git status --porcelain` after running this section and will not run a round of
phases in a tree that came back dirty, so a rewritten lockfile costs the round; left unfixed it also shows
up in every phase's diff from then on.

**Shipped as:** empty. An empty section means `/feature-implement` runs one phase at a time instead of a
round of them side by side, and says so. It is not a gate failure and nothing else changes.

## Rules

Nothing to fill in. Live prose in the stub, and Gate 1 reads it every time.
