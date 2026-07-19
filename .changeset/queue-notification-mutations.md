---
"@cosystem/core": patch
---

Queue actions, action boundaries, state writes, and direct store mutations
dispatched synchronously from `watch` listeners or plugin state hooks until the
in-flight engine commit and notification batch finish. Queued work still runs
before the triggering mutation returns, and unbounded cascades abort after
1000 mutations with a clear error.
