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
  readonly onError?: (error: unknown, phase: StoragePluginErrorPhase) => void;
}

export type StoragePluginErrorPhase = "clear" | "hydrate" | "persist";

export interface StoragePlugin extends Plugin {
  clear(): Promise<void>;
  flush(): Promise<void>;
  persist(app: App): Promise<void>;
  ready(): Promise<void>;
}

export function createStoragePlugin<TState = unknown>(
  options: StoragePluginOptions<TState>,
): StoragePlugin {
  const serialize = options.serialize ?? JSON.stringify;
  const deserialize = options.deserialize ?? JSON.parse;
  let readyPromise: Promise<void> = Promise.resolve();
  let writeQueue: Promise<void> = Promise.resolve();

  const runQueued = (
    phase: StoragePluginErrorPhase,
    task: () => void | Promise<void>,
  ): Promise<void> => {
    const operation = writeQueue.catch(() => undefined).then(task);
    writeQueue = operation.catch((error: unknown) => {
      options.onError?.(error, phase);
    });

    return operation;
  };

  return {
    name: "cosystem:storage",
    async clear() {
      await readyPromise;
      await runQueued("clear", async () => {
        await options.storage.removeItem?.(options.key);
      });
    },
    async flush() {
      await readyPromise;
      await writeQueue;
    },
    onStateChange(event) {
      if (options.shouldPersist !== undefined && !options.shouldPersist(event)) {
        return;
      }

      void runQueued("persist", async () => {
        await options.storage.setItem(options.key, serialize(event.state as TState));
      }).catch(() => undefined);
    },
    async persist(app) {
      await readyPromise;
      await runQueued("persist", async () => {
        await options.storage.setItem(options.key, serialize(app.store.getPureState() as TState));
      });
    },
    ready() {
      return readyPromise;
    },
    setup(app) {
      readyPromise = (async () => {
        try {
          const stored = await options.storage.getItem(options.key);

          if (stored === null) {
            return;
          }

          app.store.setState(deserialize(stored) as never);
        } catch (error) {
          options.onError?.(error, "hydrate");
          throw error;
        }
      })();

      return readyPromise;
    },
  };
}
