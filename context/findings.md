# Findings

Defects that outlive the session that found them. A reviewer `FAIL`, a verification gate that hits its
loopback cap, or a defect found by hand all land here — **before** the loopback, not after it, so a finding
survives even when the cap is hit and the task is escalated.

## Contract

**The rules live in [`workflow.md`](workflow.md)'s Findings section** — gating, closing, and the bound that
says this file must not grow for the life of the project. They were restated here until 2026-09-11 and are
not any more: that file is replaced by `create-ai-workflow` on update while this one is not, so a second
copy here drifts from the copy the skills actually execute. What stays below is only what `workflow.md`
does not spell out.

**Severity.** `P0` breaks production or data. `P1` blocks a phase or a gate. `P2` is a real defect that
does not block. `P3` is a note worth not losing.

**Tied to.** Either a phase — `<feature-name> Phase <n>` — or `ad-hoc` for a finding raised by
`/orchestrate` outside any feature.

**Shape.** Entries go under **Open** below, newest last, and look like this:

> ### F-001 — P1 — one line naming the defect
>
> **Tied to:** some-feature Phase 2 · **Raised:** YYYY-MM-DD (by the gate that raised it, or "hand")
>
> What is wrong, where, and why it matters. Cite the file and the evidence.
>
> **Closes when:** the condition that closes it, naming the gate run that would prove it.

---

## Open

### F-052 — P3 — env files inside a submodule are no longer copied into a new worktree

**Tied to:** ad-hoc · **Raised:** 2026-09-11 (Gate 2, the `reviewer` subagent)

`copyEnvFilesFromRootPath` now selects with `git ls-files --others --ignored --exclude-standard`
(`src/lib/env.ts:45-59`), and git does not descend into a submodule when listing the parent's files. The
filesystem glob this replaced did descend, so a gitignored `.env` inside a submodule was copied before and
is not now. Reproduced by the reviewer on a scratch repo: a seeded `sub/.env` was absent from the listing
while a filesystem walk found it.

The trade was taken deliberately — selecting on what git is not carrying is what fixes the wider defect —
and the loss is documented in `docs/src/app/docs/guides/env-files/page.mdx`. It is recorded here because
the documentation is a workaround, not a fix: a repository that keeps its env files in submodules is worse
off than before this change.

**Closes when:** a Gate 1 run passes with the submodule case covered — one `git ls-files` per submodule
path, pinned by a test in `src/lib/env.test.ts`. It is otherwise withdrawn rather than closed, if someone
decides submodules stay out of scope; a recorded decision is not something a gate run can witness.

### F-054 — P2 — Gate 1's Typecheck section does not reach the `docs/` workspace at all

**Tied to:** chat-input-multiline Phase 1 · **Raised:** 2026-09-10 (hand, during Gate 1)

*Raised the day before the triage below and not swept by it: it was written on the
`feature/40-chat-input-multiline` branch and reached this file only when that branch merged `main`. It was
renumbered from F-052 on the way in, because #54 had taken that id meanwhile.*

`context/verify.md`'s Typecheck section is `pnpm typecheck`, which is `tsc --noEmit` against the root
`tsconfig.json` — and that config carries `"include": ["src/**/*"]` (`tsconfig.json:12`). It compiles the
CLI and nothing else: `npx tsc --noEmit --listFilesOnly | grep -c 'docs/src/chat'` returns **0**.

So the whole `docs/` workspace — the Next.js app, the chat feature, and `docs/worker/` — is outside the
gate. A type error anywhere in it exits 0 and passes Gate 1. This was found while verifying Phase 1, whose
every file lives in `docs/src/chat/`: the section reported green having read none of them.

`docs/` has its own `docs/tsconfig.json` and is never invoked by any script — `docs/package.json` has no
`typecheck` script, and `ci.yml` runs only the root one. Running it by hand
(`./node_modules/.bin/tsc --noEmit -p docs/tsconfig.json`) exits **1** on **23 errors**, which is what
confirms it has not been run in a long time rather than that it is merely unwired. **22 are pre-existing**
and one arrives with this phase:

- **21 of the 22 are a single cause.** `docs/tsconfig.json:16` sets `"types": ["vitest/globals"]` and omits
  `@testing-library/jest-dom`, so every jest-dom matcher is unknown to the compiler —
  `toBeInTheDocument`, `toHaveAttribute`, `toHaveClass`. They land across four test files:
  `ProfileAvatarLink.test.tsx` (7), `Footer.test.tsx` (6), `TerminalBlock.test.tsx` (5) and
  `Navbar.test.tsx` (3). `docs/test-setup.ts:1` does the runtime half of this correctly, which is why the
  suite passes while the compiler does not.
- **The 22nd is generated.** `worker/worker.ts(5,31)` cannot resolve `./docs-context.js`, which
  `worker:build-context` writes and `.gitignore`s. `docs/vitest.config.ts:9` already aliases it to
  `worker/docs-context.stub.ts` for tests; no equivalent exists for the compiler.
- **The 23rd is new**, and is the same jest-dom cause rather than a new one:
  `ChatInput.test.tsx(29,21)`, a `toHaveAttribute`. Two more of this kind were removed from that file at
  Gate 2 for an unrelated reason, which is why the count moved from 25 to 23 during the phase.

Not raised as a blocker: this is pre-existing, it is not caused by Phase 1, and Phase 1's own types are
covered in practice by the Next.js build and by `docs:test` executing every line of the new component.
But `verify.md` presents four gate sections as covering this repository, and one of them silently covers
half of it — which is exactly the drift that file exists to prevent.

**Closes when:** either `verify.md`'s Typecheck section names a command that compiles `docs/` too, or that
file records the exclusion deliberately and says why. Whichever is chosen, a Gate 1 run citing it is the
evidence. Clearing the 23 errors is the prerequisite for the first option, and the `"types"` line above is
22 of them.

### F-067 — P3 — a workspace id that is present but not a string reads as "no space open", and closes nothing

**Tied to:** herdr-space-closer Phase 2 ([#52](https://github.com/northguild/worktree/issues/52), retired) · **Raised:** 2026-09-11 (Gate 2, the `reviewer` subagent, note NB2)

*Renumbered from F-055 when this branch merged `main`, the same way F-054 above was: the triage below
closed a different F-055 meanwhile. This feature's own F-052, F-053 and F-054 left this file for the
closing comment on [#52](https://github.com/northguild/worktree/issues/52) before that merge, and the three
ids now above and below belong to other findings — read those three on the issue, not here.*

`readOptionalWorkspaceId` (`src/integrations/herdr.ts:424-426`) is
`typeof value === "string" && value.length > 0 ? value : undefined`, so a legitimate *no space open* and a
drifted `open_workspace_id` — a number, an object — arrive at the caller identically. Only the second is a
defect, and it produces exactly the orphan this feature exists to prevent: the space stays open, no close
is attempted and nothing is printed. It is asymmetric with the `path` check three lines below, which
throws on precisely that condition.

Unreachable against 0.8.2: `herdr api schema --json` types `open_workspace_id` as `["string","null"]` and
leaves it out of `WorktreeInfo.required`. This is a drift guard, not a live defect — §5 already names
Herdr version drift as the risk this feature carries.

**Closes when:** Gate 1 re-passes with the present-but-not-a-string case separated from the absent one —
either thrown on, like `path`, or documented in that function's comment as a deliberate collapse.

### F-057 — P3 — the two new `bounds a …` cases cannot fail while any caller routes through `runHerdrRequest`

**Tied to:** herdr-space-closer Phase 2 ([#52](https://github.com/northguild/worktree/issues/52), retired) · **Raised:** 2026-09-11 (Gate 2, the `reviewer` subagent, note NB4)

`"bounds a worktree list"` (`src/integrations/herdr.test.ts:776-786`) and `"bounds a workspace close"`
(`:788-803`) assert `timeoutOf(0)` is greater than zero. Every call through `runHerdrRequest` satisfies
that for free from its `timeoutMs = HERDR_REQUEST_TIMEOUT_MS` default
(`src/integrations/herdr.ts:218-221`), so neither case can fail unless that default is deleted — which
the pre-existing `"bounds a worktree open"` already catches. They cover the route, not the export.

Not a regression: they follow the shape of the case that was already there, and the value is deliberately
not re-typed (this feature's F-053, on [#52](https://github.com/northguild/worktree/issues/52)). Worth
knowing that the coverage they appear to add is smaller than it looks — if a future export bypasses
`runHerdrRequest`, it is these cases that will not notice.

**Closes when:** Gate 1 re-passes with the two cases asserting something specific to their own call — the
argv bounded, or the rejection a kill produces — or with them folded into the case that already proves the
default exists.

### F-058 — P3 — `gitRemoveWorktreesWithProgress` cannot be caught returning the wrong set, because every path it returns from returns all of them

**Tied to:** herdr-space-closer Phase 3 ([#52](https://github.com/northguild/worktree/issues/52), retired) · **Raised:** 2026-09-11 (Gate 2, the `reviewer` subagent, note N4)

`removed.push(wt)` sits after the awaited `gitNukeWorktreeCmd` (`src/lib/git.ts`), so the accumulation is
real — but `return worktrees;` would pass all four of the set-helper's tests. The loop aborts on any throw,
so on every path where the function *returns at all*, `removed` is equal to `worktrees`; the two can only
diverge on a path that currently throws instead of returning.

Not chaseable as things stand, and deliberately so: closing it means deciding between a per-entry `catch`
and a rethrow carrying the partial set, which is the behaviour change Phase 3 was forbidden from making.
Recorded so a later reader does not mistake the accumulation for something the suite is holding in place.

**Closes when:** the plan's §9 loop gap is settled — whichever way — and Gate 1 re-passes with a case where
the returned set is a strict subset of the set passed in.


### F-063 — P3 — "a removal that failed leaves the checkout on disk" is stated as a universal, and `gitNukeWorktreeCmd` can violate it

**Tied to:** herdr-space-closer Phase 6 ([#52](https://github.com/northguild/worktree/issues/52), retired) · **Raised:** 2026-09-11 (Gate 2, the `reviewer` subagent, note)

Three surfaces say a failed removal leaves the checkout in place, so its space is deliberately not closed:
`docs/src/app/docs/guides/herdr-spaces/page.mdx`, `docs/src/app/docs/commands/remove/page.mdx` and
`skills/core/SKILL.md`. `gitNukeWorktreeCmd` (`src/lib/git.ts`) is three sequential commands —
`worktree remove`, `worktree prune`, `branch -D` — and a throw in the second or third leaves
`wasRemoved === false` with the checkout **already gone**. The space is then left open for a worktree that
no longer exists: the orphan this feature exists to prevent, in its rarest form.

The behaviour is the right way round — erring toward leaving a space open never destroys a live window —
so this is the prose over-reaching, not the code. Left rather than fixed during Phase 6's Gate 2 loopback,
which is scoped to the failing items only.

**Closes when:** the three sentences name the common case rather than asserting a universal, on any Gate 1
run that has those files open.

### F-064 — P3 — two shipped skill artifacts claim 9 config keys; there are 15

**Tied to:** ad-hoc · **Raised:** 2026-09-11 (Gate 2, the `reviewer` subagent, note)

`skills/_artifacts/domain_map.yaml` says `'worktree config (all 9 keys)'` and
`skills/_artifacts/skill_spec.md` says "9 config keys". `src/lib/constants.ts`'s `CONFIG_NAMES` holds
**15** entries — 14 excluding the internal `has-called-config`.

Predates this feature and is untouched by it: issue #52's D6 adds no config key, which is why §7 routed the
`skill_spec.md` half to its own `/orchestrate` and why `domain_map.yaml` was left alone on the same
reasoning even though Phase 6 had it open.

**§7's own parenthetical is wrong too** — it says "the 13 in `constants.ts`". Count before fixing, or the
correction ships stale a second time.

**Closes when:** an `/orchestrate` corrects both artifacts against `CONFIG_NAMES`, with the count taken
from the file rather than from any of the three numbers written down here.

### F-065 — P3 — two example blocks on the Herdr guide are each slightly narrower than what actually prints

**Tied to:** herdr-space-closer Phase 6 ([#52](https://github.com/northguild/worktree/issues/52), retired) · **Raised:** 2026-09-11 (Gate 2, the `reviewer` subagent, notes N1 and N2)

Both survived the F-061/F-062 loopback because that loopback was scoped to the failing items.

- The open-path timeout block shows only the `✖` line. `BaseCommand.openHerdrSpace` prints `spinner.fail`
  **and then** `this.log()` of the worktree path, and `src/lib/base-command.test.ts` pins exactly
  that pair for the timeout case. The block immediately above it shows both lines, so the narrower one
  reads as a difference that is not there. Not false — the sentence introducing it scopes the comparison to
  the message — but incomplete.
- The close-failure block shows two warnings, both naming workspace `wQ`. `closeSpace` prints one warning
  per space and ids are unique, so no run prints both of those lines. A reader will take it as "either of
  these"; distinct ids, or two blocks, would say so.

**Closes when:** both blocks match what a single run prints, on any Gate 1 run that has the page open.

### F-066 — P3 — the two shipped skill artifacts now disagree about the `codeEditor`-instead-of-`opener` mistake

**Tied to:** herdr-space-closer Phase 6 ([#52](https://github.com/northguild/worktree/issues/52), retired) · **Raised:** 2026-09-11 (Gate 2, the `reviewer` subagent, note N5)

`skills/_artifacts/domain_map.yaml`'s tensions entry gained a fourth consequence — the `codeEditor`
workaround also "leaves the space open when the worktree is removed" — because issue #52's §7 assigned that
file's tensions entry to Phase 6. `skills/core/SKILL.md` carries the same warning in prose and still lists
three consequences, because §7's `SKILL.md` row names three specific spots and this is not one of them.

So the phase is scope-correct and the artifacts still disagree. Both ship.

**Closes when:** `SKILL.md`'s tension prose carries the same fourth consequence, on any Gate 1 run that has
the file open — or an `/orchestrate` reconciles the two artifacts, which [F-064](#f-064) already wants for
the key count.

---

## The 2026-09-11 triage

Thirty-five findings were open here against five features that had already retired, carrying this file to
1097 lines and 76 KB — past the point where reading it returns the whole file. That matters: the one check
this file exists to enforce is *is an open `P0` or `P1` tied to this phase*, and a gate that reads a
truncated file can pass on findings it never saw. It was safe only by luck, all 35 being `P2` or `P3`.

**The accumulation was structural, not neglect.** `/feature-close` blocks on an open `P0`/`P1` and sweeps
only *closed* findings, so an open `P2` or `P3` passes through a feature's retirement untouched — and can
then never close, because closing requires the gate that raised it to re-pass and that gate belongs to a
phase that no longer exists. Orphans accumulate by design.

Where they went:

| Disposition | Count | Where |
|---|---|---|
| Promoted to the backlog | 21 | issues [#55](https://github.com/northguild/worktree/issues/55)-[#61](https://github.com/northguild/worktree/issues/61), grouped by area, each finding reproduced verbatim |
| Withdrawn, kept as record | 11 | the *Findings triage* section of each feature's plan in [`archive/`](archive/) |
| Fixed | 1 | F-046 — a one-line doc fix in a shipped skill artifact |
| Left open | 1 | F-052, the only one whose feature has not retired |
| Recorded on the feature issue | 2 | `github-issue-auto-assign` kept its plan in [#41](https://github.com/northguild/worktree/issues/41), not in `archive/` |

**Nothing was discarded.** Behaviour defects and mutation-resistance gaps became issues, because they are
work someone should still do. Only internal notes — a comment that overclaims, a doc's shape, a style
observation — were withdrawn, and each is reproduced in full in its feature's archived plan.

**No new rule was invented here.** The fix for the structural cause belongs in `create-ai-workflow`, which
owns `/feature-close`, `/orchestrate` and `workflow.md`; widening that sweep from *closed* to *disposed of*
is being taken there. This section records a one-time cleanup, not a local policy — a local policy would be
the second copy the Contract above just stopped keeping.

---

## Closed

### F-055 — P2 — the placeholder that is this feature's only user-facing documentation is clipped mid-sentence

**Tied to:** chat-input-multiline Phase 1 · **Raised:** 2026-09-10 (hand, during Phase 3's verification)

`ChatForm.tsx:71` sets `placeholder="Type a message... (Shift+Enter for a new line)"`. In the drawer's
`w-[400px]` panel (`ChatDrawer.tsx:101`) that string is two lines long at the inherited 16px type, and the
collapsed field is one row — so the browser clips it. What a user actually reads is **"Type a message...
(Shift+Enter for a"**, with the words that carry the meaning cut off.

Measured in headless Chrome against `pnpm docs:dev` on 2026-09-10: with the field empty the textarea
reports `scrollHeight` **48** against a `clientHeight` of **24** — one whole line of placeholder below the
fold — and a screenshot of the compose row shows the sentence ending after "for a". With any value typed
the numbers agree (`24`/`24` at one character), so this is the placeholder alone.

**Phase 1 introduced it.** Before b43ecfe the placeholder was `"Type a message..."`, which fits; that phase
lengthened it to name the Shift+Enter convention. Per §7 of the plan, that placeholder is *the only place
in the repository* where a user is told what Shift+Enter does — "Nothing else in the repository tells a
user how the chat's compose box behaves" — so the truncation lands squarely on the one surface the feature
has, and the half that survives ends mid-preposition.

Not raised as a blocker, and not fixed inside Phase 3: it is a Phase 1 defect in a line Phase 3 does not
otherwise touch, and the field itself works. The sizer drives growth from the *value*, never the
placeholder, so no growth behaviour is implicated — D2 is doing exactly what it says.

**Closes when:** the placeholder either fits one row at 400px or moves somewhere it can wrap, proved by a
headless measurement showing `scrollHeight` equal to `clientHeight` while the field is empty. **Gate 1
cannot close this one** — no command in [`verify.md`](verify.md) renders the drawer — so unlike
[F-054](#f-054) the evidence is that hand check, cited by whatever change makes it.

**Closed:** 2026-09-10 by the post-review fix on this branch, which took the first option at the
maintainer's direction — the placeholder is `"Type a message..."` again and the Shift+Enter convention is
not surfaced in the UI at all. Measured against the real compiled CSS and font at three drawer widths
(400px, and 360px/320px phones): the empty field reports `scrollHeight` **24** against a `clientHeight` of
**24** at every one, where it was 48/24 before. Nothing is clipped and the empty field no longer carries a
scrollbar. §7 of the plan was corrected in the same change, since it named that placeholder as the one
place the convention was written down.

### F-053 — P3 — the env-copy spinner is never failed, so a copy error leaves it mid-spin

**Tied to:** ad-hoc · **Raised:** 2026-09-11 (Gate 2, the `reviewer` subagent)

`src/lib/env.ts:70-80` starts a spinner per file, then calls `fs.mkdirSync` and `fs.copyFileSync` between
`start()` and `succeed()`. Either can throw — EACCES, or a source file removed between the listing and the
copy — and nothing calls `spinner.fail()`, so the spinner is left spinning while the raw Node error
surfaces. The error reaches the user *after* `gitCreateWorktree` has already made the worktree, and nothing
says the tree exists or that the file can be copied by hand.

`context/standards/typescript/error-handling.md`'s core rules are not broken — the cause propagates
verbatim — but its user-facing guidance ("explain the failure, explain the next step") is not met. This is
unchanged from the pre-change code and so is not a regression; it is recorded rather than fixed to keep
that change commit-sized.

**Closes when:** a Gate 1 run passes with the two fs calls wrapped so `spinner.fail()` runs and the rethrown
error names both the file and the already-created worktree.

**Closed:** 2026-09-11 by the verbosity change, which removed the per-file spinner rather than failing it.
There is one spinner now, for the lookup, and it is stopped before the copy loop
starts — so no spinner can be left mid-spin by a copy at all. The two fs calls are wrapped
and the rethrown error names the file, names the created worktree and keeps the
original as `cause`, which is the other half of what this finding asked for. Pinned by *names the file and
the created worktree when a copy fails* and *keeps the lines already printed when a later copy fails* in
`src/lib/env.test.ts`. Gate 1 re-passed on that change — `pnpm check`, `pnpm typecheck`, `pnpm build`,
`pnpm test` (497 passed) and `pnpm docs:test` (49 passed), all exit 0. That spinner is now failed on a
lookup error too, so the defect's class does not survive at the new site either.

**Route differed from the Closes-when.** That line asked for `spinner.fail()` to run; the defect was
instead removed by deleting the per-file spinner. Recorded rather than quietly re-scoped: the condition as
written is not what happened, and the defect it described is gone.

### F-039 — P2 — a quoted `codeEditor` value no longer launches

**Tied to:** herdr-space-opener Phase 1 · **Raised:** 2026-09-07 (Gate 2, the `reviewer` subagent)

`openWorktreePath` splits the configured value on `/\s+/` with no quote awareness
(`src/lib/base-command.ts:61`). A macOS-idiomatic value like `open -a "Sublime Text"` used to reach
`/bin/sh` through `exec` and work; it now produces argv `["-a", "\"Sublime", "Text\"", <path>]` and fails.
Same class: `~/bin/editor` and `$EDITOR` no longer expand, because nothing expands them any more.

This is what the plan prescribes — §4.2 says "splits the configured value on whitespace" and Phase 1's
**Done when** tests only the unquoted cases — so it is a gap in the design, not a departure from it. It
does sit against §2's "Non-Herdr users must see no change", which is why it is recorded rather than
waved through: the two statements cannot both be true for a quoted value.

Deciding it is a maintainer's call, and there are three ways out: accept it and correct
`docs/src/app/docs/guides/editor-integration/page.mdx:23`, which today tells the reader to set
`codeEditor` to "the matching shell command" and becomes wrong; parse the value with quote awareness;
or keep a shell for the editor branch and use the argv runner only for Herdr.

**Closes when:** the decision is made and Gate 1 re-passes on whichever branch it lands in — a doc
correction inside Phase 6, or a split change inside Phase 1's files.

**Closed:** 2026-09-08 by Phase 6, which took the second of the three options at the maintainer's
decision. `splitCommandValue` (`src/lib/utils.ts:99-141`) splits the configured value honouring both
quote styles, and the editor branch calls it (`src/lib/base-command.ts:185`), so `open -a "Sublime
Text"` again yields argv `["open", "-a", "Sublime Text", <path>]` — asserted at
`src/lib/base-command.test.ts:155-169` and across 14 table rows at `src/lib/utils.test.ts:222-241`.
The `~` and `$EDITOR` half is **not** restored and is not a defect: nothing expands those without a
shell. It is now stated where a reader meets the key — `README.md:217-220`,
`docs/src/app/docs/configuration/page.mdx:25-49` and the rewritten
`docs/src/app/docs/guides/editor-integration/page.mdx:23-45`, which also covers backslashes and
replaces the "matching shell command" sentence this finding named. Gate 1 re-passed on that change —
`pnpm check`, `pnpm typecheck`, `pnpm build`, `pnpm test` (297 passed) and `pnpm docs:test`
(49 passed), all exit 0, 2026-09-08.

**Renumbered on merge (2026-09-08).** Raised as F-001 on the `herdr-space-opener` branch, which numbered from the same starting point as `main` and collided with it. The finding is unchanged.

### F-040 — P3 — the availability probe discards the reason, narrowing what D5 can print

**Tied to:** herdr-space-opener Phase 4 · **Raised:** 2026-09-08 (Gate 2, the `reviewer` subagent)

`isHerdrAvailable` destructures only `stdout` and `exitCode` from the probe
(`src/integrations/herdr.ts:156`) and returns `false` on a non-zero exit without reading `stderr`
(`herdr.ts:162-163`). D5 requires the seam to print Herdr's own `error.code` and `error.message` when
"Herdr is unavailable **or** the open fails" — but for a case where the binary exists and the server is
dead, whatever structured envelope Herdr writes to stderr is discarded before Phase 4 can reach it. The
seam can only print a generic "Herdr is not available" for that half of D5.

This is Phase 3 behaving exactly as §4.3 prescribes ("The `running` boolean is the probe"), so it is a
design consequence, not a departure. It is recorded because it lands on Phase 4's **Done when**, which
names printing the `code` and `message`. §8 already carries the adjacent open question — whether
`herdr status server --json` is the right probe at all, given it costs an extra spawn on every open —
and the two should be decided together. The options are: return a reason alongside the boolean; drop
the probe and let a failed `worktree open` be the only signal; or accept a generic message for the
server-down case.

**Closed:** 2026-09-08 by Phase 4, which chose the second option. The `herdr status server --json` probe
is gone; `isHerdrAvailable` is now `isHerdrInstalled` and is `commandExists("herdr")` and nothing more
(`src/integrations/herdr.ts:141-155`). A dead server is no longer detected in advance — it fails
`worktree open`, and that failure reaches the seam carrying Herdr's own `code` and `message` through
`toHerdrError`, which is what D5 asks it to print. §4.3 and Phase 3's **Done when** were amended to match.
This also answers §8's third open question: the probe was not the right liveness signal, and its extra
spawn per open is gone. Gate 1 re-passed on that change — `pnpm check`, `pnpm typecheck`, `pnpm build`,
`pnpm test` (233 passed) and `pnpm docs:test` (49 passed), all exit 0, 2026-09-08.

**Renumbered on merge (2026-09-08).** Raised as F-003 on the `herdr-space-opener` branch, which numbered from the same starting point as `main` and collided with it. The finding is unchanged.

### F-012 — P2 — a Windows `.cmd`/`.bat` editor can no longer be launched, and `code` is one there

**Tied to:** shell-argv-safety Phase 6 · **Raised:** 2026-09-05 (hand, R6)

`openWorktreePath` now launches the editor through `run` (`src/lib/base-command.ts:65`), which is
`execFile` with no shell. On Windows that cannot start a `.cmd` or `.bat` file, and the usual `codeEditor`
value — `code` — is `code.cmd` there. The pre-change `exec` form always went through `cmd.exe`, so this is
a behaviour change a Windows user would see, against §2 of the plan.

**Measured from source rather than asserted, and the design answer is in the plan's R6:** Node 24.19.0's
JavaScript layer has no batch-file handling at all (371 builtin module sources scanned via
`process.binding("natives")`: zero `.bat` lines, and all 16 `.cmd` lines are property reads —
`message.cmd`, `msg.cmd`, `ex.cmd`); `src/process_wrap.cc` on `v24.x` returns `UV_EINVAL` for
`IsWindowsBatchFile(options.file)` because batch-file arguments "cannot be unambiguously escaped"; and
libuv's `path_search_walk_ext` appends only `.com` and `.exe`, so an extension-less `code` fails `ENOENT`
before the guard is reached. Adding `shell: true` on `win32` would restore the exact hazard this feature
removes, at the one site that interpolates a user-supplied config value, so it was rejected.

**Config-time validation does not catch it, and on Windows it actively hides it.** The plan's R7 note
argues the new `spawn <editor> ENOENT` text is narrow because `commandExists` rejects an unfound editor
before it can be stored. On Windows that inverts: `commandExists` runs `where` (`src/lib/cli.ts:31`), which
resolves `PATHEXT` and therefore *finds* `code.cmd`, while libuv's spawn path tries only `.com` and `.exe`.
Validation passes and the launch then fails — the one configuration where the "narrow" argument does not
hold. **This half is reasoned from documented behaviour, not measured**, which is why it lives here rather
than anywhere that reads as settled.

**Not observed on a Windows host.** This repository has no Windows CI — every workflow is `ubuntu-latest`
— and the phase was implemented and verified on macOS. The configuration page documents the limitation
(`docs/src/app/docs/configuration/page.mdx`), which is the user-facing half; this finding is the half that
is still unproved.

**Closes when:** the behaviour is observed on a real Windows host and the configuration page's note is
made to match what was seen — corrected and removed if `code` launches anyway, or kept with the observed
error text if it does not.

**Closed:** 2026-09-08 by the `herdr-space-opener` merge, which answers the question rather than
observing it. The maintainer's call at that branch's Phase 6 was that this repository does not support
Windows, so there is no longer a claim for a Windows host to verify: the CLI is developed and tested on
macOS and Linux, and `docs/src/app/docs/configuration/page.mdx` now says so under **Platform Support**
instead of describing how to work around `.cmd`. `README.md`, `docs/.../getting-started/page.mdx`,
`docs/.../faq/page.mdx` and `docs/.../guides/editor-integration/page.mdx` carry the same statement, the
last naming the `PATHEXT` mechanism this finding measured so the reasoning is not lost. That branch had
raised the identical defect independently as its own F-002; this entry is the surviving one. Gate 1
re-passed on the merge — `pnpm check`, `pnpm typecheck`, `pnpm build`, `pnpm test` and `pnpm docs:test`,
all exit 0.

Closed findings leave this file — a feature's at `/feature-close`, folded into the retiring plan's own log;
an `ad-hoc` one at the start of the next `/orchestrate`.

`shell-argv-safety`'s F-006 and F-007 left at its close on 2026-09-06, into
[`archive/SHELL-ARGV-SAFETY-PLAN.md`](archive/SHELL-ARGV-SAFETY-PLAN.md) §11. These two leave at
`agent-mode`'s.

### F-002 — P3 — the `pathExists` ordering rationale in §4.1 is not pinned by any test

**Tied to:** cleanup-data-loss Phase 2 · **Raised:** 2026-09-05 (Gate 2, reviewer subagent, Phase 2)

§4.1's first bullet argues that `!wt.pathExists` must stay the first branch — a worktree whose directory is
gone holds nothing to lose. No test enforces it. `src/lib/git.test.ts:255-257` covers `{ pathExists: false }`
with the `entry()` default of `uncommittedChanges: 0`, which returns `true` under either ordering, so a
future change hoisting the uncommitted test above the path test would flip
`{ pathExists: false, uncommittedChanges: 3 }` from `true` to `false` with no test failing.

Latent, not live: `gitGetWorktreeList` hardcodes `uncommittedChanges` to `0` when the path is missing
(`src/lib/git.ts:200-202`), so the combination is unreachable from the list builder. Left open rather than
fixed because Phase 2's **Done when** names exactly two over-reach cases and this is not one of them —
adding it would have landed an unreviewed assertion after Gate 2 had already passed on the diff.

This matters sooner than it looks: `agent-mode` Phase 6 adds a live-agent clause to this same predicate
(§2, R2), and is the natural place to pin the ordering while the branches are being re-read anyway.

**Closes when:** a Gate 1 run passes with a `git.test.ts` case asserting the verdict for
`{ pathExists: false, uncommittedChanges: 3 }`.

**Closed:** 2026-09-06 by agent-mode Phase 6's Gate 1 run (`pnpm check`, `pnpm typecheck`, `pnpm build`, `pnpm test` 322
passed, `pnpm docs:test` 49 passed — all exit 0). `src/lib/git.test.ts` now carries "is safe when the directory is gone
even with uncommitted work", asserting `true` for `{ pathExists: false, uncommittedChanges: 3 }` — the exact
case this finding names. The predicate was open for the live-agent clause, which is placed *after* the path
branch and pinned by a second ordering case of its own, so the argument in §4.1 is now enforced by tests on
both sides rather than by a comment.

### F-003 — P3 — a path-less worktree with a non-zero change count would be listed as skipped *and* removed

**Tied to:** cleanup-data-loss Phase 3 · **Raised:** 2026-09-05 (Gate 2, reviewer subagent, Phase 3)

For `{ pathExists: false, uncommittedChanges: 3 }` both halves of `cleanup`'s split claim the entry:
`isSafeToRemove` returns `true` at `src/lib/git.ts:159-162`, so it lands in `worktrees`
(`src/commands/cleanup.ts:48`), and `isSkippedForUncommittedChanges` (`src/commands/cleanup.ts:17-21`) also
returns `true`, because its zeroed probe hits that same first branch. The command would print the worktree
as skipped and then remove it anyway.

Latent, not live, and for the same reason as F-002: `gitGetWorktreeList` hardcodes `uncommittedChanges`
to `0` when the path is missing (`src/lib/git.ts:200-202`), and `cleanup` consumes no other source. The
one-line form is `wt.safeToRemove !== true &&` in front of the existing condition. Left open rather than
fixed because Gate 2 had already passed on the diff — the same reasoning F-002 records — and because both
findings are the `pathExists: false` ordering question that `agent-mode` Phase 6 will have this predicate
open for anyway.

**Closes when:** a Gate 1 run passes with a `cleanup.test.ts` case proving that entry appears in at most one
of the two lists.

**Closed:** 2026-09-06 by agent-mode Phase 6's Gate 1 run (`pnpm check`, `pnpm typecheck`, `pnpm build`, `pnpm test` 322
passed, `pnpm docs:test` 49 passed — all exit 0). Both skip predicates in `src/commands/cleanup.ts` now open with
`wt.safeToRemove !== true`, so an entry the sweep will remove can never also be announced as held back.
`src/commands/cleanup.test.ts` pins it with "claims a worktree whose directory is gone for at most one
report". The Gate 2 reviewer went further and ran the two predicates against the built `dist/lib/git.js`
over all 48 combinations of `pathExists` × `uncommittedChanges` × four agent shapes × three remote states,
reporting **0** entries claimed by more than one list — so the defect class is closed empirically, not just
for the one case named here.
