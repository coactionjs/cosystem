# Worker Counter Prototype

This example uses the in-memory transport pair so the call flow is visible
without Worker bootstrapping code. A real Web Worker adapter can implement the
same `WorkerTransport` contract.

```ts
import {
  createMemoryWorkerTransportPair,
  createWorkerApp,
  createWorkerClient,
  defineModule,
} from "@cosystem/core";

class Counter {
  count = 0;

  increase(step = 1): number {
    this.count += step;
    return this.count;
  }
}

defineModule(Counter, {
  actions: ["increase"],
  name: "counter",
  state: ["count"],
});

const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();

const client = createWorkerClient({
  transport: clientTransport,
});

const host = createWorkerApp({
  providers: [Counter],
  transport: hostTransport,
});

await host.ready;

const counter = client.module<Counter>("counter");

await counter.increase(2);

console.log(client.getState());

client.dispose();
await host.dispose();
```
