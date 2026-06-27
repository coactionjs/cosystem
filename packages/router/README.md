# @cosystem/router

> Embeddable router primitives for [CoSystem](../../README.md): a tiny `Router`
> interface, browser/memory implementations, a `RouterToken`, and a plugin that
> bridges route changes into the app lifecycle.

This package is intentionally minimal. It does not match routes, render views,
or own navigation UI — it provides a location source you can inject and observe,
plus helpers to wire it into a CoSystem app. Pair it with any UI adapter to react
to the current location.

## Installation

```sh
pnpm add @cosystem/router @cosystem/core
```

## Quick start

```ts
import {
  RouterToken,
  createBrowserRouter,
  createMemoryRouter,
  createRouterPlugin,
} from "@cosystem/router";
import { createApp } from "@cosystem/core";

const router =
  typeof window === "undefined" ? createMemoryRouter({ initialPath: "/" }) : createBrowserRouter();

const app = createApp({
  plugins: [
    createRouterPlugin(router, {
      onChange(location) {
        console.log(location.path);
      },
    }),
  ],
});

app.get(RouterToken).navigate("/settings");
```

## API

### Routers

- `createMemoryRouter({ initialPath? })` — in-memory router for SSR and tests.
- `createBrowserRouter({ window? })` — backed by `history.pushState` + `popstate`;
  reads `window` from the global by default, or accepts a `BrowserWindowLike`.

Both implement the `Router` interface:

```ts
interface Router {
  readonly current: RouteLocation; // { path, search, hash }
  navigate(to: string | RouteLocation): void;
  subscribe(listener: (location: RouteLocation) => void): () => void;
}
```

### Plugin

`createRouterPlugin(router, options)` returns a CoSystem `Plugin` that subscribes
to the router for the app's lifetime, unsubscribes on dispose, and provides
`RouterToken` for DI.

| Option      | Type                                       | Description                                          |
| ----------- | ------------------------------------------ | ---------------------------------------------------- |
| `onChange`  | `(location, app) => void \| Promise<void>` | Called on each navigation (may be async).            |
| `immediate` | `boolean`                                  | Also call `onChange` once with the current location. |
| `onError`   | `(error) => void`                          | Receives errors thrown/rejected by `onChange`.       |

### DI

- `RouterToken: Token<Router>` — inject the router anywhere (`app.get(RouterToken)`).
- `provideRouter(router?)` — a `ProviderInput` that binds `RouterToken` to the
  router (defaults to a fresh memory router). This is still useful when you want
  to provide a router without installing the plugin, or override the plugin's
  default router provider at the app level.

### Location helpers

- `parseLocation(value)` — parse a URL string into `{ path, search, hash }`.
- `formatLocation(location)` — serialize a `RouteLocation` back to a string.

## Exports

`createMemoryRouter`, `createBrowserRouter`, `createRouterPlugin`,
`provideRouter`, `RouterToken`, `parseLocation`, `formatLocation`, and the
`Router`, `RouteLocation`, `RouterOptions`, `BrowserRouterOptions`,
`RouterPluginOptions`, `BrowserWindowLike`, `BrowserLocationLike`,
`BrowserHistoryLike` types.

## License

[MIT](../../LICENSE) © Coaction
