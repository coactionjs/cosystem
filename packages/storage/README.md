# @cosystem/storage

> Cross-framework persistence plugin for [CoSystem](../../README.md), powered by
> [`localspace`](https://www.npmjs.com/package/localspace): hydrate app state on
> startup, persist state changes, and expose a shared storage service through app
> DI.

The recommended `createLocalSpaceStoragePlugin()` uses localspace drivers and
plugins, including IndexedDB, localStorage, memory fallback, TTL, encryption,
compression, multi-tab sync, and quota helpers. The older `createStoragePlugin()`
adapter is still available for simple `getItem` / `setItem` backends.

## Installation

```sh
pnpm add @cosystem/storage @cosystem/core
```

## Quick start

```ts
import { createApp } from "@cosystem/core";
import {
  StorageToken,
  createLocalSpaceStoragePlugin,
  syncPlugin,
  ttlPlugin,
} from "@cosystem/storage";

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
    plugins: [ttlPlugin({ defaultTTL: 7 * 24 * 60 * 60_000 }), syncPlugin()],
  },
  partialize: (state) => ({ counter: (state as CounterAppState).counter }),
  merge: (persisted, current) => ({ ...(current as object), ...persisted }),
});

const app = createApp({
  plugins: [storage],
  providers: [Counter],
});

await app.start(); // waits for hydration to complete
await storage.flush(); // waits for queued writes (useful in tests/tools)

const kv = app.get(StorageToken);
await kv.set("draft", { title: "Hello" });
```

## Localspace Options

`createLocalSpaceStoragePlugin()` accepts:

| Option             | Type                                   | Default            | Description                                                          |
| ------------------ | -------------------------------------- | ------------------ | -------------------------------------------------------------------- |
| `key`              | `string`                               | `cosystem:state`   | localspace key used for CoSystem app state.                          |
| `options`          | `LocalSpaceOptions`                    | localspace default | localspace instance config (`name`, `storeName`, `driver`, plugins). |
| `instance`         | `LocalSpaceInstance`                   | —                  | Existing localspace instance to wrap.                                |
| `service`          | `StorageService`                       | —                  | Existing CoSystem storage service to provide.                        |
| `hydrate`          | `boolean`                              | `true`             | Hydrate app state from `key` during plugin setup.                    |
| `persist`          | `boolean`                              | `true`             | Persist app state on store changes.                                  |
| `destroyOnDispose` | `boolean`                              | owns instance      | Destroy localspace resources when the app is disposed.               |
| `partialize`       | `(state) => TState`                    | identity           | Pick the subset of app state to persist.                             |
| `merge`            | `(persisted, current) => state`        | use persisted      | Combine persisted state with current defaults on hydrate.            |
| `shouldPersist`    | `(event: StateChangeEvent) => boolean` | always             | Skip selected state changes.                                         |
| `onError`          | `(error, phase) => void`               | —                  | Observe `"hydrate"`, `"persist"`, or `"clear"` failures.             |

`StorageToken` resolves a `StorageService` in every UI framework integration:

```ts
const storage = app.get(StorageToken);

await storage.set("theme", "dark");
const theme = await storage.get<string>("theme");
await storage.setMany([
  { key: "cache:user", value: { name: "Ada" } },
  { key: "cache:org", value: { name: "CoSystem" } },
]);
```

`StorageService.instance` exposes the underlying localspace instance when you
need lower-level APIs or performance stats.

`destroyOnDispose` is the sole ownership switch for the supplied storage
service. It defaults to `true` only when the plugin created the service itself;
an external `service` or `instance` is retained by default. Setting it explicitly
to `true` destroys that resource exactly once during app disposal.

## Legacy StorageLike Adapter

`createStoragePlugin()` is retained for custom string-only backends:

| Option          | Type                                   | Default          | Description                                                |
| --------------- | -------------------------------------- | ---------------- | ---------------------------------------------------------- |
| `key`           | `string`                               | —                | Storage key (required).                                    |
| `storage`       | `StorageLike`                          | —                | The backend (required). May be sync or async.              |
| `serialize`     | `(state) => string`                    | `JSON.stringify` | Encode state before writing.                               |
| `deserialize`   | `(value) => TState`                    | `JSON.parse`     | Decode persisted text on hydrate.                          |
| `partialize`    | `(state) => TState`                    | identity         | Pick the subset of state to persist.                       |
| `merge`         | `(persisted, current) => state`        | use persisted    | Combine persisted state with the current state on hydrate. |
| `shouldPersist` | `(event: StateChangeEvent) => boolean` | always           | Skip persisting selected state changes.                    |
| `onError`       | `(error, phase) => void`               | —                | Observe `"hydrate"`, `"persist"`, or `"clear"` failures.   |

## Plugin methods

The returned plugin adds imperative controls on top of the `Plugin` interface:

```ts
await storage.ready(); // resolves when hydration finished (or failed)
await storage.flush(); // resolves when all queued writes settle
await storage.persist(app); // force-write the current full state
await storage.clear(); // remove the persisted entry
```

`app.dispose()` also waits for pending storage writes through the plugin context,
so production teardown does not need an extra `flush()` call.

For the localspace plugin, `storage.clear()` removes the persisted app-state key.
Use `app.get(StorageToken).clear()` when you want to clear the whole localspace
store.

`StorageLike`:

```ts
interface StorageLike {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem?(key: string): void | Promise<void>;
}
```

## Exports

`createLocalSpaceStoragePlugin`, `createLocalSpaceStorage`, `StorageToken`,
`createStoragePlugin`, localspace plugin/driver re-exports, and the
`StorageService`, `StoragePlugin`, `StoragePluginOptions`, `StorageLike`,
`StoragePluginErrorPhase` types.

## License

[MIT](../../LICENSE) © Coaction
