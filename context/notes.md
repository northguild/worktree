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
- **Phase 2 (#352).** Contrast measures the switch's track edge on the panel and the leaf edge on the track, not the
  leaf faces against the panel as the Scope worded it (the faces are a second cue, about 1.2:1). The switch's focus
  ring is not measured. Panel placement (right-aligned, 1 rem gutter, the bar not moving) has no seam below the §8
  browser pass. `settings-control.test.ts` queries by selector rather than role.
- **Phase 3 (#352).** Records are checked field by field by hand where `typescript/validation.md` prefers a schema
  (D5 asks for GMT's reading exactly). No test sends a `storage` event with `key: null` (another tab's `clear()`).
- **Phase 4 (#352).** "A cue while muted imports nothing" is not one literal assertion; `HIDE_TAIL_MS`'s value is not
  pinned; no engine test covers the loop path; `kit.test.ts:129`'s title claims more than it checks. The audit follows
  static imports one level deep. Errors from the engine import are swallowed by design (GMT's rule).
- **Phase 5 (#352).** `docs/src/lib/settings-control.ts:12` still says "without its sound control" (untrue since this
  phase). `.stem-fader:focus-within` shows the ring after a mouse press. The leaves are one colour, not the board's
  `--leaf-N`; the owner should confirm by eye. The first notch after unmuting plays during the 50 ms fade-in.
- **Phase 6 (#352).** `flight()` runs at every stage start for muted readers too (1.8 ms median in Chromium); skipping
  it unless `data-sound="on"` would remove the cost for almost everyone. The change's sound ends at the shape leaves'
  last landing; `playStage`'s docstring says `longest * PACE`. The canopy's curve spans one step past the landing (the
  guard bus silences it). `leaves.test.ts:260` asserts arithmetic on literals. The pointer's 0.5 s silence depends on
  `feedRustle`'s constants, untested.
- **Phase 8 (#352).** No test pins "no bell after a mid-answer error or a stall"; the thinking loop's peak, release,
  lowpass and fade-out are not asserted; the Files line's `typing.test.ts` was not added (the rules are pinned in
  `DoxChat.sound.test.tsx`).
- **Phase 8 re-review (#352).** "Stops listening when the chat unmounts" can no longer fail: it types into a new
  textarea that is never the composer. The composer is always a textarea, so `isTextField`'s password branch never
  runs in this caller (kept as part of the port).
