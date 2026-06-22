# @cosystem/svelte

> Svelte bindings for [CoSystem](../../README.md): readable stores (Svelte 4+)
> and rune-friendly helpers (Svelte 5) for consuming a CoSystem app or a
> worker-hosted app.

The package root exports the store-based API, which works in Svelte 4 and 5. A
separate `@cosystem/svelte/runes` subpath exports Svelte 5 rune helpers, so the
main store contract stays unchanged for Svelte 4 users.

## Installation

```sh
pnpm add @cosystem/svelte @cosystem/core
```

Peer dependency: `svelte` `>=4 || >=5`.

## Stores (Svelte 4 and 5)

Register the app once (globally, or per component tree via context), then create
readable stores and use the `$store` auto-subscription syntax.

```ts
import { moduleStore, selectedModuleStore, setCoSystemApp } from "@cosystem/svelte";

setCoSystemApp(app); // or setCoSystemContext(app) inside a component

const counter = moduleStore(Counter);
const count = selectedModuleStore(Counter, (module) => module.count);
```

```svelte
<button on:click={() => $counter.increase()}>{$count}</button>
```

| Function                                     | Returns            | Description                                |
| -------------------------------------------- | ------------------ | ------------------------------------------ |
| `setCoSystemApp(app)` / `clearCoSystemApp()` | `App`              | Set/clear the module-global app.           |
| `setCoSystemContext(app)`                    | `App`              | Provide the app via Svelte context.        |
| `getCoSystemApp()`                           | `App`              | Resolve the active app (global → context). |
| `moduleStore(token, app?)`                   | `Readable<T>`      | Store of the bound module facade.          |
| `selectorStore(fn, opts?)`                   | `Readable<T>`      | Store of `fn(app)`.                        |
| `selectedModuleStore(token, fn, opts?)`      | `Readable<TValue>` | Store of `fn(module, app)`.                |

Selector stores accept `{ equals, app }`; `getCoSystemApp()` throws a
`CosystemError` if no app was set.

## Runes (Svelte 5)

```ts
import { moduleRune, selectedModuleRune } from "@cosystem/svelte/runes";

const counter = moduleRune(Counter, { app });
const count = selectedModuleRune(Counter, (module) => module.count, { app });
```

```svelte
<button onclick={() => counter.current.increase()}>{count.current}</button>
```

Runes expose `.current`, `.value`, and `.get()` (all equivalent). When `app` is
omitted they fall back to `getCoSystemApp()`. `selectorRune`, `moduleRune`, and
`selectedModuleRune` accept `{ app, equals }`.

## Worker-hosted state

Stores:

```ts
import { setWorkerClient, workerModuleStore, workerSelectorStore } from "@cosystem/svelte";

type CounterState = { readonly counter: { readonly count: number } };

setWorkerClient(client); // or setWorkerClientContext(client)

const counter = workerModuleStore<Counter>("counter");
const count = workerSelectorStore((state) => (state as CounterState).counter.count);
```

Runes:

```ts
import { workerModuleRune, workerSelectorRune } from "@cosystem/svelte/runes";

const counter = workerModuleRune<Counter>("counter", { client });
const count = workerSelectorRune((state) => (state as CounterState).counter.count, { client });
```

- `setWorkerClient(client)` / `clearWorkerClient()` / `setWorkerClientContext(client)`
  register the client; `getWorkerClient()` resolves it.
- `workerModuleStore<T>(name, client?)` / `workerModuleRune<T>(name, opts?)` →
  an `AsyncMethodProxy<T>`.
- `workerSelectorStore(fn, opts?)` / `workerSelectorRune(fn, opts?)` → worker state.

## Exports

Root: `setCoSystemApp`, `clearCoSystemApp`, `setCoSystemContext`, `getCoSystemApp`,
`setWorkerClient`, `clearWorkerClient`, `setWorkerClientContext`, `getWorkerClient`,
`moduleStore`, `selectorStore`, `selectedModuleStore`, `workerModuleStore`,
`workerSelectorStore`, the `CoSystemContextKey` / `WorkerClientContextKey` keys,
and the `SelectorStoreOptions`, `AppSelector`, `ModuleSelector` types.

`/runes`: `moduleRune`, `selectorRune`, `selectedModuleRune`, `workerModuleRune`,
`workerSelectorRune`, and the `CoSystemRune`, `RuneSelectorOptions`,
`ModuleRuneOptions`, `WorkerRuneSelectorOptions`, `WorkerModuleRuneOptions` types.

## License

[MIT](../../LICENSE) © Coaction
