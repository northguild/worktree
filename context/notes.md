# Notes

Branch-local observations from the gates that are neither a bug nor a backlog entry. Read by a person, by nothing
else; `/feature-close` deletes this file.

- **Phase 1 (#352).** No test exercises the click line in `docs/src/components/ThemeSelect.astro` itself;
  `theme.test.ts`'s `press()` copies its expression. The file is removed in Phase 2. If the toggle outlives Phase 2,
  pin it then (an exported helper diverges from GMT's `theme.ts`, D4, so that is the plan's call).
- **Phase 1 (#352).** `mountThemeSwitch` in `docs/src/lib/theme.ts` has no test and no caller until the gear's
  switch is wired.
- **Phase 1 (#352).** `opposite` is a named module-level arrow function in `ThemeSelect.astro` and `theme.test.ts`;
  `typescript/rules.md` asks for a `function` declaration there. Style only.
