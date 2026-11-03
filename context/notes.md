# Notes — #115 Linear agent delegation

Branch-local and advisory. Nothing reads this file; `/feature-close` deletes it.

- **Phase 1:** `linear.agentToken` and `linear.webhookSecret` get no value check in `src/lib/validators.ts`
  (`isValidConfigValue` falls to `default: return true`), so a whitespace-only token is accepted where
  `linear.apiKey` is refused. Nothing reads them in Phase 1; worth two `case` lines once something does.
- **Phase 1:** `README.md` puts the listener-keys bullet under "The setup flow can configure:" and then says
  the wizard never asks for them — reads better as a sentence below that list.
- **Phase 1:** a `worktree config --project` test pins that secret keys are never written
  (`SECRET_VALUES`), but `linear.agentAllow` is not in `PERSONAL_VALUES`, so nothing asserts it is never
  written either. `writeProjectFile` only writes `TEAM_CONFIG_KEYS`, so no defect today.
- **Phase 2:** `parseAgentSessionEvent` returns `null` both for a malformed body and for a correctly signed
  event that is simply not ours (no `issue`, an unknown `action`). Phase 5's plan maps "not a valid event"
  to `400`, which on a signed delivery makes Linear retry and may get the webhook disabled. Worth a `200`
  for signed-but-not-actionable events when Phase 5 is reviewed.
- **Phase 2:** `verifyWebhookSignature` accepts `rawBody: Uint8Array | string`; the listener should hand it
  the raw `Buffer`, since a decoded string does not always re-encode to the signed bytes. Its docstring
  (`linear-agent.ts:47-48`) still mentions the `Linear-Timestamp` header as an input to `isTimestampFresh`.
- **Phase 2:** tests could pin `isAllowedCreator("a", [])` is `false` (D5 fails closed; today only an
  `undefined` creator is tried against an empty list), and the test named "a re-stringified body" does not
  actually re-stringify one.
- **Phase 3:** `failure()` in `linear-agent-api.ts` keeps the raw error on `cause`, unredacted; Node's
  `util.inspect` prints a cause's message. Nothing logs the error object today (`base-command.ts` prints
  only the redacted message) — the listener must keep it that way.
- **Phase 3:** redaction runs `redactSecrets` before stripping the token by value, so a token holding a
  known shape mid-string can leave a prefix fragment; by-value first is strictly safer. An empty token
  turns `split("").join("***")` into garbled text — refuse it upstream.
- **Phase 3:** D10 says "5 s-class timeout"; the code and Phase 3's Scope use `fetchLinear`'s 15 s. A
  15 s cap on the first `thought` is longer than Linear's 10 s first-activity window (D7) — it only bounds
  a failure, but worth reconciling in the plan wording. The constant is now duplicated across the two
  modules.
- **Phase 3:** 401/403/429 become a bare "HTTP 401" with no next step; `fetchLinear` maps auth and rate
  limits. The listener could name `linear.agentToken` on a 401. Tests were written alongside the module
  rather than red first; every value still traces to Linear's schema or docs.
- **Phase 4:** nothing implements §4.1's "one session at a time per identifier". A mention and a delegation
  of one issue are two session ids, so two children can race on `git worktree add`; the loser likely gets
  `failed` rather than the "already exists" response. No phase's Done-when owns it.
- **Phase 4:** the team-key compare is case-sensitive (`linear-agent-dispatch.ts`), so `--team eng` would
  silently ignore every session; normalise at the flag or compare case-insensitively.
- **Phase 4:** `CHILD_TIMEOUT_MS` (15 min) has no §8 source; the install bound is 10 min *per step*, so a
  multi-step `postCreate` can exceed it, and a timed-out install's grandchildren keep running. Both limits
  belong in the Phase 7 guide, as does the fact that local paths reach Linear in activity bodies.
- **Phase 4:** the existing-branch check matches `/\balready\b/i` on `branch.ts`'s message text — tied to
  wording nothing there would flag if it changed. The `prompted` response claims an agent "keeps working"
  even when none was started. A failed install is reported only as "agent was not prompted".
- **Phase 4:** untested rules — the 1 MiB stdout cap, SIGKILL after the grace period, the body cut (which
  is at `MAX_DETAIL_CHARS * 2`, not the constant its comment names), `prompted: true` with a non-zero exit,
  and `DEFAULT_CLI_ENTRY` resolving to a real `bin/run.js`. The identifier pattern is duplicated from
  `linear-agent.ts`; the spawner test's temp directory is never removed.
- **Phase 5:** a signed, fresh body that does not parse as an actionable event gets `400`, as the plan's
  Scope says — but once the signature checks, the sender is Linear and a retry fails the same way, so any
  other webhook category or an `issue: null` session can get the webhook disabled. A `200` + "ignored" log
  would avoid it; at least the Phase 7 guide must say to enable only Agent session events.
- **Phase 5:** §4.1's per-identifier serialisation is still unbuilt (see the Phase 4 note); the CLI's
  existing-branch refusal is check-then-act, so it is not a reliable second line.
- **Phase 5:** untested — that the default allowlist reads the *personal* key's viewer (the `fetchLinear`
  mock answers whatever key it is given), `getKeyOwnerId`'s exit-1 path, and that the start-up output omits
  the personal key; the non-loopback reachability half of the bind test silently does nothing on a host
  with no external IPv4. Nothing ties `--help` to the docs page's flag list automatically.
- **Phase 5:** `getKeyOwnerId` narrows Linear's answer with `as`; no rate limit or concurrency cap on the
  endpoint; it binds `127.0.0.1` only, so a tunnel aimed at `localhost` → `::1` is refused (say so in the
  guide); a request on a kept-alive socket during the drain is not awaited; the docs chat's command→route
  map (`docs/src/chat/components/MarkdownContent.tsx`) has no `worktree linear-listen` entry.
- **Phase 6:** `SKILL.md:227` says issue content is "never passed to an agent by `worktree` itself", which reads
  as contradicting the `linear-listen` exception right after it; "never passed to an agent, except as below"
  would fit. The success activity (`linear-agent-dispatch.ts:230`) still says the agent "has been given the
  issue identifier", which is incomplete with `linear.agentContext` on.
- **Phase 6:** the `linear-listen` page's list of what start-up prints (`page.mdx:112`) leaves out the new
  "Issue context: on/off" line (line 76 mentions it). The 32 KiB `MAX_CONTEXT_BYTES` is the coder's choice;
  D8 says only "well under 131,071".
- **Phase 6:** correct but untested: the tilde, CRLF and trailing-backtick fence cases; the worst-case brief
  from an all-backtick context (~98.6 KB, under the 131,071 cap); the child's `--json` at `branch` level not
  carrying the brief (holds by construction, `base-command.ts:902`). `herdr.ts` `toHerdrError` passes Herdr's
  own stderr through verbatim; that predates this feature and applies to any brief.
- **Phase 7:** the guide's outcome table leaves out "prompted, but the command exited with code N"
  (`linear-agent-dispatch.ts:222-227`) and the refused-identifier response (`:296-302`); its thought row uses a
  literal `ENG-123` where the rest use placeholders. The missing-agent sentence covers only a run Herdr will not
  open; with Herdr opening and neither `herdr.agent` nor `agent.command` set it is also `missing_value`, exit 2.
- **Phase 7:** "If Linear rejects the token or the key … exits 1" (guide `:71`, and the command page's exit table)
  holds for the key only when `linear.agentAllow` is unset (`linear-listen.ts:324-335`). "Linear shows the
  signing secret" there and "the same place you enabled the category" are Linear UI claims not checked against
  Linear's docs ("settings under API" matches their `settings/api/applications/new` link).
- **Phase 7:** step 3 puts both tokens on the command line (process list, shell history), against
  `security/secrets.md`; that is `worktree config`'s design since Phase 1, and the wizard never asks for them (D9).
