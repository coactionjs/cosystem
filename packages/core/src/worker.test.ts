import { describe, expect, it } from "vitest";

import {
  createBroadcastWorkerTransport,
  createDataTransportWorkerTransport,
  createMemoryBroadcastChannel,
  createMemoryWorkerTransportPair,
  createPostMessageWorkerTransport,
  createWorkerApp,
  createWorkerClient,
  defineModule,
  lazyModule,
  type DataTransportLike,
  type PostMessageEndpoint,
  type PostMessageEventLike,
  type WorkerTransport,
  type WorkerConflictEvent,
  type WorkerMessage,
  type WorkerStateMessage,
} from "./index.js";

class WorkerCounter {
  count = 0;

  increase(step = 1): number {
    this.count += step;
    return this.count;
  }

  readCount(): number {
    return this.count;
  }
}

defineModule(WorkerCounter, {
  actions: ["increase"],
  name: "workerCounter",
  state: ["count"],
});

class WorkerFailingCounter {
  count = 0;

  async failAfterIncrease(): Promise<void> {
    await Promise.resolve();
    this.count += 1;
    throw new Error("fail after increase");
  }
}

defineModule(WorkerFailingCounter, {
  actions: ["failAfterIncrease"],
  name: "workerFailingCounter",
  state: ["count"],
});

class WorkerHidden {
  value = "initial";

  set(value: string): string {
    this.value = value;
    return this.value;
  }
}

defineModule(WorkerHidden, {
  actions: ["set"],
  name: "workerHidden",
  state: ["value"],
});

describe("worker prototype", () => {
  it("disposes the worker app when transport subscription fails", async () => {
    const subscribeError = new Error("host subscribe failed");
    const events: string[] = [];

    class SubscriptionFailureModule {
      onDispose(): void {
        events.push("dispose");
      }
    }

    defineModule(SubscriptionFailureModule, { name: "subscriptionFailureModule" });

    expect(() =>
      createWorkerApp({
        providers: [SubscriptionFailureModule],
        transport: {
          post() {},
          subscribe() {
            throw subscribeError;
          },
        },
      }),
    ).toThrow(subscribeError);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["dispose"]);
  });

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

  it("isolates memory worker messages with structured cloning", async () => {
    const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
    const client = createWorkerClient({ transport: clientTransport });
    const host = createWorkerApp({
      providers: [WorkerCounter],
      transport: hostTransport,
    });

    await client.ready;
    const clientState = client.getState() as {
      workerCounter: { count: number };
    };
    clientState.workerCounter.count = 99;

    expect(host.app.getModule(WorkerCounter).count).toBe(0);
    await expect(client.module<WorkerCounter>("workerCounter").increase(1)).resolves.toBe(1);
    expect(client.getState()).toEqual({ workerCounter: { count: 1 } });

    client.dispose();
    await host.dispose();
  });

  it("isolates memory transport subscribers from each other", () => {
    const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
    const received: WorkerMessage[] = [];

    clientTransport.subscribe((message) => {
      if (message.type === "state" && message.state !== undefined) {
        (message.state as { counter: { count: number } }).counter.count = 99;
      }

      throw new Error("subscriber failed");
    });
    clientTransport.subscribe((message) => {
      received.push(message);
    });

    expect(() =>
      hostTransport.post({
        state: { counter: { count: 1 } },
        sync: "snapshot",
        type: "state",
        version: 1,
      }),
    ).not.toThrow();
    expect(received).toEqual([
      {
        state: { counter: { count: 1 } },
        sync: "snapshot",
        type: "state",
        version: 1,
      },
    ]);
  });

  it("exposes only actions declared in module metadata to remote calls", async () => {
    const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
    const client = createWorkerClient({ transport: clientTransport });
    const host = createWorkerApp({
      providers: [WorkerCounter],
      transport: hostTransport,
    });

    await client.ready;

    await expect(client.call("workerCounter", "readCount")).rejects.toThrow(
      "workerCounter.readCount is not exposed as a remote action",
    );
    await expect(client.call("workerCounter", "increase", 1)).resolves.toBe(1);

    client.dispose();
    await host.dispose();
  });

  it("observes failures while posting worker call results", async () => {
    const listeners = new Set<(message: WorkerMessage) => void>();
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (error: unknown) => {
      unhandledRejections.push(error);
    };
    let failPosts = false;
    const host = createWorkerApp({
      providers: [WorkerCounter],
      transport: {
        post() {
          if (failPosts) {
            throw new Error("result post failed");
          }
        },
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      },
    });
    await host.ready;
    failPosts = true;
    process.on("unhandledRejection", onUnhandledRejection);

    try {
      for (const listener of listeners) {
        listener({
          args: [1],
          id: 1,
          method: "increase",
          module: "workerCounter",
          type: "call",
        });
      }

      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }

    expect(host.app.getModule(WorkerCounter).count).toBe(1);
    expect(unhandledRejections).toEqual([]);
    failPosts = false;
    await host.dispose();
  });

  it("syncs state before resolving delegated calls when result arrives before state", async () => {
    const pair = createControlledWorkerTransportPair();
    const conflicts: WorkerConflictEvent[] = [];
    const client = createWorkerClient({
      onConflict: (event) => {
        conflicts.push(event);
      },
      transport: pair.clientTransport,
    });
    const host = createWorkerApp({
      providers: [WorkerCounter],
      transport: pair.hostTransport,
    });
    const countsAtResolution: number[] = [];

    await client.ready;
    pair.holdNextPatchStateMessage();

    await expect(
      client
        .module<WorkerCounter>("workerCounter")
        .increase(2)
        .then((value) => {
          countsAtResolution.push(client.select(selectWorkerCount));
          return value;
        }),
    ).resolves.toBe(2);

    expect(pair.syncRequests).toEqual([1]);
    expect(pair.heldStateMessages.map((message) => message.version)).toEqual([1]);
    expect(countsAtResolution).toEqual([2]);
    expect(client.select(selectWorkerCount)).toBe(2);
    pair.releaseHeldStateMessages();
    expect(conflicts).toEqual([]);

    client.dispose();
    await host.dispose();
  });

  it("rejects pending calls when a state sync request cannot be posted", async () => {
    const syncError = new Error("sync post failed");
    let deliver!: (message: WorkerMessage) => void;
    let failSync = true;
    const successfulSyncs: number[] = [];
    const client = createWorkerClient({
      requestTimeout: 0,
      transport: {
        post(message) {
          if (message.type === "sync") {
            if (failSync) {
              throw syncError;
            }

            successfulSyncs.push(message.stateVersion ?? -1);
          }
        },
        subscribe(listener) {
          deliver = listener;
          return () => undefined;
        },
      },
    });
    const pending = client.call("workerCounter", "increase", 1);

    deliver({
      id: 1,
      stateVersion: 1,
      type: "result",
      value: 1,
    });

    await expect(pending).rejects.toBe(syncError);

    failSync = false;
    const retry = client.call("workerCounter", "increase", 1);
    deliver({
      id: 2,
      stateVersion: 1,
      type: "result",
      value: 1,
    });

    expect(successfulSyncs).toEqual([1]);
    deliver({
      state: { workerCounter: { count: 1 } },
      sync: "snapshot",
      type: "state",
      version: 1,
    });
    await expect(retry).resolves.toBe(1);
    client.dispose();
  });

  it("syncs state before rejecting delegated calls when result arrives before state", async () => {
    const pair = createControlledWorkerTransportPair();
    const conflicts: WorkerConflictEvent[] = [];
    const client = createWorkerClient({
      onConflict: (event) => {
        conflicts.push(event);
      },
      transport: pair.clientTransport,
    });
    const host = createWorkerApp({
      providers: [WorkerFailingCounter],
      transport: pair.hostTransport,
    });
    const countsAtRejection: number[] = [];

    await client.ready;
    pair.holdNextPatchStateMessage();

    await expect(
      client
        .module<WorkerFailingCounter>("workerFailingCounter")
        .failAfterIncrease()
        .catch((error: unknown) => {
          countsAtRejection.push(client.select(selectFailingWorkerCount));
          throw error;
        }),
    ).rejects.toThrow("Remote worker error: fail after increase");

    expect(pair.syncRequests).toEqual([1]);
    expect(pair.heldStateMessages.map((message) => message.version)).toEqual([1]);
    expect(countsAtRejection).toEqual([1]);
    expect(client.select(selectFailingWorkerCount)).toBe(1);
    pair.releaseHeldStateMessages();
    expect(conflicts).toEqual([]);

    client.dispose();
    await host.dispose();
  });

  it("waits for the initial version-zero snapshot before settling a call", async () => {
    const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
    const syncRequests: number[] = [];
    const unsubscribeHost = hostTransport.subscribe((message) => {
      if (message.type === "call") {
        hostTransport.post({
          id: message.id,
          stateVersion: 0,
          type: "result",
          value: "done",
        });
      } else if (message.type === "sync" && message.stateVersion !== undefined) {
        syncRequests.push(message.stateVersion);
      }
    });
    const client = createWorkerClient({
      transport: clientTransport,
    });
    let settled = false;
    const call = client.call("workerCounter", "increase", 1).then((value) => {
      settled = true;
      return value;
    });

    await Promise.resolve();

    expect(settled).toBe(false);
    expect(syncRequests).toEqual([0]);

    hostTransport.post({
      state: { workerCounter: { count: 0 } },
      sync: "snapshot",
      type: "state",
      version: 0,
    });

    await expect(call).resolves.toBe("done");
    await expect(client.ready).resolves.toBeUndefined();
    expect(client.getState()).toEqual({ workerCounter: { count: 0 } });

    client.dispose();
    unsubscribeHost();
  });

  it("selects and watches worker state through a reactive client contract", async () => {
    const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
    const client = createWorkerClient({
      transport: clientTransport,
    });
    const values: number[] = [];
    const unsubscribe = client.watch(
      selectWorkerCount,
      (value) => {
        values.push(value);
      },
      {
        immediate: true,
      },
    );
    const host = createWorkerApp({
      providers: [WorkerCounter],
      transport: hostTransport,
    });

    expect(() => client.select(selectWorkerCount)).toThrow("Worker client state is not ready");

    await client.ready;

    expect(client.select(selectWorkerCount)).toBe(0);

    await client.module<WorkerCounter>("workerCounter").increase(2);

    expect(client.select(selectWorkerCount)).toBe(2);
    expect(values).toEqual([0, 2]);

    unsubscribe();
    await client.module<WorkerCounter>("workerCounter").increase(3);

    expect(values).toEqual([0, 2]);

    client.dispose();
    await host.dispose();
  });

  it("applies patch-only worker state messages on the client", async () => {
    const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
    const client = createWorkerClient({
      transport: clientTransport,
    });
    const host = createWorkerApp({
      providers: [WorkerCounter],
      sync: "patch",
      transport: hostTransport,
    });
    const messages: WorkerStateMessage[] = [];

    client.subscribe((message) => {
      messages.push(message);
    });

    await client.ready;

    await client.module<WorkerCounter>("workerCounter").increase(2);

    const patchMessage = messages.find((message) => message.sync === "patch");

    expect(patchMessage).toMatchObject({
      patches: expect.any(Array),
      sync: "patch",
    });
    expect(patchMessage).not.toHaveProperty("state");
    expect(client.getState()).toEqual({
      workerCounter: {
        count: 2,
      },
    });
    expect(client.select(selectWorkerCount)).toBe(2);

    client.dispose();
    await host.dispose();
  });

  it("publishes one worker version for an atomic lazy effect commit", async () => {
    class AtomicLazyWorkerModule {
      count = 0;

      initializeCount(): void {
        if (this.count === 0) {
          this.setCount(1);
        }
      }

      setCount(value: number): void {
        this.count = value;
      }
    }

    defineModule(AtomicLazyWorkerModule, {
      actions: ["setCount"],
      effects: ["initializeCount"],
      name: "atomicLazyWorkerModule",
      state: ["count"],
    });

    const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
    const conflicts: WorkerConflictEvent[] = [];
    const messages: WorkerStateMessage[] = [];
    const client = createWorkerClient({
      onConflict(event) {
        conflicts.push(event);
      },
      transport: clientTransport,
    });
    const host = createWorkerApp({
      sync: "patch",
      transport: hostTransport,
    });

    client.subscribe((message) => {
      messages.push(message);
    });

    await client.ready;
    await host.app.load(lazyModule(() => AtomicLazyWorkerModule));

    expect(host.app.store.getPureState()).toEqual({
      atomicLazyWorkerModule: { count: 1 },
    });
    expect(client.getState()).toEqual({
      atomicLazyWorkerModule: { count: 1 },
    });
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      patches: [{ op: "add" }, { op: "replace" }],
      sync: "patch",
      version: 1,
    });
    expect(conflicts).toEqual([]);

    client.dispose();
    await host.dispose();
  });

  it("rejects invalid and out-of-range array indices in worker state patches", async () => {
    const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
    const conflicts: WorkerConflictEvent[] = [];
    const invalidMessages: unknown[] = [];
    const client = createWorkerClient({
      onConflict(event) {
        conflicts.push(event);
      },
      onInvalidMessage(message) {
        invalidMessages.push(message);
      },
      transport: clientTransport,
    });

    hostTransport.post({
      state: { items: [1, 2] },
      sync: "snapshot",
      type: "state",
      version: 0,
    });
    await client.ready;

    hostTransport.post({
      patches: [{ op: "remove", path: ["items", -1] }],
      sync: "patch",
      type: "state",
      version: 1,
    });
    hostTransport.post({
      patches: [{ op: "remove", path: ["items", 1.5] }],
      sync: "patch",
      type: "state",
      version: 1,
    });
    hostTransport.post({
      patches: [{ op: "remove", path: ["items", "-1"] }],
      sync: "patch",
      type: "state",
      version: 1,
    });
    hostTransport.post({
      patches: [{ op: "replace", path: ["items", 2], value: 3 }],
      sync: "patch",
      type: "state",
      version: 1,
    });
    hostTransport.post({
      patches: [{ op: "remove", path: ["items", 2] }],
      sync: "patch",
      type: "state",
      version: 1,
    });
    hostTransport.post({
      patches: [{ op: "add", path: ["items", 3], value: 3 }],
      sync: "patch",
      type: "state",
      version: 1,
    });
    hostTransport.post({
      patches: [{ op: "add", path: "/items/~2", value: 3 }],
      sync: "patch",
      type: "state",
      version: 1,
    });

    expect(invalidMessages).toHaveLength(3);
    expect(conflicts.map((event) => event.reason)).toEqual([
      "patch-apply-failed",
      "patch-apply-failed",
      "patch-apply-failed",
      "patch-apply-failed",
    ]);
    expect(client.getState()).toEqual({ items: [1, 2] });
    expect(client.state.version).toBe(0);

    hostTransport.post({
      patches: [{ op: "add", path: ["items", 2], value: 3 }],
      sync: "patch",
      type: "state",
      version: 1,
    });

    expect(client.getState()).toEqual({ items: [1, 2, 3] });
    expect(client.state.version).toBe(1);

    client.dispose();
  });

  it("treats a slash patch path as an empty property instead of the root", async () => {
    const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
    const client = createWorkerClient({ transport: clientTransport });

    hostTransport.post({
      state: { "": 1, stable: true },
      sync: "snapshot",
      type: "state",
      version: 0,
    });
    await client.ready;

    hostTransport.post({
      patches: [{ op: "replace", path: "/", value: 2 }],
      sync: "patch",
      type: "state",
      version: 1,
    });

    expect(client.getState()).toEqual({ "": 2, stable: true });
    expect(client.state.version).toBe(1);
    client.dispose();
  });

  it("rejects worker patches whose object targets do not exist", async () => {
    const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
    const conflicts: WorkerConflictEvent[] = [];
    const client = createWorkerClient({
      onConflict(event) {
        conflicts.push(event);
      },
      transport: clientTransport,
    });

    hostTransport.post({
      state: { nested: { count: 1 } },
      sync: "snapshot",
      type: "state",
      version: 0,
    });
    await client.ready;

    for (const patch of [
      { op: "replace", path: "/nested/missing", value: 2 },
      { op: "remove", path: "/nested/missing" },
      { op: "add", path: "/missing/child", value: 2 },
    ] as const) {
      hostTransport.post({
        patches: [patch],
        sync: "patch",
        type: "state",
        version: 1,
      });
    }

    expect(conflicts.map((event) => event.reason)).toEqual([
      "patch-apply-failed",
      "patch-apply-failed",
      "patch-apply-failed",
    ]);
    expect(client.getState()).toEqual({ nested: { count: 1 } });
    expect(client.state.version).toBe(0);

    hostTransport.post({
      patches: [{ op: "add", path: "/nested/added", value: 2 }],
      sync: "patch",
      type: "state",
      version: 1,
    });

    expect(client.getState()).toEqual({ nested: { added: 2, count: 1 } });
    expect(client.state.version).toBe(1);
    client.dispose();
  });

  it("rejects worker patches that replace the state root with a non-record", async () => {
    const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
    const conflicts: WorkerConflictEvent[] = [];
    const client = createWorkerClient({
      onConflict(event) {
        conflicts.push(event);
      },
      transport: clientTransport,
    });

    hostTransport.post({
      state: { stable: true },
      sync: "snapshot",
      type: "state",
      version: 0,
    });
    await client.ready;

    hostTransport.post({
      patches: [{ op: "replace", path: "", value: 1 }],
      sync: "patch",
      type: "state",
      version: 1,
    });
    hostTransport.post({
      patches: [{ op: "remove", path: "" }],
      sync: "patch",
      type: "state",
      version: 1,
    });
    hostTransport.post({
      patches: [{ op: "replace", path: "", value: new Date(0) }],
      sync: "patch",
      type: "state",
      version: 1,
    });

    expect(conflicts.map((event) => event.reason)).toEqual([
      "patch-apply-failed",
      "patch-apply-failed",
      "patch-apply-failed",
    ]);
    expect(client.getState()).toEqual({ stable: true });
    expect(client.state.version).toBe(0);
    client.dispose();
  });

  it("isolates worker state sync to configured state sections", async () => {
    const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
    const client = createWorkerClient({
      transport: clientTransport,
    });
    const host = createWorkerApp({
      providers: [WorkerCounter, WorkerHidden],
      stateSections: ["workerCounter"],
      sync: "patch",
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
    expect(messages).toHaveLength(1);
    expect(messages[0]?.sections).toEqual(["workerCounter"]);

    await expect(client.module<WorkerHidden>("workerHidden").set("secret")).resolves.toBe("secret");

    expect(client.getState()).toEqual({
      workerCounter: {
        count: 0,
      },
    });
    expect(messages).toHaveLength(1);

    await client.module<WorkerCounter>("workerCounter").increase(3);

    expect(client.getState()).toEqual({
      workerCounter: {
        count: 3,
      },
    });
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      sections: ["workerCounter"],
      sync: "patch",
    });

    client.dispose();
    await host.dispose();
  });

  it("ignores inherited worker state section names", async () => {
    const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
    const client = createWorkerClient({ transport: clientTransport });
    const host = createWorkerApp({
      stateSections: ["constructor"],
      transport: hostTransport,
    });

    await expect(Promise.all([client.ready, host.ready])).resolves.toEqual([undefined, undefined]);
    expect(client.getState()).toEqual({});

    client.dispose();
    await host.dispose();
  });

  it("reports worker state conflicts and keeps the current snapshot", async () => {
    const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
    const conflicts: WorkerConflictEvent[] = [];
    const invalidMessages: unknown[] = [];
    const client = createWorkerClient({
      onConflict: (event) => {
        conflicts.push(event);
      },
      onInvalidMessage: (message) => {
        invalidMessages.push(message);
      },
      transport: clientTransport,
    });

    hostTransport.post({
      patches: [
        {
          op: "replace",
          path: "/workerCounter/count",
          value: 9,
        },
      ],
      sync: "patch",
      type: "state",
      version: 1,
    });
    hostTransport.post({
      state: {
        workerCounter: {
          count: 1,
        },
      },
      sync: "snapshot",
      type: "state",
      version: 1,
    });

    await client.ready;

    hostTransport.post({
      state: {
        workerCounter: {
          count: 0,
        },
      },
      sync: "snapshot",
      type: "state",
      version: 1,
    });
    hostTransport.post({
      patches: [
        {
          op: "replace",
          path: 1,
          value: 9,
        },
      ],
      sync: "patch",
      type: "state",
      version: 2,
    });
    hostTransport.post({
      patches: [
        {
          op: "replace",
          path: "/workerCounter/count",
          value: 9,
        },
      ],
      sync: "patch",
      type: "state",
      version: 3,
    });

    expect(conflicts.map((event) => event.reason)).toEqual([
      "missing-snapshot",
      "stale-message",
      "version-gap",
    ]);
    expect(invalidMessages).toHaveLength(1);
    expect(client.getState()).toEqual({
      workerCounter: {
        count: 1,
      },
    });

    client.dispose();
  });

  it("uses selector equality for worker state watches", async () => {
    const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
    const client = createWorkerClient({
      transport: clientTransport,
    });
    const host = createWorkerApp({
      providers: [WorkerCounter],
      transport: hostTransport,
    });
    const values: Array<{ readonly parity: number }> = [];

    await client.ready;

    const unsubscribe = client.watch(
      (state) => ({
        parity: selectWorkerCount(state) % 2,
      }),
      (value) => {
        values.push(value);
      },
      {
        equals: (value, previous) => value.parity === previous.parity,
      },
    );

    await client.module<WorkerCounter>("workerCounter").increase(2);
    await client.module<WorkerCounter>("workerCounter").increase(1);

    expect(values).toEqual([{ parity: 1 }]);

    unsubscribe();
    client.dispose();
    await host.dispose();
  });

  it("isolates worker state observers from protocol handling", async () => {
    const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
    const observedVersions: number[] = [];
    const observedCounts: number[] = [];
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (error: unknown) => {
      unhandledRejections.push(error);
    };
    const client = createWorkerClient({ transport: clientTransport });

    client.subscribe(() => {
      throw new Error("subscriber boom");
    });
    client.subscribe((message) => {
      observedVersions.push(message.version);
    });
    client.subscribe(async () => {
      await Promise.resolve();
      throw new Error("async subscriber boom");
    });
    client.watch(
      () => {
        throw new Error("selector boom");
      },
      () => undefined,
    );
    client.watch(
      selectWorkerCount,
      () => {
        throw new Error("watch boom");
      },
      { immediate: true },
    );
    client.watch(
      selectWorkerCount,
      (value) => {
        observedCounts.push(value);
      },
      { immediate: true },
    );
    client.watch(
      selectWorkerCount,
      async () => {
        await Promise.resolve();
        throw new Error("async watch boom");
      },
      { immediate: true },
    );

    process.on("unhandledRejection", onUnhandledRejection);
    const host = createWorkerApp({
      providers: [WorkerCounter],
      transport: hostTransport,
    });

    try {
      await expect(Promise.all([client.ready, host.ready])).resolves.toEqual([
        undefined,
        undefined,
      ]);
      await expect(client.module<WorkerCounter>("workerCounter").increase(1)).resolves.toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }

    expect(observedVersions).toEqual([0, 1]);
    expect(observedCounts).toEqual([0, 1]);
    expect(unhandledRejections).toEqual([]);

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

  it("does not expose worker module proxies as thenables", async () => {
    const [, clientTransport] = createMemoryWorkerTransportPair();
    const client = createWorkerClient({ transport: clientTransport });
    const module = client.module<WorkerCounter>("workerCounter");

    expect((module as unknown as { readonly then?: unknown }).then).toBeUndefined();
    await expect(Promise.resolve(module)).resolves.toBe(module);
    client.dispose();
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

  it("preserves data-transport messages replayed during subscription", () => {
    const messages: WorkerMessage[] = [];
    const transport = createDataTransportWorkerTransport({
      emit: async () => undefined,
      listen(name, listener) {
        if (name === "ready") {
          listener({ type: "ready" });
        }
      },
    });
    const unsubscribe = transport.subscribe((message) => {
      messages.push(message);
    });

    expect(messages).toEqual([{ type: "ready" }]);
    unsubscribe();
  });

  it("unsubscribes every data-transport listener after a disposer fails", () => {
    const disposeError = new Error("data disposer failed");
    const disposedTypes: WorkerMessage["type"][] = [];
    const transport = createDataTransportWorkerTransport({
      emit: async () => undefined,
      listen(name) {
        return () => {
          disposedTypes.push(name);

          if (name === "call") {
            throw disposeError;
          }
        };
      },
    });
    const unsubscribe = transport.subscribe(() => undefined);

    expect(() => unsubscribe()).toThrow(disposeError);
    expect(disposedTypes).toEqual(["call", "result", "state", "sync", "ready"]);
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

  it("filters postMessage origin/source, validates payloads, and uses targetOrigin", () => {
    const endpoint = new MockPostMessageEndpoint();
    const expectedSource = {};
    const invalidMessages: unknown[] = [];
    const messages: WorkerMessage[] = [];
    const postedOrigins: Array<string | undefined> = [];
    const transport = createPostMessageWorkerTransport(endpoint, {
      allowedOrigins: ["https://trusted.example"],
      expectedSource,
      onInvalidMessage(message) {
        invalidMessages.push(message);
      },
      source: endpoint,
      target: {
        postMessage(_message, targetOrigin) {
          postedOrigins.push(targetOrigin);
        },
      },
      targetOrigin: "https://trusted.example",
    });
    const unsubscribe = transport.subscribe((message) => {
      messages.push(message);
    });

    endpoint.dispatch({
      data: { type: "ready" },
      origin: "https://untrusted.example",
      source: expectedSource,
    });
    endpoint.dispatch({
      data: { type: "ready" },
      origin: "https://trusted.example",
      source: {},
    });
    endpoint.dispatch({
      data: { id: 1, method: "increase", module: "workerCounter", type: "call" },
      origin: "https://trusted.example",
      source: expectedSource,
    });
    endpoint.dispatch({
      data: {
        patches: [{ op: "replace", path: "/__proto__/polluted", value: true }],
        sync: "patch",
        type: "state",
        version: 1,
      },
      origin: "https://trusted.example",
      source: expectedSource,
    });
    endpoint.dispatch({
      data: { type: "ready" },
      origin: "https://trusted.example",
      source: expectedSource,
    });
    transport.post({ type: "ready" });

    expect(messages).toEqual([{ type: "ready" }]);
    expect(invalidMessages).toHaveLength(2);
    expect(postedOrigins).toEqual(["https://trusted.example"]);

    unsubscribe();
  });

  it("isolates throwing worker transport error observers", async () => {
    const deliveryError = new Error("delivery failed");
    const observedErrors: unknown[] = [];
    const unhandledRejections: unknown[] = [];
    const onUnhandledRejection = (error: unknown) => {
      unhandledRejections.push(error);
    };
    const onError = (error: unknown) => {
      observedErrors.push(error);
      throw new Error("observer failed");
    };
    const message = { type: "ready" } as const;
    const endpoint = new MockPostMessageEndpoint();
    const postMessageTransport = createPostMessageWorkerTransport(endpoint, {
      onError,
      target: {
        postMessage() {
          throw deliveryError;
        },
      },
    });
    const broadcastTransport = createBroadcastWorkerTransport(
      {
        addEventListener() {},
        postMessage() {
          throw deliveryError;
        },
        removeEventListener() {},
      },
      { onError },
    );
    const dataTransport = createDataTransportWorkerTransport(
      {
        emit: () => Promise.reject(deliveryError),
        listen: () => undefined,
      },
      { onError },
    );
    const synchronousDataTransport = createDataTransportWorkerTransport(
      {
        emit() {
          throw deliveryError;
        },
        listen: () => undefined,
      },
      { onError },
    );

    expect(() => postMessageTransport.post(message)).not.toThrow();
    expect(() => broadcastTransport.post(message)).not.toThrow();
    expect(() => synchronousDataTransport.post(message)).not.toThrow();

    process.on("unhandledRejection", onUnhandledRejection);

    try {
      dataTransport.post(message);
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      process.off("unhandledRejection", onUnhandledRejection);
    }

    expect(observedErrors).toEqual([deliveryError, deliveryError, deliveryError, deliveryError]);
    expect(unhandledRejections).toEqual([]);
  });

  it("requires matching broadcast capability tokens when configured", () => {
    const channel = "worker-broadcast-auth";
    const receiverChannel = createMemoryBroadcastChannel(channel);
    const trustedChannel = createMemoryBroadcastChannel(channel);
    const untrustedChannel = createMemoryBroadcastChannel(channel);
    const messages: WorkerMessage[] = [];
    const receiver = createBroadcastWorkerTransport(receiverChannel, {
      authToken: "shared-secret",
      peerId: "receiver",
    });
    const trusted = createBroadcastWorkerTransport(trustedChannel, {
      authToken: "shared-secret",
      peerId: "trusted",
      targetPeerId: "receiver",
    });
    const untrusted = createBroadcastWorkerTransport(untrustedChannel, {
      authToken: "wrong-secret",
      peerId: "untrusted",
      targetPeerId: "receiver",
    });
    const unsubscribe = receiver.subscribe((message) => {
      messages.push(message);
    });
    const call: WorkerMessage = {
      args: [1],
      id: 1,
      method: "increase",
      module: "workerCounter",
      type: "call",
    };

    untrusted.post(call);
    trusted.post(call);

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ method: "increase", module: "workerCounter" });

    unsubscribe();
    receiverChannel.close?.();
    trustedChannel.close?.();
    untrustedChannel.close?.();
  });

  it("isolates memory broadcast listeners from sender delivery", () => {
    const channel = "worker-broadcast-listener-isolation";
    const sender = createMemoryBroadcastChannel(channel);
    const receiver = createMemoryBroadcastChannel(channel);
    const messages: unknown[] = [];

    receiver.addEventListener("message", () => {
      throw new Error("listener failed");
    });
    receiver.addEventListener("message", (event) => {
      messages.push(event.data);
    });

    // eslint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel-style endpoints accept one argument.
    expect(() => sender.postMessage({ type: "ready" })).not.toThrow();
    expect(messages).toEqual([{ type: "ready" }]);

    sender.close?.();
    receiver.close?.();
  });

  it("coordinates shared tab clients over a broadcast channel", async () => {
    const channel = "worker-shared-tabs";
    const hostChannel = createMemoryBroadcastChannel(channel);
    const clientOneChannel = createMemoryBroadcastChannel(channel);
    const clientTwoChannel = createMemoryBroadcastChannel(channel);
    const clientOne = createWorkerClient({
      transport: createBroadcastWorkerTransport(clientOneChannel, {
        peerId: "client:one",
        targetPeerId: "host",
      }),
    });
    const clientTwo = createWorkerClient({
      transport: createBroadcastWorkerTransport(clientTwoChannel, {
        peerId: "client:two",
        targetPeerId: "host",
      }),
    });
    const host = createWorkerApp({
      providers: [WorkerCounter],
      sync: "patch",
      transport: createBroadcastWorkerTransport(hostChannel, {
        peerId: "host",
      }),
    });

    await Promise.all([clientOne.ready, clientTwo.ready]);

    expect(clientOne.select(selectWorkerCount)).toBe(0);
    expect(clientTwo.select(selectWorkerCount)).toBe(0);

    await expect(
      Promise.all([
        clientOne.module<WorkerCounter>("workerCounter").increase(2),
        clientTwo.module<WorkerCounter>("workerCounter").increase(5),
      ]),
    ).resolves.toEqual([2, 7]);

    expect(clientOne.select(selectWorkerCount)).toBe(7);
    expect(clientTwo.select(selectWorkerCount)).toBe(7);

    clientOne.dispose();
    clientTwo.dispose();
    await host.dispose();
    hostChannel.close?.();
    clientOneChannel.close?.();
    clientTwoChannel.close?.();
  });

  it("targets broadcast snapshot resyncs to the requesting client", async () => {
    const channel = "worker-broadcast-sync";
    const hostChannel = createMemoryBroadcastChannel(channel);
    const clientOneChannel = createMemoryBroadcastChannel(channel);
    const clientTwoChannel = createMemoryBroadcastChannel(channel);
    const rawHostTransport = createBroadcastWorkerTransport(hostChannel, {
      peerId: "host",
    });
    const clientOneConflicts: WorkerConflictEvent[] = [];
    const heldStateMessages: WorkerStateMessage[] = [];
    let holdNextPatchStateMessage = false;
    const hostTransport: WorkerTransport = {
      post(message) {
        if (message.type === "state" && message.sync === "patch" && holdNextPatchStateMessage) {
          holdNextPatchStateMessage = false;
          heldStateMessages.push(message);
          return;
        }

        rawHostTransport.post(message);
      },
      subscribe(listener) {
        return rawHostTransport.subscribe(listener);
      },
    };
    const clientOne = createWorkerClient({
      onConflict: (event) => {
        clientOneConflicts.push(event);
      },
      transport: createBroadcastWorkerTransport(clientOneChannel, {
        peerId: "client:one",
        targetPeerId: "host",
      }),
    });
    const clientTwo = createWorkerClient({
      transport: createBroadcastWorkerTransport(clientTwoChannel, {
        peerId: "client:two",
        targetPeerId: "host",
      }),
    });
    const host = createWorkerApp({
      providers: [WorkerCounter],
      sync: "patch",
      transport: hostTransport,
    });

    await Promise.all([clientOne.ready, clientTwo.ready]);

    holdNextPatchStateMessage = true;
    await expect(clientOne.module<WorkerCounter>("workerCounter").increase(2)).resolves.toBe(2);

    expect(heldStateMessages.map((message) => message.version)).toEqual([1]);
    expect(clientOne.select(selectWorkerCount)).toBe(2);
    expect(clientTwo.select(selectWorkerCount)).toBe(0);

    for (const message of heldStateMessages.splice(0)) {
      rawHostTransport.post(message);
    }

    expect(clientTwo.select(selectWorkerCount)).toBe(2);
    expect(clientOneConflicts).toEqual([]);

    clientOne.dispose();
    clientTwo.dispose();
    await host.dispose();
    hostChannel.close?.();
    clientOneChannel.close?.();
    clientTwoChannel.close?.();
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

  it("finishes worker client cleanup when transport unsubscribe throws", async () => {
    const unsubscribeError = new Error("client unsubscribe failed");
    const client = createWorkerClient({
      requestTimeout: 0,
      transport: {
        post() {},
        subscribe() {
          return () => {
            throw unsubscribeError;
          };
        },
      },
    });
    const ready = client.ready.catch((error: unknown) => error);
    const pending = client.call("workerCounter", "increase").catch((error: unknown) => error);

    expect(() => client.dispose()).toThrow(unsubscribeError);
    await expect(ready).resolves.toMatchObject({
      message: "Worker client disposed before initial state.",
    });
    await expect(pending).resolves.toMatchObject({
      message: "Worker client disposed before response.",
    });
    await expect(client.call("workerCounter", "increase")).rejects.toThrow(
      "Worker client has been disposed.",
    );
  });

  it("rejects new calls immediately after the worker client is disposed", async () => {
    let posted = 0;
    const transport: WorkerTransport = {
      post() {
        posted += 1;
      },
      subscribe() {
        return () => undefined;
      },
    };
    const client = createWorkerClient({ transport });
    const counter = client.module<WorkerCounter>("workerCounter");

    client.dispose();

    await expect(client.call("workerCounter", "increase", 1)).rejects.toThrow(
      "Worker client has been disposed.",
    );
    await expect(counter.increase(1)).rejects.toThrow("Worker client has been disposed.");
    expect(posted).toBe(0);
  });

  it("times out and aborts worker calls that do not receive a response", async () => {
    const [, timeoutTransport] = createMemoryWorkerTransportPair();
    const timeoutClient = createWorkerClient({
      requestTimeout: 10,
      transport: timeoutTransport,
    });

    await expect(timeoutClient.call("workerCounter", "increase", 1)).rejects.toThrow(
      "Worker call timed out after 10ms.",
    );
    timeoutClient.dispose();

    const [, abortTransport] = createMemoryWorkerTransportPair();
    const abortClient = createWorkerClient({
      requestTimeout: 0,
      transport: abortTransport,
    });
    const abortController = new AbortController();
    const pending = abortClient.callWithOptions("workerCounter", "increase", [1], {
      signal: abortController.signal,
    });

    abortController.abort();

    await expect(pending).rejects.toThrow("Worker call aborted.");
    abortClient.dispose();
  });

  it("keeps timeout and abort controls active while waiting for state sync", async () => {
    const [timeoutHostTransport, timeoutClientTransport] = createMemoryWorkerTransportPair();
    const stopTimeoutHost = timeoutHostTransport.subscribe((message) => {
      if (message.type === "call") {
        timeoutHostTransport.post({
          id: message.id,
          stateVersion: 1,
          type: "result",
          value: "waiting-for-state",
        });
      }
    });
    const timeoutClient = createWorkerClient({
      requestTimeout: 10,
      transport: timeoutClientTransport,
    });

    await expect(timeoutClient.call("workerCounter", "increase", 1)).rejects.toThrow(
      "Worker call timed out after 10ms.",
    );

    timeoutClient.dispose();
    stopTimeoutHost();

    const [abortHostTransport, abortClientTransport] = createMemoryWorkerTransportPair();
    const stopAbortHost = abortHostTransport.subscribe((message) => {
      if (message.type === "call") {
        abortHostTransport.post({
          id: message.id,
          stateVersion: 1,
          type: "result",
          value: "waiting-for-state",
        });
      }
    });
    const abortClient = createWorkerClient({
      requestTimeout: 0,
      transport: abortClientTransport,
    });
    const abortController = new AbortController();
    const pending = abortClient.callWithOptions("workerCounter", "increase", [1], {
      signal: abortController.signal,
    });

    abortController.abort();

    await expect(pending).rejects.toThrow("Worker call aborted.");

    abortClient.dispose();
    stopAbortHost();
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

  it("rejects empty snapshot payloads before settling client readiness", async () => {
    const [hostTransport, clientTransport] = createMemoryWorkerTransportPair();
    const invalidMessages: unknown[] = [];
    const client = createWorkerClient({
      onInvalidMessage(message) {
        invalidMessages.push(message);
      },
      transport: clientTransport,
    });
    let ready = false;
    void client.ready.then(() => {
      ready = true;
      return undefined;
    });

    hostTransport.post({
      state: undefined,
      sync: "snapshot",
      type: "state",
      version: 0,
    });
    hostTransport.post({
      state: null,
      sync: "snapshot",
      type: "state",
      version: 0,
    });
    hostTransport.post({
      state: new Date(0),
      sync: "snapshot",
      type: "state",
      version: 0,
    });
    await Promise.resolve();

    expect(ready).toBe(false);
    expect(invalidMessages).toHaveLength(3);

    hostTransport.post({
      state: {},
      sync: "snapshot",
      type: "state",
      version: 0,
    });
    await client.ready;

    expect(client.getState()).toEqual({});
    client.dispose();
  });

  it("rejects client readiness when disposed before the initial state", async () => {
    const [, clientTransport] = createMemoryWorkerTransportPair();
    const client = createWorkerClient({
      transport: clientTransport,
    });

    client.dispose();

    await expect(client.ready).rejects.toThrow("Worker client disposed before initial state.");
  });

  it("aborts app initialization before waiting for worker host readiness on dispose", async () => {
    const [hostTransport] = createMemoryWorkerTransportPair();
    const events: string[] = [];
    let signal: AbortSignal | undefined;
    const host = createWorkerApp({
      plugins: [
        {
          setup(_app, context) {
            signal = context.signal;
            events.push("setup");

            return new Promise<void>((resolve) => {
              context.signal.addEventListener(
                "abort",
                () => {
                  events.push("abort");
                  resolve();
                },
                { once: true },
              );
            });
          },
        },
      ],
      transport: hostTransport,
    });
    const firstDispose = host.dispose();
    const repeatedDispose = host.dispose();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    expect(repeatedDispose).toBe(firstDispose);

    try {
      await Promise.race([
        firstDispose,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("worker host dispose timed out")), 100);
        }),
      ]);
    } finally {
      if (timeout !== undefined) {
        clearTimeout(timeout);
      }
    }

    expect(signal?.aborted).toBe(true);
    expect(events).toEqual(["setup", "abort"]);
    await expect(host.ready).rejects.toThrow("Cannot start an app after disposal.");
  });

  it("disposes the worker app when transport unsubscribe throws", async () => {
    const unsubscribeError = new Error("host unsubscribe failed");
    const events: string[] = [];

    class DisposableWorkerModule {
      onDispose(): void {
        events.push("dispose");
      }
    }

    defineModule(DisposableWorkerModule, { name: "disposableWorkerModule" });

    const [memoryHostTransport] = createMemoryWorkerTransportPair();
    const host = createWorkerApp({
      providers: [DisposableWorkerModule],
      transport: {
        post(message) {
          memoryHostTransport.post(message);
        },
        subscribe(listener) {
          const unsubscribe = memoryHostTransport.subscribe(listener);
          return () => {
            unsubscribe();
            throw unsubscribeError;
          };
        },
      },
    });
    await host.ready;

    await expect(host.dispose()).rejects.toBe(unsubscribeError);
    expect(events).toEqual(["dispose"]);
    expect(() => host.app.getModule(DisposableWorkerModule)).toThrow(
      "Cannot access modules after app disposal has begun.",
    );
  });

  it("rejects host readiness when disposed during startup before publication", async () => {
    const messages: WorkerMessage[] = [];
    let markStartEntered: (() => void) | undefined;
    let releaseStart: (() => void) | undefined;
    const startEntered = new Promise<void>((resolve) => {
      markStartEntered = resolve;
    });
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });

    class SlowStartingWorkerModule {
      async onStart(): Promise<void> {
        markStartEntered?.();
        await startGate;
      }
    }

    defineModule(SlowStartingWorkerModule, {
      name: "slowStartingWorkerModule",
    });

    const transport: WorkerTransport = {
      post(message) {
        messages.push(message);
      },
      subscribe() {
        return () => undefined;
      },
    };
    const host = createWorkerApp({
      providers: [SlowStartingWorkerModule],
      transport,
    });

    await startEntered;

    const disposal = host.dispose();
    releaseStart?.();

    await expect(host.ready).rejects.toThrow("Worker host disposed before initial state.");
    await expect(disposal).resolves.toBeUndefined();
    expect(messages).toEqual([]);
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

interface WorkerCounterState {
  readonly workerCounter: {
    readonly count: number;
  };
}

interface WorkerFailingCounterState {
  readonly workerFailingCounter: {
    readonly count: number;
  };
}

function selectWorkerCount(state: unknown): number {
  return (state as WorkerCounterState).workerCounter.count;
}

function selectFailingWorkerCount(state: unknown): number {
  return (state as WorkerFailingCounterState).workerFailingCounter.count;
}

function createControlledWorkerTransportPair(): {
  readonly hostTransport: WorkerTransport;
  readonly clientTransport: WorkerTransport;
  readonly heldStateMessages: WorkerStateMessage[];
  readonly syncRequests: number[];
  holdNextPatchStateMessage(): void;
  releaseHeldStateMessages(): void;
} {
  const hostListeners = new Set<(message: WorkerMessage) => void>();
  const clientListeners = new Set<(message: WorkerMessage) => void>();
  const heldStateMessages: WorkerStateMessage[] = [];
  const syncRequests: number[] = [];
  let holdNextPatchStateMessage = false;

  return {
    clientTransport: {
      post(message) {
        if (message.type === "sync" && typeof message.stateVersion === "number") {
          syncRequests.push(message.stateVersion);
        }

        deliverWorkerMessage(hostListeners, message);
      },
      subscribe(listener) {
        clientListeners.add(listener);
        return () => {
          clientListeners.delete(listener);
        };
      },
    },
    heldStateMessages,
    holdNextPatchStateMessage() {
      holdNextPatchStateMessage = true;
    },
    hostTransport: {
      post(message) {
        if (message.type === "state" && message.sync === "patch" && holdNextPatchStateMessage) {
          holdNextPatchStateMessage = false;
          heldStateMessages.push(message);
          return;
        }

        deliverWorkerMessage(clientListeners, message);
      },
      subscribe(listener) {
        hostListeners.add(listener);
        return () => {
          hostListeners.delete(listener);
        };
      },
    },
    releaseHeldStateMessages() {
      for (const message of heldStateMessages.splice(0)) {
        deliverWorkerMessage(clientListeners, message);
      }
    },
    syncRequests,
  };
}

function deliverWorkerMessage(
  listeners: Set<(message: WorkerMessage) => void>,
  message: WorkerMessage,
): void {
  for (const listener of listeners) {
    listener(message);
  }
}

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
