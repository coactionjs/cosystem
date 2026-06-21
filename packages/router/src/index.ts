import {
  provide,
  token,
  type App,
  type Plugin,
  type ProviderInput,
  type Token,
} from "@cosystem/core";

export interface RouteLocation {
  readonly path: string;
  readonly search: string;
  readonly hash: string;
}

export interface Router {
  readonly current: RouteLocation;
  navigate(to: string | RouteLocation): void;
  subscribe(listener: (location: RouteLocation) => void): () => void;
}

export interface RouterOptions {
  readonly initialPath?: string;
}

export interface BrowserRouterOptions {
  readonly window?: BrowserWindowLike;
}

export interface BrowserWindowLike {
  readonly location: BrowserLocationLike;
  readonly history: BrowserHistoryLike;
  addEventListener(type: "popstate", listener: () => void): void;
  removeEventListener(type: "popstate", listener: () => void): void;
}

export interface BrowserLocationLike {
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
}

export interface BrowserHistoryLike {
  pushState(data: unknown, unused: string, url?: string | URL | null): void;
}

export interface RouterPluginOptions {
  readonly immediate?: boolean;
  readonly onChange?: (location: RouteLocation, app: App) => void | Promise<void>;
  readonly onError?: (error: unknown) => void;
}

export const RouterToken: Token<Router> = token<Router>("CoSystem Router");

export function createMemoryRouter(options: RouterOptions = {}): Router {
  const listeners = new Set<(location: RouteLocation) => void>();
  let current = parseLocation(options.initialPath ?? "/");

  return {
    get current() {
      return current;
    },
    navigate(to) {
      current = typeof to === "string" ? parseLocation(to) : to;

      for (const listener of listeners) {
        listener(current);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function createBrowserRouter(options: BrowserRouterOptions = {}): Router {
  const targetWindow = options.window ?? resolveGlobalWindow();
  const listeners = new Set<(location: RouteLocation) => void>();
  let current = readBrowserLocation(targetWindow.location);
  let listening = false;

  const notify = () => {
    current = readBrowserLocation(targetWindow.location);

    for (const listener of listeners) {
      listener(current);
    }
  };

  const start = () => {
    if (listening) {
      return;
    }

    listening = true;
    targetWindow.addEventListener("popstate", notify);
  };

  const stop = () => {
    if (!listening) {
      return;
    }

    listening = false;
    targetWindow.removeEventListener("popstate", notify);
  };

  return {
    get current() {
      return current;
    },
    navigate(to) {
      current = typeof to === "string" ? parseLocation(to) : to;
      targetWindow.history.pushState(null, "", formatLocation(current));

      for (const listener of listeners) {
        listener(current);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      start();

      return () => {
        listeners.delete(listener);

        if (listeners.size === 0) {
          stop();
        }
      };
    },
  };
}

export function createRouterPlugin(router: Router, options: RouterPluginOptions = {}): Plugin {
  let unsubscribe: (() => void) | undefined;

  return {
    name: "cosystem:router",
    setup(app) {
      const notify = (location: RouteLocation): void => {
        if (options.onChange === undefined) {
          return;
        }

        try {
          const result = options.onChange(location, app);

          if (isPromiseLike(result)) {
            void result.catch((error: unknown) => {
              options.onError?.(error);
            });
          }
        } catch (error) {
          options.onError?.(error);
        }
      };

      unsubscribe = router.subscribe(notify);

      if (options.immediate === true) {
        notify(router.current);
      }
    },
    dispose() {
      unsubscribe?.();
      unsubscribe = undefined;
    },
  };
}

export function provideRouter(router: Router = createMemoryRouter()): ProviderInput {
  return provide(RouterToken, { useValue: router });
}

export function parseLocation(value: string): RouteLocation {
  const hashIndex = value.indexOf("#");
  const withoutHash = hashIndex === -1 ? value : value.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : value.slice(hashIndex);
  const searchIndex = withoutHash.indexOf("?");
  const path = searchIndex === -1 ? withoutHash : withoutHash.slice(0, searchIndex);
  const search = searchIndex === -1 ? "" : withoutHash.slice(searchIndex);

  return {
    hash,
    path: path === "" ? "/" : path,
    search,
  };
}

export function formatLocation(location: RouteLocation): string {
  return `${location.path === "" ? "/" : location.path}${location.search}${location.hash}`;
}

function readBrowserLocation(location: BrowserLocationLike): RouteLocation {
  return {
    hash: location.hash,
    path: location.pathname === "" ? "/" : location.pathname,
    search: location.search,
  };
}

function resolveGlobalWindow(): BrowserWindowLike {
  const globalWithWindow = globalThis as { readonly window?: BrowserWindowLike };

  if (globalWithWindow.window !== undefined) {
    return globalWithWindow.window;
  }

  throw new Error("createBrowserRouter() requires a browser window.");
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as { readonly then?: unknown }).then === "function"
  );
}
