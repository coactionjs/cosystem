---
"@cosystem/core": patch
---

`createApp` now requires every module to declare an explicit `name` in its
`@Module()`/`defineModule` metadata instead of deriving one from the class
name. Derived names break under minification: state slices, persisted
snapshots, and worker calls are all addressed by module name.
