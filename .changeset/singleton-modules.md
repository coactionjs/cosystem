---
"@cosystem/core": patch
---

Reject scoped, resolution, and transient CoSystem modules so dependency injection and the single bound app store slice always share one singleton module instance.
