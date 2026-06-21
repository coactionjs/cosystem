# Worker Counter Prototype

This example uses the in-memory transport pair so the call flow is visible
without Worker bootstrapping code. A real Web Worker adapter can implement the
same `WorkerTransport` contract.

```ts
import {
  createBroadcastWorkerTransport,
  createMemoryWorkerTransportPair,
  createPostMessageWorkerTransport,
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
  sync: "patch",
  transport: hostTransport,
});

await client.ready;

const counter = client.module<Counter>("counter");

await counter.increase(2);

type CounterState = {
  readonly counter: {
    readonly count: number;
  };
};

const selectCount = (state: unknown) => (state as CounterState).counter.count;
const unsubscribeCount = client.watch(selectCount, (value) => {
  console.log(value);
});

console.log(client.select(selectCount));

unsubscribeCount();
client.dispose();
await host.dispose();
```

Worker hosts can isolate published state to selected top-level module sections:

```ts
const isolatedHost = createWorkerApp({
  providers: [Counter],
  stateSections: ["counter"],
  sync: "patch",
  transport: hostTransport,
});

await isolatedHost.dispose();
```

For a real Web Worker or `MessagePort`, use the `postMessage` adapter on the
endpoint that owns `postMessage`, `addEventListener`, and `removeEventListener`:

```ts
const worker = new Worker(new URL("./counter.worker.ts", import.meta.url), {
  type: "module",
});

const client = createWorkerClient({
  transport: createPostMessageWorkerTransport(worker),
});

await client.ready;
```

For shared tabs, use a `BroadcastChannel` transport. The client subscribes
before the host starts so it receives the initial snapshot:

```ts
const hostChannel = new BroadcastChannel("counter-runtime");
const clientChannel = new BroadcastChannel("counter-runtime");

const sharedClient = createWorkerClient({
  transport: createBroadcastWorkerTransport(clientChannel, {
    peerId: "tab:client",
    targetPeerId: "tab:host",
  }),
});

const sharedHost = createWorkerApp({
  providers: [Counter],
  sync: "patch",
  transport: createBroadcastWorkerTransport(hostChannel, {
    peerId: "tab:host",
  }),
});

await sharedClient.ready;
await sharedClient.module<Counter>("counter").increase(1);

sharedClient.dispose();
await sharedHost.dispose();
hostChannel.close();
clientChannel.close();
```
