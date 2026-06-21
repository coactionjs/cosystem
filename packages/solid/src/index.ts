import {
  createContext,
  createSignal,
  onCleanup,
  useContext,
  type Accessor,
  type Context,
  type JSX,
} from "solid-js";

import { CosystemError, type App, type InjectionToken } from "@cosystem/core";

export interface CoSystemProviderProps {
  readonly app: App;
  readonly children?: JSX.Element;
}

export interface UseComputedOptions<T> {
  readonly equals?: (value: T, previous: T) => boolean;
}

export type AppSelector<T> = (app: App) => T;
export type ModuleSelector<TModule, TValue> = (module: TModule, app: App) => TValue;

export const CoSystemContext: Context<App | undefined> = createContext<App>();

export function CoSystemProvider(props: CoSystemProviderProps): JSX.Element {
  return CoSystemContext.Provider({
    get children() {
      return props.children;
    },
    value: props.app,
  });
}

export function useApp(): App {
  const app = useContext(CoSystemContext);

  if (app === undefined) {
    throw new CosystemError("Missing Solid CoSystemProvider.");
  }

  return app;
}

export function useModule<T>(token: InjectionToken<T>): T {
  return useApp().getModule(token);
}

export function useComputed<T>(
  selector: AppSelector<T>,
  options?: UseComputedOptions<T>,
): Accessor<T>;
export function useComputed<TModule, TValue>(
  token: InjectionToken<TModule>,
  selector: ModuleSelector<TModule, TValue>,
  options?: UseComputedOptions<TValue>,
): Accessor<TValue>;
export function useComputed<TModule, TValue>(
  first: AppSelector<TValue> | InjectionToken<TModule>,
  second?: ModuleSelector<TModule, TValue> | UseComputedOptions<TValue>,
  third?: UseComputedOptions<TValue>,
): Accessor<TValue> {
  const app = useApp();
  const selector =
    typeof second === "function"
      ? (currentApp: App) =>
          second(currentApp.getModule(first as InjectionToken<TModule>), currentApp)
      : (first as AppSelector<TValue>);
  const options = typeof second === "function" ? third : second;
  const equals = options?.equals ?? Object.is;
  const [value, setValue] = createSignal(selector(app), { equals });
  const unsubscribe = app.watch(
    () => selector(app),
    (next) => {
      setValue(() => next);
    },
    { equals },
  );

  onCleanup(unsubscribe);

  return value;
}
