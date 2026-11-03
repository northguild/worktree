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
