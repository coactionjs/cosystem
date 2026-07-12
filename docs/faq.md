# FAQ

Short answers to common questions. Each links to the guide with the full story.

## Do I have to use decorators?

No. `defineModule(Class, options)` declares the exact same metadata that
`@Module`/`@State`/`@Action`/`@Computed`/`@Effect` write, and the runtime treats
them identically. The no-decorator form also supports **plain fields** as state
(decorators only support `accessor` state) and works on any toolchain. See
[Modules](./modules.md).

## Does CoSystem need `reflect-metadata`?

No. The DI container is reflection-free: no `reflect-metadata`, no
`emitDecoratorMetadata`, no constructor-type or parameter-name parsing, and no
parameter decorators. You declare dependencies explicitly with `deps` (or
`static inject`). See [Dependency Injection](./dependency-injection.md).

## Do I need to call `app.start()`?

Often not. Plugin `setup`, module `onInit` hooks, and effects all run during
`createApp()` (tracked by `app.ready`). `start()` exists to await that
initialization, run `onStart` hooks, and mark the app started — call it only when
you have explicit startup work. Await `app.ready` directly when you only need an
async setup task such as storage hydration. See
[Application Lifecycle](./application-lifecycle.md).

## How is this different from using Coaction directly?

Coaction is the reactive state/signal/transport engine. CoSystem adds the
**application layer** on top: dependency injection, OO modules with
lifecycle, a single composed store from many modules, plugins, a worker
host/client, framework-native adapters, and `testApp()`. You can think of it as
"powered by Coaction." See [Architecture](./architecture.md).

## One store or one per module?

One store for the whole app. Each module contributes a slice keyed by its `name`,
so `app.store.getPureState()` returns `{ counter: {...}, todos: {...} }`. This
keeps patches, persistence, devtools, and selectors unified. See
[State & Reactivity](./state-and-reactivity.md).

## Can I render the same app with two frameworks at once?

Yes. The core never imports a UI framework, so a single `app` can be consumed by
more than one adapter on the same page — handy for incremental migrations and
micro-frontends. Mount each framework normally and pass it the shared `app`. See
[UI Adapters](./ui-adapters.md#using-two-frameworks-at-once).

## What are "strict actions"?

With `devOptions: { strictActions: true }`, every state write must happen inside
an action; writes outside one throw. Synchronous writes before the first `await`
in an async action are part of its transaction; post-`await` writes need a fresh
boundary via `runInAction(this, ...)`. See
[State & Reactivity](./state-and-reactivity.md#strict-actions-and-runinaction).

## How do I run a module in a Web Worker?

Host it with `createWorkerApp({ providers, transport })` in the worker and consume
it with `createWorkerClient({ transport })` on the main thread. The module code is
unchanged; only where it runs differs. Method calls become async. Each adapter has
`useWorkerModule`/`useWorkerSelector`-style helpers. See
[Worker & Shared Runtime](./worker-runtime.md).

## How do I persist state?

Add the [`@cosystem/storage`](../packages/storage/README.md) plugin. It hydrates on
startup (awaited by `start()`) and persists changes to any sync/async backend,
with `partialize`/`merge`/`shouldPersist` hooks. See [Plugins](./plugins.md).

## Is there a router?

[`@cosystem/router`](../packages/router/README.md) provides minimal router
primitives (browser/memory routers), a `RouterToken` you can inject, and a plugin
that bridges navigation into the app lifecycle. It does **not** match routes or
render views — pair it with your UI. See [Plugins](./plugins.md).

## How do I debug what the app is doing?

Use [`@cosystem/devtools`](../packages/devtools/README.md) to record a timeline of
setup, module creation, actions, patches, state changes, and errors, and subscribe
to it. The [`createLoggerPlugin`](../packages/core/README.md#logger-plugin) prints
actions and errors. In tests, the `testApp` inspector exposes recorded actions,
state, and patches. See [Plugins](./plugins.md) and [Testing](./testing.md).

## Does CoSystem support SSR?

The core is environment-agnostic and headless, so modules run on the server. For
routing, `createMemoryRouter({ initialPath })` is the server-side counterpart to
`createBrowserRouter()`. Framework-specific SSR (hydration, streaming) is handled
by each framework's own tooling, not by CoSystem.

## TypeScript / build setup?

CoSystem is ESM-only and targets modern runtimes. For decorators you need a
toolchain supporting TC39 decorators and the `accessor` keyword; otherwise use
`defineModule()`. The repo's shared config is
[`@cosystem/tsconfig`](../packages/tsconfig/README.md).

## Where do I report issues or contribute?

See [`CONTRIBUTING.md`](../CONTRIBUTING.md) and the
[repository](https://github.com/coactionjs/cosystem).
