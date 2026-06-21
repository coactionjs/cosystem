import {
  inject,
  onScopeDispose,
  provide,
  readonly,
  shallowRef,
  type App as VueApplication,
  type InjectionKey,
  type Plugin as VuePlugin,
  type Ref,
} from "vue";

import {
  CosystemError,
  type App,
  type AsyncMethodProxy,
  type InjectionToken,
  type WorkerClient,
  type WorkerStateSelector,
} from "@cosystem/core";

export interface UseSelectorOptions<T> {
  readonly equals?: (value: T, previous: T) => boolean;
}

export type AppSelector<T> = (app: App) => T;

export const CoSystemKey: InjectionKey<App> = Symbol("CoSystem");
export const WorkerClientKey: InjectionKey<WorkerClient> = Symbol("CoSystem WorkerClient");

export function provideCoSystem(app: App): App {
  provide(CoSystemKey, app);
  return app;
}

export function provideWorkerClient(client: WorkerClient): WorkerClient {
  provide(WorkerClientKey, client);
  return client;
}

export function cosystemPlugin(app: App): VuePlugin {
  return {
    install(vueApp: VueApplication) {
      vueApp.provide(CoSystemKey, app);
    },
  };
}

export function workerClientPlugin(client: WorkerClient): VuePlugin {
  return {
    install(vueApp: VueApplication) {
      vueApp.provide(WorkerClientKey, client);
    },
  };
}

export function useCoSystem(): App {
  const app = inject(CoSystemKey, null);

  if (app === null) {
    throw new CosystemError("Missing provideCoSystem(app).");
  }

  return app;
}

export function useApp(): App {
  return useCoSystem();
}

export function useModule<T>(token: InjectionToken<T>): T {
  return useCoSystem().getModule(token);
}

export function useWorkerClient(): WorkerClient {
  const client = inject(WorkerClientKey, null);

  if (client === null) {
    throw new CosystemError("Missing provideWorkerClient(client).");
  }

  return client;
}

export function useWorkerModule<T extends object>(name: string): AsyncMethodProxy<T> {
  return useWorkerClient().module<T>(name);
}

export function useWorkerSelector<T>(
  selector: WorkerStateSelector<T>,
  options: UseSelectorOptions<T> = {},
): Readonly<Ref<T>> {
  const client = useWorkerClient();
  const value = shallowRef(client.select(selector)) as Ref<T>;
  const watchOptions =
    options.equals === undefined
      ? undefined
      : {
          equals: options.equals,
        };
  const unsubscribe = client.watch(
    selector,
    (next) => {
      value.value = next;
    },
    watchOptions,
  );

  onScopeDispose(unsubscribe);

  return readonly(value) as Readonly<Ref<T>>;
}

export function useWorkerComputed<T>(
  selector: WorkerStateSelector<T>,
  options: UseSelectorOptions<T> = {},
): Readonly<Ref<T>> {
  return useWorkerSelector(selector, options);
}

export function useSelector<T>(
  selector: AppSelector<T>,
  options: UseSelectorOptions<T> = {},
): Readonly<Ref<T>> {
  const app = useCoSystem();
  const value = shallowRef(selector(app)) as Ref<T>;
  const watchOptions =
    options.equals === undefined
      ? undefined
      : {
          equals: options.equals,
        };
  const unsubscribe = app.watch(
    () => selector(app),
    (next) => {
      value.value = next;
    },
    watchOptions,
  );

  onScopeDispose(unsubscribe);

  return readonly(value) as Readonly<Ref<T>>;
}

export function useComputed<T>(
  selector: AppSelector<T>,
  options: UseSelectorOptions<T> = {},
): Readonly<Ref<T>> {
  return useSelector(selector, options);
}
