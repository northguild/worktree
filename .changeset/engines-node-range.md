---
"@northguild/worktree": patch
---

Declare `engines.node` (`^20.17.0 || ^22.13.0 || >=23.5.0`, the range `@inquirer/prompts` supports), so installing on an unsupported Node, such as 21, warns at install time instead of failing at runtime.
