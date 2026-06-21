# Testing

```ts
import { afterEach, expect, it } from "vitest";
import { defineModule, provide, testApp, type TestApp } from "@cosystem/core";

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

  record(): void {
    this.logger.info(`effect:${this.count}`);
  }
}

defineModule(Counter, {
  actions: ["increase"],
  deps: [Logger],
  effects: ["record"],
  name: "counter",
  state: ["count"],
});

let app: TestApp | undefined;

afterEach(async () => {
  await app?.dispose();
  app = undefined;
});

it("tests modules without a UI framework", async () => {
  const logger = new MemoryLogger();
  app = testApp({
    providers: [Counter, provide(Logger, { useValue: console })],
    overrides: [provide(Logger, { useValue: logger })],
    strictActions: true,
  });

  const counter = app.getModule(Counter);

  await app.test.flushEffects();
  counter.increase(2);

  expect(counter.count).toBe(2);
  expect(logger.messages).toEqual(["effect:0", "count:2"]);
  expect(app.test.getActions()).toMatchObject([
    {
      method: "increase",
      module: "counter",
    },
  ]);
  expect(app.test.getState()).toEqual({
    counter: {
      count: 2,
    },
  });
});
```
