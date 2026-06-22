# @cosystem/testing

> Testing helper facade for [CoSystem](../../README.md). Re-exports `testApp`
> and its types from [`@cosystem/core`](../core) under a dedicated, intention-
> revealing import for test files.

Importing `testApp` from `@cosystem/testing` keeps test setup separate from
production imports. The behavior is identical to `@cosystem/core`'s `testApp`.

## Installation

```sh
pnpm add -D @cosystem/testing
```

## Usage

```ts
import { afterEach, describe, expect, it } from "vitest";
import { defineModule, provide } from "@cosystem/core";
import { testApp, type TestApp } from "@cosystem/testing";

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

defineModule(Counter, {
  actions: ["increase"],
  deps: [Logger],
  name: "counter",
  state: ["count"],
});

let app: TestApp | undefined;

afterEach(async () => {
  await app?.dispose();
  app = undefined;
});

describe("Counter", () => {
  it("records actions and overrides providers", () => {
    const logger = new MemoryLogger();
    app = testApp({
      providers: [Counter, provide(Logger, { useValue: console })],
      overrides: [provide(Logger, { useValue: logger })],
      strictActions: true,
    });

    app.getModule(Counter).increase(2);

    expect(logger.messages).toEqual(["count:2"]);
    expect(app.test.getActions()).toMatchObject([{ method: "increase", module: "counter" }]);
    expect(app.test.getState()).toEqual({ counter: { count: 2 } });
  });
});
```

## API

`testApp(options)` is overloaded:

- `testApp(options?)` → `TestApp` (synchronous).
- `testApp({ autoStart: true, ... })` → `Promise<TestApp>` (resolves after `start()`).

Options extend `createApp` options with:

| Option          | Type              | Description                                                                      |
| --------------- | ----------------- | -------------------------------------------------------------------------------- |
| `overrides`     | `ProviderInput[]` | Replace providers discovered from `providers`. Cannot add a brand-new `@Module`. |
| `autoStart`     | `boolean`         | Start the app and return a promise.                                              |
| `strictActions` | `boolean`         | Enforce action boundaries on all state writes.                                   |

The `app.test` inspector exposes `getActions()`, `getState()`, `getPatches()`,
`clearActions()`, `clearPatches()`, and `flushEffects()`.

## Exports

`testApp`, and the `TestApp`, `TestAppOptions`, `AutoStartedTestAppOptions`,
`ManualTestAppOptions` types.

## License

[MIT](../../LICENSE) © Coaction
