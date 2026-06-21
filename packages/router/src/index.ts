import { provide, token, type Plugin, type ProviderInput, type Token } from "@cosystem/core";

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

export function createRouterPlugin(router: Router): Plugin {
  let unsubscribe: (() => void) | undefined;

  return {
    name: "cosystem:router",
    setup() {
      unsubscribe = router.subscribe(() => undefined);
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
