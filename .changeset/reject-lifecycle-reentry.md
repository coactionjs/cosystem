---
"@cosystem/core": patch
---

Reject lifecycle-control and readiness reentry from app-managed async work instead of allowing setup, hooks, effects, or teardown callbacks to deadlock the app.
