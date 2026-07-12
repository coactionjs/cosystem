import {
  provide,
  token,
  type App,
  type InjectionToken,
  type Plugin,
  type StateChangeEvent,
} from "@cosystem/core";
import localspace, {
  compressionPlugin,
  encryptionPlugin,
  indexedDBDriver,
  localStorageDriver,
  memoryDriver,
  quotaPlugin,
  syncPlugin,
  ttlPlugin,
  type LocalSpaceConfig,
  type LocalSpaceInstance,
  type LocalSpaceOptions,
  type LocalSpacePlugin,
  type PerformanceStats,
  type ReactNativeAsyncStorage,
} from "localspace";

export {
  compressionPlugin,
  encryptionPlugin,
  indexedDBDriver,
  localStorageDriver,
  memoryDriver,
  quotaPlugin,
  syncPlugin,
  ttlPlugin,
};

export type {
  LocalSpaceConfig,
  LocalSpaceInstance,
  LocalSpaceOptions,
  LocalSpacePlugin,
  PerformanceStats,
  ReactNativeAsyncStorage,
};

export interface StorageLike {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem?(key: string): void | Promise<void>;
}

export interface StorageEntry<T> {
  readonly key: string;
  readonly value: T;
}

export type StorageEntries<T> =
  | readonly StorageEntry<T>[]
  | ReadonlyMap<string, T>
  | Record<string, T>;

export type StorageBatchResponse<T> = Array<{
  readonly key: string;
  readonly value: T | null;
}>;

export type StorageTransactionMode = "readonly" | "readwrite";

export interface StorageTransactionScope {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<T>;
  remove(key: string): Promise<void>;
  keys(): Promise<string[]>;
  iterate<T, U>(iterator: (value: T, key: string, iterationNumber: number) => U): Promise<U>;
  clear(): Promise<void>;
}

export interface StorageService {
  readonly instance: LocalSpaceInstance;
  ready(): Promise<void>;
  driver(): string | null;
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<T>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  keys(): Promise<string[]>;
  length(): Promise<number>;
  setMany<T>(entries: StorageEntries<T>): Promise<StorageBatchResponse<T>>;
  getMany<T>(keys: readonly string[]): Promise<StorageBatchResponse<T>>;
  removeMany(keys: readonly string[]): Promise<void>;
  transaction<T>(
    mode: StorageTransactionMode,
    runner: (scope: StorageTransactionScope) => Promise<T> | T,
  ): Promise<T>;
  dropInstance(options?: LocalSpaceConfig): Promise<void>;
  destroy(): Promise<void>;
  getPerformanceStats(): PerformanceStats | undefined;
}

export interface CreateLocalSpaceStorageOptions {
  readonly instance?: LocalSpaceInstance;
  readonly localspace?: LocalSpaceInstance;
  readonly options?: LocalSpaceOptions;
}

export const StorageToken: InjectionToken<StorageService> =
  token<StorageService>("CoSystem Storage");

export interface StoragePluginOptions<TState = unknown> {
  readonly key: string;
  readonly storage: StorageLike;
  readonly serialize?: (state: TState) => string;
  readonly deserialize?: (value: string) => TState;
  readonly partialize?: (state: unknown) => TState;
  readonly merge?: (persisted: TState, current: unknown) => unknown;
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

export interface LocalSpaceStoragePluginOptions<
  TState = unknown,
> extends CreateLocalSpaceStorageOptions {
  readonly key?: string;
  readonly service?: StorageService;
  readonly hydrate?: boolean;
  readonly persist?: boolean;
  readonly destroyOnDispose?: boolean;
  readonly partialize?: (state: unknown) => TState;
  readonly merge?: (persisted: TState, current: unknown) => unknown;
  readonly shouldPersist?: (event: StateChangeEvent) => boolean;
  readonly onError?: (error: unknown, phase: StoragePluginErrorPhase) => void;
}

export interface LocalSpaceStoragePlugin extends StoragePlugin {
  readonly storage: StorageService;
}

export function createLocalSpaceStorage(
  options: CreateLocalSpaceStorageOptions = {},
): StorageService {
  const instance =
    options.instance ?? (options.localspace ?? localspace).createInstance(options.options);

  return {
    instance,
    clear() {
      return instance.clear();
    },
    destroy() {
      return instance.destroy();
    },
    driver() {
      return instance.driver();
    },
    dropInstance(dropOptions) {
      return instance.dropInstance(dropOptions);
    },
    get(key) {
      return instance.getItem(key);
    },
    getMany<T>(keys: readonly string[]): Promise<StorageBatchResponse<T>> {
      return instance.getItems<T>([...keys]) as Promise<StorageBatchResponse<T>>;
    },
    getPerformanceStats() {
      return instance.getPerformanceStats?.();
    },
    keys() {
      return instance.keys();
    },
    length() {
      return instance.length();
    },
    ready() {
      return instance.ready();
    },
    remove(key) {
      return instance.removeItem(key);
    },
    removeMany(keys) {
      return instance.removeItems([...keys]);
    },
    set(key, value) {
      return instance.setItem(key, value);
    },
    setMany<T>(entries: StorageEntries<T>): Promise<StorageBatchResponse<T>> {
      return instance.setItems<T>(entries as never) as Promise<StorageBatchResponse<T>>;
    },
    transaction(mode, runner) {
      return instance.runTransaction(mode, runner as never);
    },
  };
}

export function createLocalSpaceStoragePlugin<TState = unknown>(
  options: LocalSpaceStoragePluginOptions<TState> = {},
): LocalSpaceStoragePlugin {
  const key = options.key ?? "cosystem:state";
  const storage =
    options.service ??
    createLocalSpaceStorage({
      instance: options.instance,
      localspace: options.localspace,
      options: options.options,
    });
  const partialize = options.partialize ?? ((state: unknown) => state as TState);
  const merge = options.merge ?? ((persisted: TState) => persisted);
  const shouldHydrate = options.hydrate !== false;
  const shouldPersist = options.persist !== false;
  const destroyOnDispose =
    options.destroyOnDispose ?? (options.service === undefined && options.instance === undefined);
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
    providers: [provide(StorageToken, { useValue: storage })],
    storage,
    async clear() {
      await readyPromise;
      await runQueued("clear", async () => {
        await storage.remove(key);
      });
    },
    async flush() {
      await readyPromise;
      await writeQueue;
    },
    onStateChange(event) {
      if (!shouldPersist) {
        return;
      }

      if (options.shouldPersist !== undefined && !options.shouldPersist(event)) {
        return;
      }

      void runQueued("persist", async () => {
        await storage.set(key, partialize(event.state));
      }).catch(() => undefined);
    },
    async persist(app) {
      await readyPromise;
      await runQueued("persist", async () => {
        await storage.set(key, partialize(app.store.getPureState()));
      });
    },
    ready() {
      return readyPromise;
    },
    setup(app, context) {
      context.onDispose(async () => {
        const errors: unknown[] = [];

        try {
          await readyPromise;
        } catch (error) {
          errors.push(error);
        }

        try {
          await writeQueue;
        } catch (error) {
          errors.push(error);
        }

        if (destroyOnDispose) {
          try {
            await storage.destroy();
          } catch (error) {
            errors.push(error);
          }
        }

        if (errors.length === 1) {
          throw errors[0];
        }

        if (errors.length > 1) {
          throw new AggregateError(errors, "One or more storage disposal steps failed.");
        }
      });

      readyPromise = (async () => {
        try {
          await storage.ready();

          if (!shouldHydrate) {
            return;
          }

          const stored = await storage.get<TState>(key);

          if (stored === null) {
            return;
          }

          app.runInAction(
            () => app.store.setState(merge(stored, app.store.getPureState()) as never),
            { name: "storage.hydrate" },
          );
        } catch (error) {
          options.onError?.(error, "hydrate");
          throw error;
        }
      })();

      return readyPromise;
    },
  };
}

export function createStoragePlugin<TState = unknown>(
  options: StoragePluginOptions<TState>,
): StoragePlugin {
  const serialize = options.serialize ?? JSON.stringify;
  const deserialize = options.deserialize ?? JSON.parse;
  const partialize = options.partialize ?? ((state: unknown) => state as TState);
  const merge = options.merge ?? ((persisted: TState) => persisted);
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
        await options.storage.setItem(options.key, serialize(partialize(event.state)));
      }).catch(() => undefined);
    },
    async persist(app) {
      await readyPromise;
      await runQueued("persist", async () => {
        await options.storage.setItem(options.key, serialize(partialize(app.store.getPureState())));
      });
    },
    ready() {
      return readyPromise;
    },
    setup(app, context) {
      context.onDispose(async () => {
        await readyPromise;
        await writeQueue;
      });

      readyPromise = (async () => {
        try {
          const stored = await options.storage.getItem(options.key);

          if (stored === null) {
            return;
          }

          app.runInAction(
            () => app.store.setState(merge(deserialize(stored), app.store.getPureState()) as never),
            { name: "storage.hydrate" },
          );
        } catch (error) {
          options.onError?.(error, "hydrate");
          throw error;
        }
      })();

      return readyPromise;
    },
  };
}
