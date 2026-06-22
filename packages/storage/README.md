# @cosystem/storage

> Persistence plugin for [CoSystem](../../README.md): hydrate app state on
> startup and persist state changes to any synchronous or asynchronous storage
> backend.

Works with `localStorage`, `sessionStorage`, IndexedDB wrappers, or any object
implementing `getItem` / `setItem` (and optionally `removeItem`). Writes are
queued so they never interleave, and hydration is awaited by `app.start()`.

## Installation

```sh
pnpm add @cosystem/storage @cosystem/core
```

## Quick start

```ts
import { createApp } from "@cosystem/core";
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
  merge: (persisted, current) => ({ ...(current as object), ...persisted }),
});

const app = createApp({
  plugins: [storage],
  providers: [Counter],
});

await app.start(); // waits for hydration to complete
await storage.flush(); // waits for queued writes (useful in tests/tools)
```

## Options

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

`StorageLike`:

```ts
interface StorageLike {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem?(key: string): void | Promise<void>;
}
```

## Exports

`createStoragePlugin`, and the `StoragePlugin`, `StoragePluginOptions`,
`StorageLike`, `StoragePluginErrorPhase` types.

## License

[MIT](../../LICENSE) © Coaction
