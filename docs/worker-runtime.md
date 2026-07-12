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
  callWithOptions(module, method, args, { timeout, signal }): Promise<unknown>;
  module<T>(name): AsyncMethodProxy<T>; // typed async method proxy
  subscribe(listener): () => void; // low-level state-message subscription
  dispose(): void;
}
```

`module<T>(name)` returns an `AsyncMethodProxy<T>`: every method becomes
`(...args) => Promise<...>`, since each call is delegated across the transport.
When a delegated method settles, the client waits until its mirrored state has
reached the worker state version observed by that method result. If the result
arrives before the corresponding state message, the client requests a snapshot
sync and resolves or rejects the method promise only after the local mirror is
caught up.

Disposal is terminal on both sides. `host.dispose()` first starts app disposal,
which aborts plugin setup through `PluginContext.signal`, and only then waits for
startup to settle; this prevents initialization/disposal deadlocks. Repeated
host disposal shares one promise. If disposal wins the race with initial state
publication, `host.ready` rejects instead of reporting a host that never became
observable as ready. `client.dispose()` rejects pending calls and all later
`call()` / module-proxy requests immediately instead of posting work that can
no longer receive a response.

RPC calls default to a 30-second timeout (`requestTimeout` on
`createWorkerClient`; `0` disables it). Use `callWithOptions()` for a per-call
timeout or `AbortSignal`. Remote invocation is restricted to methods explicitly
listed in the module's `actions` metadata; ordinary methods, lifecycle hooks,
computed properties, and arbitrary callable fields are not remotely exposed.

## Trust boundary

Every inbound protocol envelope is runtime-validated: call IDs, module/method
names, argument arrays, result errors, state versions/sections, sync fields, and
patch operations/paths must match the complete message schema. Malformed input
is dropped and can be observed with `onInvalidMessage`. Unsafe patch path
segments such as `__proto__` are rejected.

Schema validation and the action allowlist limit capabilities, but a bare
`WorkerTransport` does not authenticate its peer. Connect bare/custom and
data-transport adapters only to trusted endpoints, or enforce authentication in
the underlying channel. For cross-origin/ambient channels, use the adapter
controls below:

- `createPostMessageWorkerTransport`: set `targetOrigin`, `allowedOrigins`, and
  `expectedSource` for iframe/window messaging. Omitting them is appropriate
  only for dedicated `Worker`/`MessagePort` endpoints already held as trusted
  capabilities.
- `createBroadcastWorkerTransport`: set the same unpredictable `authToken` on
  host and clients. Messages with a different token are ignored. A
  `BroadcastChannel` peer can observe traffic, so this is a routing capability,
  not cryptographic authentication; use it only among trusted same-origin code
  or put the protocol over an authenticated custom transport.

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

For an iframe, bind both directions explicitly instead of using wildcard
origins:

```ts
const transport = createPostMessageWorkerTransport(window as any, {
  source: window as any,
  target: iframe.contentWindow as any,
  targetOrigin: "https://trusted.example",
  allowedOrigins: ["https://trusted.example"],
  expectedSource: iframe.contentWindow,
});
```

### Shared tabs (BroadcastChannel)

The client should subscribe before the host starts so it receives the initial
snapshot. Identify peers with `peerId` / `targetPeerId`:

```ts
const client = createWorkerClient({
  transport: createBroadcastWorkerTransport(new BroadcastChannel("counter"), {
    authToken: sharedRandomCapability,
    peerId: "tab:client",
    targetPeerId: "tab:host",
  }),
});

const host = createWorkerApp({
  providers: [Counter],
  sync: "patch",
  transport: createBroadcastWorkerTransport(new BroadcastChannel("counter"), {
    authToken: sharedRandomCapability,
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
