import {
  inject,
  onScopeDispose,
  provide,
  readonly,
  shallowRef,
  type InjectionKey,
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

export function useCoSystem(): App {
  const app = inject(CoSystemKey, null);

  if (app === null) {
    throw new CosystemError("Missing provideCoSystem(app).");
  }

  return app;
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
