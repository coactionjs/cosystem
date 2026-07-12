---
"@cosystem/core": minor
---

Add explicit plugin and module lifecycle injectors so awaited hooks remain isolated across concurrently initializing browser apps without leaking a global resolution context.
