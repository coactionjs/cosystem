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

  get double(): number {
    return this.count * 2;
  }

  increase(step = 1): void {
    this.count += step;
    this.logger.info(`count:${this.count}`);
  }
}

defineModule(Counter, {
  actions: ["increase"],
  computed: ["double"],
  deps: [Logger],
  name: "counter",
  state: ["count"],
});

let app: TestApp | undefined;

afterEach(async () => {
  await app?.dispose();
  app = undefined;
});

describe("testApp", () => {
  it("overrides providers and records action/state assertions", () => {
    const logger = new MemoryLogger();
    app = testApp({
      overrides: [provide(Logger, { useValue: logger })],
      providers: [Counter, provide(Logger, { useValue: console })],
      strictActions: true,
    });

    const counter = app.getModule(Counter);

    counter.increase(2);

    expect(counter.double).toBe(4);
    expect(logger.messages).toEqual(["count:2"]);
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
});
