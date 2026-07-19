# CoSystem

**The meta-framework for coexisting UI frameworks.**

![base class: none](https://img.shields.io/badge/base_class-none-success)
![inheritance: none](https://img.shields.io/badge/inheritance-none-success)
![reflect-metadata: none](https://img.shields.io/badge/reflect--metadata-none-success)
![UI frameworks: 5](https://img.shields.io/badge/UI_frameworks-5-blue)
![Web Worker: ready](https://img.shields.io/badge/Web_Worker-ready-blueviolet)
![module: ESM](https://img.shields.io/badge/module-ESM-orange)

**Facts:** [5 UI frameworks](./docs/ui-adapters.md) · [no base class, no inheritance](./docs/modules.md) · [no `reflect-metadata`](./docs/dependency-injection.md) · [runs in a Web Worker](./docs/worker-runtime.md)

CoSystem creates a typed application core powered by [Coaction](https://www.npmjs.com/package/coaction),
then lets each UI framework render with its own native API. Business modules are
plain classes with lightweight DI, object-oriented state, actions, computed
getters, effects, and test-friendly app composition.

```ts
import { createApp, defineModule } from "@cosystem/core";

class Counter {
  count = 0;
  get double() {
    return this.count * 2;
  }
  increase(step = 1) {
    this.count += step;
  }
}

defineModule(Counter, {
  name: "counter",
  state: ["count"],
  computed: ["double"],
  actions: ["increase"],
});

const app = createApp({ providers: [Counter] });
app.getModule(Counter).increase();
```

The same `Counter` module powers a React, Vue, Svelte, Solid, or Angular view —
or runs inside a Web Worker — without rewriting a line of business logic.

<details><summary>Prefer decorators? The same module, with decorators:</summary>

```ts
@Module({ name: "counter" })
class Counter {
  @State accessor count = 0;
  @Computed get double() {
    return this.count * 2;
  }
  @Action increase(step = 1) {
    this.count += step;
  }
}
```

</details>

## Why CoSystem

- **Framework-agnostic core.** Your domain logic is plain classes. The UI layer
  is an adapter, not a dependency — swap React for Vue without touching modules.
- **One observable state tree.** Module state is merged into a single
  Coaction-backed store, so devtools, persistence, and selectors all see the
  whole app.
- **Lightweight DI.** Constructor injection with tokens, scopes, lazy modules,
  and lifecycle hooks — no reflection metadata required.
- **Decorators optional.** Use TC39 decorators _or_ `defineModule()` metadata;
  the runtime treats them identically.
- **Runs anywhere.** The same modules can be hosted in a Worker, iframe, shared
  tab, or custom RPC channel and consumed reactively from the UI thread.
- **Test-first.** `testApp()` provides provider overrides, action/state/patch
  inspection, and deterministic effect flushing.

## Concepts

A CoSystem app is a graph of **modules** wired by a **DI container**:

| Term         | What it is                                                                  |
| ------------ | --------------------------------------------------------------------------- |
| **Module**   | A plain class with state, actions, computed getters, and effects.           |
| **State**    | Reactive fields merged into the app store under the module's `name`.        |
| **Action**   | A method whose state writes run inside a transaction.                       |
| **Computed** | A cached getter that recomputes only when its tracked state changes.        |
| **Effect**   | A method that runs after init and re-runs when its tracked state changes.   |
| **Provider** | A DI registration (`useClass` / `useValue` / `useFactory` / `useExisting`). |
| **Plugin**   | A lifecycle/store observer (logger, storage, router, devtools).             |
| **Adapter**  | A framework binding that reads the store with native reactivity.            |

CoSystem does **not** own rendering — there is no `ViewModule`, root component
base class, or `render()` abstraction. UI packages only provide context and
subscription helpers.

## How CoSystem compares

Most state libraries are framework-specific and view-first. CoSystem is a
framework-agnostic application layer, so the comparison is about scope, not just
ergonomics — and it is honest about where simpler tools win.

|                                 | CoSystem                       | Zustand        | Pinia       | MobX / MST    | Redux Toolkit   |
| ------------------------------- | ------------------------------ | -------------- | ----------- | ------------- | --------------- |
| Target frameworks               | React/Vue/Svelte/Solid/Angular | React          | Vue         | React-first   | React-first     |
| Same logic across frameworks    | ✅ first-class                 | ❌             | ❌          | ⚠️ manual     | ❌              |
| Run logic in a Worker / tabs    | ✅ built-in                    | ❌ DIY         | ❌ DIY      | ❌            | ❌              |
| Dependency injection            | ✅ explicit, zero-reflection   | ❌             | ❌          | ❌            | ❌              |
| Mental model                    | modules (classes)              | hooks/closures | setup store | observables   | slices/reducers |
| Base class / inheritance needed | ❌ none                        | ❌             | ❌          | ⚠️ MST models | ❌              |
| `reflect-metadata`              | ❌ none                        | —              | —           | —             | —               |
| First-class test harness        | ✅ `testApp`                   | ⚠️             | ⚠️          | ⚠️            | ✅              |
| Ecosystem & maturity            | 🟡 new (v0.x)                  | 🟢 huge        | 🟢 huge     | 🟢 mature     | 🟢 huge         |
| Best for small / single-fw apps | ⚠️ overkill                    | 🟢             | 🟢          | 🟢            | ⚠️              |

### When _not_ to reach for CoSystem

- A small or single-framework app — Zustand, Pinia, or signals are simpler.
- You need a mature SSR meta-framework today — Next, Nuxt, or SvelteKit.
- It is not a renderer, router framework, server, or component library.

### Reach for it when

- Complex domain logic you want decoupled from the view and trivially testable.
- You ship the **same logic in 2+ frameworks**, or you are migrating frameworks.
- You want to move logic **off the main thread** or **sync across tabs** without
  rewriting it.
- Your team values explicit dependency injection and a clear module boundary
  (e.g. an Angular or NestJS background).

## Packages

Every app depends on [`@cosystem/core`](./packages/core). Pick a UI adapter for
your framework and add plugins as needed. Each package has its own README with a
full API reference.

### Core

| Package                             | Description                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| [`@cosystem/core`](./packages/core) | DI container, module metadata, app runtime, decorators, worker runtime, and `testApp`. |

### UI adapters

| Package                                   | Description                                           |
| ----------------------------------------- | ----------------------------------------------------- |
| [`@cosystem/react`](./packages/react)     | React context and hooks (`useModule`, `useSelector`). |
| [`@cosystem/vue`](./packages/vue)         | Vue provide/inject composables and a plugin.          |
| [`@cosystem/svelte`](./packages/svelte)   | Svelte readable stores (4+) and rune helpers (5).     |
| [`@cosystem/solid`](./packages/solid)     | Solid context and signal helpers.                     |
| [`@cosystem/angular`](./packages/angular) | Angular environment provider and `inject*` signals.   |

### Plugins

| Package                                     | Description                                                          |
| ------------------------------------------- | -------------------------------------------------------------------- |
| [`@cosystem/router`](./packages/router)     | Embeddable router primitives, `RouterToken`, and a lifecycle plugin. |
| [`@cosystem/storage`](./packages/storage)   | Persistence plugin for hydrating and saving app state.               |
| [`@cosystem/devtools`](./packages/devtools) | Timeline inspection plugin for development tooling.                  |

### Tooling

| Package                                     | Description                                         |
| ------------------------------------------- | --------------------------------------------------- |
| [`@cosystem/create`](./packages/create)     | Project scaffolding with the `create-cosystem` CLI. |
| [`@cosystem/testing`](./packages/testing)   | Testing helper facade for `testApp`.                |
| [`@cosystem/tsconfig`](./packages/tsconfig) | Shared TypeScript configuration (internal).         |

## Create A Project

```sh
pnpm dlx @cosystem/create my-app
cd my-app
pnpm install
pnpm start
```

## Core API

```ts
import { createApp, defineModule, provide } from "@cosystem/core";

abstract class Logger {
  abstract info(message: string): void;
}

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

const counter = app.getModule(Counter);
counter.increase();
```

The same module reads more declaratively with decorators:

```ts
import {
  Action,
  Computed,
  createApp,
  Effect,
  Module,
  provide,
  runInAction,
  State,
} from "@cosystem/core";

@Module({
  deps: [Logger],
  name: "counter",
})
class Counter {
  constructor(readonly logger: Logger) {}

  @State
  accessor count = 0;

  @Computed
  get double(): number {
    return this.count * 2;
  }

  @Action
  increase(step = 1): void {
    this.count += step;
    this.logger.info(`count:${this.count}`);
  }

  @Effect
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

`@State` intentionally targets standard accessor decorators. Plain fields should
use `defineModule()` metadata until a future compatibility layer is added.
`@Computed` getters are cached through Coaction's signal-backed computed
runtime and invalidate when the state they read changes.
`@Effect` methods run after app initialization and rerun when the state they
read changes.
Async `@Action` methods may return promises; synchronous writes before the first
`await` are part of the action transaction, while post-await writes need another
action boundary or non-strict writes. Use `runInAction(this, ...)` after an
`await` when strict action mode should remain enabled:

```ts
class Counter {
  @State
  accessor count = 0;

  @Action
  async refresh(): Promise<void> {
    const next = await loadCount();

    runInAction(this, () => {
      this.count = next;
    });
  }
}
```

## Provider Lifetime

`@Module` providers are instantiated during `createApp()` so their state can be
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

Every module must declare an explicit `name` in its metadata — state slices,
persistence keys, and worker calls are addressed by it, and class names are
not stable under minification.

Actions compose: an action may call other actions (same module or another
module) and write other modules' state directly. Everything inside the
outermost action merges into a single store commit — one state notification,
one patch set — and the whole commit rolls back if the outermost action
throws. Errors caught inside an action keep the writes made before the catch.

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
import { bootstrapApplication } from "@angular/platform-browser";
import { injectModule, injectSignal, provideCoSystem } from "@cosystem/angular";

@Component({
  selector: "counter-view",
  template: `<button (click)="counter.increase()">{{ count() }}</button>`,
})
class CounterView {
  readonly counter = injectModule(Counter);
  readonly count = injectSignal(Counter, (module) => module.count);
}

bootstrapApplication(CounterView, {
  providers: [provideCoSystem(app)],
});
```

Angular can inject worker-hosted modules and expose state as Angular signals:

```ts
import { Component } from "@angular/core";
import { bootstrapApplication } from "@angular/platform-browser";
import { injectWorkerModule, injectWorkerSignal, provideWorkerClient } from "@cosystem/angular";

type CounterState = {
  readonly counter: {
    readonly count: number;
  };
};

@Component({
  selector: "counter-view",
  template: `<button (click)="counter.increase()">{{ count() }}</button>`,
})
class WorkerCounterView {
  readonly counter = injectWorkerModule<Counter>("counter");
  readonly count = injectWorkerSignal((state) => (state as CounterState).counter.count);
}

bootstrapApplication(WorkerCounterView, {
  providers: [provideWorkerClient(client)],
});
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
it cannot add a new `@Module` after app module discovery.

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

Worker clients can observe sync conflicts such as stale messages, missing
snapshots, patch gaps, or invalid patches:

```ts
const client = createWorkerClient({
  onConflict(event) {
    console.warn(event.reason, event.currentVersion, event.incomingVersion);
  },
  transport: clientTransport,
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

Remote calls are limited to declared module actions by default. Additional
methods can be enabled explicitly per module with
`createWorkerApp({ expose: { counter: ["refresh"] }, ... })`.

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
import { StorageToken, createLocalSpaceStoragePlugin, syncPlugin } from "@cosystem/storage";

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
    plugins: [syncPlugin({ channelName: "my-app-state" })],
  },
  merge: (persisted, current) => ({
    ...(current as object),
    ...persisted,
  }),
  partialize: (state) => ({
    counter: (state as CounterAppState).counter,
  }),
});

const app = createApp({
  plugins: [storage],
  providers: [Counter],
});

await app.start(); // waits for hydration
await storage.flush(); // waits for queued persistence writes in tests/tools
await app.get(StorageToken).set("draft", { title: "Hello" });
await app.dispose(); // also waits for pending storage writes
```

Pass `throttleMs` to write at most once per interval (always with the latest
state); pending writes flush on dispose or via `plugin.flush()`.

## Router

```ts
import {
  RouterToken,
  createBrowserRouter,
  createMemoryRouter,
  createRouterPlugin,
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
packages/
  angular/    # Angular adapter
  core/       # CoSystem core runtime (DI, app, decorators, worker)
  create/     # create-cosystem scaffolding CLI
  devtools/   # timeline inspection plugin
  react/      # React adapter
  router/     # router primitives and plugin
  solid/      # Solid adapter
  storage/    # persistence plugin
  svelte/     # Svelte adapter (stores + runes)
  testing/    # testApp facade
  tsconfig/   # shared TypeScript configuration (internal)
  vue/        # Vue adapter
examples/     # runnable usage examples (one workspace package each)
scripts/      # release/publish tooling
```

## Documentation

- **Guides** — conceptual documentation lives in [`docs/`](./docs). Start with
  the [Introduction](./docs/introduction.md) and
  [Getting Started](./docs/getting-started.md), then dig into
  [Core Concepts](./docs/core-concepts.md),
  [Dependency Injection](./docs/dependency-injection.md),
  [State & Reactivity](./docs/state-and-reactivity.md),
  [UI Adapters](./docs/ui-adapters.md), [Plugins](./docs/plugins.md),
  [Worker & Shared Runtime](./docs/worker-runtime.md),
  [Testing](./docs/testing.md), and [Architecture](./docs/architecture.md).
- **API reference** — each package's README documents its exports; see the
  [Packages](#packages) table above.
- **Examples** — runnable, framework-specific demos live in
  [`examples/`](./examples).
- **Contributing** — workflow and conventions in
  [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Contributing

Contributions are welcome. The short version:

```sh
corepack enable pnpm
pnpm install
pnpm run check        # format:check + lint + typecheck + test + build
pnpm run commit       # commitizen-guided conventional commit
pnpm changeset        # describe a release-worthy change
```

See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the full guide, including commit
conventions, the changeset/release flow, and how to work with examples.

## License

[MIT](./LICENSE) © Coaction
