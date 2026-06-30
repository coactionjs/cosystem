# @cosystem/storage

## 0.2.0

### Minor Changes

- 09b158e: Add a localspace-backed cross-framework storage plugin with `StorageToken`, localspace driver/plugin re-exports, and a shared storage service for app DI.

### Patch Changes

- c91cebc: Allow plugins to contribute non-module providers, have the router plugin provide `RouterToken`, and flush storage writes through plugin context disposal.
- Updated dependencies [c91cebc]
- Updated dependencies [51a2645]
- Updated dependencies [80c4e58]
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
- Updated dependencies
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

## 0.0.2

### Patch Changes

- fix
- Updated dependencies
  - @cosystem/core@0.0.2

## 0.0.1

### Patch Changes

- fix
- Updated dependencies
  - @cosystem/core@0.0.1
