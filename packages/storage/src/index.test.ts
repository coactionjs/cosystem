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
});
