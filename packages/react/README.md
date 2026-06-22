# @cosystem/react

> React bindings for [CoSystem](../../README.md): context provider and hooks for
> consuming a CoSystem app (or a worker-hosted app) with native React reactivity.

This adapter does not own rendering or define a view base class. It exposes a
`CoSystemProvider`, a `WorkerClientProvider`, and a small set of hooks built on
`useSyncExternalStore`, so selectors stay tear-free and concurrent-safe.

## Installation

```sh
pnpm add @cosystem/react @cosystem/core
```

Peer dependency: `react` `>=18.3` (React 19 supported).

## Quick start

```tsx
import { createRoot } from "react-dom/client";
import { createApp, defineModule } from "@cosystem/core";
import { CoSystemProvider, useModule, useSelector } from "@cosystem/react";

class Counter {
  count = 0;
  get double(): number {
    return this.count * 2;
  }
  increase(step = 1): void {
    this.count += step;
  }
}

defineModule(Counter, {
  actions: ["increase"],
  computed: ["double"],
  name: "counter",
  state: ["count"],
});

const app = createApp({ providers: [Counter] });

function CounterView() {
  const counter = useModule(Counter);
  const count = useSelector(Counter, (module) => module.count);
  const double = useSelector(Counter, (module) => module.double);

  return (
    <button onClick={() => counter.increase()}>
      {count} (×2 = {double})
    </button>
  );
}

createRoot(document.getElementById("root")!).render(
  <CoSystemProvider app={app}>
    <CounterView />
  </CoSystemProvider>,
);
```

## Hooks

| Hook                         | Returns  | Description                                     |
| ---------------------------- | -------- | ----------------------------------------------- |
| `useApp()` / `useCoSystem()` | `App`    | The app from the nearest provider.              |
| `useModule(token)`           | `T`      | The bound module facade. Methods stay callable. |
| `useSelector(selector)`      | `T`      | Subscribe to `selector(app)`.                   |
| `useSelector(token, fn)`     | `TValue` | Subscribe to `fn(module, app)` for a module.    |

`useSelector` accepts a `{ equals }` option (defaults to `Object.is`) to control
re-renders.

```tsx
const count = useSelector(Counter, (m) => m.count);
const version = useSelector((app) => app.state.version);
const items = useSelector(Todos, (m) => m.items, {
  equals: (a, b) => a.length === b.length,
});
```

## Worker-hosted state

Wrap the tree in `WorkerClientProvider` and use the worker hooks to consume an
app running in a Worker, iframe, or other [transport](../core/README.md#worker--shared-runtime).

```tsx
import { WorkerClientProvider, useWorkerModule, useWorkerSelector } from "@cosystem/react";

type CounterState = { readonly counter: { readonly count: number } };

function WorkerCounterView() {
  const counter = useWorkerModule<Counter>("counter"); // async method proxy
  const count = useWorkerSelector((state) => (state as CounterState).counter.count);

  return <button onClick={() => counter.increase()}>{count}</button>;
}

<WorkerClientProvider client={client}>
  <WorkerCounterView />
</WorkerClientProvider>;
```

- `useWorkerClient()` → the `WorkerClient` from context.
- `useWorkerModule<T>(name)` → an `AsyncMethodProxy<T>` (every method returns a `Promise`).
- `useWorkerSelector(selector, { equals? })` → selected worker state.

## Exports

Providers `CoSystemProvider`, `WorkerClientProvider`; contexts `CoSystemContext`,
`WorkerClientContext`; hooks `useApp`, `useCoSystem`, `useModule`, `useSelector`,
`useWorkerClient`, `useWorkerModule`, `useWorkerSelector`; and the
`CoSystemProviderProps`, `WorkerClientProviderProps`, `UseSelectorOptions`,
`AppSelector`, `ModuleSelector` types. Missing-provider hooks throw a
`CosystemError`.

## License

[MIT](../../LICENSE) © Coaction
