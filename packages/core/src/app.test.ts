import { describe, expect, it } from "vitest";

import { CosystemError, createApp, defineModule, provide, testApp, type Plugin } from "./index.js";

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

describe("app runtime", () => {
  it("binds no-decorator modules to the Coaction-backed app store", () => {
    const logger = new MemoryLogger();
    const app = createApp({
      providers: [Counter, provide(Logger, { useValue: logger })],
    });
    const counter = app.getModule(Counter);
    const values: number[] = [];
    const unwatch = app.watch(
      () => counter.double,
      (value) => values.push(value),
    );

    expect(counter.count).toBe(0);
    expect(counter.double).toBe(0);
    expect(app.store.getPureState()).toEqual({ counter: { count: 0 } });

    counter.increase(2);

    expect(counter.count).toBe(2);
    expect(counter.double).toBe(4);
    expect(logger.messages).toEqual(["count:2"]);
    expect(app.store.getPureState()).toEqual({ counter: { count: 2 } });
    expect(values).toEqual([4]);

    unwatch();
  });

  it("enforces strict action writes when enabled", () => {
    const app = testApp({
      providers: [Counter, provide(Logger, { useValue: new MemoryLogger() })],
      strictActions: true,
    });
    const counter = app.getModule(Counter);

    expect(() => {
      counter.count = 10;
    }).toThrow(CosystemError);

    counter.increase();

    expect(counter.count).toBe(1);
  });

  it("records actions and state snapshots through testApp", () => {
    const originalLogger = new MemoryLogger();
    const overrideLogger = new MemoryLogger();
    const app = testApp({
      overrides: [provide(Logger, { useValue: overrideLogger })],
      providers: [Counter, provide(Logger, { useValue: originalLogger })],
    });
    const counter = app.getModule(Counter);

    counter.increase(5);

    expect(originalLogger.messages).toEqual([]);
    expect(overrideLogger.messages).toEqual(["count:5"]);
    expect(app.test.getActions()).toMatchObject([
      {
        method: "increase",
        module: "counter",
      },
    ]);
    expect(app.test.getState()).toEqual({ counter: { count: 5 } });
  });

  it("runs plugin and module lifecycle hooks", async () => {
    const events: string[] = [];

    class LifecycleModule {
      onInit(): void {
        events.push("module:init");
      }

      onStart(): void {
        events.push("module:start");
      }

      onStop(): void {
        events.push("module:stop");
      }

      onDispose(): void {
        events.push("module:dispose");
      }
    }

    defineModule(LifecycleModule, {
      name: "lifecycle",
    });

    const plugin: Plugin = {
      dispose() {
        events.push("plugin:dispose");
      },
      onModuleCreated(event) {
        events.push(`created:${event.name}`);
      },
      setup() {
        events.push("plugin:setup");
      },
    };

    const app = createApp({
      plugins: [plugin],
      providers: [LifecycleModule],
    });

    await app.start();
    await app.dispose();

    expect(events).toEqual([
      "created:lifecycle",
      "plugin:setup",
      "module:init",
      "module:start",
      "module:stop",
      "module:dispose",
      "plugin:dispose",
    ]);
  });

  it("returns a started app when testApp autoStart is enabled", async () => {
    const events: string[] = [];

    class AutoStartModule {
      onStart(): void {
        events.push("start");
      }
    }

    defineModule(AutoStartModule, {
      name: "autoStart",
    });

    const app = await testApp({
      autoStart: true,
      providers: [AutoStartModule],
    });

    expect(app.started).toBe(true);
    expect(events).toEqual(["start"]);
  });
});
