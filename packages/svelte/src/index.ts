import { getContext, hasContext, setContext } from "svelte";
import { readable, type Readable } from "svelte/store";

import { CosystemError, type App, type InjectionToken } from "@cosystem/core";

export interface SelectorStoreOptions<T> {
  readonly equals?: (value: T, previous: T) => boolean;
}

export type AppSelector<T> = (app: App) => T;
export type ModuleSelector<TModule, TValue> = (module: TModule, app: App) => TValue;

export const CoSystemContextKey: unique symbol = Symbol("CoSystem");

let defaultApp: App | undefined;

export function setCoSystemApp(app: App): App {
  defaultApp = app;
  return app;
}

export function clearCoSystemApp(): void {
  defaultApp = undefined;
}

export function setCoSystemContext(app: App): App {
  setContext(CoSystemContextKey, app);
  return app;
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

export function moduleStore<T>(token: InjectionToken<T>, app?: App): Readable<T> {
  const resolvedApp = app ?? getCoSystemApp();
  return selectorStore(() => resolvedApp.getModule(token), { app: resolvedApp });
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
