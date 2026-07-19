# @cosystem/storage

## 0.2.0

### Minor Changes

- 09b158e: Add a localspace-backed cross-framework storage plugin with `StorageToken`, localspace driver/plugin re-exports, and a shared storage service for app DI.

### Patch Changes

- c91cebc: Allow plugins to contribute non-module providers, have the router plugin provide `RouterToken`, and flush storage writes through plugin context disposal.
- 289305a: Enforce strict actions for nested state, arrays, and direct store mutation APIs, add an app-level action boundary for controlled whole-store updates, and use it for storage hydration.
- e7c81ad: Add explicit provider auto-disposal ownership, keep external values and aliases unowned by default, let custom disposers replace convention disposal, and make storage destroyOnDispose authoritative.
- dbf42b0: Add a `throttleMs` option to both storage plugins: state-change persistence
  writes at most once per interval on the trailing edge, always with the latest
  state. Pending writes flush on plugin dispose or through `flush()`, while
  explicit `clear()` and `persist()` cancel stale scheduled writes. Without the
  option every state change is queued immediately, as before.
- Updated dependencies [c9e64c3]
- Updated dependencies [6aec125]
- Updated dependencies [c91cebc]
- Updated dependencies [51a2645]
- Updated dependencies [289305a]
- Updated dependencies [ee5301b]
- Updated dependencies [98b4aa2]
- Updated dependencies [26ce33f]
- Updated dependencies [5f71742]
- Updated dependencies [e7c81ad]
- Updated dependencies [159ffbe]
- Updated dependencies [95d00bb]
- Updated dependencies [0751a50]
- Updated dependencies [027171e]
- Updated dependencies [14e063c]
- Updated dependencies [f931e31]
- Updated dependencies [38f4014]
- Updated dependencies [77bddf0]
- Updated dependencies [a02235b]
- Updated dependencies [1abd56b]
- Updated dependencies [38b8aa3]
- Updated dependencies [80c4e58]
- Updated dependencies [e1336a0]
- Updated dependencies [e3c3fff]
- Updated dependencies [f9c4c3c]
- Updated dependencies [71e762e]
  - @cosystem/core@0.2.0

## 0.1.0

### Major Changes

- Release CoSystem 0.1 with the app runtime, lightweight DI, module decorators and no-decorator metadata, framework-native UI adapters, worker/shared runtime transports, persistence, router, devtools, testing helpers, examples, and CI/CD publishing support.

### Minor Changes

- 2f51753: Advance the CoSystem runtime toward the v0.1 application model:

  - add explicit lazy modules with `lazyModule()` and `app.load()`
  - add async container construction through `buildAsync()`
  - run worker hosts through app startup before publishing the initial snapshot
  - expose a data-transport-compatible worker transport adapter
  - add module effects, cached computed getters, eager provider instantiation, and settled async action reporting
  - add router lifecycle bridging and queued storage persistence controls

- 527b664: Add `partialize` and `merge` options for partial persistence and hydrated state merging.

### Patch Changes

- Updated dependencies [11db34e]
- Updated dependencies [2e01e3a]
- Updated dependencies [5385bd5]
- Updated dependencies [2f51753]
- Updated dependencies [8d18a9a]
- Updated dependencies [366eb38]
- Updated dependencies [177ca9a]
- Updated dependencies [794566f]
- Updated dependencies [77cd9a9]
- Updated dependencies [80f25e8]
  - @cosystem/core@0.1.0
