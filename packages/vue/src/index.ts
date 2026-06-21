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

import { CosystemError, type App, type InjectionToken } from "@cosystem/core";

export interface UseSelectorOptions<T> {
  readonly equals?: (value: T, previous: T) => boolean;
}

export type AppSelector<T> = (app: App) => T;

export const CoSystemKey: InjectionKey<App> = Symbol("CoSystem");

export function provideCoSystem(app: App): App {
  provide(CoSystemKey, app);
  return app;
}

export function cosystemPlugin(app: App): VuePlugin {
  return {
    install(vueApp: VueApplication) {
      vueApp.provide(CoSystemKey, app);
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
