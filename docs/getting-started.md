# Getting Started

This guide takes you from an empty directory to a running CoSystem app with a UI
framework of your choice.

## Requirements

- **Node.js** `>=22.12.0`
- A package manager (pnpm, npm, or yarn). The examples below use pnpm.

CoSystem ships as **ESM only**. Your project should use `"type": "module"` (or
`.mjs`/`.mts` files) and a modern bundler or Node version.

## Option A — scaffold a project

The fastest way to start is the `create-cosystem` CLI. It generates a minimal
`@cosystem/core` project with a `defineModule()` counter:

```sh
pnpm dlx @cosystem/create my-app
cd my-app
pnpm install
pnpm start
```

This produces:

```text
my-app/
├── package.json     # scripts: build (tsc), start (tsx src/main.ts)
├── tsconfig.json    # strict, NodeNext, ES2022
└── src/
    └── main.ts      # a counter module wired into createApp()
```

See [`@cosystem/create`](../packages/create/README.md) for the programmatic API.

## Option B — add to an existing project

Install the core package and (optionally) a UI adapter:

```sh
pnpm add @cosystem/core
pnpm add @cosystem/react   # or @cosystem/vue, @cosystem/svelte, @cosystem/solid, @cosystem/angular
```

## Your first module

A module is a plain class. Declare which members are state/actions/computed
either with decorators or with `defineModule()`. The no-decorator form works
everywhere, so we start there:

```ts
// src/counter.ts
import { defineModule } from "@cosystem/core";

export class Counter {
  count = 0;

  get double(): number {
    return this.count * 2;
  }

  increase(step = 1): void {
    this.count += step;
  }

  reset(): void {
    this.count = 0;
  }
}

defineModule(Counter, {
  actions: ["increase", "reset"],
  computed: ["double"],
  name: "counter",
  state: ["count"],
});
```

> Prefer decorators? See [Modules](./modules.md) for the `@Module`, `@State`,
> `@Action`, `@Computed`, and `@Effect` equivalents. They require a build setup
> with TC39 decorators and the `accessor` keyword.

## Create the app

```ts
// src/app.ts
import { createApp } from "@cosystem/core";
import { Counter } from "./counter.js";

export const app = createApp({
  providers: [Counter],
});
```

You can already use it without any UI:

```ts
const counter = app.getModule(Counter);
counter.increase();
console.log(app.store.getPureState()); // { counter: { count: 1 } }
```

## Render with a framework

Pick the tab for your framework. Each adapter only provides context and
subscription helpers — you keep your framework's normal mount API.

### React

```tsx
import { createRoot } from "react-dom/client";
import { CoSystemProvider, useModule, useSelector } from "@cosystem/react";
import { app } from "./app.js";
import { Counter } from "./counter.js";

function CounterView() {
  const counter = useModule(Counter);
  const count = useSelector(Counter, (m) => m.count);

  return <button onClick={() => counter.increase()}>{count}</button>;
}

createRoot(document.getElementById("root")!).render(
  <CoSystemProvider app={app}>
    <CounterView />
  </CoSystemProvider>,
);
```

### Vue

```ts
import { createApp as createVueApp, defineComponent, h } from "vue";
import { cosystemPlugin, useComputed, useModule } from "@cosystem/vue";
import { app } from "./app.js";
import { Counter } from "./counter.js";

const CounterView = defineComponent({
  setup() {
    const counter = useModule(Counter);
    const count = useComputed((a) => a.getModule(Counter).count);
    return () => h("button", { onClick: () => counter.increase() }, count.value);
  },
});

createVueApp(CounterView).use(cosystemPlugin(app)).mount("#app");
```

### Svelte

```ts
import { moduleStore, selectedModuleStore, setCoSystemApp } from "@cosystem/svelte";
import { app } from "./app.js";
import { Counter } from "./counter.js";

setCoSystemApp(app);
export const counter = moduleStore(Counter);
export const count = selectedModuleStore(Counter, (m) => m.count);
```

```svelte
<button on:click={() => $counter.increase()}>{$count}</button>
```

### Solid

```tsx
import { CoSystemProvider, useComputed, useModule } from "@cosystem/solid";
import { app } from "./app.js";
import { Counter } from "./counter.js";

function CounterView() {
  const counter = useModule(Counter);
  const count = useComputed(Counter, (m) => m.count);
  return <button onClick={() => counter.increase()}>{count()}</button>;
}

<CoSystemProvider app={app}>
  <CounterView />
</CoSystemProvider>;
```

### Angular

```ts
import { Component } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { injectModule, injectSignal, provideCoSystem } from "@cosystem/angular";
import { app } from "./app.js";
import { Counter } from "./counter.js";

@Component({
  selector: "counter-view",
  template: `<button (click)="counter.increase()">{{ count() }}</button>`,
})
export class CounterView {
  readonly counter = injectModule(Counter);
  readonly count = injectSignal(Counter, (m) => m.count);
}

bootstrapApplication(CounterView, { providers: [provideCoSystem(app)] });
```

## Run a working example

Every framework above has a runnable demo in [`examples/`](../examples):

```sh
pnpm install
pnpm --filter @cosystem/example-react-counter dev
```

## Where to go next

- [Core Concepts](./core-concepts.md) — state, actions, computed, effects, the store.
- [Dependency Injection](./dependency-injection.md) — wire services into modules.
- [UI Adapters](./ui-adapters.md) — the full hook/composable/store/signal API per framework.
- [Testing](./testing.md) — verify modules with `testApp()`.
