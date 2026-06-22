# Worker & Shared Runtime

`@cosystem/core` includes a worker-hosting prototype: run an app (and its
modules) in a Web Worker, iframe, `MessagePort`, `BroadcastChannel`, or custom
RPC channel, and consume its state from another context with the same selector
and module ergonomics you use on the main thread.

Because business logic is plain modules, **moving it off-thread does not change
the modules** — only where they run.

## The host/client model

```txt
Host (e.g. Worker thread)                 Client (e.g. UI thread)
┌───────────────────────────┐  transport  ┌───────────────────────────┐
│ createWorkerApp({          │ ──────────► │ createWorkerClient({      │
│   providers, sync, ...     │ ◄────────── │   transport, onConflict   │
│ })                         │  messages   │ })                        │
│  runs real CoSystem app    │             │  state mirror + RPC proxy │
└───────────────────────────┘             └───────────────────────────┘
```

- The **host** runs an actual CoSystem app and publishes state over a transport.
- The **client** mirrors that state, exposes selectors, and delegates module
  method calls back to the host as RPC.

```ts
import {
  createMemoryWorkerTransportPair,
  createWorkerApp,
  createWorkerClient,
} from "@cosystem/core";

const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();

const client = createWorkerClient({ transport: clientTransport });
const host = createWorkerApp({
  providers: [Counter],
  sync: "patch",
  transport: hostTransport,
});

await client.ready; // resolves once the initial snapshot arrives
await client.module<Counter>("counter").increase(1);

const selectCount = (state: unknown) => (state as { counter: { count: number } }).counter.count;
const count = client.select(selectCount);
const unsubscribe = client.watch(selectCount, (value) => console.log(value));

unsubscribe();
client.dispose();
await host.dispose();
```

## The `WorkerClient` API

```ts
interface WorkerClient {
  readonly ready: Promise<void>; // resolves after the first snapshot
  readonly state: { readonly version: number };
  getState(): unknown;
  select<T>(selector): T; // read derived state synchronously
  watch<T>(selector, listener, opts?): () => void; // subscribe (equals/immediate)
  call(module, method, ...args): Promise<unknown>;
  module<T>(name): AsyncMethodProxy<T>; // typed async method proxy
  subscribe(listener): () => void; // low-level state-message subscription
  dispose(): void;
}
```

`module<T>(name)` returns an `AsyncMethodProxy<T>`: every method becomes
`(...args) => Promise<...>`, since each call is delegated across the transport.

## Transports

A transport is just `{ post(message), subscribe(listener) }`. The package ships
adapters for the common channels — all interchangeable:

| Factory                                             | Use for                                     |
| --------------------------------------------------- | ------------------------------------------- |
| `createMemoryWorkerTransportPair()`                 | In-process host/client pair (tests, demos). |
| `createPostMessageWorkerTransport(endpoint)`        | `Worker`, iframe, or `MessagePort`.         |
| `createBroadcastWorkerTransport(channel, opts)`     | Shared tabs via `BroadcastChannel`.         |
| `createDataTransportWorkerTransport(dataTransport)` | Process/socket/custom RPC.                  |

### Web Worker

```ts
// worker.ts
import { createPostMessageWorkerTransport, createWorkerApp } from "@cosystem/core";
createWorkerApp({
  providers: [Counter],
  sync: "patch",
  transport: createPostMessageWorkerTransport(globalThis as any),
});

// main.ts
const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
const client = createWorkerClient({
  transport: createPostMessageWorkerTransport(worker),
});
await client.ready;
```

### Shared tabs (BroadcastChannel)

The client should subscribe before the host starts so it receives the initial
snapshot. Identify peers with `peerId` / `targetPeerId`:

```ts
const client = createWorkerClient({
  transport: createBroadcastWorkerTransport(new BroadcastChannel("counter"), {
    peerId: "tab:client",
    targetPeerId: "tab:host",
  }),
});

const host = createWorkerApp({
  providers: [Counter],
  sync: "patch",
  transport: createBroadcastWorkerTransport(new BroadcastChannel("counter"), {
    peerId: "tab:host",
  }),
});
```

Tests and non-browser environments can use `createMemoryBroadcastChannel()` with
the same API.

## Sync modes

`createWorkerApp({ sync })` controls how the host publishes state:

- `"snapshot"` (default) — sends a full state snapshot on each change.
- `"patch"` — sends the initial snapshot, then **patch-only** diffs. The client
  applies patches locally. Requires fewer bytes for large state.

The host enables patch generation internally for `"patch"` mode.

## Isolating state sections

A host can publish only selected top-level module slices with `stateSections`.
Method delegation still works for **all** hosted modules, but snapshots and
patches only include the configured sections:

```ts
createWorkerApp({
  providers: [Counter, Secret],
  stateSections: ["counter"], // "secret" stays private to the host
  sync: "patch",
  transport: hostTransport,
});
```

## Conflict handling

The client can observe sync anomalies via `onConflict`:

```ts
const client = createWorkerClient({
  transport: clientTransport,
  onConflict(event) {
    console.warn(event.reason, event.currentVersion, event.incomingVersion);
  },
});
```

`WorkerConflictReason` is one of:

| Reason               | Meaning                                           |
| -------------------- | ------------------------------------------------- |
| `stale-message`      | A message older than the current version arrived. |
| `missing-snapshot`   | A patch arrived before any snapshot.              |
| `version-gap`        | A patch skipped a version (a message was lost).   |
| `patch-apply-failed` | A patch could not be applied to local state.      |

## Consuming from a UI framework

Every adapter ships `WorkerClient`-based helpers, so worker state renders just
like local state:

```tsx
// React
import { WorkerClientProvider, useWorkerModule, useWorkerSelector } from "@cosystem/react";

function View() {
  const counter = useWorkerModule<Counter>("counter");
  const count = useWorkerSelector((s) => (s as State).counter.count);
  return <button onClick={() => counter.increase()}>{count}</button>;
}

<WorkerClientProvider client={client}>
  <View />
</WorkerClientProvider>;
```

See [UI Adapters](./ui-adapters.md#consuming-worker-hosted-state) for the
per-framework helper names.

## What the prototype covers (and doesn't)

Covered: app creation, method delegation, initial snapshots, patch-only sync after
startup, client readiness, selector watches, `postMessage` endpoints, a
`data-transport`-style `listen`/`emit` bridge, and BroadcastChannel shared-tab
coordination with routed call results.

Not covered: full shared-runtime conflict _resolution_ (it reports conflicts, it
does not merge them) and framework-specific worker bootstrapping. It reuses
Coaction's transport/worker primitives rather than reimplementing a full shared
runtime.

## Next

- [`@cosystem/core` worker reference](../packages/core/README.md#worker--shared-runtime)
- The runnable [`worker-counter`](../examples/worker-counter) example.
