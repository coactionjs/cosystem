import { describe, expect, it } from "vitest";

import {
  createDataTransportWorkerTransport,
  createMemoryWorkerTransportPair,
  createPostMessageWorkerTransport,
  createWorkerApp,
  createWorkerClient,
  defineModule,
  type DataTransportLike,
  type PostMessageEndpoint,
  type PostMessageEventLike,
  type WorkerMessage,
  type WorkerStateMessage,
} from "./index.js";

class WorkerCounter {
  count = 0;

  increase(step = 1): number {
    this.count += step;
    return this.count;
  }
}

defineModule(WorkerCounter, {
  actions: ["increase"],
  name: "workerCounter",
  state: ["count"],
});

describe("worker prototype", () => {
  it("delegates module method calls and syncs app state snapshots", async () => {
    const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
    const client = createWorkerClient({
      transport: clientTransport,
    });
    const host = createWorkerApp({
      providers: [WorkerCounter],
      transport: hostTransport,
    });
    const messages: WorkerStateMessage[] = [];

    client.subscribe((message) => {
      messages.push(message);
    });

    await client.ready;

    expect(client.getState()).toEqual({
      workerCounter: {
        count: 0,
      },
    });

    await expect(client.call("workerCounter", "increase", 2)).resolves.toBe(2);

    expect(client.getState()).toEqual({
      workerCounter: {
        count: 2,
      },
    });

    const counter = client.module<WorkerCounter>("workerCounter");

    await expect(counter.increase(3)).resolves.toBe(5);

    expect(client.getState()).toEqual({
      workerCounter: {
        count: 5,
      },
    });
    const patchMessages = messages.filter((message) => message.sync === "patch");

    expect(patchMessages.map((message) => message.state)).toEqual([
      {
        workerCounter: {
          count: 2,
        },
      },
      {
        workerCounter: {
          count: 5,
        },
      },
    ]);
    expect(patchMessages.every((message) => (message.patches?.length ?? 0) > 0)).toBe(true);

    client.dispose();
    await host.dispose();
  });

  it("rejects delegated calls when the remote method is missing", async () => {
    const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
    const client = createWorkerClient({
      transport: clientTransport,
    });
    const host = createWorkerApp({
      providers: [WorkerCounter],
      transport: hostTransport,
    });

    await client.ready;

    await expect(client.call("workerCounter", "missing")).rejects.toThrow("Remote worker error");

    client.dispose();
    await host.dispose();
  });

  it("adapts data-transport style listen and emit endpoints", async () => {
    const [hostDataTransport, clientDataTransport] = createDataTransportPair();
    const client = createWorkerClient({
      transport: createDataTransportWorkerTransport(clientDataTransport),
    });
    const host = createWorkerApp({
      providers: [WorkerCounter],
      transport: createDataTransportWorkerTransport(hostDataTransport),
    });

    await client.ready;

    await expect(client.module<WorkerCounter>("workerCounter").increase(4)).resolves.toBe(4);

    expect(client.getState()).toEqual({
      workerCounter: {
        count: 4,
      },
    });

    client.dispose();
    await host.dispose();
  });

  it("adapts postMessage endpoints for worker clients and hosts", async () => {
    const [hostEndpoint, clientEndpoint] = createPostMessageEndpointPair();
    const ignoredMessages: unknown[] = [];
    const client = createWorkerClient({
      transport: createPostMessageWorkerTransport(clientEndpoint),
    });
    const host = createWorkerApp({
      providers: [WorkerCounter],
      transport: createPostMessageWorkerTransport(hostEndpoint),
    });

    client.subscribe((message) => {
      ignoredMessages.push(message);
    });
    hostEndpoint.dispatch({ data: { type: "unknown" } });
    hostEndpoint.dispatch({ data: "not a worker message" });

    await client.ready;

    await expect(client.module<WorkerCounter>("workerCounter").increase(6)).resolves.toBe(6);

    expect(client.getState()).toEqual({
      workerCounter: {
        count: 6,
      },
    });
    expect(ignoredMessages).toHaveLength(2);

    client.dispose();
    await host.dispose();
  });

  it("removes postMessage listeners when unsubscribed", () => {
    const [endpoint] = createPostMessageEndpointPair();
    const messages: WorkerMessage[] = [];
    const unsubscribe = createPostMessageWorkerTransport(endpoint).subscribe((message) => {
      messages.push(message);
    });

    endpoint.dispatch({
      data: {
        state: {},
        sync: "snapshot",
        type: "state",
        version: 1,
      },
    });
    unsubscribe();
    endpoint.dispatch({
      data: {
        state: {},
        sync: "snapshot",
        type: "state",
        version: 2,
      },
    });

    expect(messages).toHaveLength(1);
    expect((messages[0] as WorkerStateMessage).version).toBe(1);
  });

  it("rejects pending calls when the client is disposed", async () => {
    const [, clientTransport] = createMemoryWorkerTransportPair();
    const client = createWorkerClient({
      transport: clientTransport,
    });
    const pending = client.call("workerCounter", "increase", 1);

    client.dispose();

    await expect(pending).rejects.toThrow("Worker client disposed before response.");
  });

  it("resolves client readiness after the initial state snapshot arrives", async () => {
    const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
    const client = createWorkerClient({
      transport: clientTransport,
    });
    const host = createWorkerApp({
      providers: [WorkerCounter],
      transport: hostTransport,
    });

    await client.ready;

    expect(client.getState()).toEqual({
      workerCounter: {
        count: 0,
      },
    });

    client.dispose();
    await host.dispose();
  });

  it("rejects client readiness when disposed before the initial state", async () => {
    const [, clientTransport] = createMemoryWorkerTransportPair();
    const client = createWorkerClient({
      transport: clientTransport,
    });

    client.dispose();

    await expect(client.ready).rejects.toThrow("Worker client disposed before initial state.");
  });

  it("publishes the initial worker snapshot after app startup lifecycle", async () => {
    class StartedCounter {
      count = 0;

      onStart(): void {
        this.count = 7;
      }
    }

    defineModule(StartedCounter, {
      name: "startedCounter",
      state: ["count"],
    });

    const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
    const client = createWorkerClient({
      transport: clientTransport,
    });
    const host = createWorkerApp({
      providers: [StartedCounter],
      transport: hostTransport,
    });

    await client.ready;

    expect(client.getState()).toEqual({
      startedCounter: {
        count: 7,
      },
    });

    client.dispose();
    await host.dispose();
  });
});

function createDataTransportPair(): readonly [DataTransportLike, DataTransportLike] {
  const leftListeners = new Map<WorkerMessage["type"], Set<(message: WorkerMessage) => unknown>>();
  const rightListeners = new Map<WorkerMessage["type"], Set<(message: WorkerMessage) => unknown>>();

  return [
    createDataTransportEndpoint(leftListeners, rightListeners),
    createDataTransportEndpoint(rightListeners, leftListeners),
  ];
}

function createPostMessageEndpointPair(): readonly [
  MockPostMessageEndpoint,
  MockPostMessageEndpoint,
] {
  const left = new MockPostMessageEndpoint();
  const right = new MockPostMessageEndpoint();

  left.peer = right;
  right.peer = left;

  return [left, right];
}

class MockPostMessageEndpoint implements PostMessageEndpoint {
  peer: MockPostMessageEndpoint | undefined;
  readonly listeners = new Set<(event: PostMessageEventLike) => void>();

  postMessage(message: WorkerMessage): void {
    this.peer?.dispatch({ data: message });
  }

  addEventListener(_type: "message", listener: (event: PostMessageEventLike) => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: "message", listener: (event: PostMessageEventLike) => void): void {
    this.listeners.delete(listener);
  }

  dispatch(event: PostMessageEventLike): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

function createDataTransportEndpoint(
  inbox: Map<WorkerMessage["type"], Set<(message: WorkerMessage) => unknown>>,
  outbox: Map<WorkerMessage["type"], Set<(message: WorkerMessage) => unknown>>,
): DataTransportLike {
  return {
    emit(options, message) {
      const name = typeof options === "string" ? options : options.name;
      const listeners = outbox.get(name);

      if (listeners === undefined) {
        return Promise.resolve(undefined);
      }

      let result: unknown;

      for (const listener of listeners) {
        result = listener(message);
      }

      return Promise.resolve(result);
    },
    listen(name, listener) {
      let listeners = inbox.get(name);

      if (listeners === undefined) {
        listeners = new Set();
        inbox.set(name, listeners);
      }

      listeners.add(listener);

      return () => {
        listeners.delete(listener);

        if (listeners.size === 0) {
          inbox.delete(name);
        }
      };
    },
  };
}
