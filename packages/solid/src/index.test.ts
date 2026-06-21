import { createRoot, getOwner, runWithOwner, type Accessor } from "solid-js";
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
  CoSystemProvider,
  WorkerClientProvider,
  useApp,
  useComputed,
  useModule,
  useWorkerModule,
  useWorkerSelector,
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
  name: "solidCounter",
  state: ["count"],
});

describe("Solid adapter", () => {
  it("provides modules and computed accessors through Solid context", () => {
    const app = createApp({
      providers: [Counter],
    });
    let verified = false;

    createRoot((dispose) => {
      CoSystemProvider({
        app,
        get children() {
          const owner = getOwner();

          if (owner === null) {
            throw new Error("Missing Solid owner.");
          }

          runWithOwner(owner, () => {
            expect(useApp()).toBe(app);

            const counter = useModule(Counter);
            const double = useComputed(Counter, (module) => module.double);

            expect(double()).toBe(0);

            counter.increase(2);

            expect(double()).toBe(4);
            verified = true;
          });

          return undefined;
        },
      });

      dispose();
    });

    expect(verified).toBe(true);
  });

  it("applies equality before updating computed accessors", () => {
    const app = createApp({
      providers: [Counter],
    });
    let verified = false;

    createRoot((dispose) => {
      CoSystemProvider({
        app,
        get children() {
          const owner = getOwner();

          if (owner === null) {
            throw new Error("Missing Solid owner.");
          }

          runWithOwner(owner, () => {
            const counter = useModule(Counter);
            const parity = useComputed(
              (currentApp) => ({
                parity: currentApp.getModule(Counter).count % 2,
              }),
              {
                equals: (value, previous) => value.parity === previous.parity,
              },
            );
            const initial = parity();

            counter.increase(2);

            expect(parity()).toBe(initial);

            counter.increase(1);

            expect(parity()).toEqual({ parity: 1 });
            verified = true;
          });

          return undefined;
        },
      });

      dispose();
    });

    expect(verified).toBe(true);
  });

  it("provides worker modules and selector accessors through Solid context", async () => {
    const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
    const client = createWorkerClient({
      transport: clientTransport,
    });
    const host = createWorkerApp({
      providers: [Counter],
      sync: "patch",
      transport: hostTransport,
    });
    let disposeRoot: (() => void) | undefined;
    let counter: AsyncMethodProxy<Counter> | undefined;
    let count: Accessor<number> | undefined;

    await client.ready;

    createRoot((dispose) => {
      disposeRoot = dispose;

      WorkerClientProvider({
        client,
        get children() {
          const owner = getOwner();

          if (owner === null) {
            throw new Error("Missing Solid owner.");
          }

          runWithOwner(owner, () => {
            counter = useWorkerModule<Counter>("solidCounter");
            count = useWorkerSelector((state) => (state as WorkerCounterState).solidCounter.count);

            expect(count()).toBe(0);
          });

          return undefined;
        },
      });
    });

    await counter?.increase(4);

    expect(count?.()).toBe(4);

    disposeRoot?.();
    client.dispose();
    await host.dispose();
  });
});

interface WorkerCounterState {
  readonly solidCounter: {
    readonly count: number;
  };
}
