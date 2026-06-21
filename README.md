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
action boundary or non-strict writes.

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

Svelte:

```ts
import { moduleStore, selectedModuleStore, setCoSystemApp } from "@cosystem/svelte";

setCoSystemApp(app);

const counter = moduleStore(Counter);
const count = selectedModuleStore(Counter, (module) => module.count);
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
  createDataTransportWorkerTransport,
  createMemoryWorkerTransportPair,
  createWorkerApp,
  createWorkerClient,
} from "@cosystem/core";

const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();

const client = createWorkerClient({
  transport: clientTransport,
});

const host = createWorkerApp({
  providers: [Counter],
  transport: hostTransport,
});

await client.module<Counter>("counter").increase(1);

console.log(client.getState());

client.dispose();
await host.dispose();
```

For real worker, iframe, process, or broadcast channels, adapt a
`data-transport` endpoint instead of using the in-memory pair:

```ts
const client = createWorkerClient({
  transport: createDataTransportWorkerTransport(clientDataTransport),
});

const host = createWorkerApp({
  providers: [Counter],
  transport: createDataTransportWorkerTransport(hostDataTransport),
});
```

The prototype covers app creation, method delegation, initial state snapshots,
patch sync messages, and a `data-transport`-style `listen`/`emit` bridge. It
does not attempt full shared-runtime conflict handling or framework-specific
worker bootstrapping.

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

console.log(devtools.getTimeline());
```

## Storage

```ts
import { createStoragePlugin } from "@cosystem/storage";

const storage = createStoragePlugin({
  key: "cosystem:app",
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
  createMemoryRouter,
  createRouterPlugin,
  provideRouter,
} from "@cosystem/router";

const router = createMemoryRouter({ initialPath: "/" });

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
