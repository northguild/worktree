---
"@northguild/worktree": minor
---

`branch` no longer fails inside git when the branch name is already taken: on a terminal it offers to open the worktree that already has it, and otherwise it refuses with exit `2` (`invalid_value`) and says what to run instead.
