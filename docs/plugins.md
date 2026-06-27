# Plugins

Plugins extend the runtime without coupling it to any framework. They are for
app-level cross-cutting concerns: lifecycle integration, observability, persistence,
routing bridges, telemetry, and tooling. Business state and actions should stay in
modules; ordinary dependencies should stay providers.

## The `Plugin` interface

Implement any subset of these hooks:

```ts
interface Plugin {
  name?: string;
  providers?: readonly ProviderInput[];
  setup?(app: App, context: PluginContext): void | Promise<void>;
  onModuleCreated?(event: ModuleCreatedEvent, context: PluginContext): void;
  onActionStart?(event: ActionEvent, context: PluginContext): void;
  onActionEnd?(event: ActionEvent, context: PluginContext): void;
  onPatch?(event: PatchEvent, context: PluginContext): void;
  onStateChange?(event: StateChangeEvent, context: PluginContext): void;
  onError?(error: unknown, context: ErrorContext, pluginContext: PluginContext): void;
  dispose?(context: PluginContext): void | Promise<void>;
}

interface PluginContext {
  readonly app: App;
  readonly name: string;
  readonly signal: AbortSignal;
  emitError(error: unknown, phase?: string): void;
  onDispose(disposer: () => void | Promise<void>): void;
  watch<T>(
    read: () => T,
    listener: (value: T, previous: T) => void,
    options?: WatchOptions<T>,
  ): () => void;
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

| Hook                      | Fires when                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `providers`               | Before app providers are registered. Providers are for services/tokens only, not CoSystem modules. |
| `setup(app, context)`     | During app init (before `onInit`); may be async — `start()` awaits it.                             |
| `onModuleCreated(event)`  | After each module instance is created and bound.                                                   |
| `onActionStart(event)`    | When an action begins.                                                                             |
| `onActionEnd(event)`      | When an action settles (includes `error` on failure).                                              |
| `onPatch(event)`          | On each store patch. A plugin with `onPatch` enables patches unless `engine.patches` is set.       |
| `onStateChange(event)`    | On every store change.                                                                             |
| `onError(error, context)` | When a runtime phase or plugin observer hook throws (`context.phase`).                             |
| `dispose(context)`        | During `app.dispose()`; may be async. Context disposers run after this hook.                       |

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

## Plugin context

Use `PluginContext` for resources owned by the plugin:

```ts
const plugin: Plugin = {
  name: "metrics",
  setup(app, context) {
    context.watch(
      () => app.state.version,
      (version) => sendMetric("state.version", version),
    );

    const stop = startExternalSubscription();
    context.onDispose(stop);
  },
};
```

`context.watch()` is `app.watch()` plus automatic cleanup. `context.onDispose()`
registers any other teardown callback. `context.signal` is aborted before context
disposers run, so long-running async work can stop early.

Observer hook errors do not interrupt app actions or state updates. They are
reported to `onError` with a phase like `plugin:metrics.onActionEnd`. Errors from
`setup()` still fail app init, and errors during `dispose()` are aggregated and
re-thrown after teardown has been attempted.

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

Hydrates state on startup, persists changes through localspace drivers, and
exposes a cross-framework storage service through `StorageToken`.

```ts
import { StorageToken, createLocalSpaceStoragePlugin } from "@cosystem/storage";

type CounterAppState = {
  readonly counter: {
    readonly count: number;
  };
};

const storage = createLocalSpaceStoragePlugin<CounterAppState>({
  key: "cosystem:app",
  options: {
    name: "my-app",
    storeName: "state",
  },
  partialize: (state) => ({ counter: (state as CounterAppState).counter }),
});

const app = createApp({ plugins: [storage], providers: [Counter] });
await app.start(); // waits for hydration

await app.get(StorageToken).set("draft", { title: "Hello" });
```

### Router — [`@cosystem/router`](../packages/router/README.md)

Bridges a `Router` into the app lifecycle and exposes it via `RouterToken`.

```ts
import { RouterToken, createBrowserRouter, createRouterPlugin } from "@cosystem/router";

const router = createBrowserRouter();
const app = createApp({
  plugins: [createRouterPlugin(router, { onChange: (loc) => console.log(loc.path) })],
});

app.get(RouterToken).navigate("/settings");
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
    setup(app, context) {
      context.onDispose(() => {
        durations.length = 0;
      });
    },
  };
}
```

Tips:

- Give every plugin a `name` (used in error context and tooling).
- Use `setup(app, context)` for work that needs the live `App` (subscribing,
  resolving services); return a promise if it is async so `start()` waits.
- Prefer `context.watch()` and `context.onDispose()` for resources that must be
  cleaned up with the app.
- Use `providers` only for service/token dependencies. Plugin providers cannot
  register CoSystem modules. App-level non-`multi` providers replace plugin
  providers for the same token; app-level `multi` providers append to plugin
  `multi` providers.
- A plugin with `onPatch` enables patches automatically unless
  `engine: { patches: false }` is set.
- For imperative controls beyond the `Plugin` interface (like storage's
  `flush()`), return an object that **extends** `Plugin` with extra methods, as
  the storage and devtools plugins do.

## Next

- [Application Lifecycle](./application-lifecycle.md) — when hooks run.
- [State & Reactivity](./state-and-reactivity.md) — patches and state-change events.
- [Worker & Shared Runtime](./worker-runtime.md) — the worker host uses a patch plugin internally.
