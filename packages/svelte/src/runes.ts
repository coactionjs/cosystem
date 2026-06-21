import { createSubscriber } from "svelte/reactivity";

import type {
  App,
  AsyncMethodProxy,
  InjectionToken,
  WorkerClient,
  WorkerStateSelector,
} from "@cosystem/core";

import { getCoSystemApp, getWorkerClient } from "./index.js";

export interface RuneSelectorOptions<T> {
  readonly app?: App;
  readonly equals?: (value: T, previous: T) => boolean;
}

export interface ModuleRuneOptions {
  readonly app?: App;
}

export interface WorkerRuneSelectorOptions<T> {
  readonly client?: WorkerClient;
  readonly equals?: (value: T, previous: T) => boolean;
}

export interface WorkerModuleRuneOptions {
  readonly client?: WorkerClient;
}

export interface CoSystemRune<T> {
  readonly current: T;
  readonly value: T;
  get(): T;
}

export type AppSelector<T> = (app: App) => T;
export type ModuleSelector<TModule, TValue> = (module: TModule, app: App) => TValue;

export function moduleRune<T>(
  token: InjectionToken<T>,
  options: ModuleRuneOptions = {},
): CoSystemRune<T> {
  return selectorRune((app) => app.getModule(token), options);
}

export function workerModuleRune<T extends object>(
  name: string,
  options: WorkerModuleRuneOptions = {},
): CoSystemRune<AsyncMethodProxy<T>> {
  const client = options.client ?? getWorkerClient();
  const proxy = client.module<T>(name);

  return {
    get current() {
      return proxy;
    },
    get value() {
      return proxy;
    },
    get() {
      return proxy;
    },
  };
}

export function selectorRune<T>(
  selector: AppSelector<T>,
  options: RuneSelectorOptions<T> = {},
): CoSystemRune<T> {
  const app = options.app ?? getCoSystemApp();
  const equals = options.equals ?? Object.is;
  let current = selector(app);
  const subscribe = createSubscriber((update) =>
    app.watch(
      () => selector(app),
      (value) => {
        if (equals(value, current)) {
          return;
        }

        current = value;
        update();
      },
      { equals },
    ),
  );

  const read = () => {
    subscribe();

    const next = selector(app);

    if (!equals(next, current)) {
      current = next;
    }

    return current;
  };

  return {
    get current() {
      return read();
    },
    get value() {
      return read();
    },
    get() {
      return read();
    },
  };
}

export function workerSelectorRune<T>(
  selector: WorkerStateSelector<T>,
  options: WorkerRuneSelectorOptions<T> = {},
): CoSystemRune<T> {
  const client = options.client ?? getWorkerClient();
  const equals = options.equals ?? Object.is;
  let current = client.select(selector);
  const subscribe = createSubscriber((update) =>
    client.watch(
      selector,
      (value) => {
        if (equals(value, current)) {
          return;
        }

        current = value;
        update();
      },
      { equals },
    ),
  );

  const read = () => {
    subscribe();

    const next = client.select(selector);

    if (!equals(next, current)) {
      current = next;
    }

    return current;
  };

  return {
    get current() {
      return read();
    },
    get value() {
      return read();
    },
    get() {
      return read();
    },
  };
}

export function selectedModuleRune<TModule, TValue>(
  token: InjectionToken<TModule>,
  selector: ModuleSelector<TModule, TValue>,
  options: RuneSelectorOptions<TValue> = {},
): CoSystemRune<TValue> {
  return selectorRune((app) => selector(app.getModule(token), app), options);
}
