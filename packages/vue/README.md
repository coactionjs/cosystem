# @cosystem/vue

> Vue 3 bindings for [CoSystem](../../README.md): provide/inject composables that
> expose a CoSystem app (or a worker-hosted app) as Vue refs.

## Installation

```sh
pnpm add @cosystem/vue @cosystem/core
```

Peer dependency: `vue` `>=3.5 <4`.

## Quick start

Install the app with the plugin (or call `provideCoSystem(app)` inside a parent
`setup`), then read modules and selectors with the composables.

```ts
import { createApp as createVueApp, defineComponent, h } from "vue";
import { cosystemPlugin, useComputed, useModule } from "@cosystem/vue";

const CounterView = defineComponent({
  setup() {
    const counter = useModule(Counter);
    const count = useComputed(() => counter.count);

    return () => h("button", { onClick: () => counter.increase() }, count.value);
  },
});

createVueApp(CounterView).use(cosystemPlugin(app)).mount("#app");
```

## Providing the app

| Function                      | Use from                   | Description                               |
| ----------------------------- | -------------------------- | ----------------------------------------- |
| `cosystemPlugin(app)`         | `app.use(...)`             | Provides the app for the whole Vue app.   |
| `provideCoSystem(app)`        | a parent component `setup` | Provides the app to descendants.          |
| `workerClientPlugin(client)`  | `app.use(...)`             | Provides a `WorkerClient`.                |
| `provideWorkerClient(client)` | a parent `setup`           | Provides a `WorkerClient` to descendants. |

## Composables

| Composable                   | Returns            | Description                 |
| ---------------------------- | ------------------ | --------------------------- |
| `useApp()` / `useCoSystem()` | `App`              | The provided app.           |
| `useModule(token)`           | `T`                | The bound module facade.    |
| `useSelector(fn, opts?)`     | `Readonly<Ref<T>>` | Reactive ref for `fn(app)`. |
| `useComputed(fn, opts?)`     | `Readonly<Ref<T>>` | Alias of `useSelector`.     |

```ts
const count = useSelector((app) => app.getModule(Counter).count);
const double = useComputed((app) => app.getModule(Counter).double);
```

Selectors accept `{ equals }` to control updates and clean up automatically via
`onScopeDispose`.

## Worker-hosted state

```ts
import { createApp as createVueApp, defineComponent, h } from "vue";
import { useWorkerModule, useWorkerSelector, workerClientPlugin } from "@cosystem/vue";

type CounterState = { readonly counter: { readonly count: number } };

const WorkerCounterView = defineComponent({
  setup() {
    const counter = useWorkerModule<Counter>("counter");
    const count = useWorkerSelector((state) => (state as CounterState).counter.count);

    return () => h("button", { onClick: () => counter.increase() }, count.value);
  },
});

createVueApp(WorkerCounterView).use(workerClientPlugin(client)).mount("#app");
```

- `useWorkerClient()` → the provided `WorkerClient`.
- `useWorkerModule<T>(name)` → an `AsyncMethodProxy<T>`.
- `useWorkerSelector(fn, opts?)` / `useWorkerComputed(fn, opts?)` →
  `Readonly<Ref<T>>` of worker state.

## Exports

`cosystemPlugin`, `workerClientPlugin`, `provideCoSystem`, `provideWorkerClient`,
the `CoSystemKey` / `WorkerClientKey` injection keys, `useApp`, `useCoSystem`,
`useModule`, `useSelector`, `useComputed`, `useWorkerClient`, `useWorkerModule`,
`useWorkerSelector`, `useWorkerComputed`, and the `UseSelectorOptions` /
`AppSelector` types. The `use*` composables throw a `CosystemError` when the app
or client was never provided.

## License

[MIT](../../LICENSE) © Coaction
