---
"@cosystem/core": patch
---

Reject module lookup and writes after app disposal, including actions and deep state mutations through module facades or state references retained before teardown.
