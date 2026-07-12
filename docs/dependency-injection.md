# Dependency Injection

CoSystem ships a small, explicit DI container. It is deliberately **not**
Inversify/TSyringe/TypeDI-style: there is no `reflect-metadata`, no
`emitDecoratorMetadata`, no constructor-type reflection, no parameter decorators,
and no Proxy-based resolution. You declare tokens and dependency lists
explicitly, and the container resolves a typed graph.

> **Why explicit?** Standard (TC39) decorators are not compatible with
> `emitDecoratorMetadata`, do not support parameter decorators, and automatic
> constructor-type injection is not portable across TypeScript, Babel, SWC,
> esbuild, and worker runtimes. Explicit declarations work everywhere and give
> CoSystem tight control over scopes, lifecycle, worker boundaries, test
> overrides, and disposal.

## Injection tokens

A token identifies something the container can resolve. Any of these works:

```ts
type InjectionToken<T> = Token<T> | ClassToken<T> | string | symbol;
```

- **A class / abstract class** — the most common token. The class is both the
  identity and (for `useClass`) the implementation.
- **A typed `Token<T>`** created by `token<T>(description?)` — best for
  interfaces and non-class contracts.
- **A string or symbol** — handy for ad-hoc or cross-boundary keys.

```ts
import { token } from "@cosystem/core";

interface Logger {
  info(message: string): void;
}

const LoggerToken = token<Logger>("Logger");
```

Prefer `token<T>()` for interfaces (interfaces don't exist at runtime, so they
can't be tokens), and prefer an `abstract class` when you want a single symbol
that doubles as a type.

## Providers

`providers` is the single composition entry point of an app. Each entry is one
of:

1. A **`@Module` class** — a stateful CoSystem module, eagerly instantiated.
2. A **plain class** — a normal DI class provider, lazy by default.
3. A **`provide(token, options)`** entry — binds a token to a value, class,
   factory, or existing provider.

```ts
import { createApp, provide, token } from "@cosystem/core";

const Config = token<{ apiUrl: string }>("Config");

createApp({
  providers: [
    Counter, // class shorthand → { provide: Counter, useClass: Counter }
    ApiClient, // plain class provider (lazy)
    provide(Logger, { useValue: console }),
    provide(Config, { useValue: { apiUrl: "/api" } }),
    provide(Analytics, { useClass: Analytics, deps: [Config] }),
    provide(Clock, { useFactory: () => new Clock() }),
    ConcreteService,
    provide(AbstractService, { useExisting: ConcreteService }),
  ],
});
```

### Provider kinds

| Kind     | Shape                                                 | Notes                                                   |
| -------- | ----------------------------------------------------- | ------------------------------------------------------- |
| Class    | `{ useClass, deps?, scope?, eager?, autoDispose? }`   | Constructs the class with resolved `deps` as arguments. |
| Value    | `{ useValue, autoDispose? }`                          | Always singleton and eager.                             |
| Factory  | `{ useFactory, deps?, scope?, eager?, autoDispose? }` | Calls the factory with resolved `deps`; may be async.   |
| Existing | `{ useExisting }`                                     | Aliases one token to another.                           |

`provide(token, options)` preserves the generic relationship between the token
and the value: `provide(LoggerToken, { useValue })` constrains `useValue` to a
`Logger`.

## Declaring dependencies

Use `deps` to declare what a class/factory needs, in constructor-argument order.
A dependency spec is a token, or an object with modifiers:

```ts
type DependencySpec<T> =
  | InjectionToken<T>
  | { token: InjectionToken<T>; optional?: boolean; many?: boolean };
```

- `optional: true` → resolves to `undefined` instead of throwing when missing.
- `many: true` → resolves to an array of every `multi` provider for the token.

```ts
class Dashboard {
  constructor(
    readonly api: ApiClient,
    readonly logger: Logger | undefined,
    readonly widgets: Widget[],
  ) {}
}

provide(Dashboard, {
  useClass: Dashboard,
  deps: [ApiClient, { token: Logger, optional: true }, { token: Widget, many: true }],
});
```

A class can also carry its own `static inject` list, which is used when `deps`
is omitted.

`@Module` classes declare `deps` in their metadata:

```ts
defineModule(Counter, { deps: [Logger], name: "counter" });
// or @Module({ deps: [Logger], name: "counter" })
```

## Scopes

Every provider has a scope. The default is `singleton`.

| Scope        | Lifetime                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------- |
| `singleton`  | One instance in the root app container.                                                      |
| `scoped`     | One instance per child scope (`createScope()`) — request/view/worker/test scope.             |
| `resolution` | One instance per resolution chain; reused while resolving the current graph, then discarded. |
| `transient`  | A fresh instance for every resolution.                                                       |

```ts
provide(RequestContext, { useClass: RequestContext, scope: "scoped" });
provide(Id, { useFactory: () => crypto.randomUUID(), scope: "transient" });
```

CoSystem app modules must use `singleton`. A module owns exactly one slice in the
app's single store and its bound facade must be the same instance seen by DI;
`scoped`, `resolution`, and `transient` module scopes are rejected during app or
lazy-module provider normalization. Those scopes remain fully supported for
plain service/factory providers.

## Lifetime safety

A longer-lived provider that captures a shorter-lived one can leak scope state.
The container guards against this:

```txt
singleton  → may NOT depend on scoped / resolution / transient
scoped     → may NOT depend on resolution / transient
resolution → may depend on transient
transient  → may depend on anything
```

Violations throw `LifetimeLeakError`. If a dependency genuinely does not capture
mutable scope state (a pure value or stateless factory), mark it `leakSafe: true`
to opt out of the check for that provider.

## Multi providers

Register several providers under one token with `multi: true`, then read them
all with `getAll()` (or `{ many: true }` in `deps`):

```ts
import { createApp, provide, token, type Plugin } from "@cosystem/core";

const PluginToken = token<Plugin>("Plugin");

const app = createApp({
  providers: [
    provide(PluginToken, { useClass: PluginA, multi: true }),
    provide(PluginToken, { useClass: PluginB, multi: true }),
  ],
});

app.getAll(PluginToken); // [PluginA, PluginB]
```

Calling `get()` on a token with multiple providers throws
`AmbiguousProviderError`.

## Eager vs lazy

- `@Module` classes and `useValue` providers are **eager** (created during
  `createApp()`).
- Plain class and factory providers are **lazy** — created only when something
  resolves them.

Force eager creation for startup services:

```ts
provide(Analytics, { eager: true, useClass: Analytics });
```

## Imperative resolution: `inject()`

Inside a factory or during provider construction you can resolve dependencies
imperatively with `inject(token)`:

```ts
import { inject, provide } from "@cosystem/core";

provide(Service, {
  useFactory: () => new Service(inject(Logger)),
});
```

`inject()` only works while a provider is being resolved or during the
synchronous part of an app hook. For portable async hooks, resolve after an
`await` through the explicit lifecycle context instead:

```ts
async onInit(context: ModuleLifecycleContext): Promise<void> {
  await loadConfiguration();
  context.inject(Logger).info("ready");
}
```

Plugin setup uses `PluginContext.inject()` the same way. These explicit
resolvers remain isolated when several apps initialize concurrently in a
browser. Bare `inject()` also follows async execution in runtimes that provide
native async context, but portable code should not depend on that capability.
Outside an active resolution window it throws `InjectContextError`.

## The container

`createApp()` normalizes providers, **freezes** the root provider graph,
instantiates eager modules, builds the store, and binds module state/actions to
that store. After freezing, `provide()` / `override()` throw
`FrozenContainerError`. The `App` exposes the read side
(`get`, `getAsync`, `getAll`); the mutable `Container` is reachable through a
scope for advanced cases:

```ts
interface Container {
  get<T>(token: InjectionToken<T>): T;
  get<T>(token: InjectionToken<T>, options: { optional: true }): T | undefined;
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

`override()` replaces the container's existing records for the same token. Use
`provide(..., { multi: true })` when you want to append to a multi-provider
extension point instead.

`build()` / `buildAsync()` construct an **unregistered** class without caching it
— useful in tests and advanced factories:

```ts
const instance = app.createScope().container.build(Service);
const asyncInstance = await app.createScope().container.buildAsync(ServiceWithAsyncDeps);
```

Use the async variants whenever any dependency is backed by an async factory; the
sync path throws `AsyncProviderInSyncResolutionError`.

## Disposal

Provide a `dispose(value)` callback to clean up a provider's instance:

```ts
provide(Connection, {
  useFactory: () => openConnection(),
  dispose: (conn) => conn.close(),
});
```

Class and factory providers default to `autoDispose: true`: without a custom
callback, the container looks for `Symbol.asyncDispose`, `Symbol.dispose`,
`dispose()`, then `destroy()`. Values passed through `useValue` are external and
default to `autoDispose: false`; opt in only when ownership is intentionally
transferred. `useExisting` aliases never take ownership of the target. An
explicit `dispose(value)` callback always runs and replaces convention-based
disposal rather than running in addition to it.

`app.dispose()` disposes created instances in **reverse creation order**, then
disposes scopes and the container. Modules can also implement `onDispose()` (see
[Application Lifecycle](./application-lifecycle.md)). Disposal waits for
in-flight async providers before releasing their results. Once a container or
its root has begun disposal, further resolution, mutation, builds, and scope
creation throw `DisposedContainerError`.

## Errors

All extend `CosystemError`:

| Error                                | Cause                                                   |
| ------------------------------------ | ------------------------------------------------------- |
| `MissingProviderError`               | No provider for a token.                                |
| `DuplicateProviderError`             | A non-`multi` token registered twice.                   |
| `AmbiguousProviderError`             | `get()` on a multi token (use `getAll()`).              |
| `CircularDependencyError`            | A provider depends on itself transitively.              |
| `AsyncProviderInSyncResolutionError` | Sync `get()` hit an async factory.                      |
| `LifetimeLeakError`                  | A longer-lived provider depends on a shorter-lived one. |
| `FrozenContainerError`               | Mutating the graph after `freeze()`.                    |
| `DisposedContainerError`             | Using a container after disposal begins.                |
| `InjectContextError`                 | `inject()` outside provider resolution.                 |

## Next

- [Modules](./modules.md) — how `@Module` providers bind to the store.
- [Application Lifecycle](./application-lifecycle.md) — scopes and lazy modules.
- [`@cosystem/core` reference](../packages/core/README.md) — the full export list.
