import type { App, Plugin, StateChangeEvent } from "@cosystem/core";

export interface StorageLike {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem?(key: string): void | Promise<void>;
}

export interface StoragePluginOptions<TState = unknown> {
  readonly key: string;
  readonly storage: StorageLike;
  readonly serialize?: (state: TState) => string;
  readonly deserialize?: (value: string) => TState;
  readonly shouldPersist?: (event: StateChangeEvent) => boolean;
}

export interface StoragePlugin extends Plugin {
  clear(): Promise<void>;
  persist(app: App): Promise<void>;
}

export function createStoragePlugin<TState = unknown>(
  options: StoragePluginOptions<TState>,
): StoragePlugin {
  const serialize = options.serialize ?? JSON.stringify;
  const deserialize = options.deserialize ?? JSON.parse;

  return {
    name: "cosystem:storage",
    async clear() {
      await options.storage.removeItem?.(options.key);
    },
    async onStateChange(event) {
      if (options.shouldPersist !== undefined && !options.shouldPersist(event)) {
        return;
      }

      await options.storage.setItem(options.key, serialize(event.state as TState));
    },
    async persist(app) {
      await options.storage.setItem(options.key, serialize(app.store.getPureState() as TState));
    },
    async setup(app) {
      const stored = await options.storage.getItem(options.key);

      if (stored === null) {
        return;
      }

      app.store.setState(deserialize(stored) as never);
    },
  };
}
