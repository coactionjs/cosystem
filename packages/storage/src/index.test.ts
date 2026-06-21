import { describe, expect, it } from "vitest";

import { createApp, defineModule } from "@cosystem/core";

import { createStoragePlugin, type StorageLike } from "./index.js";

class Counter {
  count = 0;

  increase(): void {
    this.count += 1;
  }
}

defineModule(Counter, {
  actions: ["increase"],
  name: "storageCounter",
  state: ["count"],
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
