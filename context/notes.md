# Notes

Branch-local, advisory, read by nothing. `/feature-close` deletes this file.

## Phase 1 — Extract the wizard into section modules (#236)

- `src/lib/config-wizard/context.test.ts` was on the phase's Files line but not added: the move added no behaviour, and the rules in `context.ts` are already pinned at the command level in `config.test.ts`.
- `WizardContext` in `src/lib/config-wizard/context.ts` is an `export type … = {}` where `context/standards/typescript/rules.md` prefers `interface` for object shapes; every other exported shape in `src/lib` is an interface.
- The bare-run group order is not pinned by any test — `config.test.ts` asserts order only between pairs of prompts — so the reviewer's diff against `HEAD`, not the suite, is what established the order for this phase.
- D5's per-key `ask` functions do not exist yet; each key's question is still inline in its group function.
