import { get } from "svelte/store";
import { afterEach, describe, expect, it } from "vitest";

import {
  createApp,
  createMemoryWorkerTransportPair,
  createWorkerApp,
  createWorkerClient,
  defineModule,
} from "@cosystem/core";

import {
  clearCoSystemApp,
  clearWorkerClient,
  moduleStore,
  selectedModuleStore,
  selectorStore,
  setCoSystemApp,
  setWorkerClient,
  workerModuleStore,
  workerSelectorStore,
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
  name: "svelteCounter",
  state: ["count"],
});

describe("Svelte adapter", () => {
  afterEach(() => {
    clearCoSystemApp();
    clearWorkerClient();
  });

  it("exposes modules through Svelte readable stores", () => {
    const app = createApp({
      providers: [Counter],
    });
    setCoSystemApp(app);

    const counter = get(moduleStore(Counter));

    counter.increase(2);

    expect(counter.count).toBe(2);
  });

  it("updates selected readable stores from app state changes", () => {
    const app = createApp({
      providers: [Counter],
    });
    const counter = app.getModule(Counter);
    setCoSystemApp(app);

    const values: number[] = [];
    const store = selectedModuleStore(Counter, (module) => module.double);
    const unsubscribe = store.subscribe((value) => {
      values.push(value);
    });

    counter.increase(3);

    expect(get(store)).toBe(6);
    expect(values).toEqual([0, 6]);

    unsubscribe();
  });

  it("applies selector equality before publishing store values", () => {
    const app = createApp({
      providers: [Counter],
    });
    const counter = app.getModule(Counter);
    setCoSystemApp(app);

    const values: Array<{ readonly parity: number }> = [];
    const store = selectorStore(
      (currentApp) => ({
        parity: currentApp.getModule(Counter).count % 2,
      }),
      {
        equals: (value, previous) => value.parity === previous.parity,
      },
    );
    const unsubscribe = store.subscribe((value) => {
      values.push(value);
    });

    counter.increase(2);
    counter.increase(1);

    expect(values).toEqual([{ parity: 0 }, { parity: 1 }]);

    unsubscribe();
  });

  it("updates worker selector stores from worker-hosted state changes", async () => {
    const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
    const client = createWorkerClient({
      transport: clientTransport,
    });
    const host = createWorkerApp({
      providers: [Counter],
      sync: "patch",
      transport: hostTransport,
    });

    await client.ready;
    setWorkerClient(client);

    const counter = get(workerModuleStore<Counter>("svelteCounter"));
    const values: number[] = [];
    const store = workerSelectorStore((state) => (state as WorkerCounterState).svelteCounter.count);
    const unsubscribe = store.subscribe((value) => {
      values.push(value);
    });

    await counter.increase(3);

    expect(get(store)).toBe(3);
    expect(values).toEqual([0, 3]);

    unsubscribe();
    client.dispose();
    await host.dispose();
  });
});

interface WorkerCounterState {
  readonly svelteCounter: {
    readonly count: number;
  };
}
