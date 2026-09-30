# Filling in `verify.md`

The guidance for filling [`verify.md`](verify.md), read by `/onboard` Step 7 and by anyone filling the file
by hand. The stub is the answer; this file is never read by a command in the loop, and Gate 1 reads the stub
alone. Each heading below mirrors a section of the stub, in the stub's order.

## Before the first section

Write the prerequisites, if any, as a short paragraph above `## Lint`: node version, package manager,
install step already run, services up. A command that only passes after `install` has run is a command
that fails on a clean checkout until somebody says so.

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

## Not run by Gate 1

Three kinds of command go here: ones that need Docker, a cloud account or a deploy target; ones Gate 1
cannot afford on every phase — an end-to-end run against a browser, a full performance pass, a visual
snapshot; and ones a change is not what makes fail, like a dependency audit. **Name what does run each
one**: the pipeline, the deploy, a person before a release. Without that name this section reads as a
check nobody runs rather than one this gate does not. List them here so nobody promotes one into a gate
section by mistake.

**Shipped as:** empty.

## Rules

Nothing to fill in. Live prose in the stub, and Gate 1 reads it every time.
