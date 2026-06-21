---
"@cosystem/core": minor
"@cosystem/router": minor
"@cosystem/storage": minor
---

Advance the CoSystem runtime toward the v1 application model:

- add explicit lazy modules with `lazyModule()` and `app.load()`
- add async container construction through `buildAsync()`
- run worker hosts through app startup before publishing the initial snapshot
- expose a data-transport-compatible worker transport adapter
- add module effects, cached computed getters, eager provider instantiation, and settled async action reporting
- add router lifecycle bridging and queued storage persistence controls
