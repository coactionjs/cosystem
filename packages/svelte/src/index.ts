import { getContext, hasContext, setContext } from "svelte";
import { readable, type Readable } from "svelte/store";

import {
  CosystemError,
  type App,
  type AsyncMethodProxy,
  type InjectionToken,
  type WorkerClient,
  type WorkerStateSelector,
} from "@cosystem/core";

export interface SelectorStoreOptions<T> {
  readonly equals?: (value: T, previous: T) => boolean;
}

export type AppSelector<T> = (app: App) => T;
export type ModuleSelector<TModule, TValue> = (module: TModule, app: App) => TValue;

export const CoSystemContextKey: unique symbol = Symbol("CoSystem");
export const WorkerClientContextKey: unique symbol = Symbol("CoSystem WorkerClient");

let defaultApp: App | undefined;
let defaultWorkerClient: WorkerClient | undefined;

export function setCoSystemApp(app: App): App {
  defaultApp = app;
  return app;
}

export function clearCoSystemApp(): void {
  defaultApp = undefined;
}

export function setWorkerClient(client: WorkerClient): WorkerClient {
  defaultWorkerClient = client;
  return client;
}

export function clearWorkerClient(): void {
  defaultWorkerClient = undefined;
}

export function setCoSystemContext(app: App): App {
  setContext(CoSystemContextKey, app);
  return app;
}

export function setWorkerClientContext(client: WorkerClient): WorkerClient {
  setContext(WorkerClientContextKey, client);
  return client;
}

export function getCoSystemApp(): App {
  if (defaultApp !== undefined) {
    return defaultApp;
  }

  const contextApp = getCoSystemContextApp();

  if (contextApp !== undefined) {
    return contextApp;
  }

  throw new CosystemError(
    "Missing CoSystem Svelte app. Call setCoSystemApp(app) or setCoSystemContext(app).",
  );
}

export function getWorkerClient(): WorkerClient {
  if (defaultWorkerClient !== undefined) {
    return defaultWorkerClient;
  }

  const contextClient = getWorkerContextClient();

  if (contextClient !== undefined) {
    return contextClient;
  }

  throw new CosystemError(
    "Missing CoSystem Svelte worker client. Call setWorkerClient(client) or setWorkerClientContext(client).",
  );
}

export function moduleStore<T>(token: InjectionToken<T>, app?: App): Readable<T> {
  const resolvedApp = app ?? getCoSystemApp();
  return selectorStore(() => resolvedApp.getModule(token), { app: resolvedApp });
}

export function workerModuleStore<T extends object>(
  name: string,
  client?: WorkerClient,
): Readable<AsyncMethodProxy<T>> {
  const resolvedClient = client ?? getWorkerClient();
  return readable(resolvedClient.module<T>(name));
}

export function workerSelectorStore<T>(
  selector: WorkerStateSelector<T>,
  options: SelectorStoreOptions<T> & { readonly client?: WorkerClient } = {},
): Readable<T> {
  const client = options.client ?? getWorkerClient();
  const equals = options.equals ?? Object.is;

  return readable(client.select(selector), (set) => {
    let current = client.select(selector);
    set(current);

    return client.watch(
      selector,
      (value) => {
        if (equals(value, current)) {
          return;
        }

        current = value;
        set(value);
      },
      { equals },
    );
  });
}

export function selectorStore<T>(
  selector: AppSelector<T>,
  options: SelectorStoreOptions<T> & { readonly app?: App } = {},
): Readable<T> {
  const app = options.app ?? getCoSystemApp();
  const equals = options.equals ?? Object.is;

  return readable(selector(app), (set) => {
    let current = selector(app);
    set(current);

    return app.watch(
      () => selector(app),
      (value) => {
        if (equals(value, current)) {
          return;
        }

        current = value;
        set(value);
      },
      { equals },
    );
  });
}

export function selectedModuleStore<TModule, TValue>(
  token: InjectionToken<TModule>,
  selector: ModuleSelector<TModule, TValue>,
  options: SelectorStoreOptions<TValue> & { readonly app?: App } = {},
): Readable<TValue> {
  return selectorStore((app) => selector(app.getModule(token), app), options);
}

function getCoSystemContextApp(): App | undefined {
  try {
    return hasContext(CoSystemContextKey) ? getContext<App>(CoSystemContextKey) : undefined;
  } catch {
    return undefined;
  }
}

function getWorkerContextClient(): WorkerClient | undefined {
  try {
    return hasContext(WorkerClientContextKey)
      ? getContext<WorkerClient>(WorkerClientContextKey)
      : undefined;
  } catch {
    return undefined;
  }
}
