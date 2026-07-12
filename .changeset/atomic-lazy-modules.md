---
"@cosystem/core": patch
---

Coalesce concurrent lazy module loads and stage lifecycle work in a temporary scope so failures roll back state, effects, metadata, registrations, and resources before a clean retry.
