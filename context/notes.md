# Notes

- **Phase 1 (Gate 2):** the case (a) fixture body is `{"message":…}` only, because the record captured
  only `message`, and it runs against `northguild/worktree` #42 rather than the recorded
  `baldurpan/flood-engineer` #1. If the full body is ever recorded, the fixture and its expected string
  follow it.
- **Phase 2 (Gate 2):** `skills/worktree/SKILL.md:73` paraphrases the shared sentence (drops "(or Pull
  requests)" and "whose account") to fit a shell comment; nothing in it is false.
- **Phase 2 (Gate 2):** no test ties the three doc pages to the warning's sentence; the docs test suite is
  where one would go. The `branch.test.ts` comment says so.
- **Phase 2 (Gate 2):** the configuration page and the GitHub guide state the push-access condition without
  the "not tested" flag; only the branch page carries it, and the configuration page links there.
- **Phase 2 (Gate 2):** the guide reads "Assigning always does … **Assigning needs…**" — the word repeats.
