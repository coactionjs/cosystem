# CoSystem

CoSystem - The meta-framework for coexisting UI frameworks.

CoSystem creates a typed application core powered by Coaction, then lets each UI
framework render with its own native API. Business modules are plain classes
with lightweight DI, OO state, actions, computed getters, and test-friendly app
composition.

## Packages

- `@cosystem/angular`: Angular provider bridge and signals for consuming a CoSystem app
- `@cosystem/core`: DI container, module metadata, app runtime, decorators, and
  `testApp`
- `@cosystem/create`: project scaffolding utility with the `create-cosystem` CLI
- `@cosystem/devtools`: timeline inspection plugin for development tooling
- `@cosystem/react`: React context and hooks for consuming a CoSystem app
- `@cosystem/router`: embeddable router primitives and router token
- `@cosystem/solid`: Solid context and signals for consuming a CoSystem app
- `@cosystem/storage`: persistence plugin for app state snapshots
- `@cosystem/svelte`: Svelte context and readable stores for consuming a CoSystem app
- `@cosystem/testing`: testing helper facade for `testApp`
- `@cosystem/vue`: Vue provide/inject composables for consuming a CoSystem app

## Create A Project

```sh
pnpm dlx @cosystem/create my-app
cd my-app
pnpm install
pnpm start
```

## Core API

```ts
import {
  action,
  computed,
  createApp,
  effect,
  module as module_,
  provide,
  runInAction,
  state,
} from "@cosystem/core";

abstract class Logger {
  abstract info(message: string): void;
}

@module_({
  deps: [Logger],
  name: "counter",
})
class Counter {
  constructor(readonly logger: Logger) {}

  @state
  accessor count = 0;

  @computed
  get double(): number {
    return this.count * 2;
  }

  @action
  increase(step = 1): void {
    this.count += step;
    this.logger.info(`count:${this.count}`);
  }

  @effect
  recordCount(): void {
    this.logger.info(`effect:${this.count}`);
  }
}

const app = createApp({
  providers: [Counter, provide(Logger, { useValue: console })],
});

const counter = app.getModule(Counter);
counter.increase();
```

The same module can be defined without decorators:

```ts
import { createApp, defineModule, provide } from "@cosystem/core";

class Counter {
  count = 0;

  constructor(readonly logger: Logger) {}

  get double(): number {
    return this.count * 2;
  }

  increase(step = 1): void {
    this.count += step;
    this.logger.info(`count:${this.count}`);
  }

  recordCount(): void {
    this.logger.info(`effect:${this.count}`);
  }
}

defineModule(Counter, {
  actions: ["increase"],
  computed: ["double"],
  deps: [Logger],
  effects: ["recordCount"],
  name: "counter",
  state: ["count"],
});

const app = createApp({
  providers: [Counter, provide(Logger, { useValue: console })],
});
```

`@state` intentionally targets standard accessor decorators. Plain fields should
use `defineModule()` metadata until a future compatibility layer is added.
`@computed` getters are cached through Coaction's signal-backed computed
runtime and invalidate when the state they read changes.
`@effect` methods run after app initialization and rerun when the state they
read changes.
Async `@action` methods may return promises; synchronous writes before the first
`await` are part of the action transaction, while post-await writes need another
action boundary or non-strict writes. Use `runInAction(this, ...)` after an
`await` when strict action mode should remain enabled:

```ts
class Counter {
  @state
  accessor count = 0;

  @action
  async refresh(): Promise<void> {
    const next = await loadCount();

    runInAction(this, () => {
      this.count = next;
    });
  }
}
```

## Provider Lifetime

`@module` providers are instantiated during `createApp()` so their state can be
bound to the Coaction-backed app store. Plain class and factory providers stay
lazy unless a module or another eager provider depends on them.

Use `eager: true` for startup services that must be created during app
composition:

```ts
const app = createApp({
  providers: [
    Counter,
    provide(Analytics, {
      eager: true,
      useClass: Analytics,
    }),
  ],
});
```

For tests or advanced factories, the container can explicitly construct an
unregistered class without caching it:

```ts
const instance = app.createScope().container.build(Service);
const asyncInstance = await app.createScope().container.buildAsync(ServiceWithAsyncDeps);
```

`get()` still only resolves registered providers. Use `buildAsync()` when any
dependency is backed by an async factory.

## Lazy Modules

Lazy modules are explicit. They do not mutate the root provider graph or expose
`app.provide()`:

```ts
import { createApp, defineModule, lazyModule } from "@cosystem/core";

class AdminCounter {
  count = 0;

  increase(): void {
    this.count += 1;
  }
}

defineModule(AdminCounter, {
  actions: ["increase"],
  name: "adminCounter",
  state: ["count"],
});

const app = createApp();

await app.load(
  lazyModule(() => ({
    providers: [AdminCounter],
  })),
);

app.getModule(AdminCounter).increase();
```

`createApp({ providers: [lazyModule(...)] })` records lazy entries without
loading them. Call `await app.load()` to load all pending lazy modules.

## UI Adapters

CoSystem does not own rendering. There is no `ViewModule`, root component base
class, or `render()` abstraction. UI packages only provide context and
subscription helpers.

React:

```tsx
import { createRoot } from "react-dom/client";
import { CoSystemProvider, useModule, useSelector } from "@cosystem/react";

function CounterView() {
  const counter = useModule(Counter);
  const count = useSelector(Counter, (module) => module.count);

  return <button onClick={() => counter.increase()}>{count}</button>;
}

createRoot(document.getElementById("root")!).render(
  <CoSystemProvider app={app}>
    <CounterView />
  </CoSystemProvider>,
);
```

React can also consume worker-hosted state through `WorkerClientProvider`:

```tsx
import { WorkerClientProvider, useWorkerModule, useWorkerSelector } from "@cosystem/react";

type CounterState = {
  readonly counter: {
    readonly count: number;
  };
};

function WorkerCounterView() {
  const counter = useWorkerModule<Counter>("counter");
  const count = useWorkerSelector((state) => (state as CounterState).counter.count);

  return <button onClick={() => counter.increase()}>{count}</button>;
}
```

Vue:

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

Vue can consume worker-hosted modules through the same provide/inject model:

```ts
import { createApp as createVueApp, defineComponent, h } from "vue";
import { workerClientPlugin, useWorkerModule, useWorkerSelector } from "@cosystem/vue";

type CounterState = {
  readonly counter: {
    readonly count: number;
  };
};

const WorkerCounterView = defineComponent({
  setup() {
    const counter = useWorkerModule<Counter>("counter");
    const count = useWorkerSelector((state) => (state as CounterState).counter.count);

    return () => h("button", { onClick: () => counter.increase() }, count.value);
  },
});

createVueApp(WorkerCounterView).use(workerClientPlugin(client)).mount("#app");
```

Svelte:

```ts
import { moduleStore, selectedModuleStore, setCoSystemApp } from "@cosystem/svelte";

setCoSystemApp(app);

const counter = moduleStore(Counter);
const count = selectedModuleStore(Counter, (module) => module.count);
```

Svelte can also consume worker-hosted modules as readable stores:

```ts
import { setWorkerClient, workerModuleStore, workerSelectorStore } from "@cosystem/svelte";

type CounterState = {
  readonly counter: {
    readonly count: number;
  };
};

setWorkerClient(client);

const counter = workerModuleStore<Counter>("counter");
const count = workerSelectorStore((state) => (state as CounterState).counter.count);
```

Svelte 5 rune-friendly helpers are available from a separate subpath so the
main Svelte 4 store contract stays unchanged:

```ts
import { moduleRune, selectedModuleRune } from "@cosystem/svelte/runes";

const counter = moduleRune(Counter, { app });
const count = selectedModuleRune(Counter, (module) => module.count, { app });
```

Worker-hosted state has matching Svelte 5 rune helpers:

```ts
import { workerModuleRune, workerSelectorRune } from "@cosystem/svelte/runes";

const counter = workerModuleRune<Counter>("counter", { client });
const count = workerSelectorRune((state) => (state as CounterState).counter.count, { client });
```

Solid:

```tsx
import { CoSystemProvider, useComputed, useModule } from "@cosystem/solid";

function CounterView() {
  const counter = useModule(Counter);
  const count = useComputed(Counter, (module) => module.count);

  return <button onClick={() => counter.increase()}>{count()}</button>;
}

<CoSystemProvider app={app}>
  <CounterView />
</CoSystemProvider>;
```

Solid can render worker-hosted state through a worker client provider:

```tsx
import { WorkerClientProvider, useWorkerModule, useWorkerSelector } from "@cosystem/solid";

type CounterState = {
  readonly counter: {
    readonly count: number;
  };
};

function WorkerCounterView() {
  const counter = useWorkerModule<Counter>("counter");
  const count = useWorkerSelector((state) => (state as CounterState).counter.count);

  return <button onClick={() => counter.increase()}>{count()}</button>;
}

<WorkerClientProvider client={client}>
  <WorkerCounterView />
</WorkerClientProvider>;
```

Angular:

```ts
import { Component } from "@angular/core";
import { injectModule, injectSignal, provideCoSystem } from "@cosystem/angular";

bootstrapApplication(AppComponent, {
  providers: [provideCoSystem(app)],
});

@Component({
  selector: "counter-view",
  template: `<button (click)="counter.increase()">{{ count() }}</button>`,
})
class CounterView {
  readonly counter = injectModule(Counter);
  readonly count = injectSignal(Counter, (module) => module.count);
}
```

Angular can inject worker-hosted modules and expose state as Angular signals:

```ts
import { injectWorkerModule, injectWorkerSignal, provideWorkerClient } from "@cosystem/angular";

type CounterState = {
  readonly counter: {
    readonly count: number;
  };
};

bootstrapApplication(AppComponent, {
  providers: [provideWorkerClient(client)],
});

@Component({
  selector: "counter-view",
  template: `<button (click)="counter.increase()">{{ count() }}</button>`,
})
class WorkerCounterView {
  readonly counter = injectWorkerModule<Counter>("counter");
  readonly count = injectWorkerSignal((state) => (state as CounterState).counter.count);
}
```

## Testing

```ts
import { provide, testApp } from "@cosystem/core";

const app = testApp({
  providers: [Counter, provide(Logger, { useValue: console })],
  strictActions: true,
});

const counter = app.getModule(Counter);
counter.increase(2);

expect(app.test.getActions()).toMatchObject([
  {
    method: "increase",
    module: "counter",
  },
]);

const startedApp = await testApp({
  autoStart: true,
  providers: [Counter],
});

expect(startedApp.started).toBe(true);
```

`testApp({ overrides })` can replace providers discovered from `providers`, but
it cannot add a new `@module` after app module discovery.

More focused examples live in [`examples/`](./examples).

## Worker Prototype

`@cosystem/core` includes a small worker-hosting prototype:

```ts
import {
  createBroadcastWorkerTransport,
  createDataTransportWorkerTransport,
  createMemoryBroadcastChannel,
  createMemoryWorkerTransportPair,
  createPostMessageWorkerTransport,
  createWorkerApp,
  createWorkerClient,
} from "@cosystem/core";

const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();

const client = createWorkerClient({
  transport: clientTransport,
});

const host = createWorkerApp({
  providers: [Counter],
  sync: "patch",
  transport: hostTransport,
});

await client.ready;
await client.module<Counter>("counter").increase(1);

type CounterState = {
  readonly counter: {
    readonly count: number;
  };
};

const selectCount = (state: unknown) => (state as CounterState).counter.count;
const count = client.select(selectCount);
const unsubscribeCount = client.watch(selectCount, (value) => {
  console.log(value);
});

console.log(count);

unsubscribeCount();
client.dispose();
await host.dispose();
```

Worker hosts can isolate published state to selected top-level module sections.
Method delegation still works for all hosted modules, but snapshots and patches
only include the configured sections:

```ts
const host = createWorkerApp({
  providers: [Counter],
  stateSections: ["counter"],
  sync: "patch",
  transport: hostTransport,
});
```

For real Worker, iframe, or `MessagePort` targets, adapt a `postMessage`
endpoint instead of using the in-memory pair:

```ts
const worker = new Worker(new URL("./worker.ts", import.meta.url), {
  type: "module",
});

const client = createWorkerClient({
  transport: createPostMessageWorkerTransport(worker),
});

await client.ready;
```

For shared tab coordination, adapt a browser `BroadcastChannel`. The client
should subscribe before the host starts so it receives the initial snapshot:

```ts
const hostChannel = new BroadcastChannel("counter-runtime");
const clientChannel = new BroadcastChannel("counter-runtime");

const client = createWorkerClient({
  transport: createBroadcastWorkerTransport(clientChannel, {
    peerId: "tab:client",
    targetPeerId: "tab:host",
  }),
});

const host = createWorkerApp({
  providers: [Counter],
  sync: "patch",
  transport: createBroadcastWorkerTransport(hostChannel, {
    peerId: "tab:host",
  }),
});

await client.ready;
await client.module<Counter>("counter").increase(1);
```

Tests and non-browser environments can use `createMemoryBroadcastChannel()` with
the same transport API.

For process, socket, or custom RPC channels, adapt a `data-transport` endpoint:

```ts
const client = createWorkerClient({
  transport: createDataTransportWorkerTransport(clientDataTransport),
});

const host = createWorkerApp({
  providers: [Counter],
  transport: createDataTransportWorkerTransport(hostDataTransport),
});

await client.ready;
```

The prototype covers app creation, method delegation, initial state snapshots,
patch-only sync messages after startup, client-side readiness, selector watches
for worker-hosted state, `postMessage` endpoints, and a `data-transport`-style
`listen`/`emit` bridge. It also supports BroadcastChannel-style shared tab
coordination with routed call results. It does not attempt full shared-runtime
conflict handling or framework-specific worker bootstrapping.

## Logger Plugin

```ts
import { createLoggerPlugin } from "@cosystem/core";

const app = createApp({
  plugins: [createLoggerPlugin()],
  providers: [Counter],
});
```

## Devtools

```ts
import { createDevtoolsPlugin } from "@cosystem/devtools";

const devtools = createDevtoolsPlugin();

const app = createApp({
  plugins: [devtools],
  providers: [Counter],
});

const unsubscribe = devtools.subscribe((event) => {
  console.log(event.type);
});

// Includes module creation, setup, action, state, patch, and error events.
console.log(devtools.getTimeline());

unsubscribe();
```

## Storage

```ts
import { createStoragePlugin } from "@cosystem/storage";

const storage = createStoragePlugin({
  key: "cosystem:app",
  merge: (persisted, current) => ({
    ...current,
    ...persisted,
  }),
  partialize: (state) => ({
    counter: state.counter,
  }),
  storage: window.localStorage,
});

const app = createApp({
  plugins: [storage],
  providers: [Counter],
});

await app.start(); // waits for hydration
await storage.flush(); // waits for queued persistence writes in tests/tools
```

## Router

```ts
import {
  RouterToken,
  createBrowserRouter,
  createMemoryRouter,
  createRouterPlugin,
  provideRouter,
} from "@cosystem/router";

const router =
  typeof window === "undefined" ? createMemoryRouter({ initialPath: "/" }) : createBrowserRouter();

const app = createApp({
  plugins: [
    createRouterPlugin(router, {
      onChange(location) {
        console.log(location.path);
      },
    }),
  ],
  providers: [provideRouter(router)],
});

app.get(RouterToken).navigate("/settings");
```

## Tooling

This repository is set up as a modern TypeScript monorepo:

- pnpm workspaces with strict catalog-managed dependency versions
- Turborepo task orchestration
- Oxlint and Oxfmt for fast linting and formatting
- Vitest projects with V8 coverage
- tsdown for library builds powered by Rolldown
- Changesets for package versioning and publishing
- Commitizen, cz-git, commitlint, Husky, and lint-staged for commit hygiene

## Requirements

- Node.js `>=22.12.0`
- pnpm `11.8.0` via Corepack or a compatible global install

```sh
corepack enable pnpm
corepack use pnpm@11.8.0
pnpm install
```

## Common Commands

```sh
pnpm run format
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run check
pnpm changeset
pnpm run commit
```

## Workspace Layout

```text
apps/              # applications and services
examples/          # API usage examples
packages/core/     # CoSystem core runtime
packages/react/    # React adapter
packages/tsconfig/ # shared TypeScript configuration package
packages/vue/      # Vue adapter
```
