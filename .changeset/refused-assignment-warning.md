---
"@northguild/worktree": patch
---

When GitHub refuses `worktree branch --github <n> --assign` with a 403, the warning now says what the token needs: an account with push access to the repository and, for a fine-grained token, the Issues (or Pull requests) permission set to Read and write.
