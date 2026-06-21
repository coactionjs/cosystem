import {
  DestroyRef,
  InjectionToken,
  inject,
  makeEnvironmentProviders,
  signal,
  type EnvironmentProviders,
  type Signal,
} from "@angular/core";

import { type App, type InjectionToken as CoSystemToken } from "@cosystem/core";

export interface InjectSignalOptions<T> {
  readonly equals?: (value: T, previous: T) => boolean;
}

export type AppSelector<T> = (app: App) => T;
export type ModuleSelector<TModule, TValue> = (module: TModule, app: App) => TValue;

export const COSYSTEM_APP: InjectionToken<App> = new InjectionToken<App>("CoSystem App");

export function provideCoSystem(app: App): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: COSYSTEM_APP,
      useValue: app,
    },
  ]);
}

export function injectCoSystemApp(): App {
  return inject(COSYSTEM_APP);
}

export function injectModule<T>(token: CoSystemToken<T>): T {
  return injectCoSystemApp().getModule(token);
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
