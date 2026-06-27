import { describe, expect, it } from "vitest";

import {
  AsyncProviderInSyncResolutionError,
  Action,
  Computed,
  CosystemError,
  createApp,
  defineModule,
  Effect,
  inject,
  lazyModule,
  Module,
  provide,
  runInAction,
  State,
  testApp,
  token,
  type Plugin,
  type PluginContext,
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

class LazyCounter {
  count = 1;

  get double(): number {
    return this.count * 2;
  }

  increase(): void {
    this.count += 1;
  }
}

defineModule(LazyCounter, {
  actions: ["increase"],
  computed: ["double"],
  name: "lazyCounter",
  state: ["count"],
});

describe("app runtime", () => {
  it("binds standard decorator metadata to the app runtime", async () => {
    const metadata: Record<PropertyKey, unknown> = {};

    class DecoratedRuntimeCounter {
      count = 0;

      constructor(readonly logger: Logger) {}

      get double(): number {
        return this.count * 2;
      }

      increase(step = 1): void {
        this.count += step;
        this.logger.info(String(this.count));
      }

      recordCount(): void {
        this.logger.info(`effect:${this.count}`);
      }
    }

    State(
      undefined as never,
      {
        addInitializer() {},
        kind: "accessor",
        metadata,
        name: "count",
        private: false,
        static: false,
      } as unknown as ClassAccessorDecoratorContext<DecoratedRuntimeCounter, number>,
    );
    Computed(
      Object.getOwnPropertyDescriptor(DecoratedRuntimeCounter.prototype, "double")?.get as never,
      {
        addInitializer() {},
        kind: "getter",
        metadata,
        name: "double",
        private: false,
        static: false,
      } as unknown as ClassGetterDecoratorContext<DecoratedRuntimeCounter, number>,
    );
    Action(DecoratedRuntimeCounter.prototype.increase, {
      addInitializer() {},
      kind: "method",
      metadata,
      name: "increase",
      private: false,
      static: false,
    } as unknown as ClassMethodDecoratorContext<
      DecoratedRuntimeCounter,
      DecoratedRuntimeCounter["increase"]
    >);
    Effect(DecoratedRuntimeCounter.prototype.recordCount, {
      addInitializer() {},
      kind: "method",
      metadata,
      name: "recordCount",
      private: false,
      static: false,
    } as unknown as ClassMethodDecoratorContext<
      DecoratedRuntimeCounter,
      DecoratedRuntimeCounter["recordCount"]
    >);
    Module({
      deps: [Logger],
      name: "decoratedRuntimeCounter",
    })(DecoratedRuntimeCounter, {
      addInitializer() {},
      kind: "class",
      metadata,
      name: "DecoratedRuntimeCounter",
    } as ClassDecoratorContext<typeof DecoratedRuntimeCounter>);

    const logger = new MemoryLogger();
    const app = testApp({
      providers: [DecoratedRuntimeCounter, provide(Logger, { useValue: logger })],
    });
    const counter = app.getModule(DecoratedRuntimeCounter);

    await app.test.flushEffects();

    expect(counter.count).toBe(0);
    expect(counter.double).toBe(0);
    expect(logger.messages).toEqual(["effect:0"]);

    counter.increase(2);
    await app.test.flushEffects();

    expect(counter.count).toBe(2);
    expect(counter.double).toBe(4);
    expect(app.store.getPureState()).toEqual({ decoratedRuntimeCounter: { count: 2 } });
    expect(logger.messages).toEqual(["effect:0", "2", "effect:2"]);
  });

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

  it("loads lazy modules into the app runtime through an explicit child scope", async () => {
    const created: string[] = [];
    const app = createApp({
      plugins: [
        {
          onModuleCreated(event) {
            created.push(event.name);
          },
        },
      ],
    });
    const feature = lazyModule(() => ({
      providers: [LazyCounter],
    }));

    expect(() => app.getModule(LazyCounter)).toThrow(CosystemError);

    const result = await app.load(feature);
    const counter = app.getModule(LazyCounter);
    const values: number[] = [];
    const unwatch = app.watch(
      () => counter.double,
      (value) => values.push(value),
    );

    expect(result.modules.map((module) => module.name)).toEqual(["lazyCounter"]);
    expect(result.scope.container.get(LazyCounter)).toBe(counter);
    expect(created).toEqual(["lazyCounter"]);
    expect(app.store.getPureState()).toEqual({ lazyCounter: { count: 1 } });
    expect(counter.double).toBe(2);

    counter.increase();

    expect(counter.count).toBe(2);
    expect(counter.double).toBe(4);
    expect(app.store.getPureState()).toEqual({ lazyCounter: { count: 2 } });
    expect(values).toEqual([4]);

    unwatch();
  });

  it("loads lazy modules registered in initial providers when load is called without args", async () => {
    const app = createApp({
      providers: [
        lazyModule(async () => ({
          default: [LazyCounter],
        })),
      ],
    });

    const results = await app.load();

    expect(results).toHaveLength(1);
    expect(app.getModule(LazyCounter).count).toBe(1);
  });

  it("runs lazy module lifecycle hooks when loaded after app start", async () => {
    const events: string[] = [];

    class LazyLifecycle {
      count = 0;

      onInit(): void {
        events.push("init");
      }

      onStart(): void {
        events.push("start");
      }

      onStop(): void {
        events.push("stop");
      }

      onDispose(): void {
        events.push("dispose");
      }
    }

    defineModule(LazyLifecycle, {
      name: "lazyLifecycle",
      state: ["count"],
    });

    const app = createApp();
    await app.start();

    await app.load(lazyModule(() => LazyLifecycle));

    expect(events).toEqual(["init", "start"]);

    await app.dispose();

    expect(events).toEqual(["init", "start", "stop", "dispose"]);
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

  it("records async actions after their returned promises resolve", async () => {
    class AsyncActionCounter {
      count = 0;

      async increaseLater(step = 1): Promise<number> {
        this.count += step;
        await Promise.resolve();
        return this.count;
      }
    }

    defineModule(AsyncActionCounter, {
      actions: ["increaseLater"],
      name: "asyncActionCounter",
      state: ["count"],
    });

    const app = testApp({
      providers: [AsyncActionCounter],
    });
    const counter = app.getModule(AsyncActionCounter);
    const result = counter.increaseLater(2);

    expect(app.test.getActions()).toEqual([]);

    await expect(result).resolves.toBe(2);

    expect(app.test.getActions()).toMatchObject([
      {
        args: [2],
        method: "increaseLater",
        module: "asyncActionCounter",
      },
    ]);
  });

  it("records rejected async actions with their rejection error", async () => {
    const errors: string[] = [];

    class AsyncFailingAction {
      async fail(): Promise<void> {
        await Promise.resolve();
        throw new Error("async boom");
      }
    }

    defineModule(AsyncFailingAction, {
      actions: ["fail"],
      name: "asyncFailingAction",
    });

    const app = testApp({
      plugins: [
        {
          onError(error, context) {
            errors.push(`${context.phase}:${error instanceof Error ? error.message : error}`);
          },
        },
      ],
      providers: [AsyncFailingAction],
    });

    await expect(app.getModule(AsyncFailingAction).fail()).rejects.toThrow("async boom");

    expect(errors).toEqual(["action:async boom"]);
    expect(app.test.getActions()).toMatchObject([
      {
        error: expect.any(Error),
        method: "fail",
        module: "asyncFailingAction",
      },
    ]);
  });

  it("treats post-await state writes as outside the original action transaction", async () => {
    class PostAwaitWriter {
      count = 0;

      async writeLater(): Promise<void> {
        await Promise.resolve();
        this.count = 1;
      }
    }

    defineModule(PostAwaitWriter, {
      actions: ["writeLater"],
      name: "postAwaitWriter",
      state: ["count"],
    });

    const app = testApp({
      providers: [PostAwaitWriter],
      strictActions: true,
    });
    const writer = app.getModule(PostAwaitWriter);

    await expect(writer.writeLater()).rejects.toThrow(CosystemError);

    expect(writer.count).toBe(0);
    expect(app.test.getActions()).toMatchObject([
      {
        error: expect.any(CosystemError),
        method: "writeLater",
        module: "postAwaitWriter",
      },
    ]);
  });

  it("allows post-await state writes through an explicit action boundary", async () => {
    class PostAwaitCommitter {
      count = 0;

      async writeLater(): Promise<number> {
        await Promise.resolve();

        return runInAction(
          this,
          () => {
            this.count = 1;
            return this.count;
          },
          {
            name: "writeLater.commit",
          },
        );
      }
    }

    defineModule(PostAwaitCommitter, {
      actions: ["writeLater"],
      name: "postAwaitCommitter",
      state: ["count"],
    });

    const app = testApp({
      providers: [PostAwaitCommitter],
      strictActions: true,
    });
    const writer = app.getModule(PostAwaitCommitter);

    await expect(writer.writeLater()).resolves.toBe(1);

    expect(writer.count).toBe(1);
    expect(app.store.getPureState()).toEqual({
      postAwaitCommitter: {
        count: 1,
      },
    });
    expect(app.test.getActions()).toMatchObject([
      {
        method: "writeLater.commit",
        module: "postAwaitCommitter",
      },
      {
        method: "writeLater",
        module: "postAwaitCommitter",
      },
    ]);
  });

  it("runs explicit app action boundaries by module token, name, or instance", () => {
    const app = testApp({
      providers: [Counter, provide(Logger, { useValue: new MemoryLogger() })],
      strictActions: true,
    });
    const counter = app.getModule(Counter);

    app.runInAction(
      Counter,
      () => {
        counter.count = 2;
      },
      { name: "setByToken" },
    );
    app.runInAction(
      "counter",
      () => {
        counter.count = 3;
      },
      { name: "setByName" },
    );
    app.runInAction(
      counter,
      () => {
        counter.count = 4;
      },
      { name: "setByInstance" },
    );

    expect(counter.count).toBe(4);
    expect(app.test.getActions()).toMatchObject([
      { method: "setByToken", module: "counter" },
      { method: "setByName", module: "counter" },
      { method: "setByInstance", module: "counter" },
    ]);
  });

  it("rejects explicit action boundaries for non-module instances and other apps", () => {
    const first = createApp({
      providers: [Counter, provide(Logger, { useValue: new MemoryLogger() })],
    });
    const second = createApp({
      providers: [Counter, provide(Logger, { useValue: new MemoryLogger() })],
    });
    const counter = first.getModule(Counter);

    expect(() => runInAction({}, () => undefined)).toThrow(CosystemError);
    expect(() => second.runInAction(counter, () => undefined)).toThrow(
      "target belongs to another CoSystem app",
    );
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

  it("runs module effects and reruns them when tracked state changes", async () => {
    const events: string[] = [];

    class EffectCounter {
      count = 0;

      record(): void {
        events.push(`count:${this.count}`);
      }

      increase(): void {
        this.count += 1;
      }
    }

    defineModule(EffectCounter, {
      actions: ["increase"],
      effects: ["record"],
      name: "effectCounter",
      state: ["count"],
    });

    const app = testApp({
      providers: [EffectCounter],
    });
    const counter = app.getModule(EffectCounter);

    await app.test.flushEffects();

    expect(events).toEqual(["count:0"]);

    counter.increase();
    await app.test.flushEffects();

    expect(events).toEqual(["count:0", "count:1"]);
  });

  it("waits for async module effects through testApp flushEffects", async () => {
    const events: string[] = [];

    class AsyncEffectCounter {
      count = 0;

      async record(): Promise<void> {
        const count = this.count;
        await Promise.resolve();
        events.push(`async:${count}`);
      }

      increase(): void {
        this.count += 1;
      }
    }

    defineModule(AsyncEffectCounter, {
      actions: ["increase"],
      effects: ["record"],
      name: "asyncEffectCounter",
      state: ["count"],
    });

    const app = testApp({
      providers: [AsyncEffectCounter],
    });
    const counter = app.getModule(AsyncEffectCounter);

    await app.test.flushEffects();

    expect(events).toEqual(["async:0"]);

    counter.increase();
    await app.test.flushEffects();

    expect(events).toEqual(["async:0", "async:1"]);
  });

  it("disposes module effect subscriptions with the app", async () => {
    const events: string[] = [];

    class DisposableEffectCounter {
      count = 0;

      record(): void {
        events.push(`count:${this.count}`);
      }

      increase(): void {
        this.count += 1;
      }
    }

    defineModule(DisposableEffectCounter, {
      actions: ["increase"],
      effects: ["record"],
      name: "disposableEffectCounter",
      state: ["count"],
    });

    const app = testApp({
      providers: [DisposableEffectCounter],
    });
    const counter = app.getModule(DisposableEffectCounter);

    await app.test.flushEffects();
    await app.dispose();

    counter.increase();
    await app.test.flushEffects();

    expect(events).toEqual(["count:0"]);
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

  it("returns the bound module facade from app get APIs even when module scope is not singleton", async () => {
    class TransientScopedCounter {
      count = 0;

      increase(): void {
        this.count += 1;
      }
    }

    defineModule(TransientScopedCounter, {
      actions: ["increase"],
      name: "transientScopedCounter",
      scope: "transient",
      state: ["count"],
    });

    const app = createApp({
      providers: [TransientScopedCounter],
    });
    const module = app.getModule(TransientScopedCounter);

    module.increase();

    expect(app.get(TransientScopedCounter)).toBe(module);
    await expect(app.getAsync(TransientScopedCounter)).resolves.toBe(module);
    expect(app.get(TransientScopedCounter).count).toBe(1);
    expect(app.store.getPureState()).toEqual({
      transientScopedCounter: {
        count: 1,
      },
    });
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

  it("passes plugin context and disposes plugin resources", async () => {
    const events: string[] = [];
    let capturedContext: PluginContext | undefined;

    const app = createApp({
      plugins: [
        {
          name: "watcher",
          setup(app, context) {
            capturedContext = context;
            events.push(`${context.name}:${context.app === app}:${context.signal.aborted}`);
            context.onDispose(() => {
              events.push(`dispose:${context.signal.aborted}`);
            });
            context.watch(
              () => app.getModule(Counter).count,
              (value, previous) => {
                events.push(`watch:${previous}->${value}`);
              },
              { immediate: true },
            );
          },
        },
      ],
      providers: [Counter, provide(Logger, { useValue: new MemoryLogger() })],
    });

    await app.start();
    app.getModule(Counter).increase();
    await app.dispose();

    expect(capturedContext?.app).toBe(app);
    expect(capturedContext?.signal.aborted).toBe(true);
    expect(events).toEqual(["watcher:true:false", "watch:0->0", "watch:0->1", "dispose:true"]);
  });

  it("reports plugin observer errors without interrupting actions", () => {
    const errors: string[] = [];
    const app = createApp({
      plugins: [
        {
          name: "broken",
          onActionStart() {
            throw new Error("plugin boom");
          },
        },
        {
          onError(error, context) {
            errors.push(`${context.phase}:${error instanceof Error ? error.message : error}`);
          },
        },
      ],
      providers: [Counter, provide(Logger, { useValue: new MemoryLogger() })],
    });

    expect(() => app.getModule(Counter).increase()).not.toThrow();
    expect(app.getModule(Counter).count).toBe(1);
    expect(errors).toEqual(["plugin:broken.onActionStart:plugin boom"]);
  });

  it("does not recurse when plugin error hooks throw", () => {
    const app = createApp({
      plugins: [
        {
          name: "broken-observer",
          onActionEnd() {
            throw new Error("observer boom");
          },
        },
        {
          name: "broken-error",
          onError() {
            throw new Error("error boom");
          },
        },
      ],
      providers: [Counter, provide(Logger, { useValue: new MemoryLogger() })],
    });

    expect(() => app.getModule(Counter).increase()).not.toThrow();
    expect(app.getModule(Counter).count).toBe(1);
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
