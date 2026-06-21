import { describe, expect, it } from "vitest";

import {
  AsyncProviderInSyncResolutionError,
  CosystemError,
  createApp,
  defineModule,
  inject,
  provide,
  testApp,
  token,
  type Plugin,
} from "./index.js";

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

class FailingAction {
  fail(): void {
    throw new Error("boom");
  }
}

defineModule(FailingAction, {
  actions: ["fail"],
  name: "failingAction",
});

class MetadataLogger extends MemoryLogger {}

class ProviderLogger extends MemoryLogger {}

class ProviderOverrideCounter {
  constructor(readonly logger: MemoryLogger) {}
}

defineModule(ProviderOverrideCounter, {
  deps: [MetadataLogger],
  name: "providerOverrideCounter",
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

  it("rejects overrides that add a new module after provider discovery", () => {
    class OverrideOnlyModule {
      readonly value = "override";
    }

    defineModule(OverrideOnlyModule, {
      name: "overrideOnly",
      state: ["value"],
    });

    expect(() =>
      testApp({
        overrides: [OverrideOnlyModule],
        providers: [],
      }),
    ).toThrow(/Cannot add OverrideOnlyModule as a new CoSystem module through overrides/);
  });

  it("allows overrides to replace an already discovered module token", () => {
    class OriginalModule {
      value = "original";
    }

    defineModule(OriginalModule, {
      name: "originalModule",
      state: ["value"],
    });

    class ReplacementModule extends OriginalModule {
      override value = "replacement";
    }

    defineModule(ReplacementModule, {
      name: "replacementModule",
      state: ["value"],
    });

    const app = testApp({
      overrides: [
        provide(OriginalModule, {
          useClass: ReplacementModule,
        }),
      ],
      providers: [OriginalModule],
    });

    expect(app.getModule(OriginalModule)).toBeInstanceOf(ReplacementModule);
    expect(app.getModule(OriginalModule).value).toBe("replacement");
    expect(app.store.getPureState()).toEqual({
      replacementModule: {
        value: "replacement",
      },
    });
  });

  it("records Coaction patches through testApp when patches are enabled", () => {
    const app = testApp({
      engine: {
        patches: true,
      },
      providers: [Counter, provide(Logger, { useValue: new MemoryLogger() })],
    });
    const counter = app.getModule(Counter);

    counter.increase(3);

    expect(app.test.getPatches()).toHaveLength(1);
    expect(app.test.getState()).toEqual({ counter: { count: 3 } });
  });

  it("reflects applied Coaction patches through module state accessors", () => {
    const app = createApp({
      providers: [Counter, provide(Logger, { useValue: new MemoryLogger() })],
    });
    const counter = app.getModule(Counter);

    app.store.apply(app.store.getPureState(), [
      {
        op: "replace",
        path: ["counter", "count"],
        value: 7,
      },
    ] as never);

    expect(counter.count).toBe(7);
    expect(counter.double).toBe(14);
  });

  it("caches computed values until their state dependencies change", () => {
    let calls = 0;

    class CachedCounter {
      count = 1;

      get double(): number {
        calls += 1;
        return this.count * 2;
      }

      increase(): void {
        this.count += 1;
      }
    }

    defineModule(CachedCounter, {
      actions: ["increase"],
      computed: ["double"],
      name: "cachedCounter",
      state: ["count"],
    });

    const app = createApp({
      providers: [CachedCounter],
    });
    const counter = app.getModule(CachedCounter);

    expect(counter.double).toBe(2);
    expect(counter.double).toBe(2);
    expect(calls).toBe(1);

    counter.increase();

    expect(counter.double).toBe(4);
    expect(counter.double).toBe(4);
    expect(calls).toBe(2);
  });

  it("reads fresh computed values from the active action draft", () => {
    class DraftComputedCounter {
      count = 1;

      get double(): number {
        return this.count * 2;
      }

      increaseAndRead(): number {
        this.count += 1;
        return this.double;
      }
    }

    defineModule(DraftComputedCounter, {
      actions: ["increaseAndRead"],
      computed: ["double"],
      name: "draftComputedCounter",
      state: ["count"],
    });

    const app = createApp({
      providers: [DraftComputedCounter],
    });
    const counter = app.getModule(DraftComputedCounter);

    expect(counter.double).toBe(2);
    expect(counter.increaseAndRead()).toBe(4);
    expect(counter.double).toBe(4);
  });

  it("lets provider-level deps override defineModule metadata", () => {
    const app = createApp({
      providers: [
        MetadataLogger,
        ProviderLogger,
        provide(ProviderOverrideCounter, {
          deps: [ProviderLogger],
          useClass: ProviderOverrideCounter,
        }),
      ],
    });

    expect(app.getModule(ProviderOverrideCounter).logger).toBeInstanceOf(ProviderLogger);
  });

  it("keeps non-module class and factory providers lazy by default", () => {
    const ServiceToken = token<{ readonly value: string }>("LazyService");
    const events: string[] = [];

    class LazyService {
      readonly value = "class";

      constructor() {
        events.push("class");
      }
    }

    const app = createApp({
      providers: [
        LazyService,
        provide(ServiceToken, {
          useFactory: () => {
            events.push("factory");
            return { value: "factory" };
          },
        }),
      ],
    });

    expect(events).toEqual([]);
    expect(app.get(LazyService).value).toBe("class");
    expect(app.get(ServiceToken).value).toBe("factory");
    expect(events).toEqual(["class", "factory"]);
  });

  it("eagerly instantiates explicit eager providers after module binding", () => {
    const events: string[] = [];

    class EagerCounter {
      count = 1;
    }

    defineModule(EagerCounter, {
      name: "eagerCounter",
      state: ["count"],
    });

    class EagerReader {
      static readonly inject = [EagerCounter] as const;

      constructor(counter: EagerCounter) {
        events.push(`count:${counter.count}`);
        counter.count = 3;
      }
    }

    const app = createApp({
      providers: [
        EagerCounter,
        provide(EagerReader, {
          eager: true,
          useClass: EagerReader,
        }),
      ],
    });

    expect(events).toEqual(["count:1"]);
    expect(app.getModule(EagerCounter).count).toBe(3);
    expect(app.store.getPureState()).toEqual({
      eagerCounter: {
        count: 3,
      },
    });
  });

  it("instantiates eager multi provider groups", () => {
    const PluginToken = token<{ readonly name: string }>("Plugin");
    const events: string[] = [];

    const app = createApp({
      providers: [
        provide(PluginToken, {
          eager: true,
          multi: true,
          useFactory: () => {
            events.push("first");
            return { name: "first" };
          },
        }),
        provide(PluginToken, {
          multi: true,
          useFactory: () => {
            events.push("second");
            return { name: "second" };
          },
        }),
      ],
    });

    expect(events).toEqual(["first", "second"]);
    expect(app.getAll(PluginToken).map((plugin) => plugin.name)).toEqual(["first", "second"]);
  });

  it("fails fast when an eager factory is async in sync app creation", () => {
    const AsyncToken = token<string>("Async");

    expect(() =>
      createApp({
        providers: [
          provide(AsyncToken, {
            eager: true,
            useFactory: async () => "ready",
          }),
        ],
      }),
    ).toThrow(AsyncProviderInSyncResolutionError);
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

  it("emits plugin error hooks when an action fails", () => {
    const errors: string[] = [];
    const app = createApp({
      plugins: [
        {
          onError(error, context) {
            errors.push(`${context.phase}:${error instanceof Error ? error.message : error}`);
          },
        },
      ],
      providers: [FailingAction],
    });

    expect(() => app.getModule(FailingAction).fail()).toThrow("boom");
    expect(errors).toEqual(["action:boom"]);
  });

  it("supports inject() inside plugin setup and module lifecycle hooks", async () => {
    class InjectingLifecycle {
      onInit(): void {
        inject(Logger).info("module:init");
      }

      onStart(): void {
        inject(Logger).info("module:start");
      }
    }

    defineModule(InjectingLifecycle, {
      name: "injectingLifecycle",
    });

    const logger = new MemoryLogger();
    const app = createApp({
      plugins: [
        {
          setup() {
            inject(Logger).info("plugin:setup");
          },
        },
      ],
      providers: [InjectingLifecycle, provide(Logger, { useValue: logger })],
    });

    await app.start();

    expect(logger.messages).toEqual(["plugin:setup", "module:init", "module:start"]);
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

  it("accepts engine options while preserving app runtime behavior", () => {
    const app = createApp({
      engine: {
        patches: true,
      },
      providers: [Counter, provide(Logger, { useValue: new MemoryLogger() })],
    });
    const counter = app.getModule(Counter);

    counter.increase(1);

    expect(counter.count).toBe(1);
    expect(app.store.getPureState()).toEqual({
      counter: {
        count: 1,
      },
    });
  });

  it("keeps the root container private while allowing parent app resolution", () => {
    const logger = new MemoryLogger();
    const parent = createApp({
      providers: [provide(Logger, { useValue: logger })],
    });
    const child = createApp({
      parent,
      providers: [Counter],
    });

    expect("container" in parent).toBe(false);

    child.getModule(Counter).increase();

    expect(logger.messages).toEqual(["count:1"]);
  });
});
