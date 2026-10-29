---
"@northguild/worktree": minor
---

`.worktree.yml` takes a top-level `branchType` list shared by every provider that has no list of its own, so a team writes its branch-prefix rules once; rules can name the portable fields `Type` and `Labels` on any provider and on a real run a shared rule does not warn about a field a provider lacks. A provider's own `branchType` still wins, and no built-in default changes.
