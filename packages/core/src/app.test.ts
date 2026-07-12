import { describe, expect, it } from "vitest";

import {
  AsyncProviderInSyncResolutionError,
  Action,
  Computed,
  CosystemError,
  DuplicateProviderError,
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
  type PatchEvent,
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

  it("notifies object-returning watch selectors once per store mutation", () => {
    const app = createApp({
      providers: [Counter, provide(Logger, { useValue: new MemoryLogger() })],
    });
    const counter = app.getModule(Counter);
    const values: number[] = [];
    const stop = app.watch(
      () => ({ count: counter.count }),
      (value) => {
        values.push(value.count);
      },
    );

    counter.increase();

    expect(values).toEqual([1]);
    stop();
  });

  it("isolates synchronous and asynchronous watch listener failures from actions", async () => {
    const errors: string[] = [];
    const app = createApp({
      plugins: [
        {
          onError(error, context) {
            errors.push(`${context.phase}:${error instanceof Error ? error.message : error}`);
          },
        },
      ],
      providers: [Counter, provide(Logger, { useValue: new MemoryLogger() })],
    });
    const counter = app.getModule(Counter);

    app.watch(
      () => counter.count,
      () => {
        throw new Error("sync watch boom");
      },
    );
    app.watch(
      () => counter.count,
      async () => {
        throw new Error("async watch boom");
      },
    );

    expect(() => counter.increase()).not.toThrow();
    expect(counter.count).toBe(1);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(errors).toEqual(["watch:sync watch boom", "watch:async watch boom"]);
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

  it("rejects non-singleton lazy modules before they become visible", async () => {
    class InvalidLazyScope {
      value = 1;
    }

    defineModule(InvalidLazyScope, {
      name: "invalidLazyScope",
      scope: "transient" as never,
      state: ["value"],
    });

    const app = createApp();

    await expect(app.load(lazyModule(() => InvalidLazyScope))).rejects.toThrow(
      "must use singleton scope; received transient",
    );
    expect(() => app.getModule(InvalidLazyScope)).toThrow(CosystemError);
    expect(app.store.getPureState()).toEqual({});
  });

  it("coalesces concurrent lazy loads and keeps modules hidden until initialization commits", async () => {
    const events: string[] = [];
    let loaderCalls = 0;
    let releaseInit!: () => void;
    const initGate = new Promise<void>((resolve) => {
      releaseInit = resolve;
    });

    class TransactionalLazyModule {
      count = 1;

      async onInit(): Promise<void> {
        events.push("init:start");
        await initGate;
        this.count = 2;
        events.push("init:done");
      }
    }

    defineModule(TransactionalLazyModule, {
      name: "transactionalLazyModule",
      state: ["count"],
    });

    const feature = lazyModule(async () => {
      loaderCalls += 1;
      return TransactionalLazyModule;
    });
    const app = createApp();
    const committedStates: unknown[] = [];
    const unsubscribe = app.store.subscribe(() => {
      committedStates.push(structuredClone(app.store.getPureState()));
    });
    const firstLoad = app.load(feature);
    const concurrentLoad = app.load(feature);

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(loaderCalls).toBe(1);
    expect(events).toEqual(["init:start"]);
    expect(() => app.getModule(TransactionalLazyModule)).toThrow(CosystemError);
    expect(app.store.getPureState()).toEqual({});

    releaseInit();

    const [firstResult, concurrentResult] = await Promise.all([firstLoad, concurrentLoad]);
    expect(concurrentResult).toBe(firstResult);
    expect(events).toEqual(["init:start", "init:done"]);
    expect(app.getModule(TransactionalLazyModule).count).toBe(2);
    expect(app.store.getPureState()).toEqual({ transactionalLazyModule: { count: 2 } });
    expect(committedStates).toEqual([{ transactionalLazyModule: { count: 2 } }]);
    unsubscribe();
  });

  it("keeps a committed lazy publication when a store subscriber throws", async () => {
    const errors: string[] = [];
    const snapshots: unknown[] = [];

    class SubscriberFailureLazyModule {
      value = "committed";
    }

    defineModule(SubscriberFailureLazyModule, {
      name: "subscriberFailureLazyModule",
      state: ["value"],
    });

    const app = createApp({
      plugins: [
        {
          onError(error, context) {
            errors.push(`${context.phase}:${error instanceof Error ? error.message : error}`);
          },
        },
      ],
    });
    await app.ready;
    const version = app.state.version;
    const unsubscribeFailing = app.store.subscribe(() => {
      throw new Error("subscriber boom");
    });
    const unsubscribeFollowing = app.store.subscribe(() => {
      snapshots.push(structuredClone(app.store.getPureState()));
    });

    await expect(app.load(lazyModule(() => SubscriberFailureLazyModule))).resolves.toBeDefined();

    unsubscribeFailing();
    unsubscribeFollowing();

    expect(app.getModule(SubscriberFailureLazyModule).value).toBe("committed");
    expect(app.store.getPureState()).toEqual({
      subscriberFailureLazyModule: { value: "committed" },
    });
    expect(app.state.version).toBe(version + 1);
    expect(snapshots).toEqual([
      {
        subscriberFailureLazyModule: { value: "committed" },
      },
    ]);
    expect(errors).toEqual(["store:subscribe:subscriber boom"]);
  });

  it("rolls back failed lazy initialization and allows a clean retry", async () => {
    const ResourceToken = token<{ readonly attempt: number }>("LazyRollbackResource");
    const events: string[] = [];
    let initAttempts = 0;
    let loaderCalls = 0;

    class RetriableLazyModule {
      value = "staged";

      onInit(): void {
        initAttempts += 1;
        events.push(`init:${initAttempts}`);

        if (initAttempts === 1) {
          throw new Error("lazy init boom");
        }
      }

      onDispose(): void {
        events.push(`module:dispose:${initAttempts}`);
      }
    }

    defineModule(RetriableLazyModule, {
      name: "retriableLazyModule",
      state: ["value"],
    });

    const feature = lazyModule(() => {
      loaderCalls += 1;
      const attempt = loaderCalls;

      return {
        providers: [
          RetriableLazyModule,
          provide(ResourceToken, {
            dispose(resource) {
              events.push(`resource:dispose:${resource.attempt}`);
            },
            eager: true,
            useFactory: () => ({ attempt }),
          }),
        ],
      };
    });
    const app = createApp();

    await expect(app.load(feature)).rejects.toThrow("lazy init boom");

    expect(() => app.getModule(RetriableLazyModule)).toThrow(CosystemError);
    expect(app.store.getPureState()).toEqual({});
    expect(events).toEqual(["init:1", "module:dispose:1", "resource:dispose:1"]);

    const result = await app.load(feature);

    expect(loaderCalls).toBe(2);
    expect(app.getModule(RetriableLazyModule).value).toBe("staged");
    expect(result.scope.container.get(ResourceToken)).toEqual({ attempt: 2 });
    expect(app.store.getPureState()).toEqual({
      retriableLazyModule: { value: "staged" },
    });
  });

  it("restores partially bound lazy instances after load failure", async () => {
    const events: string[] = [];
    const retainedInstances: PartiallyBoundLazyModule[] = [];

    class PartiallyBoundLazyModule {
      value = 1;

      constructor() {
        retainedInstances.push(this);
      }

      onDispose(): void {
        events.push(`dispose:${String(this.value)}`);
      }
    }

    defineModule(PartiallyBoundLazyModule, {
      actions: ["missingAction"],
      name: "partiallyBoundLazyModule",
      state: ["value"],
    });

    const app = createApp();

    await expect(app.load(lazyModule(() => PartiallyBoundLazyModule))).rejects.toThrow(
      "missingAction is not a method.",
    );

    const retained = retainedInstances[0];

    if (retained === undefined) {
      throw new Error("Expected the failed lazy module instance to be retained.");
    }

    expect(events).toEqual(["dispose:1"]);
    expect(retained.value).toBe(1);
    retained.value = 2;
    expect(retained.value).toBe(2);
    expect(app.store.getPureState()).toEqual({});
    await app.dispose();
  });

  it("rolls back lazy module maps, state, effects, and scope when an effect fails", async () => {
    const events: string[] = [];
    const patchEvents: unknown[] = [];
    const stateEvents: unknown[] = [];
    const storeSnapshots: unknown[] = [];
    const watchEvents: string[] = [];

    class BrokenLazyEffect {
      value = 1;

      get double(): number {
        return this.value * 2;
      }

      cleanup(): void {
        this.value += 1;
      }

      explode(): void {
        events.push("effect");
        throw new Error("lazy effect boom");
      }

      onDispose(): void {
        this.cleanup();
        events.push(`dispose:${String(this.double)}`);
      }
    }

    defineModule(BrokenLazyEffect, {
      actions: ["cleanup"],
      computed: ["double"],
      effects: ["explode"],
      name: "brokenLazyEffect",
      state: ["value"],
    });

    const app = createApp({
      plugins: [
        {
          onModuleCreated(event) {
            events.push(`created:${event.name}`);
          },
          onPatch(event) {
            patchEvents.push(event);
          },
          onStateChange(event) {
            stateEvents.push(structuredClone(event.state));
          },
        },
      ],
    });

    await app.ready;
    const version = app.state.version;
    const unsubscribe = app.store.subscribe(() => {
      storeSnapshots.push(structuredClone(app.store.getPureState()));
    });
    const unwatch = app.watch(
      () => Object.hasOwn(app.store.getPureState(), "brokenLazyEffect"),
      (value, previous) => {
        watchEvents.push(`${String(previous)}->${String(value)}`);
      },
    );

    await expect(app.load(lazyModule(() => BrokenLazyEffect))).rejects.toThrow("lazy effect boom");

    unsubscribe();
    unwatch();

    expect(events).toEqual(["effect", "dispose:4"]);
    expect(patchEvents).toEqual([]);
    expect(stateEvents).toEqual([]);
    expect(storeSnapshots).toEqual([]);
    expect(watchEvents).toEqual([]);
    expect(app.state.version).toBe(version);
    expect(() => app.getModule(BrokenLazyEffect)).toThrow(CosystemError);
    expect(app.store.getPureState()).toEqual({});
  });

  it("waits for staged async effects before disposing a failed lazy scope", async () => {
    const ResourceToken = token<{ disposed: boolean }>("PendingLazyEffectResource");
    const events: string[] = [];
    let markEffectStarted!: () => void;
    let releaseEffect!: () => void;
    const effectStarted = new Promise<void>((resolve) => {
      markEffectStarted = resolve;
    });
    const effectGate = new Promise<void>((resolve) => {
      releaseEffect = resolve;
    });

    class PendingLazyEffect {
      value = 0;

      constructor(readonly resource: { disposed: boolean }) {}

      async waitForRelease(): Promise<void> {
        events.push("effect:start");
        markEffectStarted();
        await effectGate;
        events.push(`effect:resume:${String(this.resource.disposed)}`);
      }

      fail(): void {
        events.push("effect:fail");
        throw new Error("lazy effect boom");
      }

      onDispose(): void {
        events.push("module:dispose");
      }
    }

    defineModule(PendingLazyEffect, {
      deps: [ResourceToken],
      effects: ["waitForRelease", "fail"],
      name: "pendingLazyEffect",
      state: ["value"],
    });

    const app = createApp();
    await app.ready;
    const feature = lazyModule(() => ({
      providers: [
        provide(ResourceToken, {
          dispose(resource) {
            resource.disposed = true;
            events.push("resource:dispose");
          },
          useFactory: () => {
            events.push("resource:create");
            return { disposed: false };
          },
        }),
        PendingLazyEffect,
      ],
    }));
    let loadSettled = false;
    const loadResult = app.load(feature).then(
      () => {
        loadSettled = true;
        return { status: "fulfilled" as const };
      },
      (error: unknown) => {
        loadSettled = true;
        return { error, status: "rejected" as const };
      },
    );

    await effectStarted;
    await Promise.resolve();

    expect(loadSettled).toBe(false);
    expect(events).toEqual(["resource:create", "effect:start", "effect:fail"]);

    releaseEffect();

    const result = await loadResult;
    expect(result).toMatchObject({
      error: { message: "lazy effect boom" },
      status: "rejected",
    });
    expect(events).toEqual([
      "resource:create",
      "effect:start",
      "effect:fail",
      "effect:resume:false",
      "module:dispose",
      "resource:dispose",
    ]);

    await app.dispose();
  });

  it("resolves lazy effect injection from the lazy scope", async () => {
    const EffectValue = token<string>("LazyEffectValue");
    const values: string[] = [];

    class ScopedLazyEffect {
      readValue(): void {
        values.push(inject(EffectValue));
      }
    }

    defineModule(ScopedLazyEffect, {
      effects: ["readValue"],
      name: "scopedLazyEffect",
    });

    const app = createApp({
      providers: [provide(EffectValue, { useValue: "root" })],
    });
    await app.ready;

    await app.load(
      lazyModule(() => ({
        providers: [provide(EffectValue, { useValue: "lazy" }), ScopedLazyEffect],
      })),
    );

    expect(values).toEqual(["lazy"]);
    await app.dispose();
  });

  it("rolls back initialized lazy modules when startup fails", async () => {
    const events: string[] = [];

    class FailingLazyStart {
      value = 1;

      onInit(): void {
        events.push("init");
      }

      onStart(): void {
        events.push("start");
        throw new Error("lazy start boom");
      }

      onStop(): void {
        events.push("stop");
      }

      onDispose(): void {
        events.push("dispose");
      }
    }

    defineModule(FailingLazyStart, {
      name: "failingLazyStart",
      state: ["value"],
    });

    const app = createApp();
    await app.start();

    await expect(app.load(lazyModule(() => FailingLazyStart))).rejects.toThrow("lazy start boom");

    expect(events).toEqual(["init", "start", "stop", "dispose"]);
    expect(() => app.getModule(FailingLazyStart)).toThrow(CosystemError);
    expect(app.store.getPureState()).toEqual({});
  });

  it("stops only lazy modules whose startup was attempted", async () => {
    const events: string[] = [];

    class FailingFirstStart {
      value = 0;

      onStart(): void {
        events.push("first:start");
        throw new Error("first start boom");
      }

      onStop(): void {
        events.push("first:stop");
      }

      onDispose(): void {
        events.push("first:dispose");
      }
    }

    class UnattemptedLaterStart {
      value = 0;

      onStart(): void {
        events.push("later:start");
      }

      onStop(): void {
        events.push("later:stop");
      }

      onDispose(): void {
        events.push("later:dispose");
      }
    }

    defineModule(FailingFirstStart, {
      name: "failingFirstStart",
      state: ["value"],
    });
    defineModule(UnattemptedLaterStart, {
      name: "unattemptedLaterStart",
      state: ["value"],
    });

    const app = createApp();
    await app.start();

    await expect(
      app.load(lazyModule(() => [FailingFirstStart, UnattemptedLaterStart])),
    ).rejects.toThrow("first start boom");

    expect(events).toEqual(["first:start", "first:stop", "later:dispose", "first:dispose"]);

    await app.dispose();
  });

  it("rolls back staged lazy startups before stopping", async () => {
    const events: string[] = [];
    let markStartEntered!: () => void;
    let releaseStart!: () => void;
    const startEntered = new Promise<void>((resolve) => {
      markStartEntered = resolve;
    });
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });

    class StagedLazyStart {
      async onStart(): Promise<void> {
        events.push("lazy:start");
        markStartEntered();
        await startGate;
      }

      onStop(): void {
        events.push("lazy:stop");
      }

      onDispose(): void {
        events.push("lazy:dispose");
      }
    }

    defineModule(StagedLazyStart, { name: "stagedLazyStart" });

    const app = createApp();
    await app.start();

    const loading = app.load(lazyModule(() => StagedLazyStart));
    await startEntered;

    const stopping = app.stop();
    let lateLoaderCalled = false;

    await expect(
      app.load(
        lazyModule(() => {
          lateLoaderCalled = true;
          return [];
        }),
      ),
    ).rejects.toThrow("Cannot load a lazy module while the app is stopping.");
    expect(lateLoaderCalled).toBe(false);

    releaseStart();

    await expect(loading).rejects.toThrow("Cannot load a lazy module while the app is stopping.");
    await stopping;

    expect(events).toEqual(["lazy:start", "lazy:stop", "lazy:dispose"]);
    expect(app.started).toBe(false);
    expect(() => app.getModule(StagedLazyStart)).toThrow(CosystemError);
    await app.dispose();
  });

  it("rejects in-flight lazy loads when the app is disposed before the loader resolves", async () => {
    const events: string[] = [];
    let releaseLoad: (() => void) | undefined;
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });

    class LazyAfterDispose {
      onInit(): void {
        events.push("lazy:init");
      }
    }

    defineModule(LazyAfterDispose, {
      name: "lazyAfterDispose",
    });

    const app = createApp();
    await app.start();

    const feature = lazyModule(async () => {
      events.push("load:start");
      await loadGate;
      events.push("load:resume");
      return LazyAfterDispose;
    });

    const loadPromise = app.load(feature).catch((error: unknown) => {
      events.push(error instanceof CosystemError ? "load:error" : "load:unknown-error");
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).toEqual(["load:start"]);

    await app.dispose();
    events.push("disposed");

    if (releaseLoad === undefined) {
      throw new Error("Expected lazy loader gate to be initialized.");
    }

    releaseLoad();
    await loadPromise;

    expect(events).toEqual(["load:start", "disposed", "load:resume", "load:error"]);
    expect(() => app.getModule(LazyAfterDispose)).toThrow(CosystemError);
  });

  it("waits for staged lazy scopes before disposal completes", async () => {
    const ResourceToken = token<object>("StagedLazyResource");
    const events: string[] = [];
    let markInitStarted: (() => void) | undefined;
    let releaseInit: (() => void) | undefined;
    const initStarted = new Promise<void>((resolve) => {
      markInitStarted = resolve;
    });
    const initGate = new Promise<void>((resolve) => {
      releaseInit = resolve;
    });

    class StagedLazyModule {
      async onInit(): Promise<void> {
        events.push("init:start");
        markInitStarted?.();
        await initGate;
        events.push("init:resume");
      }

      onDispose(): void {
        events.push("module:dispose");
      }
    }

    defineModule(StagedLazyModule, {
      name: "stagedLazyModule",
    });

    const app = createApp();
    await app.start();

    const feature = lazyModule(() => ({
      providers: [
        StagedLazyModule,
        provide(ResourceToken, {
          dispose() {
            events.push("resource:dispose");
          },
          eager: true,
          useFactory: () => {
            events.push("resource:create");
            return {};
          },
        }),
      ],
    }));
    const loadResult = app.load(feature).then(
      () => ({ status: "fulfilled" as const }),
      (error: unknown) => ({ error, status: "rejected" as const }),
    );

    await initStarted;

    let disposalSettled = false;
    const disposal = app.dispose().then(() => {
      disposalSettled = true;
      events.push("app:disposed");
      return undefined;
    });

    await Promise.resolve();

    expect(disposalSettled).toBe(false);
    expect(events).toEqual(["resource:create", "init:start"]);

    releaseInit?.();

    const result = await loadResult;
    expect(result).toMatchObject({
      error: {
        message: "Cannot load a lazy module after app disposal.",
      },
      status: "rejected",
    });

    await disposal;

    expect(events).toEqual([
      "resource:create",
      "init:start",
      "init:resume",
      "module:dispose",
      "resource:dispose",
      "app:disposed",
    ]);
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

  it("enforces strict actions for deep state and direct store mutations", async () => {
    class NestedStrictModule {
      settings = { nested: { value: 0 } };
      items = [1];

      mutate(): void {
        this.settings.nested.value += 1;
        this.items.push(2);
      }

      async mutateLater(): Promise<void> {
        await Promise.resolve();
        this.settings.nested.value += 1;
      }
    }

    defineModule(NestedStrictModule, {
      actions: ["mutate", "mutateLater"],
      name: "nestedStrictModule",
      state: ["settings", "items"],
    });

    const app = testApp({
      providers: [NestedStrictModule],
      strictActions: true,
    });
    const module = app.getModule(NestedStrictModule);

    expect(() => {
      module.settings.nested.value = 1;
    }).toThrow("Cannot mutate state outside an action");
    expect(() => module.items.push(2)).toThrow("Cannot mutate state outside an action");
    expect(() => {
      app.store.getState().nestedStrictModule!.settings = {};
    }).toThrow("Cannot mutate state outside an action");
    expect(() =>
      app.store.setState({ nestedStrictModule: { settings: { nested: { value: 3 } } } }),
    ).toThrow("Cannot call store.setState() outside an action");
    expect(() => app.store.apply(app.store.getPureState())).toThrow(
      "Cannot call store.apply() outside an action",
    );

    const pureState = app.store.getPureState() as {
      nestedStrictModule: {
        items: number[];
        settings: { nested: { value: number } };
      };
    };

    expect(Object.isFrozen(pureState)).toBe(true);
    expect(Object.isFrozen(pureState.nestedStrictModule!.settings)).toBe(true);
    expect(structuredClone(pureState)).toEqual(pureState);
    expect(() => {
      pureState.nestedStrictModule!.settings.nested.value = 9;
    }).toThrow(TypeError);
    expect(() => {
      pureState.nestedStrictModule!.items.push(9);
    }).toThrow(TypeError);
    expect(module.settings.nested.value).toBe(0);
    expect(module.items).toEqual([1]);

    module.mutate();

    expect(module.settings.nested.value).toBe(1);
    expect(module.items).toEqual([1, 2]);
    await expect(module.mutateLater()).rejects.toThrow("Cannot mutate state outside an action");
    expect(module.settings.nested.value).toBe(1);

    app.runInAction(
      () => {
        app.store.setState({
          nestedStrictModule: {
            items: [4],
            settings: { nested: { value: 4 } },
          },
        });
      },
      { name: "replaceNestedState" },
    );

    expect(module.settings.nested.value).toBe(4);
    expect(module.items).toEqual([4]);
    expect(app.test.getActions()).toMatchObject([
      { method: "mutate", module: "nestedStrictModule" },
      { error: expect.any(CosystemError), method: "mutateLater" },
      { method: "replaceNestedState", module: "$app" },
    ]);
  });

  it("does not grant draft authority to retained strict state views", () => {
    class RetainedStrictState {
      settings = { nested: { value: 0 } };
    }

    defineModule(RetainedStrictState, {
      name: "retainedStrictState",
      state: ["settings"],
    });

    const app = testApp({
      providers: [RetainedStrictState],
      strictActions: true,
    });
    const module = app.getModule(RetainedStrictState);
    const retained = module.settings.nested;
    const version = app.state.version;

    expect(() =>
      app.runInAction(
        () =>
          app.store.setState(() => {
            retained.value = 9;
          }),
        { name: "mutateRetainedState" },
      ),
    ).toThrow("Cannot mutate state outside an action");

    expect(module.settings.nested.value).toBe(0);
    expect(app.store.getPureState()).toEqual({
      retainedStrictState: { settings: { nested: { value: 0 } } },
    });
    expect(app.state.version).toBe(version);
    expect(app.test.getPatches()).toEqual([]);
  });

  it("allows strict apps to commit transactional lazy module state", async () => {
    const app = createApp({
      devOptions: { strictActions: true },
    });

    await app.load(lazyModule(() => LazyCounter));

    expect(app.getModule(LazyCounter).count).toBe(1);
    expect(app.store.getPureState()).toEqual({ lazyCounter: { count: 1 } });
  });

  it("supports nested strict actions in loaded lazy modules", async () => {
    class NestedStrictLazyModule {
      items = [1];
      settings = { nested: { value: 0 } };

      fail(): never {
        this.settings.nested.value += 1;
        this.items.push(3);
        throw new Error("lazy nested boom");
      }

      mutate(): void {
        this.settings.nested.value += 1;
        this.items.push(2);
      }
    }

    defineModule(NestedStrictLazyModule, {
      actions: ["fail", "mutate"],
      name: "nestedStrictLazyModule",
      state: ["items", "settings"],
    });

    const app = createApp({
      devOptions: { strictActions: true },
    });
    await app.load(lazyModule(() => NestedStrictLazyModule));

    const module = app.getModule(NestedStrictLazyModule);
    module.mutate();

    expect(module.items).toEqual([1, 2]);
    expect(module.settings.nested.value).toBe(1);
    expect(() => module.fail()).toThrow("lazy nested boom");
    expect(module.items).toEqual([1, 2]);
    expect(module.settings.nested.value).toBe(1);
    expect(app.store.getPureState()).toEqual({
      nestedStrictLazyModule: {
        items: [1, 2],
        settings: { nested: { value: 1 } },
      },
    });

    const retainedNestedState = module.settings.nested;
    await app.dispose();
    expect(() => {
      retainedNestedState.value = 9;
    }).toThrow("Cannot mutate module state after app disposal has begun.");
  });

  it("avoids replacing existing strict slices during lazy state writes", async () => {
    class StableStrictModule {
      value = 1;
    }

    class WritableStrictLazyModule {
      value = 0;
    }

    class SnapshotReadingFailingLazyModule {
      value = 0;

      explode(): void {
        app.store.getPureState();
        throw new Error("strict lazy effect boom");
      }
    }

    defineModule(StableStrictModule, {
      name: "stableStrictModule",
      state: ["value"],
    });
    defineModule(WritableStrictLazyModule, {
      name: "writableStrictLazyModule",
      state: ["value"],
    });
    defineModule(SnapshotReadingFailingLazyModule, {
      effects: ["explode"],
      name: "snapshotReadingFailingLazyModule",
      state: ["value"],
    });

    const patchEvents: PatchEvent[] = [];
    const app = createApp({
      devOptions: { strictActions: true },
      plugins: [
        {
          onPatch(event) {
            patchEvents.push(event);
          },
        },
      ],
      providers: [StableStrictModule],
    });
    await app.ready;
    patchEvents.length = 0;

    await app.load(lazyModule(() => WritableStrictLazyModule));

    expect(app.store.getPureState().stableStrictModule).toEqual({ value: 1 });
    expect(patchEvents).toHaveLength(1);
    expect(patchEvents[0]?.patches).toEqual([
      {
        op: "add",
        path: ["writableStrictLazyModule"],
        value: { value: 0 },
      },
    ]);

    patchEvents.length = 0;
    app.runInAction(() => {
      app.getModule(WritableStrictLazyModule).value = 2;
    });

    expect(app.store.getPureState().stableStrictModule).toEqual({ value: 1 });
    expect(patchEvents).toHaveLength(1);
    expect(
      patchEvents[0]?.patches.every(
        (patch) =>
          (patch as { readonly path?: readonly unknown[] }).path?.[0] ===
          "writableStrictLazyModule",
      ),
    ).toBe(true);

    patchEvents.length = 0;
    const committedVersion = app.state.version;
    await expect(app.load(lazyModule(() => SnapshotReadingFailingLazyModule))).rejects.toThrow(
      "strict lazy effect boom",
    );

    expect(app.store.getPureState()).not.toHaveProperty("snapshotReadingFailingLazyModule");
    expect(app.store.getPureState().stableStrictModule).toEqual({ value: 1 });
    expect(app.state.version).toBe(committedVersion);
    expect(patchEvents).toEqual([]);
    await app.dispose();
  });

  it("composes nested and cross-module lazy actions", async () => {
    let sibling!: SiblingLazyModule;

    class ComposedLazyModule {
      count = 0;
      total = 0;

      inner(): void {
        this.count += 2;
      }

      outer(): void {
        this.count = 1;
        this.inner();
        sibling.increase();
        this.total = this.count;
      }
    }

    class SiblingLazyModule {
      count = 0;

      increase(): void {
        this.count += 1;
      }
    }

    defineModule(ComposedLazyModule, {
      actions: ["inner", "outer"],
      name: "composedLazyModule",
      state: ["count", "total"],
    });
    defineModule(SiblingLazyModule, {
      actions: ["increase"],
      name: "siblingLazyModule",
      state: ["count"],
    });

    const app = createApp({ devOptions: { strictActions: true } });
    await app.load(lazyModule(() => [ComposedLazyModule, SiblingLazyModule]));
    sibling = app.getModule(SiblingLazyModule);

    app.getModule(ComposedLazyModule).outer();

    expect(app.store.getPureState()).toEqual({
      composedLazyModule: { count: 3, total: 3 },
      siblingLazyModule: { count: 1 },
    });
    await app.dispose();
  });

  it("composes nested actions across eager modules", async () => {
    let eagerSibling!: EagerSiblingModule;

    class ComposedEagerModule {
      count = 0;
      total = 0;

      inner(): void {
        this.count += 2;
      }

      outer(): void {
        this.count = 1;
        this.inner();
        eagerSibling.increase();
        this.total = this.count;
      }
    }

    class EagerSiblingModule {
      count = 0;

      increase(): void {
        this.count += 1;
      }
    }

    defineModule(ComposedEagerModule, {
      actions: ["inner", "outer"],
      name: "composedEagerModule",
      state: ["count", "total"],
    });
    defineModule(EagerSiblingModule, {
      actions: ["increase"],
      name: "eagerSiblingModule",
      state: ["count"],
    });
    const app = createApp({
      devOptions: { strictActions: true },
      providers: [ComposedEagerModule, EagerSiblingModule],
    });
    eagerSibling = app.getModule(EagerSiblingModule);

    app.getModule(ComposedEagerModule).outer();

    expect(app.store.getPureState()).toEqual({
      composedEagerModule: { count: 3, total: 3 },
      eagerSiblingModule: { count: 1 },
    });
    await app.dispose();
  });

  it("publishes eager and lazy nested actions atomically", async () => {
    let lazySibling!: NestedLazySiblingModule;

    class EagerWithLazyActionModule {
      observedLazyCount = 0;

      failBoth(): never {
        lazySibling.increase();
        this.observedLazyCount = lazySibling.count;
        throw new Error("nested transaction boom");
      }

      updateBoth(): void {
        lazySibling.increase();
        this.observedLazyCount = lazySibling.count;
      }
    }

    class NestedLazySiblingModule {
      count = 0;

      increase(): void {
        this.count += 1;
      }
    }

    defineModule(EagerWithLazyActionModule, {
      actions: ["failBoth", "updateBoth"],
      name: "eagerWithLazyActionModule",
      state: ["observedLazyCount"],
    });
    defineModule(NestedLazySiblingModule, {
      actions: ["increase"],
      name: "nestedLazySiblingModule",
      state: ["count"],
    });

    const patchEvents: PatchEvent[] = [];
    const app = createApp({
      devOptions: { strictActions: true },
      plugins: [
        {
          onPatch(event) {
            patchEvents.push(event);
          },
        },
      ],
      providers: [EagerWithLazyActionModule],
    });
    await app.load(lazyModule(() => NestedLazySiblingModule));
    lazySibling = app.getModule(NestedLazySiblingModule);
    patchEvents.length = 0;
    const snapshots: unknown[] = [];
    const version = app.state.version;
    const unsubscribe = app.store.subscribe(() => {
      snapshots.push(app.store.getPureState());
    });

    app.getModule(EagerWithLazyActionModule).updateBoth();
    unsubscribe();

    const expectedState = {
      eagerWithLazyActionModule: { observedLazyCount: 1 },
      nestedLazySiblingModule: { count: 1 },
    };
    expect(app.store.getPureState()).toEqual(expectedState);
    expect(snapshots).toEqual([expectedState]);
    expect(app.state.version).toBe(version + 1);
    expect(patchEvents).toHaveLength(1);

    snapshots.length = 0;
    patchEvents.length = 0;
    const committedVersion = app.state.version;
    const unsubscribeFailure = app.store.subscribe(() => {
      snapshots.push(app.store.getPureState());
    });

    expect(() => app.getModule(EagerWithLazyActionModule).failBoth()).toThrow(
      "nested transaction boom",
    );
    unsubscribeFailure();

    expect(app.store.getPureState()).toEqual(expectedState);
    expect(snapshots).toEqual([]);
    expect(app.state.version).toBe(committedVersion);
    expect(patchEvents).toEqual([]);
    await app.dispose();
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

  it("enables Coaction patches when a plugin observes patches", () => {
    const patches: (readonly unknown[])[] = [];
    const app = createApp({
      plugins: [
        {
          onPatch(event) {
            patches.push(event.patches);
          },
        },
      ],
      providers: [Counter, provide(Logger, { useValue: new MemoryLogger() })],
    });

    app.getModule(Counter).increase();

    expect(patches).toHaveLength(1);
  });

  it("does not enable Coaction patches when engine patches are explicitly disabled", () => {
    const patches: (readonly unknown[])[] = [];
    const app = createApp({
      engine: {
        patches: false,
      },
      plugins: [
        {
          onPatch(event) {
            patches.push(event.patches);
          },
        },
      ],
      providers: [Counter, provide(Logger, { useValue: new MemoryLogger() })],
    });

    app.getModule(Counter).increase();

    expect(patches).toEqual([]);
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

  it("disposes module effect subscriptions and rejects retained actions", async () => {
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

    expect(() => counter.increase()).toThrow(
      "Cannot run module actions after app disposal has begun.",
    );

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

  it("rejects non-singleton module metadata and provider scopes", () => {
    for (const scope of ["scoped", "resolution", "transient"] as const) {
      class InvalidScopedModule {
        readonly ready = true;
      }

      defineModule(InvalidScopedModule, {
        name: `invalid-${scope}`,
        scope: scope as never,
      });

      expect(() => createApp({ providers: [InvalidScopedModule] })).toThrow(
        `must use singleton scope; received ${scope}`,
      );
    }

    class ProviderScopedModule {
      readonly ready = true;
    }

    defineModule(ProviderScopedModule, {
      name: "providerScopedModule",
    });

    expect(() =>
      createApp({
        providers: [
          provide(ProviderScopedModule, {
            scope: "resolution",
            useClass: ProviderScopedModule,
          }),
        ],
      }),
    ).toThrow("must use singleton scope; received resolution");
  });

  it("rejects non-singleton factory overrides for discovered modules", () => {
    class FactoryOverriddenModule {
      value = "module";
    }

    defineModule(FactoryOverriddenModule, {
      name: "factoryOverriddenModule",
      state: ["value"],
    });

    expect(() =>
      testApp({
        overrides: [
          provide(FactoryOverriddenModule, {
            scope: "transient",
            useFactory: () => new FactoryOverriddenModule(),
          }),
        ],
        providers: [FactoryOverriddenModule],
      }),
    ).toThrow("must use singleton scope; received transient");
  });

  it("rejects overrides that replace a discovered module with a non-module value", () => {
    class FactoryOverriddenModule {
      value = "module";
    }

    defineModule(FactoryOverriddenModule, {
      name: "factoryOverriddenModule",
      state: ["value"],
    });

    expect(() =>
      testApp({
        overrides: [
          provide(FactoryOverriddenModule, {
            useFactory: () => ({ value: "plain object" }) as FactoryOverriddenModule,
          }),
        ],
        providers: [FactoryOverriddenModule],
      }),
    ).toThrow("FactoryOverriddenModule resolved to a value that is not a CoSystem module.");
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

  it("exposes stable readiness and internally observes initialization failures", async () => {
    const initError = new Error("ready init boom");
    const unhandled: unknown[] = [];
    const onUnhandled = (error: unknown) => {
      unhandled.push(error);
    };

    class FailingReadyModule {
      async onInit(): Promise<void> {
        await Promise.resolve();
        throw initError;
      }
    }

    defineModule(FailingReadyModule, {
      name: "failingReadyModule",
    });

    process.on("unhandledRejection", onUnhandled);

    try {
      const app = createApp({ providers: [FailingReadyModule] });
      const ready = app.ready;

      expect(app.ready).toBe(ready);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
      await expect(ready).rejects.toBe(initError);
      await expect(app.dispose()).resolves.toBeUndefined();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("rejects start reentry from async lifecycle hooks without reordering phases", async () => {
    const events: string[] = [];

    class OrderedLifecycleModule {
      onInit(): void {
        events.push("module:init");
      }

      onStart(): void {
        events.push("module:start");
      }
    }

    defineModule(OrderedLifecycleModule, {
      name: "orderedLifecycleModule",
    });

    const app = createApp({
      plugins: [
        {
          async setup(runtimeApp) {
            events.push("plugin:setup");
            await Promise.resolve();

            await runtimeApp.start().catch((error: unknown) => {
              events.push(error instanceof CosystemError ? "plugin:start-rejected" : "unknown");
            });
          },
        },
      ],
      providers: [OrderedLifecycleModule],
    });

    await app.ready;
    await app.start();

    expect(events).toEqual([
      "plugin:setup",
      "plugin:start-rejected",
      "module:init",
      "module:start",
    ]);
  });

  it("rolls back attempted startup hooks before a retry", async () => {
    const events: string[] = [];
    let failingAttempts = 0;

    class FirstStartedModule {
      onStart(): void {
        events.push("first:start");
      }

      onStop(): void {
        events.push("first:stop");
      }
    }

    class InitiallyFailingStartedModule {
      onStart(): void {
        failingAttempts += 1;
        events.push("failing:start");

        if (failingAttempts === 1) {
          throw new Error("root start boom");
        }
      }

      onStop(): void {
        events.push("failing:stop");
      }
    }

    class LaterStartedModule {
      onStart(): void {
        events.push("later:start");
      }

      onStop(): void {
        events.push("later:stop");
      }
    }

    defineModule(FirstStartedModule, { name: "firstStartedModule" });
    defineModule(InitiallyFailingStartedModule, { name: "initiallyFailingStartedModule" });
    defineModule(LaterStartedModule, { name: "laterStartedModule" });

    const app = createApp({
      providers: [FirstStartedModule, InitiallyFailingStartedModule, LaterStartedModule],
    });

    await expect(app.start()).rejects.toThrow("root start boom");
    expect(app.started).toBe(false);
    expect(events).toEqual(["first:start", "failing:start", "failing:stop", "first:stop"]);

    await app.start();
    expect(app.started).toBe(true);
    expect(events).toEqual([
      "first:start",
      "failing:start",
      "failing:stop",
      "first:stop",
      "first:start",
      "failing:start",
      "later:start",
    ]);

    await app.stop();
    expect(events.slice(-3)).toEqual(["later:stop", "failing:stop", "first:stop"]);
    await app.dispose();
  });

  it("finishes stopping when stop is requested during startup", async () => {
    const events: string[] = [];
    let markStartEntered!: () => void;
    let releaseStart!: () => void;
    const startEntered = new Promise<void>((resolve) => {
      markStartEntered = resolve;
    });
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });

    class SlowStartModule {
      async onStart(): Promise<void> {
        events.push("start");
        markStartEntered();
        await startGate;
      }

      onStop(): void {
        events.push("stop");
      }
    }

    defineModule(SlowStartModule, { name: "slowStartModule" });

    const app = createApp({ providers: [SlowStartModule] });
    const starting = app.start();
    await startEntered;

    const stopping = app.stop();
    releaseStart();
    await Promise.all([starting, stopping]);

    expect(events).toEqual(["start", "stop"]);
    expect(app.started).toBe(false);
    await app.dispose();
  });

  it("restarts when start is requested during stopping", async () => {
    const events: string[] = [];
    let markStopEntered!: () => void;
    let releaseStop!: () => void;
    const stopEntered = new Promise<void>((resolve) => {
      markStopEntered = resolve;
    });
    const stopGate = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });

    class SlowStopModule {
      onStart(): void {
        events.push("start");
      }

      async onStop(): Promise<void> {
        events.push("stop");
        markStopEntered();
        await stopGate;
      }
    }

    defineModule(SlowStopModule, { name: "slowStopModule" });

    const app = createApp({ providers: [SlowStopModule] });
    await app.start();

    const stopping = app.stop();
    await stopEntered;
    const restarting = app.start();

    releaseStop();
    await Promise.all([stopping, restarting]);

    expect(events).toEqual(["start", "stop", "start"]);
    expect(app.started).toBe(true);
    await app.dispose();
  });

  it("rejects readiness reentry from initialization work", async () => {
    const app = createApp({
      plugins: [
        {
          async setup(runtimeApp) {
            await runtimeApp.ready;
          },
        },
      ],
    });

    await expect(app.ready).rejects.toThrow("Cannot await app.ready from app-managed setup work.");
    await expect(app.dispose()).resolves.toBeUndefined();
  });

  it("rejects disposal reentry from startup hooks", async () => {
    let app!: ReturnType<typeof createApp>;

    class ReentrantStartModule {
      async onStart(): Promise<void> {
        await app.dispose();
      }
    }

    defineModule(ReentrantStartModule, {
      name: "reentrantStartModule",
    });

    app = createApp({ providers: [ReentrantStartModule] });

    await expect(app.start()).rejects.toThrow(
      "Cannot call dispose() from app-managed onStart work.",
    );
    await expect(app.dispose()).resolves.toBeUndefined();
  });

  it("rejects stop reentry from teardown hooks without leaving the app started", async () => {
    let app!: ReturnType<typeof createApp>;

    class ReentrantStopModule {
      async onStop(): Promise<void> {
        await app.stop();
      }
    }

    defineModule(ReentrantStopModule, {
      name: "reentrantStopModule",
    });

    app = createApp({ providers: [ReentrantStopModule] });
    await app.start();

    let stopError: unknown;

    try {
      await app.stop();
    } catch (error) {
      stopError = error;
    }

    expect(stopError).toBeInstanceOf(AggregateError);
    expect((stopError as AggregateError).errors[0]).toMatchObject({
      message: "Cannot call stop() from app-managed onStop work.",
    });
    expect(app.started).toBe(false);
    await expect(app.dispose()).resolves.toBeUndefined();
  });

  it("rejects disposal reentry from plugin teardown and still reaches a terminal state", async () => {
    let reentryError: unknown;
    const app = createApp({
      plugins: [
        {
          async dispose(context) {
            try {
              await context.app.dispose();
            } catch (error) {
              reentryError = error;
              throw error;
            }
          },
        },
      ],
    });

    await app.ready;

    let disposeError: unknown;

    try {
      await app.dispose();
    } catch (error) {
      disposeError = error;
    }

    expect(reentryError).toMatchObject({
      message: "Cannot call dispose() from app-managed pluginDispose work.",
    });
    expect(disposeError).toBeInstanceOf(AggregateError);
    await expect(app.dispose()).rejects.toBe(disposeError);
  });

  it("allows external start while an async initialization hook is in flight", async () => {
    let markSetupStarted!: () => void;
    let releaseSetup!: () => void;
    const setupStarted = new Promise<void>((resolve) => {
      markSetupStarted = resolve;
    });
    const setupGate = new Promise<void>((resolve) => {
      releaseSetup = resolve;
    });

    class ExternallyStartedModule {
      started = false;

      onStart(): void {
        this.started = true;
      }
    }

    defineModule(ExternallyStartedModule, {
      name: "externallyStartedModule",
    });

    const app = createApp({
      plugins: [
        {
          async setup() {
            markSetupStarted();
            await setupGate;
          },
        },
      ],
      providers: [ExternallyStartedModule],
    });

    await setupStarted;
    const startPromise = app.start();
    releaseSetup();
    await startPromise;

    expect(app.getModule(ExternallyStartedModule).started).toBe(true);
    await app.dispose();
  });

  it("isolates inject() across concurrently initializing apps", async () => {
    let markFirstStarted!: () => void;
    let markSecondStarted!: () => void;
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const secondStarted = new Promise<void>((resolve) => {
      markSecondStarted = resolve;
    });
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    const firstLogger = new MemoryLogger();
    const secondLogger = new MemoryLogger();
    const first = createApp({
      plugins: [
        {
          async setup() {
            markFirstStarted();
            await firstGate;
            inject(Logger).info("first");
          },
        },
      ],
      providers: [provide(Logger, { useValue: firstLogger })],
    });
    const second = createApp({
      plugins: [
        {
          async setup() {
            markSecondStarted();
            await secondGate;
            inject(Logger).info("second");
          },
        },
      ],
      providers: [provide(Logger, { useValue: secondLogger })],
    });

    await Promise.all([firstStarted, secondStarted]);
    releaseFirst();
    await first.ready;
    releaseSecond();
    await second.ready;

    expect(firstLogger.messages).toEqual(["first"]);
    expect(secondLogger.messages).toEqual(["second"]);
    await Promise.all([first.dispose(), second.dispose()]);
  });

  it("waits for in-flight start hooks before disposing the app", async () => {
    const events: string[] = [];
    let releaseStart: (() => void) | undefined;
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });

    class SlowStartModule {
      async onStart(): Promise<void> {
        events.push("module:start");
        await startGate;
        events.push("module:start:done");
      }

      onStop(): void {
        events.push("module:stop");
      }

      onDispose(): void {
        events.push("module:dispose");
      }
    }

    defineModule(SlowStartModule, {
      name: "slowStart",
    });

    const app = createApp({
      providers: [SlowStartModule],
    });

    const startPromise = app.start();

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events).toEqual(["module:start"]);

    const disposePromise = app.dispose();
    await Promise.resolve();

    expect(events).toEqual(["module:start"]);

    if (releaseStart === undefined) {
      throw new Error("Expected start gate to be initialized.");
    }

    releaseStart();
    await Promise.all([startPromise, disposePromise]);

    expect(app.started).toBe(false);
    expect(events).toEqual(["module:start", "module:start:done", "module:stop", "module:dispose"]);
  });

  it("terminates retained module facade writes after app disposal", async () => {
    class RetainedTerminalModule {
      count = 0;
      settings = { nested: { value: 0 } };

      increase(): void {
        this.count += 1;
      }

      onDispose(): void {
        this.increase();
      }
    }

    defineModule(RetainedTerminalModule, {
      actions: ["increase"],
      name: "retainedTerminalModule",
      state: ["count", "settings"],
    });

    const app = createApp({ providers: [RetainedTerminalModule] });
    const retained = app.getModule(RetainedTerminalModule);
    const retainedNestedState = retained.settings.nested;

    await app.ready;
    await app.dispose();

    expect(retained.count).toBe(1);
    const version = app.state.version;

    expect(() => retained.increase()).toThrow(
      "Cannot run module actions after app disposal has begun.",
    );
    expect(() => {
      retained.count = 10;
    }).toThrow("Cannot write module state after app disposal has begun.");
    expect(() => {
      retainedNestedState.value = 10;
    }).toThrow("Cannot mutate module state after app disposal has begun.");
    expect(() => app.getModule(RetainedTerminalModule)).toThrow(
      "Cannot access modules after app disposal has begun.",
    );
    expect(() => app.getModuleByName("retainedTerminalModule")).toThrow(
      "Cannot access modules after app disposal has begun.",
    );
    expect(retained.count).toBe(1);
    expect(retainedNestedState.value).toBe(0);
    expect(app.state.version).toBe(version);
  });

  it("rejects direct store writes after app disposal", async () => {
    const app = createApp({
      providers: [Counter, provide(Logger, { useValue: new MemoryLogger() })],
    });

    await app.ready;
    await app.dispose();

    const state = app.store.getPureState();
    const version = app.state.version;

    expect(() => app.store.setState({ counter: { count: 10 } })).toThrow(
      "Cannot call store.setState() after app disposal has begun.",
    );
    expect(() => app.store.apply({ counter: { count: 10 } })).toThrow(
      "Cannot call store.apply() after app disposal has begun.",
    );
    expect(app.store.getPureState()).toBe(state);
    expect(app.state.version).toBe(version);
  });

  it("rejects start while disposal is stopping a started app", async () => {
    let markStopStarted!: () => void;
    let releaseStop!: () => void;
    const stopStarted = new Promise<void>((resolve) => {
      markStopStarted = resolve;
    });
    const stopGate = new Promise<void>((resolve) => {
      releaseStop = resolve;
    });

    class SlowTerminalStop {
      async onStop(): Promise<void> {
        markStopStarted();
        await stopGate;
      }
    }

    defineModule(SlowTerminalStop, { name: "slowTerminalStop" });

    const app = createApp({ providers: [SlowTerminalStop] });
    await app.start();

    const disposal = app.dispose();
    await stopStarted;

    await expect(app.start()).rejects.toThrow("Cannot start an app after disposal.");

    releaseStop();
    await disposal;
  });

  it("continues every disposal phase after teardown failures and stays terminal", async () => {
    const events: string[] = [];
    const stopError = new Error("stop boom");
    const moduleDisposeError = new Error("module dispose boom");
    const pluginDisposeError = new Error("plugin dispose boom");
    const providerDisposeError = new Error("provider dispose boom");

    class ContinuingModule {
      onStop(): void {
        events.push("continuing:stop");
      }

      onDispose(): void {
        events.push("continuing:dispose");
      }
    }

    class FailingModule {
      onStop(): void {
        events.push("failing:stop");
        throw stopError;
      }

      onDispose(): void {
        events.push("failing:dispose");
        throw moduleDisposeError;
      }
    }

    class DisposableService {
      destroy(): void {
        events.push("provider:dispose");
        throw providerDisposeError;
      }
    }

    defineModule(ContinuingModule, { name: "continuingModule" });
    defineModule(FailingModule, { name: "failingModule" });

    const app = createApp({
      plugins: [
        {
          dispose() {
            events.push("plugin:dispose");
            throw pluginDisposeError;
          },
        },
      ],
      providers: [ContinuingModule, FailingModule, DisposableService],
    });
    const continuingModule = app.getModule(ContinuingModule);
    const service = app.get(DisposableService);

    await app.start();

    let caught: unknown;
    try {
      await app.dispose();
    } catch (error) {
      caught = error;
    }

    expect(events).toEqual([
      "failing:stop",
      "continuing:stop",
      "failing:dispose",
      "continuing:dispose",
      "plugin:dispose",
      "provider:dispose",
    ]);
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toEqual([
      stopError,
      moduleDisposeError,
      pluginDisposeError,
      providerDisposeError,
    ]);
    expect(app.started).toBe(false);

    expect(() => app.get(DisposableService)).toThrow(/after app disposal has begun/);
    await expect(app.getAsync(DisposableService)).rejects.toThrow(/after app disposal has begun/);
    expect(() => app.getAll(DisposableService)).toThrow(/after app disposal has begun/);
    expect(() =>
      app.watch(
        () => 1,
        () => undefined,
      ),
    ).toThrow(/after app disposal has begun/);
    expect(() => app.runInAction(continuingModule, () => undefined)).toThrow(
      /after app disposal has begun/,
    );
    expect(() => app.createScope()).toThrow(/after app disposal has begun/);
    await expect(app.load()).rejects.toThrow(/after app disposal/);
    await expect(app.dispose()).rejects.toBe(caught);
    expect(service).toBeInstanceOf(DisposableService);
  });

  it("passes plugin context and disposes plugin resources", async () => {
    const events: string[] = [];
    let capturedContext: PluginContext | undefined;

    const app = createApp({
      plugins: [
        {
          name: "watcher",
          setup(runtimeApp, context) {
            capturedContext = context;
            events.push(`${context.name}:${context.app === runtimeApp}:${context.signal.aborted}`);
            context.onDispose(() => {
              events.push(`dispose:${context.signal.aborted}`);
            });
            context.watch(
              () => runtimeApp.getModule(Counter).count,
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

  it("waits for in-flight plugin setup before disposing plugin context resources", async () => {
    const events: string[] = [];
    let releaseSetup: (() => void) | undefined;
    const setupGate = new Promise<void>((resolve) => {
      releaseSetup = resolve;
    });

    class InitAfterDisposeModule {
      onInit(): void {
        events.push("module:init");
      }
    }

    defineModule(InitAfterDisposeModule, {
      name: "initAfterDispose",
    });

    const app = createApp({
      plugins: [
        {
          name: "async-setup",
          async setup(_app, context) {
            events.push(`setup:start:${context.signal.aborted}`);
            await setupGate;
            events.push(`setup:resume:${context.signal.aborted}`);
            context.onDispose(() => {
              events.push(`context:dispose:${context.signal.aborted}`);
            });
          },
        },
      ],
      providers: [InitAfterDisposeModule],
    });

    const disposePromise = (async () => {
      await app.dispose();
      events.push("disposed");
    })();

    await Promise.resolve();
    expect(events).toEqual(["setup:start:false"]);

    if (releaseSetup === undefined) {
      throw new Error("Expected plugin setup gate to be initialized.");
    }

    releaseSetup();
    await disposePromise;

    expect(events).toEqual([
      "setup:start:false",
      "setup:resume:true",
      "context:dispose:true",
      "disposed",
    ]);
  });

  it("does not start later plugin setup after disposal begins", async () => {
    const events: string[] = [];
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const app = createApp({
      plugins: [
        {
          setup(_app, context) {
            events.push(`first:setup:${String(context.signal.aborted)}`);
            markFirstStarted();

            return new Promise<void>((resolve) => {
              context.signal.addEventListener(
                "abort",
                () => {
                  events.push("first:abort");
                  resolve();
                },
                { once: true },
              );
            });
          },
        },
        {
          setup(_app, context) {
            events.push(`second:setup:${String(context.signal.aborted)}`);
          },
        },
      ],
    });

    await firstStarted;
    await app.dispose();

    expect(events).toEqual(["first:setup:false", "first:abort"]);
  });

  it("lets plugin context watches stop manually before app disposal", async () => {
    const events: string[] = [];
    let stopWatch: (() => void) | undefined;
    const app = createApp({
      plugins: [
        {
          setup(runtimeApp, context) {
            stopWatch = context.watch(
              () => runtimeApp.getModule(Counter).count,
              (value, previous) => {
                events.push(`${previous}->${value}`);
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
    stopWatch?.();
    stopWatch?.();
    app.getModule(Counter).increase();
    await app.dispose();

    expect(events).toEqual(["0->0", "0->1"]);
  });

  it("lets plugin context emit default and custom error phases", async () => {
    const errors: string[] = [];
    const app = createApp({
      plugins: [
        {
          name: "emitter",
          setup(_app, context) {
            context.emitError(new Error("default boom"));
            context.emitError("custom boom", "plugin:emitter.custom");
          },
        },
        {
          onError(error, context) {
            errors.push(`${context.phase}:${error instanceof Error ? error.message : error}`);
          },
        },
      ],
    });

    await app.start();

    expect(errors).toEqual(["plugin:emitter:default boom", "plugin:emitter.custom:custom boom"]);
  });

  it("disposes plugins in reverse order and aggregates teardown errors", async () => {
    const events: string[] = [];
    const pluginError = new Error("plugin dispose boom");
    const contextError = new Error("context dispose boom");
    const app = createApp({
      plugins: [
        {
          name: "first",
          setup(_app, context) {
            context.onDispose(() => {
              events.push(`first:context:${context.signal.aborted}`);
            });
          },
          dispose(context) {
            events.push(`first:plugin:${context.signal.aborted}`);
          },
        },
        {
          name: "second",
          setup(_app, context) {
            context.onDispose(() => {
              events.push(`second:context:${context.signal.aborted}`);
              throw contextError;
            });
          },
          dispose(context) {
            events.push(`second:plugin:${context.signal.aborted}`);
            throw pluginError;
          },
        },
      ],
    });

    await app.start();

    let caught: unknown;
    try {
      await app.dispose();
    } catch (error) {
      caught = error;
    }

    expect(events).toEqual([
      "second:plugin:false",
      "second:context:true",
      "first:plugin:false",
      "first:context:true",
    ]);
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toHaveLength(2);
    expect((caught as AggregateError).errors[0]).toBe(pluginError);
    expect((caught as AggregateError).errors[1]).toBeInstanceOf(AggregateError);
    expect(((caught as AggregateError).errors[1] as AggregateError).errors).toEqual([contextError]);
  });

  it("registers plugin providers before modules and setup", async () => {
    const Config = token<{ readonly label: string }>("Config");
    const events: string[] = [];

    class ConfigReader {
      constructor(readonly config: { readonly label: string }) {}
    }

    defineModule(ConfigReader, {
      deps: [Config],
      name: "configReader",
    });

    const app = createApp({
      plugins: [
        {
          name: "config",
          providers: [provide(Config, { useValue: { label: "plugin" } })],
          setup() {
            events.push(inject(Config).label);
          },
        },
      ],
      providers: [ConfigReader],
    });

    await app.start();

    expect(app.get(Config)).toEqual({ label: "plugin" });
    expect(app.getModule(ConfigReader).config).toEqual({ label: "plugin" });
    expect(events).toEqual(["plugin"]);
  });

  it("lets app providers override plugin providers for the same token", () => {
    const Config = token<{ readonly label: string }>("Config");
    const app = createApp({
      plugins: [
        {
          providers: [provide(Config, { useValue: { label: "plugin" } })],
        },
      ],
      providers: [provide(Config, { useValue: { label: "app" } })],
    });

    expect(app.get(Config)).toEqual({ label: "app" });
  });

  it("lets app non-multi providers replace plugin multi providers for the same token", () => {
    const Extension = token<{ readonly name: string }>("ReplaceableExtension");
    const app = createApp({
      plugins: [
        {
          providers: [provide(Extension, { multi: true, useValue: { name: "plugin:first" } })],
        },
        {
          providers: [provide(Extension, { multi: true, useValue: { name: "plugin:second" } })],
        },
      ],
      providers: [provide(Extension, { useValue: { name: "app" } })],
    });

    expect(app.get(Extension)).toEqual({ name: "app" });
    expect(app.getAll(Extension)).toEqual([{ name: "app" }]);
  });

  it("merges plugin and app multi providers in registration order", () => {
    const Extension = token<{ readonly name: string }>("Extension");
    const app = createApp({
      plugins: [
        {
          providers: [provide(Extension, { multi: true, useValue: { name: "plugin:first" } })],
        },
        {
          providers: [provide(Extension, { multi: true, useValue: { name: "plugin:second" } })],
        },
      ],
      providers: [provide(Extension, { multi: true, useValue: { name: "app" } })],
    });

    expect(app.getAll(Extension).map((extension) => extension.name)).toEqual([
      "plugin:first",
      "plugin:second",
      "app",
    ]);
  });

  it("rejects duplicate non-multi providers across plugins", () => {
    const Config = token<{ readonly label: string }>("Config");

    expect(() =>
      createApp({
        plugins: [
          {
            name: "first",
            providers: [provide(Config, { useValue: { label: "first" } })],
          },
          {
            name: "second",
            providers: [provide(Config, { useValue: { label: "second" } })],
          },
        ],
      }),
    ).toThrow(DuplicateProviderError);
  });

  it("rejects modules from plugin providers", () => {
    class PluginModule {
      readonly value = true;
    }

    defineModule(PluginModule, {
      name: "pluginModule",
    });

    expect(() =>
      createApp({
        plugins: [
          {
            name: "bad",
            providers: [PluginModule],
          },
        ],
      }),
    ).toThrow(/bad cannot register CoSystem modules through plugin providers/);
  });

  it("rejects module classes provided through plugin useClass providers", () => {
    class IndirectPluginModule {
      readonly value = true;
    }

    const PluginService = token<IndirectPluginModule>("PluginService");

    defineModule(IndirectPluginModule, {
      name: "indirectPluginModule",
    });

    expect(() =>
      createApp({
        plugins: [
          {
            name: "bad",
            providers: [provide(PluginService, { useClass: IndirectPluginModule })],
          },
        ],
      }),
    ).toThrow(/bad cannot register CoSystem modules through plugin providers/);
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

  it("reports async plugin observer errors without interrupting updates", async () => {
    const errors: string[] = [];
    const app = createApp({
      plugins: [
        {
          name: "async-action",
          onActionEnd() {
            return Promise.reject(new Error("action observer boom"));
          },
        },
        {
          name: "async-state",
          onStateChange() {
            return Promise.reject(new Error("state observer boom"));
          },
        },
        {
          name: "async-patch",
          onPatch() {
            return Promise.reject(new Error("patch observer boom"));
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
    await Promise.resolve();

    expect(errors).toHaveLength(3);
    expect(errors).toEqual(
      expect.arrayContaining([
        "plugin:async-action.onActionEnd:action observer boom",
        "plugin:async-patch.onPatch:patch observer boom",
        "plugin:async-state.onStateChange:state observer boom",
      ]),
    );
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

  it("preserves undefined action failures and records them as errors", async () => {
    class UndefinedFailingAction {
      fail(): never {
        throw undefined;
      }

      async failLater(): Promise<never> {
        await Promise.resolve();
        throw undefined;
      }
    }

    defineModule(UndefinedFailingAction, {
      actions: ["fail", "failLater"],
      name: "undefinedFailingAction",
    });

    const app = testApp({ providers: [UndefinedFailingAction] });
    const module = app.getModule(UndefinedFailingAction);
    let returnedNormally = true;
    let syncError: unknown = Symbol("not thrown");

    try {
      module.fail();
    } catch (error) {
      returnedNormally = false;
      syncError = error;
    }

    expect(returnedNormally).toBe(false);
    expect(syncError).toBeUndefined();
    await expect(module.failLater()).rejects.toBeUndefined();
    expect(app.test.getActions()).toHaveLength(2);
    expect(app.test.getActions().every((event) => Object.hasOwn(event, "error"))).toBe(true);
    expect(app.test.getActions().map((event) => event.error)).toEqual([undefined, undefined]);

    await app.dispose();
  });

  it("supports inject() across awaits in plugin setup and module lifecycle hooks", async () => {
    class InjectingLifecycle {
      async onInit(): Promise<void> {
        await Promise.resolve();
        inject(Logger).info("module:init");
      }

      async onStart(): Promise<void> {
        await Promise.resolve();
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
          async setup() {
            await Promise.resolve();
            inject(Logger).info("plugin:setup");
          },
        },
      ],
      providers: [InjectingLifecycle, provide(Logger, { useValue: logger })],
    });

    await app.ready;
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

  it("allows hook-managed app views to parent child apps", async () => {
    const ParentService = token<string>("ManagedParentService");
    let child: ReturnType<typeof createApp> | undefined;
    const parent = createApp({
      plugins: [
        {
          async setup(runtimeApp) {
            await Promise.resolve();
            child = createApp({ parent: runtimeApp });
          },
        },
      ],
      providers: [provide(ParentService, { useValue: "from-parent" })],
    });

    await parent.ready;

    if (child === undefined) {
      throw new Error("Expected setup to create a child app.");
    }

    expect(child.get(ParentService)).toBe("from-parent");

    await child.dispose();
    await parent.dispose();
  });
});
