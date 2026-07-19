---
"@cosystem/core": patch
---

`getModule` and `getModuleByName` now resolve modules registered on a parent
app instead of throwing a misleading "not a CoSystem module" error for a
token the child container can already resolve. Unregistered tokens still
surface `MissingProviderError`.
