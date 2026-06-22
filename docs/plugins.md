# Plugins

Plugins extend the runtime without coupling it to any framework. They observe the
app lifecycle and the store, and can run setup/teardown work. Routing,
persistence, and devtools are all plugins — nothing observability-related is baked
into the core.

## The `Plugin` interface

Implement any subset of these hooks:

```ts
interface Plugin {
  name?: string;
  setup?(app: App): void | Promise<void>;
  onModuleCreated?(event: ModuleCreatedEvent): void;
  onActionStart?(event: ActionEvent): void;
  onActionEnd?(event: ActionEvent): void;
  onPatch?(event: PatchEvent): void;
  onStateChange?(event: StateChangeEvent): void;
  onError?(error: unknown, context: ErrorContext): void;
  dispose?(): void | Promise<void>;
}
```

Register plugins through `createApp({ plugins })`:

```ts
const app = createApp({
  plugins: [createLoggerPlugin()],
  providers: [Counter],
});
```

## When each hook fires

| Hook                      | Fires when                                                             |
| ------------------------- | ---------------------------------------------------------------------- |
| `setup(app)`              | During app init (before `onInit`); may be async — `start()` awaits it. |
| `onModuleCreated(event)`  | After each module instance is created and bound.                       |
| `onActionStart(event)`    | When an action begins.                                                 |
| `onActionEnd(event)`      | When an action settles (includes `error` on failure).                  |
| `onPatch(event)`          | On each store patch (requires `engine: { patches: true }`).            |
| `onStateChange(event)`    | On every store change.                                                 |
| `onError(error, context)` | When a lifecycle phase throws (`context.phase`).                       |
| `dispose()`               | During `app.dispose()`; may be async.                                  |

See [Application Lifecycle](./application-lifecycle.md#phase-ordering) for the
exact ordering of `setup`, `onInit`, and effects.

## Event payloads

```ts
interface ModuleCreatedEvent {
  name: string;
  token: InjectionToken;
  instance: unknown;
}
interface ActionEvent {
  module: string;
  method: string;
  args: readonly unknown[];
  startedAt: number;
  endedAt?: number;
  error?: unknown;
}
interface PatchEvent {
  patches: readonly unknown[];
  inversePatches: readonly unknown[];
}
interface StateChangeEvent {
  state: unknown;
}
interface ErrorContext {
  phase: string;
}
```

## Built-in plugins

### Logger — [`createLoggerPlugin`](../packages/core/README.md#logger-plugin)

Logs module creation, action completion/failure, and runtime errors. Ships in
`@cosystem/core`.

```ts
import { createLoggerPlugin } from "@cosystem/core";

createApp({ plugins: [createLoggerPlugin()], providers: [Counter] });
// pass { logger } to route messages somewhere other than console
```

### Storage — [`@cosystem/storage`](../packages/storage/README.md)

Hydrates state on startup and persists changes to any sync/async backend.

```ts
import { createStoragePlugin } from "@cosystem/storage";

type CounterAppState = {
  readonly counter: {
    readonly count: number;
  };
};

const storage = createStoragePlugin({
  key: "cosystem:app",
  storage: window.localStorage,
  partialize: (state) => ({ counter: (state as CounterAppState).counter }),
});

const app = createApp({ plugins: [storage], providers: [Counter] });
await app.start(); // waits for hydration
```

### Router — [`@cosystem/router`](../packages/router/README.md)

Bridges a `Router` into the app lifecycle and exposes it via `RouterToken`.

```ts
import { createRouterPlugin, createBrowserRouter, provideRouter } from "@cosystem/router";

const router = createBrowserRouter();
const app = createApp({
  plugins: [createRouterPlugin(router, { onChange: (loc) => console.log(loc.path) })],
  providers: [provideRouter(router)],
});
```

### Devtools — [`@cosystem/devtools`](../packages/devtools/README.md)

Records a timeline of setup, module, action, patch, state, and error events.

```ts
import { createDevtoolsPlugin } from "@cosystem/devtools";

const devtools = createDevtoolsPlugin();
const app = createApp({ plugins: [devtools], providers: [Counter] });
devtools.subscribe((event) => console.log(event.type));
```

## Writing your own plugin

A plugin is just an object. Keep state in a closure and return the hooks you
need:

```ts
import type { Plugin } from "@cosystem/core";

export function createTimingPlugin(): Plugin {
  const durations: number[] = [];

  return {
    name: "timing",
    onActionEnd(event) {
      if (event.endedAt !== undefined) {
        durations.push(event.endedAt - event.startedAt);
      }
    },
    dispose() {
      durations.length = 0;
    },
  };
}
```

Tips:

- Give every plugin a `name` (used in error context and tooling).
- Use `setup(app)` for work that needs the live `App` (subscribing, resolving
  services); return a promise if it is async so `start()` waits.
- Clean up everything you allocate in `dispose()` — it runs during
  `app.dispose()`.
- A plugin that needs patches should be paired with `engine: { patches: true }`.
- For imperative controls beyond the `Plugin` interface (like storage's
  `flush()`), return an object that **extends** `Plugin` with extra methods, as
  the storage and devtools plugins do.

## Next

- [Application Lifecycle](./application-lifecycle.md) — when hooks run.
- [State & Reactivity](./state-and-reactivity.md) — patches and state-change events.
- [Worker & Shared Runtime](./worker-runtime.md) — the worker host uses a patch plugin internally.
