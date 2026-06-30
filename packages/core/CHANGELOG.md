# @cosystem/core

## 0.2.0

### Minor Changes

- c91cebc: Allow plugins to contribute non-module providers, have the router plugin provide `RouterToken`, and flush storage writes through plugin context disposal.
- 51a2645: Rename decorator APIs to PascalCase: `Module`, `State`, `Action`, `Computed`, and `Effect`.
- 80c4e58: Add `PluginContext` with managed disposers and `watch`, and isolate observer hook errors through plugin error hooks.

## 0.1.0

### Major Changes

- Release CoSystem 0.1 with the app runtime, lightweight DI, module decorators and no-decorator metadata, framework-native UI adapters, worker/shared runtime transports, persistence, router, devtools, testing helpers, examples, and CI/CD publishing support.

### Minor Changes

- 11db34e: Add BroadcastChannel-style worker transport for shared tab coordination, including routed call results and an in-memory broadcast channel for tests.
- 2e01e3a: Add explicit action boundaries with `app.runInAction()` and `runInAction(module, callback)` so strict action mode can be preserved across awaited work.
- 5385bd5: Add `createPostMessageWorkerTransport()` for Web Worker, iframe, and MessagePort-style endpoints.
- 2f51753: Advance the CoSystem runtime toward the v0.1 application model:

  - add explicit lazy modules with `lazyModule()` and `app.load()`
  - add async container construction through `buildAsync()`
  - run worker hosts through app startup before publishing the initial snapshot
  - expose a data-transport-compatible worker transport adapter
  - add module effects, cached computed getters, eager provider instantiation, and settled async action reporting
  - add router lifecycle bridging and queued storage persistence controls

- 366eb38: Expose `WorkerClient.ready`, resolving after the initial state snapshot is available and rejecting if the client is disposed first.
- 177ca9a: Add `WorkerClient.select()` and `WorkerClient.watch()` for selector-based reads of worker-hosted state.
- 794566f: Add worker client conflict hooks for stale messages, missing snapshots, patch version gaps, and patch application failures.
- 77cd9a9: Add patch-only worker state synchronization with client-side patch application.
- 80f25e8: Add worker state section filtering with `stateSections` so worker hosts can publish isolated top-level module slices.

### Patch Changes

- Ensure delegated worker method promises settle only after the client state mirror reaches the worker state version associated with the result.
- 8d18a9a: Return the bound CoSystem module facade from `app.get()` and `app.getAsync()` for module tokens, even when the provider scope is not singleton.

## 0.0.2

### Patch Changes

- fix

## 0.0.1

### Patch Changes

- fix
