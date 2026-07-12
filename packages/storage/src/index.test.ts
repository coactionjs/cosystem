import { describe, expect, it } from "vitest";

import { createApp, defineModule } from "@cosystem/core";

import {
  StorageToken,
  createLocalSpaceStorage,
  createLocalSpaceStoragePlugin,
  createStoragePlugin,
  type LocalSpacePlugin,
  type StorageLike,
  type StorageService,
} from "./index.js";

class Counter {
  count = 0;

  increase(): void {
    this.count += 1;
  }
}

class Preferences {
  theme = "light";
}

defineModule(Counter, {
  actions: ["increase"],
  name: "storageCounter",
  state: ["count"],
});

defineModule(Preferences, {
  name: "storagePreferences",
  state: ["theme"],
});

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("storage plugin", () => {
  it("hydrates state during setup and persists state changes", async () => {
    const storage = new MemoryStorage();
    storage.setItem("app", JSON.stringify({ storageCounter: { count: 4 } }));

    const plugin = createStoragePlugin({
      key: "app",
      storage,
    });
    const app = createApp({
      plugins: [plugin],
      providers: [Counter],
    });

    await app.start();

    expect(app.getModule(Counter).count).toBe(4);

    app.getModule(Counter).increase();
    await plugin.flush();

    expect(storage.getItem("app")).toBe(JSON.stringify({ storageCounter: { count: 5 } }));
  });

  it("can clear stored state", async () => {
    const storage = new MemoryStorage();
    storage.setItem("app", "{}");

    const plugin = createStoragePlugin({
      key: "app",
      storage,
    });

    await plugin.clear();

    expect(storage.getItem("app")).toBeNull();
  });

  it("waits for async storage writes through flush", async () => {
    const storage = new AsyncMemoryStorage();
    const plugin = createStoragePlugin({
      key: "app",
      storage,
    });
    const app = createApp({
      plugins: [plugin],
      providers: [Counter],
    });

    await app.start();
    app.getModule(Counter).increase();

    expect(storage.getItem("app")).toBeNull();

    await plugin.flush();

    expect(storage.getItem("app")).toBe(JSON.stringify({ storageCounter: { count: 1 } }));
  });

  it("flushes pending writes when the app is disposed", async () => {
    const storage = new AsyncMemoryStorage();
    const plugin = createStoragePlugin({
      key: "app",
      storage,
    });
    const app = createApp({
      plugins: [plugin],
      providers: [Counter],
    });

    await app.start();
    app.getModule(Counter).increase();
    await app.dispose();

    expect(storage.getItem("app")).toBe(JSON.stringify({ storageCounter: { count: 1 } }));
  });

  it("reports pending write failures while disposing the app", async () => {
    const writeError = new Error("dispose write failed");
    const errors: Array<{ error: unknown; phase: string }> = [];
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () =>
        new Promise((_resolve, reject) => {
          queueMicrotask(() => reject(writeError));
        }),
    };
    const plugin = createStoragePlugin({
      key: "app",
      onError(error, phase) {
        errors.push({ error, phase });
      },
      storage,
    });
    const app = createApp({
      plugins: [plugin],
      providers: [Counter],
    });

    await app.start();
    app.getModule(Counter).increase();
    await expect(app.dispose()).resolves.toBeUndefined();

    expect(errors).toEqual([{ error: writeError, phase: "persist" }]);
  });

  it("can persist a partial state slice", async () => {
    const storage = new MemoryStorage();
    const plugin = createStoragePlugin({
      key: "app",
      partialize: (state) => (state as { readonly storageCounter: unknown }).storageCounter,
      storage,
    });
    const app = createApp({
      plugins: [plugin],
      providers: [Counter, Preferences],
    });

    await app.start();
    app.getModule(Counter).increase();
    await plugin.flush();

    expect(storage.getItem("app")).toBe(JSON.stringify({ count: 1 }));
  });

  it("can merge hydrated partial state with current app defaults", async () => {
    const storage = new MemoryStorage();
    storage.setItem("app", JSON.stringify({ storageCounter: { count: 4 } }));
    const plugin = createStoragePlugin({
      key: "app",
      merge: (persisted, current) => ({
        ...(current as object),
        ...(persisted as object),
      }),
      storage,
    });
    const app = createApp({
      plugins: [plugin],
      providers: [Counter, Preferences],
    });

    await app.start();

    expect(app.getModule(Counter).count).toBe(4);
    expect(app.getModule(Preferences).theme).toBe("light");
    expect(app.store.getPureState()).toEqual({
      storageCounter: {
        count: 4,
      },
      storagePreferences: {
        theme: "light",
      },
    });
  });

  it("reports background persistence errors without throwing from state changes", async () => {
    const errors: Array<{ error: unknown; phase: string }> = [];
    const storage: StorageLike = {
      getItem: () => null,
      setItem: () => Promise.reject(new Error("write failed")),
    };
    const plugin = createStoragePlugin({
      key: "app",
      onError(error, phase) {
        errors.push({ error, phase });
      },
      storage,
    });
    const app = createApp({
      plugins: [plugin],
      providers: [Counter],
    });

    await app.start();
    expect(() => app.getModule(Counter).increase()).not.toThrow();
    await plugin.flush();

    expect(errors).toHaveLength(1);
    expect(errors[0]?.phase).toBe("persist");
    expect(errors[0]?.error).toBeInstanceOf(Error);
  });
});

describe("localspace storage plugin", () => {
  it("hydrates and persists app state with localspace", async () => {
    const plugin = createLocalSpaceStoragePlugin<{
      readonly storageCounter: { readonly count: number };
    }>({
      key: "app",
      options: createMemoryLocalSpaceOptions("state"),
    });
    await plugin.storage.set("app", { storageCounter: { count: 4 } });
    const app = createApp({
      plugins: [plugin],
      providers: [Counter],
    });

    await app.start();

    expect(app.getModule(Counter).count).toBe(4);

    app.getModule(Counter).increase();
    await plugin.flush();

    expect(await plugin.storage.get("app")).toEqual({ storageCounter: { count: 5 } });

    await app.dispose();
  });

  it("provides a cross-framework storage service through app DI", async () => {
    const plugin = createLocalSpaceStoragePlugin({
      options: createMemoryLocalSpaceOptions("di"),
    });
    const app = createApp({
      plugins: [plugin],
    });

    await app.start();

    const storage = app.get(StorageToken);
    await storage.setMany([
      { key: "first", value: 1 },
      { key: "second", value: 2 },
    ]);

    expect(storage).toBe(plugin.storage);
    expect(await storage.getMany<number>(["first", "second"])).toEqual([
      { key: "first", value: 1 },
      { key: "second", value: 2 },
    ]);
    expect(await storage.keys()).toEqual(["first", "second"]);

    await app.dispose();
  });

  it("honors destroyOnDispose for externally supplied storage services", async () => {
    const events: string[] = [];

    const createService = (name: string) => {
      const service = createLocalSpaceStorage({
        options: createMemoryLocalSpaceOptions(name),
      });
      service.destroy = async () => {
        events.push(name);
      };
      return service;
    };

    const retainedService = createService("retained");
    const retainedApp = createApp({
      plugins: [
        createLocalSpaceStoragePlugin({
          destroyOnDispose: false,
          hydrate: false,
          persist: false,
          service: retainedService,
        }),
      ],
    });
    await retainedApp.start();
    await retainedApp.dispose();

    const ownedService = createService("owned");
    const ownedApp = createApp({
      plugins: [
        createLocalSpaceStoragePlugin({
          destroyOnDispose: true,
          hydrate: false,
          persist: false,
          service: ownedService,
        }),
      ],
    });
    await ownedApp.start();
    await ownedApp.dispose();

    expect(events).toEqual(["owned"]);

    await retainedService.instance.destroy();
    await ownedService.instance.destroy();
  });

  it("runs localspace plugins and destroys owned localspace resources on app disposal", async () => {
    const events: string[] = [];
    const localspacePlugin: LocalSpacePlugin = {
      name: "tagger",
      afterGet(key: string, value: unknown) {
        events.push(`get:${key}`);
        return value;
      },
      beforeSet(key: string, value: unknown) {
        events.push(`set:${key}`);
        return {
          ...(value as Record<string, unknown>),
          tagged: true,
        };
      },
      onDestroy() {
        events.push("destroy");
      },
    };
    const plugin = createLocalSpaceStoragePlugin({
      hydrate: false,
      options: {
        ...createMemoryLocalSpaceOptions("plugins"),
        plugins: [localspacePlugin],
      },
    });
    const app = createApp({
      plugins: [plugin],
    });

    await app.start();
    await plugin.storage.set("item", { value: 1 });

    expect(await plugin.storage.get("item")).toEqual({ tagged: true, value: 1 });

    await app.dispose();

    expect(events).toEqual(["set:item", "get:item", "destroy"]);
  });

  it("destroys owned localspace resources when hydration fails", async () => {
    const hydrateError = new Error("ready failed");
    const events: string[] = [];
    const errors: Array<{ readonly error: unknown; readonly phase: string }> = [];
    const storage: StorageService = {
      instance: {} as StorageService["instance"],
      clear: async () => undefined,
      destroy: async () => {
        events.push("destroy");
      },
      driver: () => "test",
      dropInstance: async () => undefined,
      get: async () => null,
      getMany: async () => [],
      getPerformanceStats: () => undefined,
      keys: async () => [],
      length: async () => 0,
      ready: async () => {
        events.push("ready");
        throw hydrateError;
      },
      remove: async () => undefined,
      removeMany: async () => undefined,
      set: async (_key, value) => value,
      setMany: async () => [],
      transaction: async (_mode, runner) => runner({} as never),
    };
    const plugin = createLocalSpaceStoragePlugin({
      destroyOnDispose: true,
      onError(error, phase) {
        errors.push({ error, phase });
      },
      service: storage,
    });
    const app = createApp({
      plugins: [plugin],
    });

    await expect(app.start()).rejects.toBe(hydrateError);
    await expect(app.dispose()).rejects.toBeInstanceOf(AggregateError);

    expect(errors).toEqual([{ error: hydrateError, phase: "hydrate" }]);
    expect(events).toEqual(["ready", "destroy"]);
  });
});

class AsyncMemoryStorage extends MemoryStorage {
  override setItem(key: string, value: string): Promise<void> {
    return new Promise((resolve) => {
      queueMicrotask(() => {
        super.setItem(key, value);
        resolve();
      });
    });
  }
}

function createMemoryLocalSpaceOptions(suffix: string) {
  return {
    driver: "memoryStorageWrapper",
    name: `cosystem-storage-${suffix}`,
    storeName: "state",
  };
}
