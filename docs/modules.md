# Modules

A module is a plain class that the runtime binds to the app store. This guide
covers both ways to declare module metadata, how that metadata maps to the
store, and the lifecycle hooks a module can implement.

## Two ways to declare a module

CoSystem treats decorators and `defineModule()` identically — they write the same
metadata. Pick whichever fits your build setup and taste.

### With decorators

```ts
import { Action, Computed, Effect, Module, State } from "@cosystem/core";

@Module({ name: "counter", deps: [Logger] })
class Counter {
  constructor(readonly logger: Logger) {}

  @State accessor count = 0;

  @Computed get double(): number {
    return this.count * 2;
  }

  @Action increase(step = 1): void {
    this.count += step;
  }

  @Effect announce(): void {
    this.logger.info(`count:${this.count}`);
  }
}
```

Decorator rules:

- `@State` targets **standard accessor decorators** — use the `accessor`
  keyword. Plain fields are not picked up by `@State`; use `defineModule()` for
  those.
- `@Action` and `@Effect` target **methods**.
- `@Computed` targets **getters**.

Decorators require a toolchain that supports TC39 decorators plus the `accessor`
keyword. The repo's `tsdown`/`tsc` configuration does; if yours does not, use the
no-decorator form.

### Without decorators

`defineModule(Class, options)` declares the same metadata for a plain class. This
is the most portable option and supports **plain fields** as state:

```ts
import { defineModule } from "@cosystem/core";

class Counter {
  count = 0;
  constructor(readonly logger: Logger) {}

  get double(): number {
    return this.count * 2;
  }
  increase(step = 1): void {
    this.count += step;
  }
  announce(): void {
    this.logger.info(`count:${this.count}`);
  }
}

defineModule(Counter, {
  actions: ["increase"],
  computed: ["double"],
  deps: [Logger],
  effects: ["announce"],
  name: "counter",
  state: ["count"],
});
```

`DefineModuleOptions`:

| Field      | Type               | Description                                                     |
| ---------- | ------------------ | --------------------------------------------------------------- |
| `name`     | `string`           | Stable store key for this module's state.                       |
| `deps`     | `DependencySpec[]` | Constructor dependencies (see [DI](./dependency-injection.md)). |
| `scope`    | `"singleton"`      | Module provider scope; other scopes are rejected.               |
| `state`    | `PropertyKey[]`    | Fields that become reactive state.                              |
| `actions`  | `PropertyKey[]`    | Methods wrapped in a transaction.                               |
| `computed` | `PropertyKey[]`    | Cached getters.                                                 |
| `effects`  | `PropertyKey[]`    | Methods that react to state.                                    |

`getModuleMetadata(Class)` reads back the merged metadata if you need to inspect
it.

## How metadata is stored

Metadata lives in a `WeakMap` keyed by the class, and is mirrored onto the
standard `Symbol.metadata` slot when the decorator context provides one. This
means:

- Decorators and `defineModule()` **merge** into the same record — you can use
  both on one class.
- No `reflect-metadata` import is required.
- Metadata is attached to the class, not instances, so it is set up once.

## Naming

A module's `name` is the key its state appears under in the store, so it must be
stable. The runtime resolves the name in this priority order:

```txt
@Module({ name })  >  defineModule(..., { name })  >  provider token description  >  camelCased class name
```

Duplicate names in one app are a development-time error — two modules cannot both
claim `"counter"`.

## Binding to the store

When `createApp()` instantiates a `@Module` provider, it binds the instance to
the store:

- **State** fields become a slice keyed by `name`. Reading a state field tracks
  it; writing it goes through the store so subscribers are notified.
- **Actions** are wrapped so their synchronous writes run inside one transaction
  and emit a single coherent update (and an `ActionEvent` to plugins).
- **Computed** getters are backed by Coaction's cached computed runtime: they
  recompute only when the state they read changes.
- **Effects** are started after init and re-run when their tracked state changes;
  they are disposed with the app.

You still interact with the module as a normal object:

```ts
const counter = app.getModule(Counter);
counter.increase(); // action → transaction → store update
counter.double; // cached computed
counter.count; // current state value
```

`app.getModule(token)` and `app.getModuleByName(name)` both return this bound
facade.

Modules are singleton-only because every module owns one slice in the app's
single store. Multiple transient/resolution/scoped instances would not share the
bound facade and could mutate fields without updating that slice. Use scoped or
transient plain DI services behind a singleton module when request-specific
state is needed.

## Lifecycle hooks

A module may implement any subset of these optional methods. The runtime calls
them at the right phase:

```ts
class Service {
  onInit(context: ModuleLifecycleContext): void | Promise<void> {} // after graph creation
  onStart(context: ModuleLifecycleContext): void | Promise<void> {} // during app.start()
  onStop(context: ModuleLifecycleContext): void | Promise<void> {} // during app.stop()
  onDispose(context: ModuleLifecycleContext): void | Promise<void> {} // during app.dispose()
}
```

- `onInit` runs during app creation (tracked by `app.ready`, which `start()` also
  awaits) — good for wiring that needs the full module graph.
- `onStart` runs when you call `app.start()` — good for kicking off subscriptions
  or fetching initial data.
- `onStop` and `onDispose` run in reverse order. Teardown is best-effort: hook
  failures are collected while the remaining modules still run.
- Every lifecycle hook receives a context whose `inject()` remains valid after
  an `await` and stays isolated across concurrent apps. Calling `app.start()`
  from a lifecycle hook is rejected to prevent phase reentry.

See [Application Lifecycle](./application-lifecycle.md) for the exact ordering
relative to plugins and effects.

## Async work in a module

State writes after an `await` need a fresh action boundary in strict mode. Wrap
them in `runInAction(this, ...)`:

```ts
import { runInAction } from "@cosystem/core";

class Counter {
  @State accessor count = 0;

  @Action async refresh(): Promise<void> {
    const next = await loadCount(); // pre-await writes are in the transaction
    runInAction(this, () => {
      this.count = next; // post-await write needs its own boundary
    });
  }
}
```

This is covered in depth in
[State & Reactivity](./state-and-reactivity.md#strict-actions-and-runinaction).

## Lazy modules

Modules can be loaded after app creation without touching the root provider
graph. See [Application Lifecycle](./application-lifecycle.md#lazy-modules).

## Next

- [Dependency Injection](./dependency-injection.md) — wiring services into modules.
- [State & Reactivity](./state-and-reactivity.md) — the store, actions, and `watch`.
- [UI Adapters](./ui-adapters.md) — exposing modules to a framework.
