import { describe, expect, it } from "vitest";

import {
  createMemoryWorkerTransportPair,
  createWorkerApp,
  createWorkerClient,
  defineModule,
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
    expect(messages.map((message) => message.state)).toEqual([
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
    expect(messages.map((message) => message.sync)).toEqual(["patch", "patch"]);
    expect(messages.every((message) => (message.patches?.length ?? 0) > 0)).toBe(true);

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

    await expect(client.call("workerCounter", "missing")).rejects.toThrow("Remote worker error");

    client.dispose();
    await host.dispose();
  });
});
