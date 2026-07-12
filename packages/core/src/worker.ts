import { CosystemError } from "./errors.js";
import { createApp, type App, type CreateAppOptions, type Plugin } from "./app.js";
import { getModuleMetadata } from "./metadata.js";
import type { Constructor } from "./types.js";

export interface WorkerTransport {
  post(message: WorkerMessage): void;
  subscribe(listener: (message: WorkerMessage) => void): () => void;
}

export type DataTransportEmitOptions =
  | WorkerMessage["type"]
  | {
      readonly name: WorkerMessage["type"];
      readonly respond?: boolean;
      readonly timeout?: number;
      readonly silent?: boolean;
      readonly skipBeforeEmit?: boolean;
    };

export interface DataTransportLike {
  emit(options: DataTransportEmitOptions, message: WorkerMessage): Promise<unknown>;
  listen(
    name: WorkerMessage["type"],
    listener: (message: WorkerMessage) => unknown,
  ): (() => void) | void;
}

export interface DataTransportWorkerTransportOptions {
  readonly onError?: (error: unknown, message: WorkerMessage) => void;
  readonly onInvalidMessage?: (message: unknown) => void;
}

export interface PostMessageTarget {
  postMessage(message: WorkerMessage): void;
}

export interface PostMessageOriginTarget {
  postMessage(message: WorkerMessage, targetOrigin: string): void;
}

export interface PostMessageEventLike {
  readonly data?: unknown;
  readonly origin?: string;
  readonly source?: unknown;
}

export interface PostMessageSource {
  addEventListener(type: "message", listener: (event: PostMessageEventLike) => void): void;
  removeEventListener(type: "message", listener: (event: PostMessageEventLike) => void): void;
}

export interface PostMessageEndpoint extends PostMessageTarget, PostMessageSource {}

export interface PostMessageWorkerTransportOptions {
  readonly source?: PostMessageSource;
  readonly target?: PostMessageTarget | PostMessageOriginTarget;
  readonly targetOrigin?: string;
  readonly allowedOrigins?: readonly string[];
  readonly expectedSource?: unknown;
  readonly onError?: (error: unknown, message: WorkerMessage) => void;
  readonly onInvalidMessage?: (message: unknown) => void;
}

export interface BroadcastMessageEventLike {
  readonly data?: unknown;
}

export interface BroadcastChannelLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: BroadcastMessageEventLike) => void): void;
  removeEventListener(type: "message", listener: (event: BroadcastMessageEventLike) => void): void;
  close?(): void;
}

export interface BroadcastWorkerTransportOptions {
  readonly channel?: string;
  readonly peerId?: string;
  readonly targetPeerId?: string;
  readonly authToken?: string;
  readonly onError?: (error: unknown, message: WorkerMessage) => void;
  readonly onInvalidMessage?: (message: unknown) => void;
}

export interface BroadcastWorkerMessageEnvelope {
  readonly type: "cosystem:worker";
  readonly channel: string;
  readonly source: string;
  readonly target?: string;
  readonly auth?: string;
  readonly message: WorkerMessage;
}

export type WorkerMessage =
  | WorkerCallMessage
  | WorkerResultMessage
  | WorkerStateMessage
  | WorkerSyncMessage
  | WorkerReadyMessage;

export interface WorkerCallMessage {
  readonly id: number;
  readonly type: "call";
  readonly module: string;
  readonly method: string;
  readonly args: readonly unknown[];
}

export interface WorkerResultMessage {
  readonly id: number;
  readonly type: "result";
  readonly stateVersion?: number;
  readonly value?: unknown;
  readonly error?: SerializedWorkerError;
}

export interface WorkerStateMessage {
  readonly type: "state";
  readonly state?: unknown;
  readonly patches?: readonly unknown[];
  readonly sections?: readonly WorkerStateSection[];
  readonly sync: "patch" | "snapshot";
  readonly syncId?: number;
  readonly version: number;
}

export interface WorkerReadyMessage {
  readonly type: "ready";
}

export interface WorkerSyncMessage {
  readonly id: number;
  readonly type: "sync";
  readonly stateVersion?: number;
}

export interface SerializedWorkerError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

export interface CreateWorkerAppOptions extends CreateAppOptions {
  readonly transport: WorkerTransport;
  readonly sync?: WorkerStateSyncMode;
  readonly stateSections?: readonly WorkerStateSection[];
  readonly onInvalidMessage?: (message: unknown) => void;
}

export type WorkerStateSyncMode = "snapshot" | "patch";
export type WorkerStateSection = string;

export interface WorkerAppHost {
  readonly app: App;
  readonly ready: Promise<void>;
  dispose(): Promise<void>;
}

export interface CreateWorkerClientOptions {
  readonly transport: WorkerTransport;
  readonly onConflict?: (event: WorkerConflictEvent) => void;
  readonly onInvalidMessage?: (message: unknown) => void;
  readonly requestTimeout?: number;
  readonly signal?: AbortSignal;
}

export interface WorkerCallOptions {
  readonly signal?: AbortSignal;
  readonly timeout?: number;
}

export type WorkerConflictReason =
  | "missing-snapshot"
  | "patch-apply-failed"
  | "stale-message"
  | "version-gap";

export interface WorkerConflictEvent {
  readonly reason: WorkerConflictReason;
  readonly currentVersion: number;
  readonly incomingVersion: number;
  readonly message: WorkerStateMessage;
  readonly error?: unknown;
}

export type AsyncMethodProxy<T extends object> = {
  readonly [Key in keyof T as T[Key] extends (...args: any[]) => unknown
    ? Key
    : never]: T[Key] extends (...args: infer Args) => infer Return
    ? (...args: Args) => Promise<Awaited<Return>>
    : never;
};

export type WorkerStateSelector<T> = (state: unknown, client: WorkerClient) => T;

export interface WorkerWatchOptions<T> {
  readonly equals?: (value: T, previous: T) => boolean;
  readonly immediate?: boolean;
}

export interface WorkerClient {
  readonly ready: Promise<void>;
  readonly state: {
    readonly version: number;
  };
  getState(): unknown;
  select<T>(selector: WorkerStateSelector<T>): T;
  watch<T>(
    selector: WorkerStateSelector<T>,
    listener: (value: T, previous: T) => void,
    options?: WorkerWatchOptions<T>,
  ): () => void;
  call(module: string, method: string, ...args: readonly unknown[]): Promise<unknown>;
  callWithOptions(
    module: string,
    method: string,
    args: readonly unknown[],
    options?: WorkerCallOptions,
  ): Promise<unknown>;
  module<T extends object>(name: string): AsyncMethodProxy<T>;
  subscribe(listener: (message: WorkerStateMessage) => void): () => void;
  dispose(): void;
}

interface WorkerSelectorWatcher<T> {
  readonly selector: WorkerStateSelector<T>;
  readonly listener: (value: T, previous: T) => void;
  readonly equals: (value: T, previous: T) => boolean;
  readonly immediate: boolean;
  initialized: boolean;
  previous: T | undefined;
}

type PatchPathSegment = string | number;
type PatchContainer = Record<string, unknown> | unknown[];

interface BroadcastMessageRoute {
  readonly id: number;
  readonly source: string;
}

interface WorkerPatch {
  readonly op: "add" | "replace" | "remove";
  readonly path: unknown;
  readonly value?: unknown;
}

interface PendingWorkerCall {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
  readonly cleanup: () => void;
  result?: PendingWorkerResult;
}

interface PendingWorkerResult {
  readonly value?: unknown;
  readonly error?: SerializedWorkerError;
  readonly stateVersion?: number;
}

const maximumArrayIndex = 2 ** 32 - 2;

export function createWorkerApp(options: CreateWorkerAppOptions): WorkerAppHost {
  const { onInvalidMessage, stateSections, sync = "snapshot", transport, ...appOptions } = options;
  let stateSyncVersion = 0;
  let publishPatches = false;
  const patchPlugin: Plugin = {
    name: "cosystem:worker-patches",
    onPatch(event) {
      if (publishPatches) {
        const version = stateSections === undefined ? app.state.version : stateSyncVersion + 1;

        if (publishState(app, transport, event.patches, sync, stateSections, version)) {
          stateSyncVersion = version;
        }
      }
    },
  };
  const app = createApp({
    ...appOptions,
    engine: {
      ...appOptions.engine,
      patches: true,
    },
    plugins: [...(appOptions.plugins ?? []), patchPlugin],
  });
  let disposed = false;
  let disposePromise: Promise<void> | undefined;
  const ready = app.start().then(() => {
    if (disposed) {
      throw new CosystemError("Worker host disposed before initial state.");
    }

    publishPatches = true;
    transport.post({ type: "ready" });
    const version = stateSections === undefined ? app.state.version : stateSyncVersion;

    if (publishState(app, transport, [], "snapshot", stateSections, version)) {
      stateSyncVersion = version;
    }
    return undefined;
  });

  ready.catch(() => undefined);
  let unsubscribeTransport = noop;

  try {
    unsubscribeTransport = transport.subscribe((message) => {
      if (!isWorkerMessage(message)) {
        reportInvalidWorkerMessage(onInvalidMessage, message);
        return;
      }

      if (disposed) {
        return;
      }

      if (message.type === "sync") {
        void handleSync(app, transport, message, ready, stateSections, () => stateSyncVersion);
        return;
      }

      if (message.type === "call") {
        void handleCall(app, transport, message, ready, () => stateSyncVersion).catch(
          () => undefined,
        );
      }
    });
  } catch (error) {
    disposed = true;
    void app.dispose().catch(() => undefined);
    throw error;
  }

  return {
    app,
    ready,
    dispose() {
      disposePromise ??= disposeHost();
      return disposePromise;
    },
  };

  async function disposeHost(): Promise<void> {
    disposed = true;
    publishPatches = false;
    const errors: unknown[] = [];

    try {
      unsubscribeTransport();
    } catch (error) {
      errors.push(error);
    }

    try {
      await app.dispose();
    } catch (error) {
      errors.push(error);
    } finally {
      await ready.catch(() => undefined);
    }

    if (errors.length === 1) {
      throw errors[0];
    }

    if (errors.length > 1) {
      throw new AggregateError(errors, "Worker host disposal failed.");
    }
  }
}

export function createWorkerClient(options: CreateWorkerClientOptions): WorkerClient {
  const {
    onConflict,
    onInvalidMessage,
    requestTimeout = defaultWorkerRequestTimeout,
    signal: defaultSignal,
    transport,
  } = options;
  assertValidWorkerTimeout(requestTimeout, "requestTimeout");
  const listeners = new Set<(message: WorkerStateMessage) => void>();
  const selectorWatchers = new Set<WorkerSelectorWatcher<unknown>>();
  const pending = new Map<number, PendingWorkerCall>();
  const state = { version: 0 };
  let nextId = 1;
  let requestedSyncVersion: number | undefined;
  let syncedStaleVersion = 0;
  let snapshot: unknown;
  let readySettled = false;
  let disposed = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  ready.catch(() => undefined);

  let unsubscribe = noop;
  const client: WorkerClient = {
    ready,
    state,
    call(module, method, ...args) {
      return client.callWithOptions(module, method, args);
    },
    callWithOptions(module, method, args, callOptions = {}) {
      if (disposed) {
        return Promise.reject(new CosystemError("Worker client has been disposed."));
      }

      const timeout = callOptions.timeout ?? requestTimeout;
      const signal = callOptions.signal ?? defaultSignal;
      assertValidWorkerTimeout(timeout, "timeout");
      const id = nextId;
      nextId += 1;

      return new Promise((resolve, reject) => {
        let timeoutId: ReturnType<typeof setTimeout> | undefined;
        const abort = () => {
          fail(new CosystemError("Worker call aborted."));
        };
        const cleanup = () => {
          if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
          }

          signal?.removeEventListener("abort", abort);
        };
        const entry: PendingWorkerCall = { cleanup, reject, resolve };
        const fail = (error: unknown) => {
          if (pending.get(id) !== entry) {
            return;
          }

          pending.delete(id);
          cleanup();
          reject(error);
        };

        pending.set(id, entry);

        if (signal?.aborted === true) {
          abort();
          return;
        }

        signal?.addEventListener("abort", abort, { once: true });

        if (timeout > 0) {
          timeoutId = setTimeout(() => {
            fail(new CosystemError(`Worker call timed out after ${timeout}ms.`));
          }, timeout);
        }

        try {
          transport.post({
            args,
            id,
            method,
            module,
            type: "call",
          });
        } catch (error) {
          fail(error);
        }
      });
    },
    dispose() {
      if (disposed) {
        return;
      }

      disposed = true;
      let unsubscribeError: unknown;
      let unsubscribeFailed = false;

      try {
        unsubscribe();
      } catch (error) {
        unsubscribeFailed = true;
        unsubscribeError = error;
      }

      if (!readySettled) {
        readySettled = true;
        rejectReady(new CosystemError("Worker client disposed before initial state."));
      }

      for (const entry of pending.values()) {
        entry.cleanup();
        entry.reject(new CosystemError("Worker client disposed before response."));
      }

      pending.clear();
      listeners.clear();
      selectorWatchers.clear();

      if (unsubscribeFailed) {
        throw unsubscribeError;
      }
    },
    getState() {
      return snapshot;
    },
    module<T extends object>(name: string): AsyncMethodProxy<T> {
      return new Proxy(
        {},
        {
          get(_target, property) {
            if (typeof property !== "string" || property === "then") {
              return undefined;
            }

            return (...args: readonly unknown[]) => client.call(name, property, ...args);
          },
        },
      ) as AsyncMethodProxy<T>;
    },
    select<T>(selector: WorkerStateSelector<T>): T {
      if (snapshot === undefined) {
        throw new CosystemError("Worker client state is not ready.");
      }

      return selector(snapshot, client);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    watch<T>(
      selector: WorkerStateSelector<T>,
      listener: (value: T, previous: T) => void,
      watchOptions: WorkerWatchOptions<T> = {},
    ): () => void {
      const watcher: WorkerSelectorWatcher<T> = {
        equals: watchOptions.equals ?? Object.is,
        immediate: watchOptions.immediate ?? false,
        initialized: false,
        listener,
        previous: undefined,
        selector,
      };

      if (snapshot !== undefined) {
        const value = selector(snapshot, client);
        watcher.initialized = true;
        watcher.previous = value;

        if (watcher.immediate) {
          runWorkerObserver(() => listener(value, value));
        }
      }

      selectorWatchers.add(watcher as WorkerSelectorWatcher<unknown>);

      return () => {
        selectorWatchers.delete(watcher as WorkerSelectorWatcher<unknown>);
      };
    },
  };

  const settlePendingResult = (
    id: number,
    entry: PendingWorkerCall,
    result: PendingWorkerResult,
  ): void => {
    pending.delete(id);
    entry.cleanup();

    if (result.error !== undefined) {
      entry.reject(createRemoteError(result.error));
      return;
    }

    entry.resolve(result.value);
  };

  const trySettlePendingResult = (
    id: number,
    entry: PendingWorkerCall,
    result: PendingWorkerResult,
  ): boolean => {
    if (
      result.stateVersion !== undefined &&
      (!readySettled || result.stateVersion > state.version)
    ) {
      return false;
    }

    settlePendingResult(id, entry, result);
    return true;
  };

  const resolveSyncedResults = () => {
    for (const [id, entry] of pending) {
      if (entry.result !== undefined) {
        trySettlePendingResult(id, entry, entry.result);
      }
    }
  };

  const requestStateSync = (stateVersion: number): void => {
    if (disposed) {
      return;
    }

    if (
      (readySettled && stateVersion <= state.version) ||
      (requestedSyncVersion !== undefined && stateVersion <= requestedSyncVersion)
    ) {
      return;
    }

    requestedSyncVersion = stateVersion;
    transport.post({
      id: nextId,
      stateVersion,
      type: "sync",
    });
    nextId += 1;
  };

  const publishSelectorWatchers = () => {
    if (snapshot === undefined) {
      return;
    }

    for (const watcher of selectorWatchers) {
      try {
        const value = watcher.selector(snapshot, client);

        if (!watcher.initialized) {
          watcher.initialized = true;
          watcher.previous = value;

          if (watcher.immediate) {
            watcher.listener(value, value);
          }

          continue;
        }

        const previous = watcher.previous as never;

        if (watcher.equals(value, previous)) {
          continue;
        }

        watcher.previous = value;
        watcher.listener(value, previous as never);
      } catch {
        // A selector observer must not interrupt state publication or pending RPC settlement.
      }
    }
  };

  unsubscribe = transport.subscribe((message) => {
    if (!isWorkerMessage(message)) {
      reportInvalidWorkerMessage(onInvalidMessage, message);
      return;
    }

    if (message.type === "state") {
      if (readySettled && message.version <= state.version) {
        if (message.version <= syncedStaleVersion) {
          return;
        }

        reportWorkerConflict(onConflict, {
          currentVersion: state.version,
          incomingVersion: message.version,
          message,
          reason: "stale-message",
        });
        return;
      }

      const isPatchOnly = message.state === undefined && message.sync === "patch";

      if (isPatchOnly && snapshot === undefined) {
        reportWorkerConflict(onConflict, {
          currentVersion: state.version,
          incomingVersion: message.version,
          message,
          reason: "missing-snapshot",
        });
        return;
      }

      if (isPatchOnly && readySettled && message.version !== state.version + 1) {
        reportWorkerConflict(onConflict, {
          currentVersion: state.version,
          incomingVersion: message.version,
          message,
          reason: "version-gap",
        });
        return;
      }

      try {
        const nextSnapshot = isPatchOnly
          ? applyWorkerPatches(snapshot, message.patches ?? [])
          : message.state;

        if (!isRecord(nextSnapshot)) {
          throw new CosystemError("Worker state root must remain an object.");
        }

        snapshot = nextSnapshot;
      } catch (error) {
        reportWorkerConflict(onConflict, {
          currentVersion: state.version,
          error,
          incomingVersion: message.version,
          message,
          reason: "patch-apply-failed",
        });
        return;
      }

      state.version = message.version;
      if (requestedSyncVersion !== undefined && requestedSyncVersion <= state.version) {
        syncedStaleVersion = Math.max(syncedStaleVersion, state.version);
        requestedSyncVersion = undefined;
      }

      if (!readySettled) {
        readySettled = true;
        resolveReady();
      }

      for (const listener of listeners) {
        runWorkerObserver(() => listener(message));
      }

      publishSelectorWatchers();
      resolveSyncedResults();

      return;
    }

    if (message.type !== "result") {
      return;
    }

    const entry = pending.get(message.id);

    if (entry === undefined) {
      return;
    }

    pending.delete(message.id);
    const result: PendingWorkerResult = {
      ...(message.error === undefined ? { value: message.value } : { error: message.error }),
      ...(typeof message.stateVersion === "number" ? { stateVersion: message.stateVersion } : {}),
    };

    if (trySettlePendingResult(message.id, entry, result)) {
      return;
    }

    entry.result = result;
    pending.set(message.id, entry);

    try {
      requestStateSync(result.stateVersion!);
    } catch (error) {
      if (pending.get(message.id) === entry) {
        pending.delete(message.id);
        entry.cleanup();
        entry.reject(error);
      }
    }
  });

  return client;
}

function reportWorkerConflict(
  onConflict: ((event: WorkerConflictEvent) => void) | undefined,
  event: WorkerConflictEvent,
): void {
  try {
    onConflict?.(event);
  } catch {
    // Conflict observers cannot repair protocol state and must not interrupt message handling.
  }
}

function reportWorkerTransportError(
  onError: ((error: unknown, message: WorkerMessage) => void) | undefined,
  error: unknown,
  message: WorkerMessage,
): void {
  try {
    onError?.(error, message);
  } catch {
    // Transport error observers must not rethrow delivery failures or create rejected tasks.
  }
}

function runWorkerObserver(callback: () => void): void {
  try {
    callback();
  } catch {
    // Worker observers cannot alter protocol state and must not interrupt message handling.
  }
}

function reportInvalidWorkerMessage(
  onInvalidMessage: ((message: unknown) => void) | undefined,
  message: unknown,
): void {
  try {
    onInvalidMessage?.(message);
  } catch {
    // Invalid-message observers must not make malformed input executable control flow.
  }
}

export function createMemoryWorkerTransportPair(): readonly [WorkerTransport, WorkerTransport] {
  const leftListeners = new Set<(message: WorkerMessage) => void>();
  const rightListeners = new Set<(message: WorkerMessage) => void>();

  return [
    createMemoryWorkerTransport(leftListeners, rightListeners),
    createMemoryWorkerTransport(rightListeners, leftListeners),
  ];
}

export function createPostMessageWorkerTransport(
  endpoint: PostMessageEndpoint,
  options: PostMessageWorkerTransportOptions = {},
): WorkerTransport {
  const source = options.source ?? endpoint;
  const target = options.target ?? endpoint;

  return {
    post(message) {
      try {
        if (options.targetOrigin === undefined) {
          // eslint-disable-next-line unicorn/require-post-message-target-origin -- Worker and MessagePort endpoints do not accept a targetOrigin.
          (target as PostMessageTarget).postMessage(message);
        } else {
          (target as PostMessageOriginTarget).postMessage(message, options.targetOrigin);
        }
      } catch (error) {
        reportWorkerTransportError(options.onError, error, message);
      }
    },
    subscribe(listener) {
      const handleMessage = (event: PostMessageEventLike) => {
        if (options.expectedSource !== undefined && event.source !== options.expectedSource) {
          return;
        }

        if (
          options.allowedOrigins !== undefined &&
          (typeof event.origin !== "string" ||
            !isAllowedPostMessageOrigin(event.origin, options.allowedOrigins))
        ) {
          return;
        }

        if (!isWorkerMessage(event.data)) {
          reportInvalidWorkerMessage(options.onInvalidMessage, event.data);
          return;
        }

        listener(event.data);
      };

      source.addEventListener("message", handleMessage);

      return () => {
        source.removeEventListener("message", handleMessage);
      };
    },
  };
}

export function createBroadcastWorkerTransport(
  broadcast: BroadcastChannelLike,
  options: BroadcastWorkerTransportOptions = {},
): WorkerTransport {
  const channel = options.channel ?? defaultBroadcastWorkerChannel;
  const peerId = options.peerId ?? createWorkerPeerId();
  const messageRoutes = new Map<number, BroadcastMessageRoute>();
  let nextRoutedCallId = 1;

  return {
    post(message) {
      try {
        const routed = routeBroadcastWorkerMessage(message, messageRoutes);
        const target = routed.target ?? getBroadcastWorkerTarget(message, options);
        const envelope: BroadcastWorkerMessageEnvelope = {
          channel,
          message: routed.message,
          source: peerId,
          type: "cosystem:worker",
          ...(options.authToken === undefined ? {} : { auth: options.authToken }),
          ...(target === undefined ? {} : { target }),
        };

        // eslint-disable-next-line unicorn/require-post-message-target-origin -- BroadcastChannel-style endpoints do not accept targetOrigin.
        broadcast.postMessage(envelope);
      } catch (error) {
        reportWorkerTransportError(options.onError, error, message);
      }
    },
    subscribe(listener) {
      const handleMessage = (event: BroadcastMessageEventLike) => {
        const envelope = event.data;

        if (
          !isRecord(envelope) ||
          envelope.type !== "cosystem:worker" ||
          envelope.channel !== channel ||
          envelope.source === peerId ||
          (envelope.target !== undefined && envelope.target !== peerId)
        ) {
          return;
        }

        if (!isBroadcastWorkerMessageEnvelope(envelope)) {
          reportInvalidWorkerMessage(options.onInvalidMessage, envelope);
          return;
        }

        if (options.authToken !== undefined && envelope.auth !== options.authToken) {
          return;
        }

        if (envelope.message.type === "call" || envelope.message.type === "sync") {
          const routedCallId = nextRoutedCallId;
          nextRoutedCallId += 1;
          messageRoutes.set(routedCallId, {
            id: envelope.message.id,
            source: envelope.source,
          });
          listener({
            ...envelope.message,
            id: routedCallId,
          });
          return;
        }

        listener(envelope.message);
      };

      broadcast.addEventListener("message", handleMessage);

      return () => {
        broadcast.removeEventListener("message", handleMessage);
      };
    },
  };
}

export function createMemoryBroadcastChannel(
  name: string = defaultBroadcastWorkerChannel,
): BroadcastChannelLike {
  return new MemoryBroadcastChannel(name);
}

export function createDataTransportWorkerTransport(
  dataTransport: DataTransportLike,
  options: DataTransportWorkerTransportOptions = {},
): WorkerTransport {
  const listeners = new Set<(message: WorkerMessage) => void>();
  const disposers: (() => void)[] = [];
  let listening = false;

  const start = () => {
    if (listening) {
      return;
    }

    listening = true;

    try {
      for (const type of workerMessageTypes) {
        const dispose = dataTransport.listen(type, (message) => {
          if (!isWorkerMessage(message) || message.type !== type) {
            reportInvalidWorkerMessage(options.onInvalidMessage, message);
            return;
          }

          for (const listener of listeners) {
            listener(message);
          }
        });

        if (typeof dispose === "function") {
          disposers.push(dispose);
        }
      }
    } catch (error) {
      try {
        stop();
      } catch (cleanupError) {
        // eslint-disable-next-line preserve-caught-error -- Both subscription and rollback failures are actionable.
        throw new AggregateError([error, cleanupError], "Data transport subscription failed.", {
          cause: error,
        });
      }

      throw error;
    }
  };

  const stop = () => {
    if (!listening) {
      return;
    }

    listening = false;
    const errors: unknown[] = [];

    for (const dispose of disposers.splice(0)) {
      try {
        dispose();
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length === 1) {
      throw errors[0];
    }

    if (errors.length > 1) {
      throw new AggregateError(errors, "Data transport listeners failed to unsubscribe.");
    }
  };

  return {
    post(message) {
      void dataTransport
        .emit(
          {
            name: message.type,
            respond: false,
          },
          message,
        )
        .catch((error: unknown) => {
          reportWorkerTransportError(options.onError, error, message);
        });
    },
    subscribe(listener) {
      listeners.add(listener);

      try {
        start();
      } catch (error) {
        listeners.delete(listener);
        throw error;
      }

      return () => {
        listeners.delete(listener);

        if (listeners.size === 0) {
          stop();
        }
      };
    },
  };
}

function getBroadcastWorkerTarget(
  message: WorkerMessage,
  options: BroadcastWorkerTransportOptions,
): string | undefined {
  return message.type === "call" || message.type === "sync" ? options.targetPeerId : undefined;
}

function routeBroadcastWorkerMessage(
  message: WorkerMessage,
  messageRoutes: Map<number, BroadcastMessageRoute>,
): { readonly message: WorkerMessage; readonly target?: string } {
  if (message.type === "result") {
    const route = messageRoutes.get(message.id);

    if (route === undefined) {
      return { message };
    }

    messageRoutes.delete(message.id);

    return {
      message: {
        ...message,
        id: route.id,
      },
      target: route.source,
    };
  }

  if (message.type !== "state" || message.syncId === undefined) {
    return { message };
  }

  const route = messageRoutes.get(message.syncId);

  if (route === undefined) {
    return { message };
  }

  messageRoutes.delete(message.syncId);
  const { syncId: _syncId, ...stateMessage } = message;

  return {
    message: stateMessage,
    target: route.source,
  };
}

async function handleCall(
  app: App,
  transport: WorkerTransport,
  message: WorkerCallMessage,
  ready: Promise<void>,
  getStateVersion: () => number,
): Promise<void> {
  try {
    await ready;
    const module = app.getModuleByName<Record<string, unknown>>(message.module);
    const metadata = getModuleMetadata(module.constructor as Constructor);

    if (metadata?.actions.has(message.method) !== true) {
      throw new CosystemError(
        `${message.module}.${message.method} is not exposed as a remote action.`,
      );
    }

    const method = module[message.method];

    if (typeof method !== "function") {
      throw new CosystemError(`${message.module}.${message.method} is not callable.`);
    }

    const value = await method.apply(module, message.args);
    transport.post({
      id: message.id,
      stateVersion: getStateVersion(),
      type: "result",
      value,
    });
  } catch (error) {
    transport.post({
      error: serializeError(error),
      id: message.id,
      stateVersion: getStateVersion(),
      type: "result",
    });
  }
}

async function handleSync(
  app: App,
  transport: WorkerTransport,
  message: WorkerSyncMessage,
  ready: Promise<void>,
  sections: readonly WorkerStateSection[] | undefined,
  getStateVersion: () => number,
): Promise<void> {
  try {
    await ready;
    publishState(app, transport, [], "snapshot", sections, getStateVersion(), message.id);
  } catch {
    // The startup failure is reported through the host ready promise and call results.
  }
}

function publishState(
  app: App,
  transport: WorkerTransport,
  patches: readonly unknown[] = [],
  mode: WorkerStateSyncMode = "snapshot",
  sections?: readonly WorkerStateSection[],
  version: number = app.state.version,
  syncId?: number,
): boolean {
  const filteredPatches = filterWorkerPatches(patches, sections);
  const isPatch = filteredPatches.length > 0;

  if (patches.length > 0 && filteredPatches.length === 0) {
    return false;
  }

  const state = filterWorkerState(app.store.getPureState(), sections);
  const message: WorkerStateMessage = {
    ...(isPatch && mode === "patch" ? {} : { state }),
    ...(sections === undefined ? {} : { sections }),
    sync: isPatch ? "patch" : "snapshot",
    ...(syncId === undefined ? {} : { syncId }),
    type: "state",
    version,
    ...(isPatch ? { patches: filteredPatches } : {}),
  };

  transport.post(message);
  return true;
}

function filterWorkerState(state: unknown, sections?: readonly WorkerStateSection[]): unknown {
  if (sections === undefined || !isRecord(state)) {
    return state;
  }

  const filtered: Record<string, unknown> = {};

  for (const section of sections) {
    if (Object.hasOwn(state, section)) {
      filtered[section] = state[section];
    }
  }

  return filtered;
}

function filterWorkerPatches(
  patches: readonly unknown[],
  sections?: readonly WorkerStateSection[],
): readonly unknown[] {
  if (sections === undefined) {
    return patches;
  }

  const sectionSet = new Set(sections);

  return patches.filter((patch) => {
    if (!isWorkerPatch(patch)) {
      throw new CosystemError("Worker state patch is invalid.");
    }

    const section = getWorkerPatchSection(patch);
    return section !== undefined && sectionSet.has(String(section));
  });
}

function getWorkerPatchSection(patch: WorkerPatch): PatchPathSegment | undefined {
  const path = normalizePatchPath(patch.path);
  return path[0];
}

function applyWorkerPatches(state: unknown, patches: readonly unknown[]): unknown {
  let next = state;

  for (const patch of patches) {
    next = applyWorkerPatch(next, patch);
  }

  return next;
}

function applyWorkerPatch(state: unknown, patch: unknown): unknown {
  if (!isWorkerPatch(patch)) {
    throw new CosystemError("Worker state patch is invalid.");
  }

  const path = normalizePatchPath(patch.path);

  if (path.length === 0) {
    if (patch.op === "remove") {
      return undefined;
    }

    return patch.value;
  }

  return applyPatchAtPath(state, path, patch);
}

function applyPatchAtPath(
  state: unknown,
  path: readonly PatchPathSegment[],
  patch: WorkerPatch,
): unknown {
  const [segment, ...rest] = path;

  if (segment === undefined) {
    throw new CosystemError("Worker state patch path is invalid.");
  }

  const container = clonePatchContainer(state, segment);

  if (rest.length === 0) {
    if (patch.op === "remove") {
      removePatchValue(container, segment);
      return container;
    }

    setPatchValue(container, segment, patch.value, patch.op);
    return container;
  }

  setPatchValue(
    container,
    segment,
    applyPatchAtPath(getPatchValue(container, segment), rest, patch),
    "replace",
  );

  return container;
}

function clonePatchContainer(state: unknown, nextSegment: PatchPathSegment): PatchContainer {
  if (Array.isArray(state)) {
    return [...state];
  }

  if (isRecord(state)) {
    return { ...state };
  }

  return typeof nextSegment === "number" ? [] : {};
}

function getPatchValue(container: PatchContainer, segment: PatchPathSegment): unknown {
  if (Array.isArray(container)) {
    return container[toArrayIndex(segment)];
  }

  return container[String(segment)];
}

function setPatchValue(
  container: PatchContainer,
  segment: PatchPathSegment,
  value: unknown,
  operation: "add" | "replace",
): void {
  if (Array.isArray(container)) {
    const index = toArrayIndex(segment);

    if (operation === "add") {
      if (index > container.length) {
        throw new CosystemError("Worker state patch array index is out of range.");
      }

      container.splice(index, 0, value);
      return;
    }

    if (index >= container.length) {
      throw new CosystemError("Worker state patch array index is out of range.");
    }

    container[index] = value;
    return;
  }

  container[String(segment)] = value;
}

function removePatchValue(container: PatchContainer, segment: PatchPathSegment): void {
  if (Array.isArray(container)) {
    const index = toArrayIndex(segment);

    if (index >= container.length) {
      throw new CosystemError("Worker state patch array index is out of range.");
    }

    container.splice(index, 1);
    return;
  }

  delete container[String(segment)];
}

function toArrayIndex(segment: PatchPathSegment): number {
  if (typeof segment === "string" && !/^(?:0|[1-9]\d*)$/.test(segment)) {
    throw new CosystemError("Worker state patch array index is invalid.");
  }

  const index = typeof segment === "number" ? segment : Number(segment);

  if (!Number.isSafeInteger(index) || index < 0 || index > maximumArrayIndex) {
    throw new CosystemError("Worker state patch array index is invalid.");
  }

  return index;
}

function normalizePatchPath(path: unknown): readonly PatchPathSegment[] {
  if (Array.isArray(path)) {
    return path.map((segment) => normalizePatchPathSegment(segment));
  }

  if (typeof path === "string") {
    if (path === "") {
      return [];
    }

    return path
      .split("/")
      .slice(1)
      .map((segment) =>
        normalizePatchPathSegment(segment.replaceAll("~1", "/").replaceAll("~0", "~")),
      );
  }

  throw new CosystemError("Worker state patch path is invalid.");
}

function normalizePatchPathSegment(segment: unknown): PatchPathSegment {
  if (
    typeof segment === "number" &&
    Number.isSafeInteger(segment) &&
    segment >= 0 &&
    segment <= maximumArrayIndex
  ) {
    return segment;
  }

  if (typeof segment === "string" && !isUnsafeWorkerPathSegment(segment)) {
    return segment;
  }

  throw new CosystemError("Worker state patch path segment is invalid.");
}

function isWorkerPatch(value: unknown): value is WorkerPatch {
  if (!isRecord(value)) {
    return false;
  }

  if (value.op !== "add" && value.op !== "replace" && value.op !== "remove") {
    return false;
  }

  if (value.op !== "remove" && !("value" in value)) {
    return false;
  }

  if (typeof value.path === "string" && value.path !== "" && !value.path.startsWith("/")) {
    return false;
  }

  try {
    normalizePatchPath(value.path);
    return true;
  } catch {
    return false;
  }
}

function createMemoryWorkerTransport(
  inbox: Set<(message: WorkerMessage) => void>,
  outbox: Set<(message: WorkerMessage) => void>,
): WorkerTransport {
  return {
    post(message) {
      const clonedMessage = structuredClone(message);

      for (const listener of outbox) {
        listener(clonedMessage);
      }
    },
    subscribe(listener) {
      inbox.add(listener);
      return () => {
        inbox.delete(listener);
      };
    },
  };
}

const workerMessageTypes = ["call", "result", "state", "sync", "ready"] as const;
const defaultWorkerRequestTimeout = 30_000;
const defaultBroadcastWorkerChannel = "cosystem:worker";
const memoryBroadcastChannels = new Map<string, Set<MemoryBroadcastChannel>>();
let nextWorkerPeerId = 1;

class MemoryBroadcastChannel implements BroadcastChannelLike {
  readonly name: string;
  readonly #listeners = new Set<(event: BroadcastMessageEventLike) => void>();
  #closed = false;

  constructor(name: string) {
    this.name = name;

    let channels = memoryBroadcastChannels.get(name);

    if (channels === undefined) {
      channels = new Set();
      memoryBroadcastChannels.set(name, channels);
    }

    channels.add(this);
  }

  postMessage(message: unknown): void {
    if (this.#closed) {
      return;
    }

    const channels = memoryBroadcastChannels.get(this.name);

    if (channels === undefined) {
      return;
    }

    for (const channel of channels) {
      if (channel === this || channel.#closed) {
        continue;
      }

      channel.dispatch({ data: structuredClone(message) });
    }
  }

  addEventListener(_type: "message", listener: (event: BroadcastMessageEventLike) => void): void {
    if (!this.#closed) {
      this.#listeners.add(listener);
    }
  }

  removeEventListener(
    _type: "message",
    listener: (event: BroadcastMessageEventLike) => void,
  ): void {
    this.#listeners.delete(listener);
  }

  close(): void {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    this.#listeners.clear();

    const channels = memoryBroadcastChannels.get(this.name);

    if (channels === undefined) {
      return;
    }

    channels.delete(this);

    if (channels.size === 0) {
      memoryBroadcastChannels.delete(this.name);
    }
  }

  private dispatch(event: BroadcastMessageEventLike): void {
    for (const listener of this.#listeners) {
      listener(event);
    }
  }
}

function createWorkerPeerId(): string {
  const id = nextWorkerPeerId;
  nextWorkerPeerId += 1;
  return `peer:${id}`;
}

function isWorkerMessage(message: unknown): message is WorkerMessage {
  if (!isRecord(message)) {
    return false;
  }

  switch (message.type) {
    case "call":
      return (
        isWorkerMessageId(message.id) &&
        typeof message.module === "string" &&
        message.module.length > 0 &&
        typeof message.method === "string" &&
        message.method.length > 0 &&
        Array.isArray(message.args)
      );

    case "result":
      return (
        isWorkerMessageId(message.id) &&
        isOptionalWorkerStateVersion(message.stateVersion) &&
        (message.error === undefined || isSerializedWorkerError(message.error))
      );

    case "state":
      return (
        isWorkerStateVersion(message.version) &&
        (message.sync === "patch" || message.sync === "snapshot") &&
        (message.syncId === undefined || isWorkerMessageId(message.syncId)) &&
        (message.sections === undefined ||
          (Array.isArray(message.sections) &&
            message.sections.every((section) => typeof section === "string"))) &&
        (message.patches === undefined ||
          (Array.isArray(message.patches) && message.patches.every(isWorkerPatch))) &&
        (message.state === undefined || isRecord(message.state)) &&
        (message.sync !== "snapshot" || isRecord(message.state)) &&
        (message.sync !== "patch" || isRecord(message.state) || message.patches !== undefined)
      );

    case "sync":
      return isWorkerMessageId(message.id) && isOptionalWorkerStateVersion(message.stateVersion);

    case "ready":
      return true;

    default:
      return false;
  }
}

function isBroadcastWorkerMessageEnvelope(
  message: unknown,
): message is BroadcastWorkerMessageEnvelope {
  if (!isRecord(message)) {
    return false;
  }

  return (
    message.type === "cosystem:worker" &&
    typeof message.channel === "string" &&
    typeof message.source === "string" &&
    (message.target === undefined || typeof message.target === "string") &&
    (message.auth === undefined || typeof message.auth === "string") &&
    isWorkerMessage(message.message)
  );
}

function isWorkerMessageId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isWorkerStateVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isOptionalWorkerStateVersion(value: unknown): boolean {
  return value === undefined || isWorkerStateVersion(value);
}

function isSerializedWorkerError(value: unknown): value is SerializedWorkerError {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.message === "string" &&
    (value.stack === undefined || typeof value.stack === "string")
  );
}

function isUnsafeWorkerPathSegment(segment: PatchPathSegment): boolean {
  return segment === "__proto__" || segment === "constructor" || segment === "prototype";
}

function isAllowedPostMessageOrigin(origin: string, allowedOrigins: readonly string[]): boolean {
  return allowedOrigins.includes("*") || allowedOrigins.includes(origin);
}

function assertValidWorkerTimeout(timeout: number, option: string): void {
  if (!Number.isFinite(timeout) || timeout < 0) {
    throw new CosystemError(`${option} must be a finite, non-negative number.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializeError(error: unknown): SerializedWorkerError {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }

  return {
    message: String(error),
    name: "Error",
  };
}

function createRemoteError(error: SerializedWorkerError): CosystemError {
  const remoteError = new CosystemError(`Remote worker error: ${error.message}`);
  remoteError.name = error.name;

  if (error.stack !== undefined) {
    remoteError.stack = error.stack;
  }

  return remoteError;
}

function noop(): void {}
