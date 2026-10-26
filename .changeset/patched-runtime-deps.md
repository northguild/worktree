---
"@northguild/worktree": patch
---

Update runtime dependencies so a fresh install no longer pulls a `brace-expansion` with known denial-of-service advisories: `@oclif/core` 4.14 drops the `ejs` 3 → `jake` → `minimatch` chain that carried it.
