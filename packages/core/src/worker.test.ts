import { describe, expect, it } from "vitest";

import {
  createDataTransportWorkerTransport,
  createMemoryWorkerTransportPair,
  createWorkerApp,
  createWorkerClient,
  defineModule,
  type DataTransportLike,
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

    await host.ready;

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

    await host.ready;

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

    await host.ready;

    await expect(client.module<WorkerCounter>("workerCounter").increase(4)).resolves.toBe(4);

    expect(client.getState()).toEqual({
      workerCounter: {
        count: 4,
      },
    });

    client.dispose();
    await host.dispose();
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

    await host.ready;

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
