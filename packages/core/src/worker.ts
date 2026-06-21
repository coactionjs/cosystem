import { CosystemError } from "./errors.js";
import { createApp, type App, type CreateAppOptions, type Plugin } from "./app.js";

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
}

export interface PostMessageTarget {
  postMessage(message: WorkerMessage): void;
}

export interface PostMessageEventLike {
  readonly data?: unknown;
}

export interface PostMessageSource {
  addEventListener(type: "message", listener: (event: PostMessageEventLike) => void): void;
  removeEventListener(type: "message", listener: (event: PostMessageEventLike) => void): void;
}

export interface PostMessageEndpoint extends PostMessageTarget, PostMessageSource {}

export interface PostMessageWorkerTransportOptions {
  readonly source?: PostMessageSource;
  readonly target?: PostMessageTarget;
  readonly onError?: (error: unknown, message: WorkerMessage) => void;
}

export type WorkerMessage =
  | WorkerCallMessage
  | WorkerResultMessage
  | WorkerStateMessage
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
  readonly value?: unknown;
  readonly error?: SerializedWorkerError;
}

export interface WorkerStateMessage {
  readonly type: "state";
  readonly state: unknown;
  readonly patches?: readonly unknown[];
  readonly sync: "patch" | "snapshot";
  readonly version: number;
}

export interface WorkerReadyMessage {
  readonly type: "ready";
}

export interface SerializedWorkerError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string;
}

export interface CreateWorkerAppOptions extends CreateAppOptions {
  readonly transport: WorkerTransport;
}

export interface WorkerAppHost {
  readonly app: App;
  readonly ready: Promise<void>;
  dispose(): Promise<void>;
}

export interface CreateWorkerClientOptions {
  readonly transport: WorkerTransport;
}

export type AsyncMethodProxy<T extends object> = {
  readonly [Key in keyof T as T[Key] extends (...args: any[]) => unknown
    ? Key
    : never]: T[Key] extends (...args: infer Args) => infer Return
    ? (...args: Args) => Promise<Awaited<Return>>
    : never;
};

export interface WorkerClient {
  readonly ready: Promise<void>;
  readonly state: {
    readonly version: number;
  };
  getState(): unknown;
  call(module: string, method: string, ...args: readonly unknown[]): Promise<unknown>;
  module<T extends object>(name: string): AsyncMethodProxy<T>;
  subscribe(listener: (message: WorkerStateMessage) => void): () => void;
  dispose(): void;
}

export function createWorkerApp(options: CreateWorkerAppOptions): WorkerAppHost {
  const { transport, ...appOptions } = options;
  let publishPatches = false;
  const patchPlugin: Plugin = {
    name: "cosystem:worker-patches",
    onPatch(event) {
      if (publishPatches) {
        publishState(app, transport, event.patches);
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
  const ready = app.start().then(() => {
    publishPatches = true;
    transport.post({ type: "ready" });
    publishState(app, transport);
    return undefined;
  });
  const unsubscribeTransport = transport.subscribe((message) => {
    if (message.type !== "call") {
      return;
    }

    void handleCall(app, transport, message, ready);
  });

  return {
    app,
    ready,
    async dispose() {
      unsubscribeTransport();
      await ready.catch(() => undefined);
      await app.dispose();
    },
  };
}

export function createWorkerClient(options: CreateWorkerClientOptions): WorkerClient {
  const { transport } = options;
  const listeners = new Set<(message: WorkerStateMessage) => void>();
  const pending = new Map<
    number,
    {
      readonly resolve: (value: unknown) => void;
      readonly reject: (error: unknown) => void;
    }
  >();
  const state = { version: 0 };
  let nextId = 1;
  let snapshot: unknown;
  let readySettled = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: unknown) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  ready.catch(() => undefined);

  const unsubscribe = transport.subscribe((message) => {
    if (message.type === "state") {
      state.version = message.version;
      snapshot = message.state;

      if (!readySettled) {
        readySettled = true;
        resolveReady();
      }

      for (const listener of listeners) {
        listener(message);
      }

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

    if (message.error !== undefined) {
      entry.reject(createRemoteError(message.error));
      return;
    }

    entry.resolve(message.value);
  });

  const client: WorkerClient = {
    ready,
    state,
    call(module, method, ...args) {
      const id = nextId;
      nextId += 1;

      return new Promise((resolve, reject) => {
        pending.set(id, { reject, resolve });
        transport.post({
          args,
          id,
          method,
          module,
          type: "call",
        });
      });
    },
    dispose() {
      unsubscribe();

      if (!readySettled) {
        readySettled = true;
        rejectReady(new CosystemError("Worker client disposed before initial state."));
      }

      for (const entry of pending.values()) {
        entry.reject(new CosystemError("Worker client disposed before response."));
      }

      pending.clear();
      listeners.clear();
    },
    getState() {
      return snapshot;
    },
    module<T extends object>(name: string): AsyncMethodProxy<T> {
      return new Proxy(
        {},
        {
          get(_target, property) {
            if (typeof property !== "string") {
              return undefined;
            }

            return (...args: readonly unknown[]) => client.call(name, property, ...args);
          },
        },
      ) as AsyncMethodProxy<T>;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return client;
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
        // eslint-disable-next-line unicorn/require-post-message-target-origin -- Worker and MessagePort endpoints do not consistently accept targetOrigin.
        target.postMessage(message);
      } catch (error) {
        options.onError?.(error, message);
      }
    },
    subscribe(listener) {
      const handleMessage = (event: PostMessageEventLike) => {
        if (!isWorkerMessage(event.data)) {
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

    for (const type of workerMessageTypes) {
      const dispose = dataTransport.listen(type, (message) => {
        if (!isWorkerMessage(message)) {
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
  };

  const stop = () => {
    if (!listening) {
      return;
    }

    listening = false;

    for (const dispose of disposers.splice(0)) {
      dispose();
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
          options.onError?.(error, message);
        });
    },
    subscribe(listener) {
      start();
      listeners.add(listener);

      return () => {
        listeners.delete(listener);

        if (listeners.size === 0) {
          stop();
        }
      };
    },
  };
}

async function handleCall(
  app: App,
  transport: WorkerTransport,
  message: WorkerCallMessage,
  ready: Promise<void>,
): Promise<void> {
  try {
    await ready;
    const module = app.getModuleByName<Record<string, unknown>>(message.module);
    const method = module[message.method];

    if (typeof method !== "function") {
      throw new CosystemError(`${message.module}.${message.method} is not callable.`);
    }

    const value = await method.apply(module, message.args);
    transport.post({
      id: message.id,
      type: "result",
      value,
    });
  } catch (error) {
    transport.post({
      error: serializeError(error),
      id: message.id,
      type: "result",
    });
  }
}

function publishState(
  app: App,
  transport: WorkerTransport,
  patches: readonly unknown[] = [],
): void {
  const message: WorkerStateMessage = {
    state: app.store.getPureState(),
    sync: patches.length > 0 ? "patch" : "snapshot",
    type: "state",
    version: app.state.version,
    ...(patches.length === 0 ? {} : { patches }),
  };

  transport.post(message);
}

function createMemoryWorkerTransport(
  inbox: Set<(message: WorkerMessage) => void>,
  outbox: Set<(message: WorkerMessage) => void>,
): WorkerTransport {
  return {
    post(message) {
      for (const listener of outbox) {
        listener(message);
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

const workerMessageTypes = ["call", "result", "state", "ready"] as const;

function isWorkerMessage(message: unknown): message is WorkerMessage {
  if (typeof message !== "object" || message === null || !("type" in message)) {
    return false;
  }

  return workerMessageTypes.includes(
    (message as { readonly type?: unknown }).type as WorkerMessage["type"],
  );
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
