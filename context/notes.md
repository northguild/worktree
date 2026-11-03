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
