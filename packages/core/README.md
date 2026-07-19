# @cosystem/core

> The CoSystem core runtime: a typed application core with lightweight dependency
> injection, object-oriented state, actions, computed getters, effects, and a
> framework-agnostic store powered by [Coaction](https://www.npmjs.com/package/coaction).

`@cosystem/core` is the only package every CoSystem app depends on. It owns the
DI container, module metadata, the app runtime and lifecycle, the reactive
store, and a worker-hosting prototype. UI adapters (`@cosystem/react`,
`@cosystem/vue`, …) and plugins (`@cosystem/storage`, `@cosystem/router`, …) are
thin layers on top of the primitives exported here.

## Installation

```sh
pnpm add @cosystem/core
# npm install @cosystem/core
# yarn add @cosystem/core
```

CoSystem ships as ESM only and targets Node.js `>=22.12.0` and modern browsers.

## Table of contents

- [Concepts](#concepts)
- [Defining a module](#defining-a-module)
  - [With decorators](#with-decorators)
  - [Without decorators](#without-decorators)
- [Creating an app](#creating-an-app)
- [Dependency injection](#dependency-injection)
- [State, actions, computed, and effects](#state-actions-computed-and-effects)
- [Async actions and `runInAction`](#async-actions-and-runinaction)
- [Provider lifetime and scopes](#provider-lifetime-and-scopes)
- [Module lifecycle hooks](#module-lifecycle-hooks)
- [Lazy modules](#lazy-modules)
- [Plugins](#plugins)
- [Reading state outside of components](#reading-state-outside-of-components)
- [Testing](#testing)
- [Worker / shared runtime](#worker--shared-runtime)
- [Errors](#errors)
- [API reference](#api-reference)

## Concepts

A CoSystem app is a graph of **modules**. A module is a plain class that:

- holds **state** (reactive fields),
- exposes **actions** (methods that mutate state inside a transaction),
- derives **computed** values (cached getters), and
- can run **effects** (methods that re-run when their tracked state changes).

Modules are wired together with a small **DI container**. Their state is merged
into a single Coaction-backed store keyed by the module `name`, so the whole app
has one observable state tree:

```ts
// app.store.getPureState()
{ counter: { count: 2 }, todos: { items: [] } }
```

CoSystem does **not** own rendering. There is no view base class or `render()`
abstraction. Framework adapters read the store and subscribe to changes using
each framework's native reactivity.

## Defining a module

### Without decorators

`defineModule()` declares module metadata for a class. This form needs no special
build setup, supports **plain fields** as state, and is the simplest way to
start.

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

app.getModule(Counter).increase();
```

Every module must declare an explicit `name`. It is the stable key used by app
state, persistence, devtools, and worker RPC; deriving it from a class name
would break when application code is minified.

### With decorators

The same module reads more declaratively with decorators. `@State` targets
standard accessor decorators, `@Action`/`@Effect` target methods, and `@Computed`
targets getters. Decorators require a TypeScript or build setup that supports the
TC39 decorators + `accessor` keyword (the repo's `tsdown`/`tsc` config does).

```ts
import { Action, Computed, Effect, Module, State } from "@cosystem/core";

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
```

`@Computed` getters are cached through Coaction's signal-backed computed runtime
and invalidate when the state they read changes. `@Effect` methods run after app
initialization and re-run when the state they read changes.

## Creating an app

```ts
const app = createApp({
  providers: [Counter, provide(Logger, { useValue: console })],
  plugins: [],
  devOptions: { strictActions: true },
});
```

`createApp(options)` returns an [`App`](#app). Key options:

| Option       | Type                              | Description                                                            |
| ------------ | --------------------------------- | ---------------------------------------------------------------------- |
| `providers`  | `(ProviderInput \| LazyModule)[]` | Modules, plain providers, and lazy-module entries to register.         |
| `plugins`    | `Plugin[]`                        | Lifecycle/observability plugins (logger, storage, router, devtools …). |
| `parent`     | `App \| Container`                | Parent container for hierarchical DI.                                  |
| `devOptions` | `{ strictActions?: boolean }`     | Enforce action boundaries for all state writes when `true`.            |
| `engine`     | `{ patches?: boolean }`           | Enable patch generation on the underlying store.                       |

`@Module` providers are instantiated during `createApp()` so their state can be
bound to the store. Plugin `setup`, module `onInit` hooks, and effects are kicked
off on the next microtask and tracked by the stable `app.ready` promise.
`app.start()` awaits that same initialization, then runs `onStart` hooks and
marks the app started; many apps can skip `start()` entirely if they have no
startup work. Initialization failures reject `app.ready` even though the runtime
observes them internally to prevent an unhandled rejection when an app is never
started.

## Dependency injection

CoSystem includes a small but complete DI container. You register **providers**
keyed by **injection tokens** (a class, a `Token`, a string, or a symbol).

```ts
import { createApp, provide, token } from "@cosystem/core";

const Config = token<{ apiUrl: string }>("Config");

createApp({
  providers: [
    Counter, // class shorthand → useClass: Counter
    provide(Logger, { useValue: console }),
    provide(Config, { useValue: { apiUrl: "/api" } }),
    provide(Analytics, { useClass: Analytics, deps: [Config] }),
    provide(Clock, { useFactory: () => new Clock(), deps: [] }),
    ConcreteService,
    provide(AbstractService, { useExisting: ConcreteService }),
  ],
});
```

Provider shapes (`provide(token, options)`):

- `useClass` — construct a class, resolving `deps` as constructor arguments.
- `useValue` — use an existing value (always eager, singleton, and externally
  owned unless `autoDispose: true`).
- `useFactory` — call a factory with resolved `deps`; may be async.
- `useExisting` — alias one token to another.

Inside a factory or provider construction you may also call `inject(token)` to
resolve dependencies imperatively:

```ts
import { inject, provide } from "@cosystem/core";

provide(Service, {
  useFactory: () => new Service(inject(Logger)),
});
```

`inject()` throws `InjectContextError` outside of an active resolution. In async
plugin setup, use `PluginContext.inject()` after an `await`; module hooks receive
a `ModuleLifecycleContext` with the same explicit resolver. This keeps
concurrently initializing browser apps isolated without relying on a global
async context.

### Container access

`app.createScope().container` exposes the [`Container`](#container) directly for
advanced use. `build()` / `buildAsync()` construct an unregistered class without
caching it:

```ts
const instance = app.createScope().container.build(Service);
const asyncInstance = await app.createScope().container.buildAsync(ServiceWithAsyncDeps);
```

Use `buildAsync()` when any dependency is backed by an async factory; the sync
path throws `AsyncProviderInSyncResolutionError`.

When sync resolution discovers async work, the container still tracks that
pending provider. A later `getAsync()` shares cacheable work, and disposal waits
for fulfilled resources instead of leaking them.

## State, actions, computed, and effects

- **State** fields become the module's slice in the store. Reads are tracked.
- **Actions** wrap writes in a transaction. In `strictActions` mode, writes
  outside an action throw, including deep object/array mutations and direct
  `store.setState()` / `store.apply()` calls; plain snapshots from
  `store.getPureState()` are detached and recursively frozen.
- **Computed** getters are memoized and recomputed only when tracked state
  changes.
- **Effects** run once after init and re-run when their tracked state changes.
  Effects are torn down on `dispose()`.

## Async actions and `runInAction`

Async `@Action` methods may return promises. Synchronous writes before the first
`await` are part of the action transaction; writes after an `await` need a fresh
action boundary when strict mode is enabled. Use `runInAction(this, …)`:

```ts
import { runInAction } from "@cosystem/core";

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

You can also call `app.runInAction(moduleOrToken, callback, { name, args })` from
outside the module. For whole-store hydration or replacement, use the app-level
overload: `app.runInAction(() => app.store.setState(next), { name: "hydrate" })`.

## Provider lifetime and scopes

Providers default to the `"singleton"` scope. Available scopes:

| Scope          | Lifetime                                                        |
| -------------- | --------------------------------------------------------------- |
| `"singleton"`  | One instance per root container (default).                      |
| `"scoped"`     | One instance per child scope created with `createScope()`.      |
| `"resolution"` | One instance per resolution graph (shared within a single get). |
| `"transient"`  | A fresh instance on every resolution.                           |

These four scopes apply to plain DI services. CoSystem modules are
singleton-only: each module owns one app store slice and must have the same
identity through `getModule()` and dependency injection. Configuring a module as
`scoped`, `resolution`, or `transient` throws during provider normalization.

`@Module` providers and `useValue` providers are eager. Plain class/factory
providers stay lazy unless a module or another eager provider depends on them.
Mark startup services eager explicitly:

```ts
createApp({
  providers: [Counter, provide(Analytics, { eager: true, useClass: Analytics })],
});
```

A longer-lived provider that depends on a shorter-lived one throws
`LifetimeLeakError` unless the dependency is marked `leakSafe: true`. Use `multi:
true` to register several providers under one token and read them with
`getAll()`. Provide a `dispose(value)` callback to clean up on `app.dispose()`.
Class/factory values use convention-based disposal by default; disable it with
`autoDispose: false`. External `useValue` providers default to no automatic
disposal, while `autoDispose: true` explicitly transfers ownership. A custom
`dispose(value)` replaces convention disposal, and aliases never own targets.

## Module lifecycle hooks

Modules may implement any of these optional methods, called by the runtime:

```ts
class Service {
  onInit(context: ModuleLifecycleContext): void | Promise<void> {} // after graph creation
  onStart(context: ModuleLifecycleContext): void | Promise<void> {} // during app.start()
  onStop(context: ModuleLifecycleContext): void | Promise<void> {} // during app.stop()
  onDispose(context: ModuleLifecycleContext): void | Promise<void> {} // during app.dispose()
}
```

Lifecycle hooks may use `context.inject()` before or after an `await`.
App-managed setup, effects, and lifecycle hooks cannot call `app.start()`,
`app.stop()`, or `app.dispose()`; setup and `onInit` work also cannot await
`app.ready`. Drive lifecycle phases from application bootstrap so a hook cannot
await the phase that is already waiting for it. After an `await`, use the app
supplied to `setup` or `ModuleLifecycleContext.app` for portable enforcement;
browser fallback keeps unrelated external lifecycle controls available.

`onStop`/`onDispose` run in reverse order. Teardown is best-effort across every
module and cleanup phase; failures are reported together as an `AggregateError`
after disposal reaches its terminal state.

Module lookup and writes are terminal too: once disposal begins, new
`getModule()` / `getModuleByName()` calls fail, and a facade retained earlier
cannot run actions or mutate top-level or nested state after teardown completes.

## Lazy modules

Lazy modules are explicit and isolated — they do not mutate the root provider
graph:

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

await app.load(lazyModule(() => ({ providers: [AdminCounter] })));

app.getModule(AdminCounter).increase();
```

Passing `lazyModule(...)` to `createApp({ providers })` records the entry without
loading it. Call `await app.load()` to load all pending lazy modules, or
`await app.load(module)` to load one. Loaders may return a provider, a provider
array, or a module-namespace object (`{ default }` / `{ providers }`), which
makes dynamic `import()` ergonomic. Concurrent calls for the same entry share
one in-flight load. Lifecycle work runs in a temporary scope; state, facades,
effects, and module lookups are committed only after initialization, startup,
and the effects' initial synchronous run succeed. A failed effect startup emits
no transient state, watch, patch, or version update. Failed loads dispose and
roll back the scope so a later call can retry.

## Plugins

A plugin observes the app lifecycle and store. Implement any subset of the hooks:

```ts
import type { Plugin } from "@cosystem/core";

const plugin: Plugin = {
  name: "my-plugin",
  providers: [],
  setup(app, context) {},
  onModuleCreated(event, context) {},
  onActionStart(event, context) {},
  onActionEnd(event, context) {},
  onPatch(event, context) {},
  onStateChange(event, context) {},
  onError(error, errorContext, context) {},
  dispose(context) {},
};
```

`PluginContext` gives plugins managed cleanup. `context.watch()` is `app.watch()`
with automatic teardown, and `context.onDispose()` registers any other disposer.
Plugin `providers` can contribute service/token dependencies before app providers
are registered, but they cannot register CoSystem modules. App-level non-`multi`
providers replace plugin providers for the same token; app-level `multi`
providers append to plugin `multi` providers.

Built-in: [`createLoggerPlugin()`](#logger-plugin). The
[`@cosystem/storage`](../storage), [`@cosystem/router`](../router), and
[`@cosystem/devtools`](../devtools) packages are plugins too.

### Logger plugin

```ts
import { createApp, createLoggerPlugin } from "@cosystem/core";

const app = createApp({
  plugins: [createLoggerPlugin()],
  providers: [Counter],
});
```

Pass `{ logger }` to route messages somewhere other than `console`.

## Reading state outside of components

```ts
app.getModule(Counter); // the bound module facade
app.getModuleByName("counter"); // look up by registered name
app.get(Token); // resolve any provider (sync)
await app.getAsync(Token); // resolve, allowing async factories
app.getAll(MultiToken); // all providers registered as multi
app.store.getPureState(); // the full plain state tree

const stop = app.watch(
  () => app.getModule(Counter).count,
  (value, previous) => console.log(value, previous),
  { equals: Object.is, immediate: false },
);
stop();
```

Watch selectors run once per committed store mutation. Listener exceptions and
async rejections are isolated from actions and reported to plugin `onError`
hooks with phase `"watch"`.

## Testing

`testApp()` wraps `createApp()` with an inspector and override support. See
[`@cosystem/testing`](../testing) for the dedicated facade.

```ts
import { provide, testApp } from "@cosystem/core";

const app = testApp({
  providers: [Counter, provide(Logger, { useValue: console })],
  strictActions: true,
});

app.getModule(Counter).increase(2);

expect(app.test.getActions()).toMatchObject([{ method: "increase", module: "counter" }]);

// autoStart returns a Promise that resolves once start() completes.
const started = await testApp({ autoStart: true, providers: [Counter] });
expect(started.started).toBe(true);
```

`testApp({ overrides })` replaces providers discovered from `providers`, but it
cannot introduce a brand new `@Module` after module discovery. The inspector
(`app.test`) exposes `getActions`, `getState`, `getPatches`, `clearActions`,
`clearPatches`, and `flushEffects`.

## Worker / shared runtime

`@cosystem/core` includes a worker-hosting prototype: run the app (and its
modules) in a Worker, iframe, `MessagePort`, `BroadcastChannel`, or custom RPC
channel, and consume its state from another context.

```ts
import {
  createMemoryWorkerTransportPair,
  createWorkerApp,
  createWorkerClient,
} from "@cosystem/core";

const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();

const client = createWorkerClient({ transport: clientTransport });
const host = createWorkerApp({
  providers: [Counter],
  sync: "patch",
  transport: hostTransport,
});

await client.ready;
await client.module<Counter>("counter").increase(1);

const selectCount = (state: unknown) => (state as { counter: { count: number } }).counter.count;
const count = client.select(selectCount);
const unsubscribe = client.watch(selectCount, (value) => console.log(value));

unsubscribe();
client.dispose();
await host.dispose();
```

Delegated method promises settle after the client mirror reaches the worker
state version associated with the method result. If a result arrives before its
state update, the client requests a snapshot sync and waits before resolving or
rejecting the call.

Worker host disposal aborts in-flight app initialization before awaiting
readiness. Worker client disposal rejects both pending and newly attempted RPC
calls, so no request can remain orphaned after subscriptions are removed.

Declared module actions are remotely callable by default. Opt additional plain
methods in per module with `createWorkerApp({ expose: { counter: ["refresh"] }, ... })`.
Protocol messages are schema-validated (including safe patch paths), and client
requests default to a 30-second timeout with per-call timeout/`AbortSignal`
support through `callWithOptions()`. Bare/custom transports are trusted-endpoint
APIs; postMessage adds `targetOrigin` plus origin/source filters, while broadcast
transports support a shared `authToken` routing capability. Broadcast peers can
observe that token, so BroadcastChannel remains a trusted same-origin transport,
not an adversarial security boundary.

Transports (all interchangeable):

- `createMemoryWorkerTransportPair()` — in-process host/client pair (tests).
- `createPostMessageWorkerTransport(endpoint)` — `Worker`, iframe, `MessagePort`.
- `createBroadcastWorkerTransport(channel, { peerId, targetPeerId })` — shared
  tabs via `BroadcastChannel`; `createMemoryBroadcastChannel()` mirrors it in
  tests.
- `createDataTransportWorkerTransport(dataTransport)` — process/socket/custom RPC.

Hosts can isolate published state to selected top-level sections with
`stateSections: ["counter"]` (method delegation still covers all modules). Sync
defaults to `"snapshot"`; `sync: "patch"` sends patch-only updates after startup.
Clients can observe conflicts via `onConflict` (`stale-message`,
`missing-snapshot`, `version-gap`, `patch-apply-failed`).

The prototype intentionally does not implement full shared-runtime conflict
resolution or framework-specific worker bootstrapping. Adapters
(`@cosystem/react`, `@cosystem/vue`, `@cosystem/svelte`, `@cosystem/solid`,
`@cosystem/angular`) ship `WorkerClient`-based hooks for consuming worker state.

## Errors

All errors extend `CosystemError`:

| Error                                | Thrown when                                                           |
| ------------------------------------ | --------------------------------------------------------------------- |
| `MissingProviderError`               | A token has no registered provider.                                   |
| `DuplicateProviderError`             | A non-`multi` token is registered twice.                              |
| `AmbiguousProviderError`             | `get()` is called for a token with multiple providers (use `getAll`). |
| `CircularDependencyError`            | A provider depends on itself transitively.                            |
| `AsyncProviderInSyncResolutionError` | A sync `get()` hits an async factory (use `getAsync`/`buildAsync`).   |
| `LifetimeLeakError`                  | A longer-lived provider depends on a shorter-lived one.               |
| `FrozenContainerError`               | The provider graph is mutated after freezing.                         |
| `DisposedContainerError`             | A container is used after disposal begins.                            |
| `InjectContextError`                 | `inject()` is used outside provider resolution.                       |

## API reference

`createApp`, `createContainer`, `defineModule`, `getModuleMetadata`, the
`Module`/`State`/`Action`/`Computed`/`Effect` decorators, `provide`, `token`,
`tokenName`, `inject`, `lazyModule`, `runInAction`, `testApp`,
`createLoggerPlugin`, and the worker factories are all exported from the package
root, alongside their TypeScript types (`App`, `CreateAppOptions`, `Plugin`,
`PluginContext`, `Container`, `Provider`, `Scope`, `WorkerClient`,
`WorkerAppHost`, the event types, and more).

### App

```ts
interface App {
  readonly ready: Promise<void>;
  readonly state: { readonly version: number };
  readonly started: boolean;
  readonly store: Store<RootState>;

  get<T>(token: InjectionToken<T>): T;
  getAsync<T>(token: InjectionToken<T>): Promise<T>;
  getAll<T>(token: InjectionToken<T>): T[];
  getModule<T>(token: InjectionToken<T>): T;
  getModuleByName<T = unknown>(name: string): T;
  watch<T>(
    read: () => T,
    listener: (value: T, previous: T) => void,
    options?: WatchOptions<T>,
  ): () => void;
  runInAction<T>(module: RunInActionTarget, callback: () => T, options?: RunInActionOptions): T;
  start(): Promise<void>;
  stop(): Promise<void>;
  dispose(): Promise<void>;
  createScope(options?: ScopeOptions): AppScope;
  load(module: LazyModule): Promise<LazyModuleLoadResult>;
  load(): Promise<readonly LazyModuleLoadResult[]>;
}
```

### Container

```ts
interface Container {
  get<T>(token: InjectionToken<T>): T;
  get<T>(token: InjectionToken<T>, options: { readonly optional: true }): T | undefined;
  getAll<T>(token: InjectionToken<T>): T[];
  getAsync<T>(token: InjectionToken<T>): Promise<T>;
  has(token: InjectionToken): boolean;
  provide(provider: ProviderInput): void;
  override(provider: ProviderInput): void;
  createScope(options?: ScopeOptions): Container;
  build<T>(target: Constructor<T>, options?: BuildOptions): T;
  buildAsync<T>(target: Constructor<T>, options?: BuildOptions): Promise<T>;
  freeze(): void;
  dispose(): Promise<void>;
}
```

`override()` replaces existing records for the same token. Use `multi: true`
providers with `provide()` when you want to append extension entries.

## License

[MIT](../../LICENSE) © Coaction
