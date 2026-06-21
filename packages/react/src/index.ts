import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useRef,
  useSyncExternalStore,
  type Context,
  type ReactElement,
  type ReactNode,
} from "react";

import { CosystemError, type App, type InjectionToken } from "@cosystem/core";

export interface CoSystemProviderProps {
  readonly app: App;
  readonly children?: ReactNode;
}

export interface UseSelectorOptions<T> {
  readonly equals?: (value: T, previous: T) => boolean;
}

export type AppSelector<T> = (app: App) => T;
export type ModuleSelector<TModule, TValue> = (module: TModule, app: App) => TValue;

export const CoSystemContext: Context<App | null> = createContext<App | null>(null);

export function CoSystemProvider({ app, children }: CoSystemProviderProps): ReactElement {
  return createElement(CoSystemContext.Provider, { value: app }, children);
}

export function useCoSystem(): App {
  const app = useContext(CoSystemContext);

  if (app === null) {
    throw new CosystemError("Missing CoSystemProvider.");
  }

  return app;
}

export function useApp(): App {
  return useCoSystem();
}

export function useModule<T>(token: InjectionToken<T>): T {
  return useCoSystem().getModule(token);
}

export function useSelector<T>(selector: AppSelector<T>, options?: UseSelectorOptions<T>): T;
export function useSelector<TModule, TValue>(
  token: InjectionToken<TModule>,
  selector: ModuleSelector<TModule, TValue>,
  options?: UseSelectorOptions<TValue>,
): TValue;
export function useSelector<TModule, TValue>(
  first: AppSelector<TValue> | InjectionToken<TModule>,
  second?: ModuleSelector<TModule, TValue> | UseSelectorOptions<TValue>,
  third?: UseSelectorOptions<TValue>,
): TValue {
  const app = useCoSystem();
  const selector =
    typeof second === "function"
      ? (currentApp: App) =>
          second(currentApp.getModule(first as InjectionToken<TModule>), currentApp)
      : (first as AppSelector<TValue>);
  const options = typeof second === "function" ? third : second;

  return useSelectedValue(app, selector, options ?? {});
}

function useSelectedValue<T>(
  app: App,
  selector: AppSelector<T>,
  options: UseSelectorOptions<T>,
): T {
  const selectorRef = useRef(selector);
  const equalsRef = useRef(options.equals ?? objectIs);
  const snapshotRef = useRef<{ readonly value: T }>(undefined);

  selectorRef.current = selector;
  equalsRef.current = options.equals ?? objectIs;

  const getSnapshot = useCallback(() => {
    const next = selectorRef.current(app);
    const current = snapshotRef.current;

    if (current === undefined || !equalsRef.current(next, current.value)) {
      const snapshot = { value: next };
      snapshotRef.current = snapshot;
      return snapshot.value;
    }

    return current.value;
  }, [app]);

  const subscribe = useCallback(
    (notify: () => void) =>
      app.watch(
        () => selectorRef.current(app),
        (value) => {
          const current = snapshotRef.current;

          if (current !== undefined && equalsRef.current(value, current.value)) {
            return;
          }

          snapshotRef.current = { value };
          notify();
        },
        {
          equals: (value, previous) => equalsRef.current(value, previous),
        },
      ),
    [app],
  );

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function objectIs<T>(value: T, previous: T): boolean {
  return Object.is(value, previous);
}
