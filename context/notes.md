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
