# agent-mode Plan

Written 2026-09-05. Hands a freshly created worktree to a coding agent, and makes the other worktree
commands aware that an agent may be living inside one. The `agent-mode` entry in
[`../roadmap.md`](../roadmap.md) is where this feature's status lives.

**Phase status lives in §6.1 of this document, and nowhere else.**

Built on the maintainer brief captured by `/roadmap` on 2026-09-05, which this document replaces. That
brief's provenance is carried forward in §0 so nothing it recorded is lost.

---

## 0. Provenance of the source material

- **Source:** maintainer brief pasted into `/roadmap`, 2026-09-05.
- **External citation in the brief:** <https://code.claude.com/docs/en/agent-view> — the maintainer's claim
  about background-session worktree isolation is attributed to that page. **The page was never fetched; the
  claim it carries was instead verified by observation at Phase 2** — see §8 Q1.
- **The `claude agents --json` join was marked "I verified this join works" by the maintainer.** That claim
  **is now verified here** — see §1 and D4.
- The brief's closing instruction was "do not commit or push, leave the work in the tree and summarise."
  That was addressed to a direct implementation run and is **superseded** by the roadmap flow:
  `/feature-implement` commits per phase and updates the ledger in the same commit.

## 1. Why

Claude Code background sessions isolate themselves into `<project>/.claude/worktrees/`, which fights this
tool's `<repo>.worktrees/<branch>` layout. Per the brief, that isolation is **skipped when the session's cwd
is already inside a linked git worktree** — so if this CLI creates the worktree and dispatches the agent
with `cwd` set to it, the agent works inside our layout and no nested worktree appears. There is a
`worktree.location` setting in Claude Code, but per the brief its own schema says the CLI does not read it
yet, so dispatching into an existing worktree is the only way to control placement today. **That is why this
belongs in this tool rather than in agent configuration.**

Verified on 2026-09-05, on this machine, `claude` 2.1.261:

```
$ claude agents --json | head
[
  { "pid": 9187, "cwd": "/Users/baldur/Documents/Job seeker", "kind": "interactive",
    "startedAt": 1788600791123, "sessionId": "53fac4da-…", "name": "job-seeker-1f" },
  …
  { "pid": 33471, "id": "23f50fae",
    "cwd": "/Users/baldur/Development/northguild/worktree/worktree.worktrees/feature/add-agent-mode",
    "kind": "background", … } ]
```

`claude agents --help` documents `--json` as *"Print active sessions (interactive and background) as a JSON
array and exit (for scripting; does not require a TTY)"*, plus `--cwd <path>` and `--all`. The join the
brief wanted is real, and the last entry above is a background session whose `cwd` is a worktree in this
repo's own layout — with no `.claude/worktrees/` anywhere under
`/Users/baldur/Development/northguild/worktree` (`find … -name worktrees -path '*.claude*'` returns
nothing).

**Three things the live JSON shows that the brief did not**, each of which forces a decision below:

1. A `kind` field separating `"interactive"` from `"background"`. Interactive sessions include the user's
   own terminal — a naive join reports "an agent is here" when a human simply has Claude open. (D5)
2. `status` and `state` fields on background sessions — and **on background sessions only**: an
   interactive entry carries just `pid, cwd, kind, startedAt, sessionId, name`. **Completed sessions are
   excluded from the default listing**; `--all` is what includes them, per `claude agents --help`: *"With
   --json: also include completed background sessions"*. Re-measured 2026-09-06 on `claude` 2.1.263: the
   default returns 7 sessions, 1 of them background with `"state": "working"`; `--all` returns 10, adding
   three with `"state": "done"` and `"status": null`. So the invocation must never pass `--all`. (D4, D6)
3. `pid`, `sessionId` and a short `id` are all present. The brief asked for `{ name, pid }`; that is
   satisfiable exactly as written.

## 2. Constraints

From the brief, unchanged:

- **Runtime-neutral.** Never hardcode `claude`. The command is a config string, so Codex or anything of the
  same shape works. **Tests must not depend on Claude Code being installed.**
- **No TUI, no monitor.** `claude agents` already is one. `list --agents` prints and exits.
- **No orchestration.** This tool decides *where* work happens, never *what* the work is. No task
  assignment, no queue, no prompt templating.
- **Degrade silently.** A missing agent command, a non-zero exit, or non-JSON output yields no agent data
  and no error. This must never become a hard dependency on Claude Code.

From this repository ([`../stack.md`](../stack.md)):

- ESM throughout; relative imports keep the `.js` extension. `export default` only in `src/commands/*.ts`.
- Tests colocated as `*.test.ts`, vitest.
- Console output is chalk-styled and TTY-dependent; assertions on printed text rely on the `FORCE_COLOR: "0"`
  pin in `vitest.config.ts`.
- Never add a file named `biome.json` or `biome.jsonc` anywhere in the tree.

## 3. Decisions

**D1. `agent.command` holds a full command line, validated on its argv head only.** A new
`isValidCommandLine` in `src/lib/validators.ts` splits on whitespace and checks the first token, wired into
`isValidConfigValue`'s switch. *Rejected:* reusing `isValidCommand` — `commandExists` (`src/lib/cli.ts:27-39`)
does already take `command.split(" ")[0]`, so `claude --bg` would in fact pass, but `isValidCommand`'s error
message quotes the whole string back (`Command not found: claude --bg`), which is a misleading thing to show
a user. *Rejected:* no validation at all — a typo would then fail silently at dispatch time, long after the
config command exited 0.

**D2. Dispatch uses `spawn` with an argv array, never `exec`.** `dispatchAgent(path, prompt)` splits
`agent.command` into argv, appends the prompt as **one** argument, sets `cwd` to the worktree path, and uses
`detached: true` + `unref()` so the CLI exits cleanly. *Rejected:* mirroring `openWorktreePath`'s
`exec(\`${cmd} ${path}\`)` — a prompt is arbitrary user text full of quotes and apostrophes, and passing it
through a shell string is an injection hole, not merely a quoting bug. See §5 R1.

**D3. `--agent` and the editor are independent; both fire.** Order in `run()` becomes: create worktree →
copy env files → dispatch agent → open editor. **The env-before-agent edge is load-bearing** (the brief says
so explicitly); editor-last simply preserves the existing final call and keeps `openWorktreePath`'s
`✔ Worktree created in …` as the last line when no editor is configured. *Rejected:* making `--agent`
suppress the editor — the maintainer's stated preference is independence.

**D4. One `claude agents --json` invocation per command run, joined in-process on `cwd`. The invocation is
bare `--json`; `--all` is never passed (D6).** *Rejected:* `claude agents --cwd <path>` per worktree — two
reasons, and the second is the disqualifying one. `gitGetWorktreeList()` (`src/lib/git.ts:168-211`) is
already a serial loop doing 3 subprocess calls per worktree, so a fourth spawn per iteration for data one
call returns whole is the wrong trade; and `--cwd` is documented as *"Show only background sessions started
under `<path>`"*, so it silently drops exactly the interactive sessions D5 exists to protect.

**D5. The join keeps `kind`, and both consumers see every session.** `cleanup` blocks on **any** session,
interactive included: its job is not to delete a directory a human is sitting in. `list --agents` reports
both kinds too, **marking interactive ones** so a dispatched agent is still distinguishable from a human's
own terminal. *Rejected:* filtering to background everywhere — that makes `cleanup` delete the worktree out
from under an open editor session, which is the failure mode the brief calls the worst in the whole flow.
*Rejected:* background-only in `list` while `cleanup` blocks on both — the original wording, **superseded by
the Q2 resolution in §8**: it made `list --agents` silent about exactly the worktrees `cleanup` then refused
to remove, which is the inconsistency Q2 asked about.

**D6. The invocation omits `--all`, and liveness is a belt-and-braces `state !== "done"` on top of that.**
The default listing already excludes completed sessions (§1.2), so the primary guard against wedging a
worktree is simply not asking for them. The `state` check is the second layer, for a session that is listed
but finished. An absent or unrecognised `state` counts as live — which is also what makes an *interactive*
session live, since those carry no `state` at all (§1.2), exactly as D5 requires. *Rejected:* passing
`--all` for completeness — that imports exactly the wedging problem this decision exists to prevent, and
nothing in either consumer wants a finished session.

**D7. ~~Churn's merge-base comes from `defaultSourceBranch`, falling back to `origin/main`.~~ — CUT with
Phase 4, 2026-09-06.** Kept rather than deleted, because it is the one part of the churn design that was
actually settled and the `worktree-churn-stats` roadmap entry should not have to re-derive it: a
`WorktreeListEntry` has no record of what it was branched from (`gitGetWorktreeList` tracks `remote`, not
origin-of-branch), and `branch.ts:81` already uses exactly this fallback chain. If `git merge-base` fails,
churn is **omitted**, not defaulted to zero — an absent number and a genuine zero are different facts.

**D8. `list --agents` extends the existing bullet-list output, and does not become a table.** The brief says
"output stays a printed table, consistent with current `list` formatting" — **the brief is wrong about the
current formatting.** `src/commands/list.ts:16-18` prints `- ${worktreeListEntryToListName(wt)}`, a bullet
list, and `worktreeListEntryToListName` (`src/lib/utils.ts:24-49`) builds a parenthesised details string.
Agent facts append to that same `details` array. **`worktreeListEntryToListName` is shared with
`src/commands/cleanup.ts:40`**, so it takes an options argument to control which details render; without one,
this change silently rewrites `cleanup`'s output too and breaks `cleanup.test.ts`.

**D9. `checkout --agent` is in scope.** The brief marked it "only if it falls out cheaply — explicitly
skippable." It does fall out cheaply: `dispatchAgent` lives on `BaseCommand`, and `checkout.run()`
(`src/commands/checkout.ts:65-71`) already has the identical create → copy env → open sequence. The only
real cost is that `checkout` has no `static override flags` block today and needs one.

## 4. Design

**Config.** `agent.command` joins `CONFIG_NAMES` (`src/lib/constants.ts`). `config.ts` gates it behind a
`maybePrompt` confirm exactly as `codeEditor` is gated at `src/commands/config.ts:211-224`. Unset is a
normal state: `dispatchAgent` prints a line pointing at `worktree config` and returns, rather than erroring.

**Dispatch.** `dispatchAgent(path, prompt)` on `BaseCommand`, sibling to `openWorktreePath`:

```
agent.command  ──split──▶ [bin, ...args]
                          spawn(bin, [...args, prompt], { cwd: path, detached: true, stdio: "ignore" })
                          .unref()
```

**Session join.** A new `src/lib/agent.ts` owns everything that knows an agent CLI exists:

- `getAgentSessions()` — returns `AgentSession[]` (`{ name, pid, cwd, kind, status?, state? }`), or `[]`
  on any failure. Gated on `agent.command` being configured; parses stdout as JSON inside a `try`. Invoked
  as bare `--json` — never `--all` (D4, D6).
- `findSessionForPath(sessions, path)` — the `cwd` join.
- `isSessionLive(session)` — D6.
- `isSessionWaiting(session)` — true when the session is live but not progressing (`state === "blocked"`,
  or `status === "idle"`). Derived here so the JSON shape stays inside this module, per the rule below.

Nothing outside this file knows the JSON shape, so swapping runtimes touches one module.

**4.1 — what `isSessionWaiting` can and cannot say.** Two measured constraints, both from §1.2. `status` is
`null`, not absent, on a finished session, so the test is `status === "idle"` and never a truthiness check.
And interactive sessions carry no `status` or `state` at all, so `waiting` is **only ever true for a
background session** — which is the intended reading, since a human's own terminal should be marked
*interactive*, not *waiting*, but it is invisible from the field name and so is written down here. Both
fields are undocumented (R3); an unrecognised vocabulary degrades `waiting` to "no marker", which is
cosmetic — unlike D6, where the same degradation goes the safe way and counts the session live.

**List.** `WorktreeListEntry` (`src/lib/types.ts:12-19`) gains **one** optional field:

```ts
agent?: { name: string; pid: number; interactive?: boolean; waiting?: boolean }
```

`interactive` is required by the Q2 resolution — Phase 5 must mark a human's own terminal, and the brief's
bare `{ name, pid }` has nowhere to put that. `waiting` is §4.1. Both are **derived** in `agent.ts`; no raw
`kind`, `state` or `status` value crosses this boundary, per the encapsulation rule above.
`gitGetWorktreeList` takes an options flag so the join happens only when `list --agents` asks for it —
`list` today pays for no session lookup and must not start.

The brief's `filesChanged?` / `insertions?` / `deletions?` are **not** part of this feature. See the cut
Phase 4 in §6.1.

**Cleanup.** `isSafeToRemove` (`src/lib/git.ts:153-166`) gains a live-agent clause. `cleanup` gets an
override flag; `--force` alone must **not** be it, since `--force` today means "skip the confirmation
prompt", not "override a safety verdict".

## 5. Risks

**R1 — the shell-interpolation prerequisite is wider than the brief says.** The brief cites
`src/lib/base-command.ts:56` and calls it an `/orchestrate` task to be fixed separately and first. Verified
present, and **it is not the only one**: `src/lib/git.ts` interpolates unquoted paths at lines 86, 94, 103,
231 and 239 (`cd ${branchPath} && …`), and `gitSetConfigValue` at `src/lib/git.ts:23-25` interpolates a
config *value* into `git config … "${value}"` — which `agent.command` will now flow through. Any worktree
under a path containing a space is already broken today. **This plan does not depend on that fix** (D2 keeps
dispatch off the shell entirely), but shipping `agent.command` through `gitSetConfigValue` adds a value with
spaces in it to a code path that quotes badly. See §8 Q4.

**R2 — the isolation mechanic is load-bearing and second-hand.** If the cwd-inside-a-worktree exemption does
not hold, `--agent` produces a nested `.claude/worktrees/` and the feature's premise fails. It shows up
immediately as a directory appearing inside the repo. Response: this is the first thing Phase 2's manual
check looks for (§7), before any of Phases 3–7 build on it.

**R3 — the agent JSON shape is undocumented.** `kind`, `state` and `status` appear in output but not in
`claude agents --help`. A future version could rename them. Response: D6 fails safe, `getAgentSessions`
returns `[]` on any parse failure, and every field the code reads is optional.

**R4 — cost on the `list` path.** `gitGetWorktreeList` is serial and already runs 3 subprocess calls per
worktree, and one real repo on this machine carries **51 registered worktrees** (`git worktree list` in
`~/Development/corivo/corivo`, 2026-09-06) — so a per-worktree cost is not hypothetical here. Response:
cutting churn (Phase 4) removes the proposed fourth per-worktree call outright, and the session join is
**one** invocation for the whole run (D4), gated behind `--agents` (§4). Default `list` is unchanged, and
`list --agents` adds a **constant** cost regardless of worktree count. Measured at Phase 5, that constant is
**two** subprocesses, not one: `getAgentSessions` reads `agent.command` through `gitGetConfigValue` before
it invokes the runtime (`src/lib/agent.ts:66,78`). R4's substance is that the cost does not scale with the
worktree count, and that holds exactly; the earlier "exactly one" was a miscount of the same constant.

**R5 — a stale PID.** A session's process can die between the JSON call and the removal. The window is
small and the consequence is a spurious block, not data loss. Accepted; not mitigated.

## 6. Phases

### 6.1 Status ledger

| # | Phase | Status | Depends on | Note |
|---|---|---|---|---|
| 1 | `agent.command` config value | done | — | Gate 1 green; Gate 2 `PASS WITH NOTES`. Notes filed as F-014/F-015/F-016, all `P3`. |
| 2 | `dispatchAgent` + `--agent` on `branch` and `checkout` | done | 1 | Gate 1 green; Gate 2 `PASS WITH NOTES` after one loopback. F-017 (`P1`) raised and closed in the same commit; F-016 closed. §7's manual run passed, including step 3 — see Q1. Notes filed as F-018/F-019, both `P3`. |
| 3 | Agent session join module | done | 1 | Gate 1 green; Gate 2 `PASS` after one loopback. F-020 (`P2`) raised and closed in the same commit. Notes filed as F-021/F-022/F-023, all `P3`, plus F-024 against Phase 5. |
| 4 | ~~Churn stats on the worktree entry~~ | cut | — | Cut 2026-09-06: unrelated to agents, Phase 5 was its only consumer, and it was the fourth per-worktree subprocess (R4). Re-filed as `worktree-churn-stats`. |
| 5 | `list --agents` | done | 3 | Gate 1 green (307 tests, was 294). Gate 2 `PASS WITH NOTES`, no loopbacks. F-024 closed. Notes filed as F-025 (`P2`, tied to Phase 6) and F-026/F-027/F-028, all `P3`. §4's flag on `gitGetWorktreeList` was followed over this phase's original **Files** line — see Phase 5 below. |
| 6 | Agent-aware `cleanup` | done | 3 | Gate 1 green (322 tests, was 307). Gate 2 `PASS WITH NOTES`, no loopbacks. §7's Phase 6 manual run passed, including the override and the finished-session case. F-002, F-003 and F-026 closed; F-025 deferred, with its dangling close condition amended in place. Notes filed as F-029 through F-035, all `P3`. `src/lib/types.ts` added to **Files** — see Phase 6 below. |
| 7 | Generated-surface sweep | done | 2, 5, 6 | Gate 1 green — docs-only per `verify.md`, so Lint (`pnpm check`, exit 0) plus a read of the diff, and `pnpm sync-version` left no further diff, which is this phase's own **Done when**. Gate 2 `PASS WITH NOTES`, no loopbacks. `skills/_artifacts/skill_tree.yaml` added to **Files** — see Phase 7 below. F-036 filed by hand during the sweep. Of Gate 2's ten notes, the six that were inaccuracies or stale bookkeeping in this phase's own text were corrected before the commit; the two that would have rewritten shipped prose are filed as F-037/F-038, and two were judged not defects. All `P3`. |

Status is one of `not started`, `in progress`, `blocked`, `done`, `cut`. `done` only when committed and
verified, and whoever finishes a phase updates the row in the same commit. `cut` means the phase will not be
built and nothing depends on it; **the row stays so the numbering never shifts** —
[`../findings.md`](../findings.md) F-002 and F-003 both cite "agent-mode Phase 6" by number, and renumbering
would silently break those references.

**Exactly one table in this document has these columns.** Do not add a second phase table — a
differently-shaped one nearby is a decoy that gets read by mistake.

### 6.2 The phases

#### Phase 1 — `agent.command` config value

**Files:** `src/lib/constants.ts`, `src/lib/validators.ts`, `src/lib/validators.test.ts`,
`src/commands/config.ts`, `src/commands/config.test.ts`, `docs/src/app/docs/configuration/page.mdx`

**Scope:** Add `agent.command` to `CONFIG_NAMES`. Add `isValidCommandLine` and wire it into
`isValidConfigValue`'s switch (D1). Add a `maybePrompt`-gated prompt in `renderInput`, following the
`codeEditor` block at `src/commands/config.ts:211-224`. Document the value.

**Done when:** `worktree config agent.command "claude --bg"` stores it and `worktree config --list` shows it;
`worktree config agent.command "nope-not-a-binary"` is rejected; `config.test.ts` covers both.

#### Phase 2 — `dispatchAgent` + `--agent` on `branch` and `checkout`

**Files:** `src/lib/base-command.ts`, `src/commands/branch.ts`, `src/commands/branch.test.ts`,
`src/commands/checkout.ts`, `src/commands/checkout.test.ts`,
`docs/src/app/docs/commands/branch/page.mdx`, `docs/src/app/docs/commands/checkout/page.mdx`

**Scope:** `dispatchAgent(path, prompt)` on `BaseCommand` per D2 — `spawn`, argv array, prompt as one
argument, `cwd` set, `detached` + `unref()`. Unset `agent.command` prints a pointer at `worktree config` and
returns. Add the `--agent` / `-a` string flag to `branch` and `checkout`, called after
`copyEnvFilesFromRootPath` and before `openWorktreePath` (D3). `checkout` needs a new `static override flags`
block (D9). **`src/lib/base-command.test.ts` now exists** (added by `shell-argv-safety`, 6 tests on
`openWorktreePath`) — this phase extends it rather than creating it.

**Done when:** `worktree branch --github 47 --agent "implement the issue"` creates the worktree, copies env
files, and starts the agent with cwd set to the worktree; tests assert the spawn argv — including a prompt
containing a single quote and a double quote — without invoking a real agent binary.

#### Phase 3 — Agent session join module

**Files:** `src/lib/agent.ts` (new), `src/lib/agent.test.ts` (new), `src/lib/types.ts`

**Scope:** `getAgentSessions`, `findSessionForPath`, `isSessionLive`, `isSessionWaiting` per §4/§4.1 and
D4/D5/D6. Add the `AgentSession` type and the widened `agent?` field (§4) to `WorktreeListEntry`. Every
failure path returns `[]`.

**Done when:** tests cover a well-formed array, a non-zero exit, non-JSON stdout, an unset `agent.command`,
and a session with no `state` — all without Claude Code installed, per §2; **and the invocation is asserted
to omit `--all`** (D6). That assertion is the primary guard, not a detail: a regression to `--all` would
pass every other test in the file and only show up as a worktree nobody can delete.

#### Phase 4 — ~~Churn stats on the worktree entry~~ — CUT 2026-09-06

Not built. Churn is diff statistics with no relationship to an agent session; Phase 5 was its only consumer;
and it was the fourth serial subprocess per worktree on the `list` path, in a tool whose largest real
installation here has 51 of them (R4). It is also what would have made Phase 5 a dashboard rather than a
read surface — see Phase 5 below.

Re-filed as the `worktree-churn-stats` entry in [`../roadmap.md`](../roadmap.md); **D7 above is retained as
the design that entry should start from.** The phase number is retained and never reused — see §6.1.

#### Phase 5 — `list --agents`

**Files:** `src/commands/list.ts`, `src/commands/list.test.ts`, `src/lib/utils.ts`,
`src/lib/utils.test.ts`, `docs/src/app/docs/commands/list/page.mdx`, and — **added at implementation,
2026-09-06** — `src/lib/git.ts`, `src/lib/git.test.ts`. This line originally omitted the two `git.ts` files
and disagreed with §4, which puts the `includeAgents` flag on `gitGetWorktreeList` itself. §4 is the
normative design and was followed: the join has to happen inside the builder, because that is where
`isSafeToRemove` is called (`src/lib/git.ts:265`) and Phase 6 needs it to see the agent. Phase 6's own
**Files** line already names both, so this moves in-feature work earlier rather than widening the feature.

**Scope:** Add the `--agents` flag — `list`'s first (`src/commands/list.ts:6-19` has no flags today). When
set, perform the session join and render it in the existing bullet-list details string per D8, via a new
options argument to `worktreeListEntryToListName` so `cleanup`'s output is untouched. **Both session kinds
are listed, and an interactive one is marked as such** — this is what the §8 Q2 resolution requires and the
reason D5 was amended; without the marker a human's own terminal is indistinguishable from an agent this
tool dispatched. A *waiting* session is marked too (§4.1).

**The marker describes one session, not the worktree.** `WorktreeListEntry.agent` is singular (§4), so a
worktree holding several live sessions at once — a dispatched agent and a human's own terminal, which is the
ordinary `--agent`-then-editor case — is rendered from whichever `findSessionForPath` picked, and the
picked one may differ between runs. That is why the rendering **names** the session: `Agent: <name>`, with
`[interactive]` or `[waiting]` qualifying that named session and nothing else. This is the resolution of
[`../findings.md`](../findings.md) F-024, which recorded the ambiguity against this phase; the docs page
says the same thing in the reader's words.

**Why this phase survives the "is it just a dashboard?" question.** It is the read surface for Phase 6:
once `cleanup` refuses a worktree because a session lives in it, the only other way to find out which
worktrees those are is to trigger the refusal. Cutting churn (Phase 4) is what keeps this a read surface
rather than a dashboard, and §2's "no TUI, no monitor" still holds — the flag prints and exits.

**Done when:** `worktree list --agents` prints the agent name per worktree; **an interactive session renders
with its marker and a background one without it**; **a worktree whose session is blocked or idle renders
distinguishably from one that is actively working**; `worktree list` output is byte-identical to today's;
`cleanup.test.ts` passes unmodified.

#### Phase 6 — Agent-aware `cleanup`

**Files:** `src/lib/git.ts`, `src/lib/git.test.ts`, `src/commands/cleanup.ts`,
`src/commands/cleanup.test.ts`, `docs/src/app/docs/commands/cleanup/page.mdx`, and — **added at
implementation, 2026-09-06** — `src/lib/types.ts`. Liveness has to reach `isSafeToRemove`, and §4's
encapsulation rule says no raw `state` may cross out of `agent.ts`, so `WorktreeAgent` carries a third
derived field — `live?: boolean`, alongside `interactive` and `waiting` — set in `toWorktreeAgent` from
`isSessionLive`. That is one line on a type Phase 3 already created rather than new scope. It is **optional**
like its two siblings, because `src/commands/list.test.ts` and `src/lib/utils.test.ts` build `WorktreeAgent`
literals without it and both are Phase 5's files; the cost is that every reader must say what an absent
marker means, and `hasLiveAgent` says *live*, which is the direction D6 fails in.

**Scope:** Teach `isSafeToRemove` about a live agent (D5, D6) and add the explicit override flag to
`cleanup` — distinct from `--force` (§4). A worktree hosting a live session is excluded from the sweep and
named as skipped rather than silently dropped.

**The override is `--ignore-agents`, and it works by not looking.** It has no short alias: `--force` has
`-f` because it answers a prompt, and this one overrules a safety verdict, which is worth spelling out.
Rather than gathering sessions and discounting them, it turns the join off (`includeAgents:
!flags["ignore-agents"]`), so the overridden path also costs exactly what `cleanup` cost before this phase —
R4's constant, off. The one consequence is that the override reports nothing about what it swept past, which
is a departure from this command's own "do not ask me, not do not tell me" principle and is recorded as
F-030.

**Each held-back worktree is named under exactly one heading.** A worktree an agent is working in almost
always holds uncommitted work too, so the two skip reports are made disjoint by construction: the uncommitted
probe keeps the agent (and so declines anything an agent holds), the agent probe drops both. Both are gated
on `safeToRemove !== true`, which is also what closes F-003 — without it a worktree whose directory is gone
is reported as held back *and* removed.

**Done when:** a worktree with a live session in its `cwd` is excluded from `cleanup` and reported as
skipped; the override includes it; a session with `state: "done"` does not block; tests cover all three
without a real agent binary.

#### Phase 7 — Generated-surface sweep

**Files:** `skills/core/SKILL.md`, `README.md`, and — **added at implementation, 2026-09-06** —
`skills/_artifacts/skill_tree.yaml`. That file carries a near-copy of `SKILL.md`'s frontmatter — a
`description` enumerating the config keys and commands, and the same `sources` list — and it ships: the
`files` field in `package.json` publishes the whole `skills/` tree. Leaving it would have put two
disagreeing descriptions of the config surface in the published package, which is the drift this phase
exists to close.

`skills/_artifacts/domain_map.yaml` and `skills/_artifacts/skill_spec.md` are **deliberately not touched**,
and the line between them and `skill_tree.yaml` is checkable rather than a matter of taste. Two independent
things draw it in the same place: `scripts/sync-intent-version.mjs:49-50` writes exactly two files,
`SKILL.md` and `skill_tree.yaml`, and `.github/workflows/ci.yml:33-34` gates on that same pair —
`git diff --exit-code -- skills/core/SKILL.md skills/_artifacts/skill_tree.yaml`. Those two are the
maintained artifacts; the other two are generator inputs nothing consumes at build or run time.

`domain_map.yaml` is additionally a stamped record: `:4-6` carries `Version: 1.2.0`, `Date: 2026-04-06` and
`Status: reviewed` against a package now at 1.2.8, so hand-editing it would claim a discovery run and a
review that never happened. `skill_spec.md` carries no such stamp and rests on the sync/CI criterion alone.
Both files' stale enumerations are recorded as [`../findings.md`](../findings.md) F-036 instead.

**Scope:** Update `SKILL.md`'s frontmatter `description` (it enumerates every command and config value) and
its `sources` list, plus the body. Update `README.md` if the feature list changed. **No new command is
added, so `docs/src/app/docs/commands/_meta.ts` is not touched.**

**Done when:** `SKILL.md` names `agent.command`, `--agent` and `list --agents`; `pnpm sync-version` leaves
no diff (`ci.yml` hard-fails on drift via `git diff --exit-code`).

## 7. Verification

[`../verify.md`](../verify.md) names the commands — this file does not repeat them. Beyond Gate 1:

**The manual run, from the brief's own definition of done.** Required at Phase 2, before later phases build
on the premise (R2):

1. `worktree branch <name> --agent "<some prompt>"` in a repo with `agent.command` set.
2. Confirm the agent starts with cwd set to the new worktree — `claude agents --json` shows a session whose
   `cwd` is that path.
3. **Confirm no `.claude/worktrees/` directory appears inside the repo.** This is the load-bearing check.

**At Phase 6**, confirm by hand that a worktree with a live agent survives `cleanup` and is reported as
skipped. Removing a worktree out from under a running agent is the worst failure mode in this flow, and it
is not one to discover from a unit test alone.

## 8. Open questions

- **Q1 — the isolation mechanic — RESOLVED 2026-09-06: it holds, verified first-hand.** §7's manual run
  was performed at Phase 2 against the built `dist` in a throwaway repo. With `agent.command` set to
  `claude --bg`, `worktree branch feature/claude-check --agent "…"` produced a `"kind": "background"`
  session whose `cwd` was exactly the new worktree (`claude agents --json`), and `find` over the repository
  and its worktrees returned **no `.claude` directory at all**. R2's premise is confirmed by observation
  rather than by the maintainer's claim, and <https://code.claude.com/docs/en/agent-view> did not need to be
  fetched to settle it. Phases 3–7 build on a checked foundation.
- **Q2 — should `list --agents` show interactive sessions? — RESOLVED 2026-09-06: yes, with a marker.**
  The maintainer chose the fix the question itself named, so `list` and `cleanup` now agree on what counts
  as "an agent is here". **D5 is amended accordingly** and Phase 5 renders the marker.
- **Q3 — is `state: "done"` a stable field?** It is absent from `claude agents --help`. D6 fails safe, so a
  rename degrades to "everything blocks cleanup" rather than "nothing does" — annoying, not dangerous.
- **Q4 — does the `/orchestrate` shell fix land before or after this? — RESOLVED 2026-09-06: before.**
  It shipped as the `shell-argv-safety` feature and is archived (`acf0774` … `43cca67`). Verified on
  2026-09-06: `grep -rn 'exec(\|cd \${' src/` matches nothing but the `execFile` import in
  `src/lib/cli.ts:1`, and `gitSetConfigValue` (`src/lib/git.ts:25-27`) now passes the value as an argv
  element. **R1 is closed**, and the code path `agent.command` flows through is clean. The conflict this
  question worried about cannot now occur.
- **Q5 — what should `--agent` with no `agent.command` configured do on a *scripted* run? — RESOLVED
  2026-09-06: the brief's behaviour, unchanged.** A message and exit 0; the worktree is still created and
  the editor still opens, only the dispatch is skipped. The maintainer accepted the CI caveat rather than
  adding a TTY branch. Phase 2 implements exactly this.

## 9. Surfaces to update — all verified to exist

- `docs/src/app/docs/commands/branch/page.mdx`, `checkout/`, `list/`, `cleanup/` — all present.
- `docs/src/app/docs/configuration/page.mdx` — for `agent.command`.
- `docs/src/app/docs/commands/_meta.ts` — **not touched**; no new command is added.
- `skills/core/SKILL.md` — frontmatter `description` enumerates every command and config value; `sources`
  listed `src/commands/branch.ts`, `src/lib/git.ts`, `src/lib/validators.ts` when this plan was written, and
  Phase 7 added `src/lib/agent.ts` and `src/lib/base-command.ts` to it.
- `skills/_artifacts/skill_tree.yaml` — **added at Phase 7**; it ships and duplicates that frontmatter. Its
  two sibling artifacts are deliberately left alone; see Phase 7's **Files** line for where the line falls.
- `README.md` — if the feature list changes.

## 10. What already holds in this repo

Read, not recalled — checked 2026-09-05 on `feature/add-agent-mode`, with the last four rows added
2026-09-06 by the audit that cut Phase 4. The first seven rows are the brief's own table, re-verified; the
rest were found while writing this plan or auditing it.

| Claim | Status |
|---|---|
| Unquoted shell interpolation of the path in `openWorktreePath()` | confirmed, `src/lib/base-command.ts:51-66` |
| `CONFIG_NAMES` has `codeEditor`, no agent entry | confirmed, `src/lib/constants.ts:1-12` |
| `WorktreeListEntry` carries `ahead`/`behind`/`uncommittedChanges`/`safeToRemove` | confirmed, `src/lib/types.ts:12-19` |
| `branch.run()` already orders create → copy env → open editor | confirmed, `src/commands/branch.ts:182-184` |
| `safeToRemove` reasons only about remote / commits / uncommitted | confirmed, `isSafeToRemove()` at `src/lib/git.ts:153-166` |
| `cleanup` filters on `safeToRemove === true` and has only `--force` | confirmed, `src/commands/cleanup.ts:16-27` |
| `list` has no flags at all today | confirmed, `src/commands/list.ts:6-19` — `--agents` is the first |
| `claude agents --json` exists and emits `cwd` + `name` per session | **confirmed by running it**, `claude` 2.1.261 — see §1 |
| `list` output is a bullet list, **not** a table as the brief states | confirmed, `src/commands/list.ts:16-18` + `src/lib/utils.ts:24-49` |
| `worktreeListEntryToListName` is shared by `list` and `cleanup` | confirmed, `src/commands/cleanup.ts:40` |
| `checkout` has no `flags` block at all | confirmed, `src/commands/checkout.ts:12-20` |
| `commandExists` already splits on whitespace and checks only the head | confirmed, `src/lib/cli.ts:27-39` |
| `config.ts` gates `codeEditor` behind a `maybePrompt` confirm | confirmed, `src/commands/config.ts:211-224` |
| `gitGetWorktreeList()` does 3 serial subprocess calls per worktree | confirmed, `src/lib/git.ts:168-211` |
| No `src/lib/base-command.test.ts` exists | confirmed, `ls src/lib/` — Phase 2 creates it |
| `gitSetConfigValue` interpolates the value into a shell string | confirmed, `src/lib/git.ts:23-25` — see R1 |
| Unquoted `cd ${branchPath}` in five more places | confirmed, `src/lib/git.ts:86,94,103,231,239` — see R1 |
| No `.claude/worktrees/` exists under this repo today | confirmed, `find` returned nothing — the §7 baseline |
| `claude agents --json` **excludes** completed sessions unless `--all` is passed | **confirmed by running both**, 2.1.263 on 2026-09-06 — 7 sessions vs 10; see §1 and D6 |
| Interactive sessions carry no `status` or `state` field at all | **confirmed by running it** — keys are `pid, cwd, kind, startedAt, sessionId, name`; see §4.1 |
| `--cwd` filters to background sessions only | confirmed, `claude agents --help` — the disqualifying reason in D4 |
| A real repo on this machine has 51 registered worktrees | confirmed, `git worktree list` in `~/Development/corivo/corivo`, 2026-09-06 — see R4 |
