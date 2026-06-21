---
"@cosystem/core": patch
---

Return the bound CoSystem module facade from `app.get()` and `app.getAsync()` for module tokens, even when the provider scope is not singleton.
