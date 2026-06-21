import {
  createEnvironmentInjector,
  runInInjectionContext,
  type EnvironmentInjector,
  type Signal,
} from "@angular/core";
import { describe, expect, it } from "vitest";

import {
  createApp,
  createMemoryWorkerTransportPair,
  createWorkerApp,
  createWorkerClient,
  defineModule,
  type AsyncMethodProxy,
} from "@cosystem/core";

import {
  injectCoSystemApp,
  injectModule,
  injectSignal,
  injectWorkerClient,
  injectWorkerModule,
  injectWorkerSignal,
  provideCoSystem,
  provideWorkerClient,
} from "./index.js";

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
  name: "angularCounter",
  state: ["count"],
});

describe("Angular adapter", () => {
  it("bridges CoSystem apps through Angular providers", () => {
    const app = createApp({
      providers: [Counter],
    });
    const injector = createEnvironmentInjector(
      [provideCoSystem(app)],
      null as unknown as EnvironmentInjector,
    );

    runInInjectionContext(injector, () => {
      expect(injectCoSystemApp()).toBe(app);

      const counter = injectModule(Counter);

      counter.increase(2);

      expect(counter.count).toBe(2);
    });

    injector.destroy();
  });

  it("exposes selected module reads as Angular signals", () => {
    const app = createApp({
      providers: [Counter],
    });
    const injector = createEnvironmentInjector(
      [provideCoSystem(app)],
      null as unknown as EnvironmentInjector,
    );

    runInInjectionContext(injector, () => {
      const counter = injectModule(Counter);
      const double = injectSignal(Counter, (module) => module.double);

      expect(double()).toBe(0);

      counter.increase(3);

      expect(double()).toBe(6);
    });

    injector.destroy();
  });

  it("applies equality before updating Angular signals", () => {
    const app = createApp({
      providers: [Counter],
    });
    const injector = createEnvironmentInjector(
      [provideCoSystem(app)],
      null as unknown as EnvironmentInjector,
    );

    runInInjectionContext(injector, () => {
      const counter = injectModule(Counter);
      const parity = injectSignal(
        (currentApp) => ({
          value: currentApp.getModule(Counter).count % 2,
        }),
        {
          equals: (value, previous) => value.value === previous.value,
        },
      );
      const initial = parity();

      counter.increase(2);

      expect(parity()).toBe(initial);

      counter.increase(1);

      expect(parity()).toEqual({ value: 1 });
    });

    injector.destroy();
  });

  it("exposes worker modules and selected worker state as Angular signals", async () => {
    const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
    const client = createWorkerClient({
      transport: clientTransport,
    });
    const host = createWorkerApp({
      providers: [Counter],
      sync: "patch",
      transport: hostTransport,
    });
    const injector = createEnvironmentInjector(
      [provideWorkerClient(client)],
      null as unknown as EnvironmentInjector,
    );
    let counter: AsyncMethodProxy<Counter> | undefined;
    let count: Signal<number> | undefined;

    await client.ready;

    runInInjectionContext(injector, () => {
      expect(injectWorkerClient()).toBe(client);

      counter = injectWorkerModule<Counter>("angularCounter");
      count = injectWorkerSignal((state) => (state as WorkerCounterState).angularCounter.count);

      expect(count()).toBe(0);
    });

    await counter?.increase(4);

    expect(count?.()).toBe(4);

    injector.destroy();
    client.dispose();
    await host.dispose();
  });
});

interface WorkerCounterState {
  readonly angularCounter: {
    readonly count: number;
  };
}
