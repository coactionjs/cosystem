# @cosystem/core

## 0.2.0

### Minor Changes

- c91cebc: Allow plugins to contribute non-module providers, have the router plugin provide `RouterToken`, and flush storage writes through plugin context disposal.
- 51a2645: Rename decorator APIs to PascalCase: `Module`, `State`, `Action`, `Computed`, and `Effect`.
- 14e063c: Add explicit plugin and module lifecycle injectors so awaited hooks remain isolated across concurrently initializing browser apps without leaking a global resolution context.
- 80c4e58: Add `PluginContext` with managed disposers and `watch`, and isolate observer hook errors through plugin error hooks.

### Patch Changes

- c9e64c3: Make lazy-module state publication atomic with synchronous effect startup so a failed effect emits no transient state, watch, patch, or app-version update before rollback.
- 6aec125: Coalesce concurrent lazy module loads and stage lifecycle work in a temporary scope so failures roll back state, effects, metadata, registrations, and resources before a clean retry.
- 289305a: Enforce strict actions for nested state, arrays, and direct store mutation APIs, add an app-level action boundary for controlled whole-store updates, and use it for storage hydration.
- ee5301b: Make app and container disposal terminal, continue every cleanup phase after failures, aggregate teardown errors, and release resources produced by in-flight async providers.
- 98b4aa2: Return detached, recursively frozen plain snapshots from `store.getPureState()` in strict-actions apps so raw object or array writes cannot bypass action enforcement.
- 26ce33f: Support nested and cross-module action composition. Actions invoked while
  another action is running now reuse the open root draft instead of calling
  `setState` again, which Coaction rejects while a commit is open. Cross-module
  state writes inside an action are routed into the active commit and are
  allowed under `strictActions`. Everything inside the outermost action merges
  into a single commit: one state notification and one patch set, rolled back
  as a whole if the outermost action throws.
- 5f71742: `getModule` and `getModuleByName` now resolve modules registered on a parent
  app instead of throwing a misleading "not a CoSystem module" error for a
  token the child container can already resolve. Unregistered tokens still
  surface `MissingProviderError`.
- e7c81ad: Add explicit provider auto-disposal ownership, keep external values and aliases unowned by default, let custom disposers replace convention disposal, and make storage destroyOnDispose authoritative.
- 159ffbe: Queue actions, action boundaries, state writes, and direct store mutations
  dispatched synchronously from `watch` listeners or plugin state hooks until the
  in-flight engine commit and notification batch finish. Queued work still runs
  before the triggering mutation returns, and unbounded cascades abort after
  1000 mutations with a clear error.
- 95d00bb: Reject lifecycle-control and readiness reentry from app-managed async work instead of allowing setup, hooks, effects, or teardown callbacks to deadlock the app.
- 0751a50: Remove the unused `rxjs` peer dependency from `@cosystem/angular`.
  `@cosystem/core` now builds with a neutral platform target and uses the same
  `.js`/`.d.ts` output convention as the other browser-and-server packages.
- 027171e: `createApp` now requires every module to declare an explicit `name` in its
  `@Module()`/`defineModule` metadata instead of deriving one from the class
  name. Derived names break under minification: state slices, persisted
  snapshots, and worker calls are all addressed by module name.
- f931e31: Validate complete worker protocol schemas, expose only declared actions, add RPC timeout and AbortSignal controls, and secure ambient postMessage/BroadcastChannel transports with origin, source, targetOrigin, and capability-token options.
- 38f4014: Reject scoped, resolution, and transient CoSystem modules so dependency injection and the single bound app store slice always share one singleton module instance.
- 77bddf0: Expose stable app initialization readiness, observe initialization failures internally, reject lifecycle start reentry, and preserve imperative injection across awaited lifecycle work.
- a02235b: Notify app watchers once per store mutation and isolate synchronous or asynchronous listener failures from committed actions through the watch error phase.
- 1abd56b: Share in-flight async providers across singleton and resolution scopes, retry failed factories, and keep imperative `inject()` inside the active resolution graph.
- 38b8aa3: Reject module lookup and writes after app disposal, including actions and deep state mutations through module facades or state references retained before teardown.
- e1336a0: Track async provider work discovered through synchronous resolution so fulfilled resources remain cached or container-owned and are disposed without leaks.
- e3c3fff: Upgrade the runtime dependency to Coaction 3.1.0, consume its reactive tracker
  from the public `coaction/adapter` entry point, and preserve dynamic lazy-module
  state behind Coaction's fixed root schema.
- f9c4c3c: Allow worker hosts to opt ordinary module methods into remote invocation with
  the new `createWorkerApp({ expose })` allowlist. Declared module actions remain
  remotely callable by default; lifecycle hooks, helpers, and other methods stay
  private unless explicitly listed by module name.
- 71e762e: Abort worker app initialization before awaiting host readiness during disposal, make host disposal idempotent, and reject new client RPC calls after client disposal.

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
