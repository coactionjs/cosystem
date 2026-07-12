# Core Concepts

CoSystem has a small vocabulary. Learn these seven terms and the rest of the
framework follows.

| Term         | One-line definition                                                         |
| ------------ | --------------------------------------------------------------------------- |
| **Module**   | A plain class with state, actions, computed getters, and effects.           |
| **State**    | Reactive fields merged into the app store under the module's `name`.        |
| **Action**   | A method whose state writes run inside a single transaction.                |
| **Computed** | A cached getter recomputed only when its tracked state changes.             |
| **Effect**   | A method that runs after init and re-runs when its tracked state changes.   |
| **Provider** | A DI registration (`useClass` / `useValue` / `useFactory` / `useExisting`). |
| **App**      | The runtime created by `createApp()` that owns the container and the store. |

## Modules

A module is just a class. Nothing extends a base class; nothing is decorated by
the framework at runtime beyond metadata you opt into.

```ts
import { defineModule } from "@cosystem/core";

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
```

The `name` is important: it is the **stable key** under which this module's state
appears in the store. See [Modules](./modules.md) for the decorator form and the
binding details.

## The single app store

CoSystem creates **one** Coaction-backed store for the whole app, not one per
module. Each module contributes a slice keyed by its `name`:

```ts
const app = createApp({ providers: [Counter, Todos] });

app.store.getPureState();
// { counter: { count: 0 }, todos: { items: [] } }
```

A single store means unified patches, persistence, devtools, and selectors all
see the entire application at once. You rarely touch `app.store` directly —
prefer `app.getModule(Counter)` and adapter selectors — but it is there for
advanced cases. See [State & Reactivity](./state-and-reactivity.md).

## State

State is a declared set of fields. Reads are tracked by the reactive runtime, so
computed values and effects know when to recompute, and UI selectors know when
to re-render.

```ts
class Counter {
  count = 0; // listed in defineModule({ state: ["count"] })
}
```

With decorators, state uses standard accessor decorators:

```ts
class Counter {
  @State accessor count = 0;
}
```

## Actions

An action wraps its synchronous state writes in a transaction. Multiple writes
in one action produce one coherent update (one patch, one notification):

```ts
class Cart {
  items: Item[] = [];
  total = 0;

  addItem(item: Item): void {
    this.items.push(item); // both writes are part of
    this.total += item.price; // the same transaction
  }
}
```

If you enable **strict actions**, writes outside an action throw — a guardrail
that keeps all mutations auditable. Async actions need an explicit boundary after
`await`; see [State & Reactivity](./state-and-reactivity.md#strict-actions-and-runinaction).

## Computed values

A computed getter is memoized through Coaction's signal-backed computed runtime.
It recomputes only when the state it read changes, and caches otherwise:

```ts
class Cart {
  items: Item[] = [];

  get count(): number {
    return this.items.length; // recomputed only when items changes
  }
}
```

Declare it in `defineModule({ computed: ["count"] })` or with `@Computed`.

## Effects

An effect is a method that runs once after the app initializes, then re-runs
whenever the state it reads changes. Effects are torn down on `app.dispose()`.

```ts
class Counter {
  count = 0;

  logCount(): void {
    console.log("count is", this.count); // re-runs when count changes
  }
}

defineModule(Counter, {
  effects: ["logCount"],
  name: "counter",
  state: ["count"],
});
```

Use effects for reactions to state — logging, syncing to external systems,
triggering follow-up work — not for deriving values (that is what computed is
for).

## Providers and dependency injection

Modules can depend on services. You register everything through `providers`, and
declare a module's dependencies with `deps` (constructor arguments):

```ts
abstract class Logger {
  abstract info(message: string): void;
}

class Counter {
  constructor(readonly logger: Logger) {}
  increase(): void {
    this.logger.info("increment");
  }
}

defineModule(Counter, { deps: [Logger], name: "counter", actions: ["increase"] });

const app = createApp({
  providers: [Counter, provide(Logger, { useValue: console })],
});
```

`@Module` classes are eagerly instantiated so their state can be bound. Plain
service classes stay lazy until something needs them. The full model — tokens,
provider kinds, scopes, lifetime safety, and disposal — is in
[Dependency Injection](./dependency-injection.md).

## The app

`createApp(options)` returns an `App`. It owns the DI container and the store,
and exposes a small surface:

```ts
app.getModule(Counter); // the bound module facade
app.get(SomeToken); // resolve any provider
app.watch(read, listener); // subscribe to derived values
await app.ready; // wait for setup and onInit
await app.start(); // run onStart hooks (optional)
await app.dispose(); // tear everything down
```

Lifecycle, options, lazy modules, and scopes are covered in
[Application Lifecycle](./application-lifecycle.md).

## Putting it together

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
  }
  announce(): void {
    this.logger.info(`count is now ${this.count}`);
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

const app = createApp({
  providers: [Counter, provide(Logger, { useValue: console })],
});

app.getModule(Counter).increase(2);
// effect logs "count is now 2"; app.store → { counter: { count: 2 } }
```

## Next

- [Modules](./modules.md) — decorators, metadata, binding, and lifecycle hooks.
- [Dependency Injection](./dependency-injection.md) — the full DI model.
- [State & Reactivity](./state-and-reactivity.md) — the store, `watch`, and strict actions.
