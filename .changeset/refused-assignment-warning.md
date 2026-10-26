---
"@northguild/worktree": patch
---

`worktree branch --github <n> --assign` now explains a refused assignment more precisely: the token's account needs push access, and a fine-grained token also needs the Issues (or Pull requests) permission set to Read and write.
