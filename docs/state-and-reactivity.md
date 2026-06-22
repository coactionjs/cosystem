# State & Reactivity

CoSystem's reactivity is provided by [Coaction](https://www.npmjs.com/package/coaction).
You rarely call Coaction directly — modules and adapters sit on top — but
understanding the store helps when you reach for `watch`, strict actions, or
patches.

## One store, many slices

Every stateful module contributes a **slice** to a single app-level Coaction
store, keyed by the module's `name`:

```ts
const app = createApp({ providers: [Counter, Todos] });

app.store.getPureState();
// { counter: { count: 0 }, todos: { items: [] } }
```

One store (not one per module) is a deliberate choice: app-level patches,
persistence, devtools, and selectors all operate over the whole application at
once. User modules stay plain classes; CoSystem generates the Coaction-compatible
state/action layer internally.

## Accessing state

Three layers, from most to least common:

1. **Through the module facade** — normal property access:

   ```ts
   app.getModule(Counter).count;
   ```

2. **Through a UI adapter selector** — reactive in components (see
   [UI Adapters](./ui-adapters.md)):

   ```ts
   const count = useSelector(Counter, (m) => m.count); // React
   ```

3. **Through the store** — for advanced/tooling cases:

   ```ts
   app.store.getPureState(); // full plain snapshot
   app.store.setState(next); // imperative write (used by plugins)
   app.store.subscribe(() => {}); // low-level change subscription
   ```

Adapters use the stable reactive runtime contract, not private store internals.
Prefer `app.getModule()` and selectors in application code; reserve `app.store`
for plugins and tooling.

## Watching state

`app.watch(read, listener, options?)` subscribes to a derived value. The
`listener` fires when the value changes (by `equals`, default `Object.is`):

```ts
const stop = app.watch(
  () => app.getModule(Counter).count,
  (value, previous) => console.log(`count: ${previous} → ${value}`),
  {
    equals: Object.is, // custom equality to control firing
    immediate: false, // call the listener once up front when true
  },
);

stop(); // unsubscribe
```

`watch` is the primitive every UI adapter builds on — React's `useSelector`,
Vue's `useSelector`, Svelte's `selectorStore`, Solid's `useComputed`, and
Angular's `injectSignal` all wrap it with the framework's native reactivity.

## Actions and transactions

A method declared as an action wraps its synchronous state writes in a single
transaction: multiple writes produce one patch and one notification.

```ts
class Cart {
  items: Item[] = [];
  total = 0;

  addItem(item: Item): void {
    this.items.push(item);
    this.total += item.price; // one transaction, one update
  }
}
```

Each action also emits an `ActionEvent` (`{ module, method, args, startedAt,
endedAt?, error? }`) to plugins — that's how the logger and devtools see them.

## Strict actions and `runInAction`

By default, writing state outside an action is allowed. Enable **strict actions**
to require that every state write happens inside an action boundary — a guardrail
that keeps all mutations auditable:

```ts
const app = createApp({
  providers: [Counter],
  devOptions: { strictActions: true },
});
```

With strict actions on, a write outside an action throws.

Async actions need care. Synchronous writes **before the first `await`** are part
of the action's transaction. Writes **after an `await`** are no longer inside the
original boundary, so in strict mode they need a fresh one. Use `runInAction`:

```ts
import { runInAction } from "@cosystem/core";

class Counter {
  @state accessor count = 0;

  @action async refresh(): Promise<void> {
    this.count = -1; // in the transaction (pre-await)
    const next = await loadCount();

    runInAction(this, () => {
      this.count = next; // post-await: needs its own boundary
    });
  }
}
```

`runInAction` accepts the module instance (or a token/instance) plus a callback,
and an optional `{ name, args }` for nicer action events:

```ts
app.runInAction(
  Counter,
  () => {
    app.getModule(Counter).count = 0;
  },
  { name: "reset" },
);
```

Async actions may return promises; their settlement is reported to plugins.

## Patches

Enable patch generation to receive structured diffs of each change:

```ts
const app = createApp({ providers: [Counter], engine: { patches: true } });
```

With patches on, plugins receive `PatchEvent` (`{ patches, inversePatches }`) via
`onPatch`. Patches power:

- **The worker runtime's `sync: "patch"` mode** — sending diffs instead of full
  snapshots after startup (see [Worker & Shared Runtime](./worker-runtime.md)).
- **Devtools** time-travel-style inspection (see [Plugins](./plugins.md)).

The store also tracks a monotonic `app.state.version` that increments on every
change — handy as a coarse "something changed" signal.

## State change events

Independently of patches, every store change emits a `StateChangeEvent`
(`{ state }`) to plugins via `onStateChange`. The
[storage plugin](../packages/storage/README.md) uses this to persist state; the
[devtools plugin](../packages/devtools/README.md) records it on the timeline.

## Next

- [Plugins](./plugins.md) — observe actions, patches, and state changes.
- [Worker & Shared Runtime](./worker-runtime.md) — sync state across threads/tabs.
- [Testing](./testing.md) — assert on recorded actions, state, and patches.
