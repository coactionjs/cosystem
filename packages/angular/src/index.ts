import {
  DestroyRef,
  InjectionToken,
  inject,
  makeEnvironmentProviders,
  signal,
  type EnvironmentProviders,
  type Signal,
} from "@angular/core";

import {
  type App,
  type AsyncMethodProxy,
  type InjectionToken as CoSystemToken,
  type WorkerClient,
  type WorkerStateSelector,
} from "@cosystem/core";

export interface InjectSignalOptions<T> {
  readonly equals?: (value: T, previous: T) => boolean;
}

export type AppSelector<T> = (app: App) => T;
export type ModuleSelector<TModule, TValue> = (module: TModule, app: App) => TValue;

export const COSYSTEM_APP: InjectionToken<App> = new InjectionToken<App>("CoSystem App");
export const COSYSTEM_WORKER_CLIENT: InjectionToken<WorkerClient> =
  new InjectionToken<WorkerClient>("CoSystem WorkerClient");

export function provideCoSystem(app: App): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: COSYSTEM_APP,
      useValue: app,
    },
  ]);
}

export function provideWorkerClient(client: WorkerClient): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: COSYSTEM_WORKER_CLIENT,
      useValue: client,
    },
  ]);
}

export function injectCoSystemApp(): App {
  return inject(COSYSTEM_APP);
}

export function injectModule<T>(token: CoSystemToken<T>): T {
  return injectCoSystemApp().getModule(token);
}

export function injectWorkerClient(): WorkerClient {
  return inject(COSYSTEM_WORKER_CLIENT);
}

export function injectWorkerModule<T extends object>(name: string): AsyncMethodProxy<T> {
  return injectWorkerClient().module<T>(name);
}

export function injectWorkerSignal<T>(
  selector: WorkerStateSelector<T>,
  options?: InjectSignalOptions<T>,
): Signal<T> {
  const client = injectWorkerClient();
  const destroyRef = inject(DestroyRef);
  const equals = options?.equals ?? Object.is;
  const value = signal(client.select(selector), { equal: equals });
  const unsubscribe = client.watch(
    selector,
    (next) => {
      value.set(next);
    },
    { equals },
  );

  destroyRef.onDestroy(unsubscribe);

  return value.asReadonly();
}

export function injectSignal<T>(
  selector: AppSelector<T>,
  options?: InjectSignalOptions<T>,
): Signal<T>;
export function injectSignal<TModule, TValue>(
  token: CoSystemToken<TModule>,
  selector: ModuleSelector<TModule, TValue>,
  options?: InjectSignalOptions<TValue>,
): Signal<TValue>;
export function injectSignal<TModule, TValue>(
  first: AppSelector<TValue> | CoSystemToken<TModule>,
  second?: ModuleSelector<TModule, TValue> | InjectSignalOptions<TValue>,
  third?: InjectSignalOptions<TValue>,
): Signal<TValue> {
  const app = injectCoSystemApp();
  const destroyRef = inject(DestroyRef);
  const selector =
    typeof second === "function"
      ? (currentApp: App) =>
          second(currentApp.getModule(first as CoSystemToken<TModule>), currentApp)
      : (first as AppSelector<TValue>);
  const options = typeof second === "function" ? third : second;
  const equals = options?.equals ?? Object.is;
  const value = signal(selector(app), { equal: equals });
  const unsubscribe = app.watch(
    () => selector(app),
    (next) => {
      value.set(next);
    },
    { equals },
  );

  destroyRef.onDestroy(unsubscribe);

  return value.asReadonly();
}
