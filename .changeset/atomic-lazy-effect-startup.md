---
"@cosystem/core": patch
---

Make lazy-module state publication atomic with synchronous effect startup so a failed effect emits no transient state, watch, patch, or app-version update before rollback.
