# Application Lifecycle

`createApp()` builds the runtime; the `App` then moves through init, start, stop,
and dispose phases. This guide covers the options, the exact ordering, lazy
modules, and scopes.

## `createApp(options)`

```ts
import { createApp, createLoggerPlugin, provide } from "@cosystem/core";

const app = createApp({
  providers: [Counter, provide(Logger, { useValue: console })],
  plugins: [createLoggerPlugin()],
  devOptions: { strictActions: true },
  engine: { patches: true },
});
```

| Option       | Type                              | Description                                                   |
| ------------ | --------------------------------- | ------------------------------------------------------------- |
| `providers`  | `(ProviderInput \| LazyModule)[]` | Modules, plain providers, and lazy-module entries.            |
| `plugins`    | `Plugin[]`                        | Lifecycle/observability plugins. See [Plugins](./plugins.md). |
| `parent`     | `App \| Container`                | Parent container for hierarchical DI.                         |
| `devOptions` | `{ strictActions?: boolean }`     | Enforce action boundaries for all writes.                     |
| `engine`     | `{ patches?: boolean }`           | Enable patch generation on the store.                         |

`createApp()` only creates the application runtime. It does not accept a root
view, render function, DOM container, or framework component — rendering is
always done by the host framework after the app exists.

## Phase ordering

```txt
createApp()
  1. create the root container (optionally under a parent)
  2. register plugin providers
  3. normalize provider inputs (app providers can override plugin providers)
  4. apply test overrides (testApp only)
  5. freeze the provider graph
  6. instantiate eager @Module providers
  7. build the single Coaction store from module state
  8. bind module state/actions/computed to the store
  9. instantiate other eager providers
  10. run onModuleCreated plugin hooks
  11. init():
       - run each plugin's setup(app, context) in registration order
       - run module onInit() hooks
       - start effects
     (steps under init() are tracked by the stable app.ready promise)

app.start()
  - await the init promise
  - run module onStart() hooks
  - mark the app started

app.stop()
  - run module onStop() hooks in reverse order
  - mark the app stopped

app.dispose()
  - if init is still in flight, abort plugin contexts, wait for setup to settle,
    and skip any remaining init work
  - if start is still in flight, wait for onStart hooks before stopping
  - stop() if still running
  - stop and drain effects
  - run module onDispose() hooks in reverse order
  - dispose dynamically loaded scopes in reverse load order
  - dispose plugins and plugin context resources in reverse order
  - dispose the container (provider dispose callbacks, reverse creation order)
  - destroy the store
  - if any teardown failed, throw one AggregateError after every phase ran
```

A few consequences worth internalizing:

- **Async initialization starts after `createApp()` returns.** Module creation
  and `onModuleCreated` are synchronous; plugin `setup`, `onInit`, and effects
  begin on the next microtask. Await `ready` (or `start()`) before work that
  depends on those phases.
- **`onInit` and effects run during creation**, not during `start()`. Many apps
  never need `start()` at all — call it only when you have explicit startup work
  in `onStart` hooks.
- **`start()` awaits init.** If a plugin's `setup` (e.g. storage hydration) is
  async, `start()` waits for it.
- **`ready` exposes init completion.** `app.ready` is one stable promise. It
  rejects with initialization failures; the runtime also observes that
  rejection internally so creating an app without starting or awaiting it does
  not emit an unhandled rejection.
- **Lifecycle reentry is rejected.** App-managed setup, lifecycle, effect, and
  teardown work cannot call `start()`, `stop()`, or `dispose()`: awaiting those
  operations from a phase they control can create a self-dependency. Setup and
  `onInit` work likewise cannot await `app.ready`. These calls return internally
  observed rejections; invoke lifecycle controls from application bootstrap.
- **Lifecycle injection survives `await`.** Use `PluginContext.inject()` in
  plugin setup and the `ModuleLifecycleContext` hook argument in modules. Their
  explicit resolvers remain app-scoped even when browser hooks overlap.
- **Teardown hooks run in reverse order and best-effort.** Errors from module
  hooks, effects, scopes, plugins, providers, and the store are collected while
  the remaining cleanup continues, then re-thrown together as an
  `AggregateError`.
- **Disposal is terminal.** As soon as disposal begins, provider resolution,
  module lookup and writes, watches, explicit action boundaries, lazy loads, and
  new scopes are rejected. A module facade or nested state reference retained
  before disposal cannot run actions or mutate state after teardown. Disposed
  containers (including descendants of a disposed root) likewise reject further
  use.

## Reading the app

```ts
app.state.version; // increments on every store change
app.started; // boolean
app.store.getPureState(); // full plain state tree
await app.ready; // plugin setup and module onInit are complete

app.getModule(Counter); // bound module facade
app.getModuleByName("counter"); // look up by registered name
app.get(Token); // resolve any provider (sync)
await app.getAsync(Token); // resolve, allowing async factories
app.getAll(MultiToken); // all multi providers
```

Subscribe to derived values with `watch` (see
[State & Reactivity](./state-and-reactivity.md#watching-state)):

```ts
const stop = app.watch(
  () => app.getModule(Counter).count,
  (value, previous) => console.log(value, previous),
  { immediate: false },
);
stop();
```

## Lazy modules

Lazy modules let you load functionality after the app is built — for code
splitting or feature gating — **without mutating the root provider graph**. Each
lazy module is loaded into its own child scope.

```ts
import { createApp, defineModule, lazyModule } from "@cosystem/core";

class AdminCounter {
  count = 0;
  increase(): void {
    this.count += 1;
  }
}
defineModule(AdminCounter, { actions: ["increase"], name: "adminCounter", state: ["count"] });

const app = createApp();

await app.load(lazyModule(() => ({ providers: [AdminCounter] })));
app.getModule(AdminCounter).increase();
```

### Loading model

- Passing `lazyModule(...)` in `createApp({ providers })` **records** the entry
  without loading it.
- `await app.load()` loads **all** pending lazy modules, in registration order.
- `await app.load(module)` loads **one** specific lazy module (idempotent — a
  second call returns the same result).
- Concurrent loads of the same `LazyModule` share one loader and initialization
  promise.
- Providers and modules are staged in a temporary child scope. The module state,
  facades, metadata, effects, and lookup maps become visible only after
  `onInit` and (for a started app) `onStart` succeed.
- A failed load disposes the temporary scope and rolls back all staged runtime
  state. A later call retries from a fresh scope.
- Once app disposal begins, lazy loads reject instead of installing new modules.
- A loader may return a provider, a provider array, or a module-namespace object
  (`{ default }` / `{ providers }`), which makes dynamic `import()` ergonomic:

  ```ts
  await app.load(lazyModule(() => import("./admin/module.js")));
  ```

When a lazy module loads after `start()`, its `onInit` and (if the app is
started) `onStart` hooks run, and its effects start immediately. Loading after
`dispose()` throws. The result describes the created modules and the scope:

```ts
const { modules, scope } = await app.load(adminModule);
```

## Scopes

`app.createScope(options?)` returns an `AppScope` whose `container` is a child DI
scope. Use it for request/view/worker-scoped providers, or to `build()`
unregistered classes:

```ts
const scope = app.createScope();
const handler = scope.container.build(RequestHandler);
```

Scoped providers resolve to one instance per child scope; see
[Dependency Injection](./dependency-injection.md#scopes).

## Hierarchical apps

Pass `parent` to nest one app/container under another, so a child app can resolve
the parent's providers:

```ts
const child = createApp({ parent: app, providers: [FeatureModule] });
```

## Next

- [State & Reactivity](./state-and-reactivity.md) — the store, strict actions, patches.
- [Plugins](./plugins.md) — hook into these phases.
- [Worker & Shared Runtime](./worker-runtime.md) — run modules off the main thread.
