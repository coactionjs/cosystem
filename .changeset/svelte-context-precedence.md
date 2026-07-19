---
"@cosystem/svelte": patch
---

`getCoSystemApp` now resolves the component context before the global default
app, so nested apps and per-request (SSR) apps are not shadowed by
module-level state. The global app set with `setCoSystemApp` remains the
fallback outside component context.
