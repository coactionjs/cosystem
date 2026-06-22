# Testing

CoSystem is designed to be tested without a UI. Modules are plain classes with
injected dependencies, and `testApp()` gives you provider overrides plus an
inspector for actions, state, and patches.

`testApp` is exported from both [`@cosystem/core`](../packages/core/README.md) and
the dedicated [`@cosystem/testing`](../packages/testing/README.md) facade —
importing from `@cosystem/testing` keeps test wiring separate from production
imports. The behavior is identical.

## `testApp(options)`

`testApp` extends `createApp` options and is overloaded:

- `testApp(options?)` → `TestApp` (synchronous).
- `testApp({ autoStart: true, ... })` → `Promise<TestApp>` (resolves after
  `start()`).

| Option          | Type              | Description                                    |
| --------------- | ----------------- | ---------------------------------------------- |
| `providers`     | `ProviderInput[]` | Same as `createApp`.                           |
| `plugins`       | `Plugin[]`        | Same as `createApp`.                           |
| `overrides`     | `ProviderInput[]` | Replace providers discovered from `providers`. |
| `autoStart`     | `boolean`         | Start the app and return a promise.            |
| `strictActions` | `boolean`         | Shortcut for `devOptions.strictActions`.       |

A `TestApp` is a normal `App` plus a non-enumerable `test` inspector.

## Overriding dependencies

`overrides` swaps a provider's implementation — perfect for injecting a fake or
spy. It can replace a provider discovered from `providers`, but it **cannot add a
brand-new `@Module`** after module discovery.

```ts
import { defineModule, provide } from "@cosystem/core";
import { testApp } from "@cosystem/testing";

abstract class Logger {
  abstract info(message: string): void;
}
class MemoryLogger implements Logger {
  readonly messages: string[] = [];
  info(message: string): void {
    this.messages.push(message);
  }
}

class Counter {
  count = 0;
  constructor(readonly logger: Logger) {}
  increase(step = 1): void {
    this.count += step;
    this.logger.info(`count:${this.count}`);
  }
}
defineModule(Counter, { actions: ["increase"], deps: [Logger], name: "counter", state: ["count"] });

const logger = new MemoryLogger();
const app = testApp({
  providers: [Counter, provide(Logger, { useValue: console })],
  overrides: [provide(Logger, { useValue: logger })], // console → MemoryLogger
  strictActions: true,
});

app.getModule(Counter).increase(2);
expect(logger.messages).toEqual(["count:2"]);
```

## The inspector

`app.test` records what the app does:

```ts
interface TestAppInspector {
  getActions(): readonly ActionEvent[];
  getState(): unknown;
  getPatches(): readonly unknown[];
  clearActions(): void;
  clearPatches(): void;
  flushEffects(): Promise<void>;
}
```

Assert on recorded actions and the resulting state:

```ts
expect(app.test.getActions()).toMatchObject([{ method: "increase", module: "counter" }]);
expect(app.test.getState()).toEqual({ counter: { count: 2 } });
```

`getPatches()` requires `engine: { patches: true }`. `flushEffects()` resolves
once pending effects settle — call it before asserting on effect-driven state.

## Auto-starting

When a test needs `onStart` hooks or async startup (e.g. storage hydration), use
`autoStart` and await the returned promise:

```ts
const app = await testApp({ autoStart: true, providers: [Counter] });
expect(app.started).toBe(true);
```

## Clean up between tests

Dispose the app after each test so effects, plugins, and provider `dispose`
callbacks run and nothing leaks across tests:

```ts
import { afterEach } from "vitest";

let app: TestApp | undefined;

afterEach(async () => {
  await app?.dispose();
  app = undefined;
});
```

## Testing async actions

For actions that write state after an `await`, flush effects (and any pending
microtasks) before asserting, and remember that post-`await` writes need a
`runInAction` boundary in strict mode (see
[State & Reactivity](./state-and-reactivity.md#strict-actions-and-runinaction)).

```ts
await app.getModule(Counter).refresh();
await app.test.flushEffects();
expect(app.test.getState()).toEqual({ counter: { count: 42 } });
```

## Testing adapters

You can test framework integration with each framework's testing tools (e.g.
`@testing-library/react`), passing an app from `testApp()` to the adapter's
provider. The module logic itself, though, is best tested directly through
`testApp()` — it is faster and framework-free.

## Runnable example

See the [`testing`](../examples/testing) example, runnable with:

```sh
pnpm --filter @cosystem/example-testing test
```

## Next

- [`@cosystem/testing` reference](../packages/testing/README.md)
- [Dependency Injection](./dependency-injection.md) — overrides and scopes.
- [State & Reactivity](./state-and-reactivity.md) — actions, patches, strict mode.
