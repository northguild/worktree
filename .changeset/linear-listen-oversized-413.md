---
"@northguild/worktree": patch
---

`worktree linear-listen` now answers a webhook body over 1 MiB with its `413` instead of a connection reset: the listener reads the rest of the body before replying, and cuts off a sender that is still writing after 5 seconds.
