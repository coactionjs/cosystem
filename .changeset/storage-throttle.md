---
"@cosystem/storage": patch
---

Add a `throttleMs` option to both storage plugins: state-change persistence
writes at most once per interval on the trailing edge, always with the latest
state. Pending writes flush on plugin dispose or through `flush()`, while
explicit `clear()` and `persist()` cancel stale scheduled writes. Without the
option every state change is queued immediately, as before.
