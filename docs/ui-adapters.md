# UI Adapters

CoSystem does not own rendering. There is no `ViewModule`, root component base
class, or `render()` abstraction. Each UI adapter is a thin layer that:

1. provides the `App` (or a `WorkerClient`) to a component tree, and
2. exposes the bound module facade plus a reactive selector, using the
   framework's **native** reactivity.

This keeps every framework idiomatic: React users get hooks, Vue users get
composables, Svelte users get stores/runes, Solid users get signals, Angular
users get signals.

## The adapter contract

`@cosystem/core` exposes a framework-neutral reactive runtime — `getModule()` and
`watch()` — rather than a selector-first external-store API. Why selectors still
appear in adapters:

- Coaction is **signal-backed**. Frameworks with native signal tracking (Vue,
  Solid, Svelte, Angular) can read module state directly inside their reactive
  scopes and stay subscribed automatically.
- **React** does not track external signal reads during render, so its adapter is
  selector-first and built on `useSyncExternalStore` for tear-free, concurrent-
  safe reads.

Every adapter ultimately wraps two core calls:

```ts
app.getModule(token); // the bound module facade (methods stay callable)
app.watch(read, listener, opts); // subscribe to a derived value
```

## Two things every adapter gives you

| Capability         | What it returns                                                         |
| ------------------ | ----------------------------------------------------------------------- |
| **Module access**  | The bound module facade — call its actions, read computed/state.        |
| **Selected state** | A reactive value (`fn(module \| app)`) that updates the view on change. |

Selectors accept an `{ equals }` option (default `Object.is`) to control when the
view updates.

## React — [`@cosystem/react`](../packages/react/README.md)

```tsx
import { CoSystemProvider, useModule, useSelector } from "@cosystem/react";

function CounterView() {
  const counter = useModule(Counter);
  const count = useSelector(Counter, (m) => m.count);
  return <button onClick={() => counter.increase()}>{count}</button>;
}

<CoSystemProvider app={app}>
  <CounterView />
</CoSystemProvider>;
```

`useApp()` / `useCoSystem()`, `useModule(token)`, `useSelector(selector)` or
`useSelector(token, fn)`.

## Vue — [`@cosystem/vue`](../packages/vue/README.md)

```ts
import { cosystemPlugin, useComputed, useModule } from "@cosystem/vue";

const counter = useModule(Counter);
const count = useComputed((app) => app.getModule(Counter).count); // Readonly<Ref<T>>

createVueApp(Root).use(cosystemPlugin(app)).mount("#app");
```

`provideCoSystem(app)` / `cosystemPlugin(app)`, `useModule(token)`,
`useSelector`/`useComputed` (return `Readonly<Ref<T>>`).

## Svelte — [`@cosystem/svelte`](../packages/svelte/README.md)

```ts
import { moduleStore, selectedModuleStore, setCoSystemApp } from "@cosystem/svelte";

setCoSystemApp(app);
const counter = moduleStore(Counter);
const count = selectedModuleStore(Counter, (m) => m.count);
```

```svelte
<button on:click={() => $counter.increase()}>{$count}</button>
```

Stores work in Svelte 4 and 5. Svelte 5 rune helpers live at
`@cosystem/svelte/runes` (`moduleRune`, `selectedModuleRune`) and expose
`.current` / `.value` / `.get()`.

## Solid — [`@cosystem/solid`](../packages/solid/README.md)

```tsx
import { CoSystemProvider, useComputed, useModule } from "@cosystem/solid";

function CounterView() {
  const counter = useModule(Counter);
  const count = useComputed(Counter, (m) => m.count); // Accessor<T>
  return <button onClick={() => counter.increase()}>{count()}</button>;
}
```

`useComputed` returns a Solid `Accessor<T>` — call it (`count()`).

## Angular — [`@cosystem/angular`](../packages/angular/README.md)

```ts
import { Component } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { injectModule, injectSignal, provideCoSystem } from "@cosystem/angular";

@Component({ template: `<button (click)="counter.increase()">{{ count() }}</button>` })
class CounterView {
  readonly counter = injectModule(Counter);
  readonly count = injectSignal(Counter, (m) => m.count); // Signal<T>
}

bootstrapApplication(CounterView, { providers: [provideCoSystem(app)] });
```

## At a glance

| Framework      | Provide the app                         | Module access  | Selected state                | Returns                     |
| -------------- | --------------------------------------- | -------------- | ----------------------------- | --------------------------- |
| React          | `<CoSystemProvider app>`                | `useModule`    | `useSelector`                 | raw value                   |
| Vue            | `cosystemPlugin` / `provideCoSystem`    | `useModule`    | `useSelector` / `useComputed` | `Readonly<Ref<T>>`          |
| Svelte         | `setCoSystemApp` / `setCoSystemContext` | `moduleStore`  | `selectedModuleStore`         | `Readable<T>`               |
| Svelte 5 runes | (same)                                  | `moduleRune`   | `selectedModuleRune`          | `{ current, value, get() }` |
| Solid          | `<CoSystemProvider app>`                | `useModule`    | `useComputed`                 | `Accessor<T>`               |
| Angular        | `provideCoSystem`                       | `injectModule` | `injectSignal`                | `Signal<T>`                 |

## Consuming worker-hosted state

Every adapter has a parallel set of helpers for state hosted in a Worker (or
other transport), driven by a `WorkerClient` instead of an `App`:

| Framework | Provide the client                           | Module proxy                             | Selected state                               |
| --------- | -------------------------------------------- | ---------------------------------------- | -------------------------------------------- |
| React     | `<WorkerClientProvider client>`              | `useWorkerModule`                        | `useWorkerSelector`                          |
| Vue       | `workerClientPlugin` / `provideWorkerClient` | `useWorkerModule`                        | `useWorkerSelector` / `useWorkerComputed`    |
| Svelte    | `setWorkerClient` / `setWorkerClientContext` | `workerModuleStore` / `workerModuleRune` | `workerSelectorStore` / `workerSelectorRune` |
| Solid     | `<WorkerClientProvider client>`              | `useWorkerModule`                        | `useWorkerSelector` / `useWorkerComputed`    |
| Angular   | `provideWorkerClient`                        | `injectWorkerModule`                     | `injectWorkerSignal`                         |

The module proxy returned by `useWorkerModule`/`injectWorkerModule`/etc. is an
`AsyncMethodProxy<T>` — every method returns a `Promise` because the call crosses
a thread/transport boundary. See [Worker & Shared Runtime](./worker-runtime.md).

## Using two frameworks at once

Because the core never imports a UI framework, the _same_ `app` can be rendered
by more than one adapter in the same page — useful for incremental migrations and
micro-frontends. Mount each framework normally and pass it the shared `app`.

## Next

- [Worker & Shared Runtime](./worker-runtime.md) — the `WorkerClient` model.
- [State & Reactivity](./state-and-reactivity.md) — what selectors subscribe to.
- Per-framework API: [React](../packages/react/README.md) ·
  [Vue](../packages/vue/README.md) · [Svelte](../packages/svelte/README.md) ·
  [Solid](../packages/solid/README.md) · [Angular](../packages/angular/README.md).
