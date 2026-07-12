---
"@cosystem/core": patch
---

Return detached, recursively frozen plain snapshots from `store.getPureState()` in strict-actions apps so raw object or array writes cannot bypass action enforcement.
